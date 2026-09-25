// SPDX-License-Identifier: GPL-3.0-only
use once_cell::sync::Lazy;
use regex::Regex;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::certs;
use crate::engine::{self, quiet_command};
use crate::jobs::{self, Job, Trim};
use crate::link::{self, DetectedLink};
use crate::settings::{self, Settings};
use crate::spotify::{self, Track};
use crate::terms;

/// Returned when yt-dlp or FFmpeg has not been installed yet.
const SETUP_REQUIRED: &str = "SETUP_REQUIRED";

/// Trims silence from both ends of the audio (the second pass runs on the
/// reversed stream).
const SILENCE_FILTER: &str = "silenceremove=start_periods=1:start_silence=0.1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-50dB,areverse";

/// Blurred-background 9:16 re-frame: the original sits centered over a
/// blurred, cropped copy of itself.
const VERTICAL_FILTER: &str = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]";

/// How far a YouTube upload's length may differ from the Spotify track's and
/// still count as the same recording. Official audio matches to about a second;
/// music videos with an intro, live cuts and remixes do not.
const DURATION_TOLERANCE_SECS: f64 = 4.0;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static VIDEO_SIZE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Video:.*?,\s(\d{2,5})x(\d{2,5})[\s,\[]").unwrap());
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn new_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

/// Starts a download in the background and returns its job id. Progress and
/// the result arrive through the `jobs-changed` event.
#[tauri::command]
pub fn start_download(
    app: AppHandle,
    url: String,
    format: String,
    trim: Option<Trim>,
    quality: Option<String>,
) -> Result<String, String> {
    if !terms::is_accepted() {
        return Err("Terms of Use not accepted".into());
    }
    if format != "mp3" && format != "mp4" {
        return Err(format!("Unsupported format: {format}"));
    }
    if let Some(range) = trim {
        validate_trim(range)?;
    }
    let quality = quality.unwrap_or_else(|| "best".to_string());
    validate_quality(&format, &quality)?;

    let link = link::detect(&url).ok_or("This link isn't supported")?;
    if link.platform == "Spotify" && format == "mp4" {
        return Err("Spotify links can only be saved as MP3".into());
    }
    if engine::resolve(&app, "yt-dlp").is_none() || engine::resolve(&app, "ffmpeg").is_none() {
        return Err(SETUP_REQUIRED.into());
    }

    let id = new_id();
    jobs::add(
        &app,
        Job {
            id: id.clone(),
            url: link.url.clone(),
            platform: link.platform.clone(),
            format: format.clone(),
            title: None,
            status: "running".into(),
            stage: "starting".into(),
            percent: 0.0,
            path: None,
            error: None,
            error_kind: None,
            created_at: now_secs(),
            trim,
            quality: quality.clone(),
        },
    );

    let handle = app.clone();
    let job_id = id.clone();
    thread::spawn(move || match run(&handle, &job_id, &link, &format, trim, &quality) {
        Ok(path) => jobs::update(&handle, &job_id, |job| {
            if job.status == "running" {
                job.status = "done".into();
                job.percent = 100.0;
                job.path = Some(path);
            }
        }),
        Err(message) => jobs::update(&handle, &job_id, |job| {
            if job.status == "running" {
                job.status = "error".into();
                job.error_kind = certs::kind_of_message(&message).map(str::to_string);
                job.error = Some(message);
            }
        }),
    });

    Ok(id)
}

/// A Spotify track, looked for on a public site instead. Says what to search
/// for and how to name and tag the file so it reads like the Spotify track.
struct SpotifyPlan {
    /// A yt-dlp search, such as `ytsearch6:The Weeknd - Blinding Lights audio`.
    query: String,
    /// Keeps only results whose length matches the track's.
    filter: Option<String>,
    /// File name without the extension: "The Weeknd - Blinding Lights".
    file_stem: String,
    title: String,
    artists: String,
}

/// Search attempts for a track, strictest first: results whose length matches
/// Spotify's, then simply the top result.
fn spotify_plans(track: &Track) -> Vec<SpotifyPlan> {
    let file_stem = sanitize_file_name(&format!("{} - {}", track.artist_line(), track.title));
    let search = format!("{} - {} audio", track.artist_line(), track.title);
    let plan = |query: String, filter: Option<String>| SpotifyPlan {
        query,
        filter,
        file_stem: file_stem.clone(),
        title: track.title.clone(),
        artists: track.artist_line(),
    };

    let mut plans = Vec::new();
    if let Some(seconds) = track.duration_secs {
        plans.push(plan(format!("ytsearch6:{search}"), Some(duration_filter(seconds))));
    }
    plans.push(plan(format!("ytsearch1:{search}"), None));
    plans
}

/// yt-dlp `--match-filter` keeping results within the tolerance of `seconds`.
fn duration_filter(seconds: f64) -> String {
    let low = (seconds - DURATION_TOLERANCE_SECS).floor().max(0.0) as u64;
    let high = (seconds + DURATION_TOLERANCE_SECS).ceil() as u64;
    format!("duration >= {low} & duration <= {high}")
}

/// A name that is safe on Windows, macOS and Linux.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let limited: String = collapsed.chars().take(150).collect();
    limited.trim_matches(|c: char| c == '.' || c == ' ').to_string()
}

/// yt-dlp reads `%` in an output template as a field; a literal one is `%%`.
fn escape_template(text: &str) -> String {
    text.replace('%', "%%")
}

/// A value that can sit inside double quotes in yt-dlp's argument string.
fn tag_value(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .collect::<String>()
        .trim()
        .to_string()
}

/// Reads lines from a stream without ever stopping at bytes that are not valid
/// UTF-8. `BufRead::lines` ends at the first such line, which would silently
/// drop everything after an accented title, including the saved file's path.
fn lossy_lines<R: BufRead>(mut reader: R) -> impl Iterator<Item = String> {
    std::iter::from_fn(move || {
        let mut buffer = Vec::new();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&buffer).trim_end_matches(['\r', '\n']).to_string()),
        }
    })
}

/// How one yt-dlp run ended.
enum Outcome {
    File(String),
    /// It finished without error but saved nothing, e.g. no search result passed the filter.
    NothingFound,
}

/// Runs the whole pipeline for one job and returns the final file path.
fn run(
    app: &AppHandle,
    id: &str,
    link: &DetectedLink,
    format: &str,
    trim: Option<Trim>,
    quality: &str,
) -> Result<String, String> {
    let yt_dlp = engine::resolve(app, "yt-dlp").ok_or(SETUP_REQUIRED)?;
    let ffmpeg = engine::resolve(app, "ffmpeg").ok_or(SETUP_REQUIRED)?;
    // Certificates are always checked, and always against the system's store as
    // well: make sure the plugin that does so is still in place.
    engine::sync_certificate_plugin(app);
    let settings = settings::current(app);
    let out_dir = settings::save_dir(&settings)?;
    let is_spotify = link.platform == "Spotify";

    // Spotify streams are protected: read which track this is, then find the
    // same recording on a public site.
    let plans = if is_spotify {
        let track = spotify::lookup(&link.url, settings.allow_untrusted_certificates)?;
        jobs::update(app, id, |job| job.title = Some(track.label()));
        spotify_plans(&track)
    } else {
        Vec::new()
    };
    let attempts: Vec<Option<&SpotifyPlan>> = if plans.is_empty() {
        vec![None]
    } else {
        plans.iter().map(Some).collect()
    };

    let mut found: Option<String> = None;
    for spotify in attempts {
        let source = spotify.map_or_else(|| link.url.clone(), |plan| plan.query.clone());
        let args = build_args(&Plan {
            settings: &settings,
            link,
            format,
            ffmpeg: &ffmpeg,
            out_dir: &out_dir,
            source: &source,
            trim,
            quality,
            spotify,
        });
        if let Outcome::File(path) = execute(app, id, &yt_dlp, &args, format, is_spotify)? {
            found = Some(path);
            break;
        }
    }

    let mut path = found.ok_or(if is_spotify {
        "Couldn't find this track's audio online"
    } else {
        "The download finished but the file could not be found"
    })?;

    // Cancel stops these post-processing steps too, not only the download.
    let tether = Tether {
        started: &|child| jobs::register_child(app, id, child),
        finished: &|| jobs::unregister_child(app, id),
        canceled: &|| jobs::is_canceled(app, id),
    };
    let announce = || {
        jobs::update(app, id, |job| {
            job.stage = "converting".into();
            job.percent = job.percent.max(96.0);
        })
    };

    if format == "mp4" {
        // The best quality some sites offer (TikTok's 1080p is HEVC) is a format
        // Windows cannot play without a paid extension: make it play everywhere.
        make_playable(&ffmpeg, Path::new(&path), &tether, &announce)?;

        if settings.vertical_916 {
            path = to_vertical(&ffmpeg, &path, &tether, &announce)?;
        }
    } else if format == "mp3" && settings.trim_audio_silence {
        trim_silence(&ffmpeg, &path, quality, &tether, &announce)?;
    }

    Ok(path)
}

/// Runs yt-dlp once, following its progress, and reports what it saved.
fn execute(
    app: &AppHandle,
    id: &str,
    yt_dlp: &Path,
    args: &[String],
    format: &str,
    is_spotify: bool,
) -> Result<Outcome, String> {
    let mut command = quiet_command(yt_dlp);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start yt-dlp: {e}"))?;

    let stdout = child.stdout.take().ok_or("Could not read yt-dlp output")?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    jobs::register_child(app, id, child.clone());

    let errors: Arc<Mutex<Vec<String>>> = Arc::default();
    let error_reader = stderr.map(|stderr| {
        let errors = errors.clone();
        thread::spawn(move || {
            for line in lossy_lines(BufReader::new(stderr)) {
                if let Ok(mut lines) = errors.lock() {
                    lines.push(line);
                }
            }
        })
    });

    let mut final_path: Option<String> = None;
    let mut segment = 0u32;
    let mut last_bytes = 0.0f64;
    let mut best = 0.0f32;
    let mut last_reported = 0.0f32;

    for line in lossy_lines(BufReader::new(stdout)) {
        if let Some(title) = line.strip_prefix("CG_TITLE:") {
            let title = title.trim().to_string();
            // A Spotify track keeps the "Artist – Title" label found earlier.
            if !is_spotify && !title.is_empty() && title != "NA" {
                jobs::update(app, id, |job| job.title = Some(title));
            }
        } else if let Some(path) = line.strip_prefix("CG_PATH:") {
            final_path = Some(path.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("CG_PROGRESS:") {
            // Fields are "NA" when unknown and floats for estimated totals.
            let mut parts = rest.split(':').map(|p| p.trim().parse::<f64>().ok());
            let downloaded = parts.next().flatten().unwrap_or(0.0);
            let exact_total = parts.next().flatten();
            let estimated_total = parts.next().flatten();
            let total = exact_total.or(estimated_total).unwrap_or(0.0);
            if total <= 0.0 {
                continue;
            }
            // yt-dlp restarts at 0% for each stream (video, then audio).
            if downloaded < last_bytes {
                segment += 1;
            }
            last_bytes = downloaded;

            let fraction = (downloaded / total).clamp(0.0, 1.0) as f32 * 100.0;
            let overall = match (format, segment) {
                ("mp4", 0) => fraction * 0.85,
                ("mp4", _) => 85.0 + fraction * 0.10,
                _ => fraction * 0.95,
            };
            best = best.max(overall);
            if best - last_reported >= 1.0 {
                last_reported = best;
                jobs::update(app, id, |job| {
                    job.stage = "downloading".into();
                    job.percent = best;
                });
            }
        }
    }

    let exit = loop {
        let polled = child.lock().map_err(|e| e.to_string())?.try_wait();
        match polled {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    };
    jobs::unregister_child(app, id);
    if let Some(reader) = error_reader {
        let _ = reader.join();
    }

    if jobs::is_canceled(app, id) {
        return Err("Canceled".into());
    }
    // 101 is what yt-dlp returns when `--max-downloads` was reached: a success.
    if !(exit.success() || exit.code() == Some(101)) {
        let lines = errors.lock().map(|l| l.clone()).unwrap_or_default();
        return Err(friendly_error(&lines));
    }

    Ok(match final_path.filter(|p| Path::new(p).exists()) {
        Some(path) => Outcome::File(path),
        None => Outcome::NothingFound,
    })
}

/// Everything that decides how one yt-dlp run is set up.
struct Plan<'a> {
    settings: &'a Settings,
    link: &'a DetectedLink,
    format: &'a str,
    ffmpeg: &'a Path,
    out_dir: &'a Path,
    source: &'a str,
    trim: Option<Trim>,
    quality: &'a str,
    spotify: Option<&'a SpotifyPlan>,
}

/// Options for the audio extraction step: for a Spotify track, the title and
/// artist tags. Silence trimming is done separately, after the download: some
/// sources (TikTok's "audio" stream is already MP3) make yt-dlp skip its own
/// postprocessing, which would silently drop `--postprocessor-args`.
fn extract_audio_args(spotify: Option<&SpotifyPlan>) -> Vec<String> {
    let mut parts = Vec::new();
    if let Some(plan) = spotify {
        parts.push(format!("-metadata \"title={}\"", tag_value(&plan.title)));
        parts.push(format!("-metadata \"artist={}\"", tag_value(&plan.artists)));
    }
    parts
}

fn build_args(plan: &Plan) -> Vec<String> {
    let Plan { settings, link, format, ffmpeg, out_dir, source, trim, quality, spotify } = *plan;

    // A trimmed or lower-quality copy gets its own file name so it never
    // collides with (and yt-dlp never skips it because of) another download of
    // the same video.
    let stem = match spotify {
        Some(plan) => escape_template(&plan.file_stem),
        None => "%(title)s".to_string(),
    };
    let file_name = match name_suffix(format, quality, trim) {
        Some(suffix) => format!("{stem} ({suffix}).%(ext)s"),
        None => format!("{stem}.%(ext)s"),
    };
    let template = out_dir.join(file_name);
    let mut args: Vec<String> = vec![
        // On Windows yt-dlp writes non-ASCII text (é, ñ, 日本語...) in the console's
        // code page when piped, which is not valid UTF-8.
        "--encoding".into(),
        "utf-8".into(),
        "--no-playlist".into(),
        "--no-colors".into(),
        "--no-mtime".into(),
        "--newline".into(),
        "--progress".into(),
        "--no-simulate".into(),
        "--trim-filenames".into(),
        "150".into(),
        "--ffmpeg-location".into(),
        ffmpeg.to_string_lossy().into_owned(),
        "-o".into(),
        template.to_string_lossy().into_owned(),
        "--print".into(),
        "before_dl:CG_TITLE:%(title)s".into(),
        "--print".into(),
        "after_move:CG_PATH:%(filepath)s".into(),
        "--progress-template".into(),
        "download:CG_PROGRESS:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s".into(),
    ];

    // A link to a playlist or a channel (any site can be given) saves its first video, not hundreds.
    // Not for a Spotify search: all its results are looked at, to keep the one of the right length.
    if spotify.is_none() {
        args.extend(["--playlist-items", "1"].map(String::from));
    }

    // Only when the person has knowingly allowed it, in Settings.
    if settings.allow_untrusted_certificates {
        args.push("--no-check-certificates".into());
    }

    // Search results are filtered by length, then the first one that passes is kept.
    if let Some(filter) = spotify.and_then(|plan| plan.filter.as_deref()) {
        args.extend(["--match-filter".to_string(), filter.to_string(), "--max-downloads".to_string(), "1".to_string()]);
    }

    if format == "mp3" {
        args.extend(["-f", "bestaudio/best", "-x", "--audio-format", "mp3"].map(String::from));
        args.push("--audio-quality".into());
        args.push(audio_quality_arg(quality));
        let extract = extract_audio_args(spotify);
        if !extract.is_empty() {
            args.push("--postprocessor-args".into());
            args.push(format!("ExtractAudio:{}", extract.join(" ")));
        }
    } else {
        let selector = video_selector(quality, link.platform == "TikTok" && settings.remove_watermark);
        args.extend(
            [
                "-f",
                selector.as_str(),
                "-S",
                sort_arg(quality),
                "--merge-output-format",
                "mp4",
            ]
            .map(String::from),
        );
    }

    if let Some(range) = trim {
        args.push("--download-sections".into());
        args.push(section_arg(range));
        // Cut on the exact frame instead of the nearest keyframe.
        args.push("--force-keyframes-at-cuts".into());
    }

    // Whatever follows is the link or search, never an option.
    args.push("--".into());
    args.push(source.to_string());
    args
}

/// Sort order for MP4. h264 plays everywhere but stops at 1080p on YouTube, so
/// when the person asks for the best quality, 2K or 4K the resolution comes
/// first and VP9/AV1 streams are allowed. Otherwise h264 is preferred.
fn sort_arg(quality: &str) -> &'static str {
    match quality {
        "best" | "2160" | "1440" => "res,vcodec:h264,acodec:m4a",
        _ => "vcodec:h264,res,acodec:m4a",
    }
}

/// Audio bitrate for `--audio-quality`: 0 is yt-dlp's "best" (VBR), otherwise "192K".
fn audio_quality_arg(quality: &str) -> String {
    if quality == "best" {
        "0".to_string()
    } else {
        format!("{quality}K")
    }
}

/// Format selector for MP4. A quality caps the video height (`<=?` also keeps
/// formats that don't report a height). For TikTok, un-watermarked streams are
/// preferred with a fallback to anything.
fn video_selector(quality: &str, avoid_watermark: bool) -> String {
    let cap = if quality == "best" {
        String::new()
    } else {
        format!("[height<=?{quality}]")
    };
    if avoid_watermark {
        format!(
            "bv*{cap}[format_note!*=watermarked]+ba/b{cap}[format_note!*=watermarked]/bv*{cap}+ba/b{cap}"
        )
    } else {
        format!("bv*{cap}+ba/b{cap}")
    }
}

fn validate_quality(format: &str, quality: &str) -> Result<(), String> {
    let allowed: &[&str] = if format == "mp3" {
        &["best", "320", "192", "128"]
    } else {
        &["best", "2160", "1440", "1080", "720", "480", "360"]
    };
    if allowed.contains(&quality) {
        Ok(())
    } else {
        Err(format!("Unsupported quality \"{quality}\" for {format}"))
    }
}

/// What makes a copy different from the default download, for its file name.
fn name_suffix(format: &str, quality: &str, trim: Option<Trim>) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if quality != "best" {
        parts.push(if format == "mp3" {
            format!("{quality}kbps")
        } else {
            format!("{quality}p")
        });
    }
    if let Some(range) = trim {
        parts.push(trim_label(range));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

/// Seconds as a short decimal: 90 -> "90", 90.5 -> "90.5".
fn seconds(value: f64) -> String {
    let text = format!("{value:.3}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// yt-dlp's `--download-sections` syntax: `*START-END`, `inf` for "to the end".
fn section_arg(range: Trim) -> String {
    let end = range.end.map_or_else(|| "inf".to_string(), seconds);
    format!("*{}-{}", seconds(range.start), end)
}

fn trim_label(range: Trim) -> String {
    match range.end {
        Some(end) => format!("trim {}s-{}s", seconds(range.start), seconds(end)),
        None => format!("trim from {}s", seconds(range.start)),
    }
}

fn validate_trim(range: Trim) -> Result<(), String> {
    let valid = range.start.is_finite()
        && range.start >= 0.0
        && range.end.is_none_or(|end| end.is_finite() && end > range.start);
    if valid {
        Ok(())
    } else {
        Err("Invalid trim range: the end must come after the start".into())
    }
}

/// Last useful line from yt-dlp's stderr, without the "ERROR:" prefix.
fn friendly_error(lines: &[String]) -> String {
    let raw = lines
        .iter()
        .rev()
        .find(|line| line.contains("ERROR:"))
        .or_else(|| lines.iter().rev().find(|line| !line.trim().is_empty()))
        .map(|line| line.split("ERROR:").last().unwrap_or(line).trim().to_string())
        .unwrap_or_else(|| "yt-dlp exited with an error".to_string());

    let lower = raw.to_lowercase();
    if let Some(message) = certs::explain(&raw) {
        // Never skipped and never worked around: say what is wrong instead.
        message
    } else if lower.contains("unsupported url") || lower.contains("no video formats found") {
        // Checked before the words below: the address itself may contain "login" or "private".
        "No video could be found at this link".into()
    } else if lower.contains("drm protected") || lower.contains("drm-protected") {
        "This video is protected (DRM) and can't be saved".into()
    } else if lower.contains("private") || lower.contains("sign in") || lower.contains("login") {
        "This video is private or needs you to sign in".into()
    } else if lower.contains("unavailable") || lower.contains("removed") {
        "This video is no longer available".into()
    } else if raw.chars().count() > 140 {
        format!("{}…", raw.chars().take(140).collect::<String>())
    } else {
        raw
    }
}

/// Re-frames a video to 9:16 unless it already is, and returns the new path.
/// Cancel stops it and leaves the video as it was downloaded.
fn to_vertical(ffmpeg: &Path, input: &str, tether: &Tether, announce: &dyn Fn()) -> Result<String, String> {
    let probe = quiet_command(ffmpeg)
        .args(["-hide_banner", "-i", input])
        .output()
        .map_err(|e| e.to_string())?;
    let info = String::from_utf8_lossy(&probe.stderr);
    if let Some(found) = VIDEO_SIZE_RE.captures(&info) {
        let width: u32 = found[1].parse().unwrap_or(0);
        let height: u32 = found[2].parse().unwrap_or(0);
        // Already 9:16 (or taller): nothing to do.
        if width > 0 && height * 9 >= width * 16 {
            return Ok(input.to_string());
        }
    }
    announce();

    let source = PathBuf::from(input);
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".into());
    let output = source.with_file_name(format!("{stem} (9x16).mp4"));

    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-i"].map(String::from).to_vec();
    args.push(input.to_string());
    args.extend(
        [
            "-filter_complex", VERTICAL_FILTER, "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        ]
        .map(String::from),
    );
    args.push(output.to_string_lossy().into_owned());

    match run_ffmpeg(ffmpeg, &args, tether) {
        Ok(()) => {}
        Err(Conversion::Canceled) => {
            let _ = std::fs::remove_file(&output);
            return Err("Canceled".into());
        }
        Err(Conversion::Failed(reason)) => {
            let _ = std::fs::remove_file(&output);
            return Err(format!("Could not convert to 9:16: {reason}"));
        }
    }

    let _ = std::fs::remove_file(input);
    Ok(output.to_string_lossy().into_owned())
}

/// Shortest result of a silence trim that is kept, in seconds.
const SHORTEST_TRIMMED_AUDIO_SECS: f64 = 0.1;

fn trimmed_audio_is_usable(info: Option<&StreamInfo>) -> bool {
    info.is_some_and(|info| info.audio_codec.is_some() && info.seconds.is_some_and(|seconds| seconds >= SHORTEST_TRIMMED_AUDIO_SECS))
}

/// Trims silence from both ends of a saved MP3, in place. Re-encodes at the
/// same quality the file was downloaded at, since a filter cannot be applied
/// with `-c:a copy`. Cancel stops it and leaves the file as it was downloaded.
fn trim_silence(ffmpeg: &Path, input: &str, quality: &str, tether: &Tether, announce: &dyn Fn()) -> Result<(), String> {
    announce();

    let mut name = PathBuf::from(input).into_os_string();
    name.push(".cleangrab.mp3");
    let scratch = PathBuf::from(name);

    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-i"].map(String::from).to_vec();
    args.push(input.to_string());
    args.extend(["-af", SILENCE_FILTER, "-c:a", "libmp3lame"].map(String::from));
    let bitrate = audio_quality_arg(quality);
    if bitrate == "0" {
        args.extend(["-q:a", "0"].map(String::from));
    } else {
        args.extend(["-b:a".to_string(), bitrate]);
    }
    args.push(scratch.to_string_lossy().into_owned());

    match run_ffmpeg(ffmpeg, &args, tether) {
        Ok(()) => {
            // A recording that is silence from end to end comes out empty: keep it as it was.
            if !trimmed_audio_is_usable(probe(ffmpeg, &scratch).as_ref()) {
                let _ = std::fs::remove_file(&scratch);
                return Ok(());
            }
            if let Err(error) = std::fs::rename(&scratch, input) {
                let _ = std::fs::remove_file(&scratch);
                return Err(format!("Could not replace the audio with its trimmed copy: {error}"));
            }
            Ok(())
        }
        Err(Conversion::Canceled) => {
            let _ = std::fs::remove_file(&scratch);
            Err("Canceled".into())
        }
        Err(Conversion::Failed(reason)) => {
            let _ = std::fs::remove_file(&scratch);
            Err(format!("Could not trim silence: {reason}"))
        }
    }
}

// ------------------------------------------------------------ playable video

/// What ffmpeg reports about a file's streams.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct StreamInfo {
    pub(crate) video_codec: Option<String>,
    pub(crate) pixel_format: Option<String>,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
    pub(crate) audio_codec: Option<String>,
    pub(crate) audio_profile: Option<String>,
    pub(crate) seconds: Option<f64>,
}

static VIDEO_FORMAT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Video: (\w+)(?:\s\([^)]*\))*,\s(\w+)").unwrap());
static AUDIO_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Audio: (\w+)(?:\s\(([^)]*)\))?").unwrap());
static DURATION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)").unwrap());

/// Reads the report `ffmpeg -i file` prints.
fn parse_streams(report: &str) -> StreamInfo {
    let mut info = StreamInfo::default();
    for line in report.lines().filter(|line| line.contains("Stream #")) {
        // Cover art is a "video" stream too, but it is not the picture.
        if line.contains("Video:") && !line.contains("attached pic") && info.video_codec.is_none() {
            if let Some(found) = VIDEO_FORMAT_RE.captures(line) {
                info.video_codec = Some(found[1].to_string());
                info.pixel_format = Some(found[2].to_string());
            }
            if let Some(found) = VIDEO_SIZE_RE.captures(line) {
                info.width = found[1].parse().ok();
                info.height = found[2].parse().ok();
            }
        } else if line.contains("Audio:") && info.audio_codec.is_none() {
            if let Some(found) = AUDIO_RE.captures(line) {
                info.audio_codec = Some(found[1].to_string());
                info.audio_profile = found.get(2).map(|profile| profile.as_str().to_string());
            }
        }
    }
    info.seconds = DURATION_RE.captures(report).and_then(|found| {
        let (hours, minutes, seconds): (f64, f64, f64) = (found[1].parse().ok()?, found[2].parse().ok()?, found[3].parse().ok()?);
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    });
    info
}

/// A video longer than this, or bigger than this (its shorter side: 1440 is "2K",
/// and a vertical 1080p video is 1080 wide however tall it is), would take a long
/// time to re-encode, so it is left as downloaded.
const LONGEST_VIDEO_TO_CONVERT_SECS: f64 = 900.0;
const LARGEST_VIDEO_TO_CONVERT: u32 = 1440;

/// Which streams of a file need converting so it plays everywhere.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Fixes {
    video: bool,
    audio: bool,
}

/// Video that plays everywhere is H.264 in 8-bit 4:2:0, with AAC-LC audio.
/// Windows cannot play HEVC (H.265) without a paid extension, and TikTok serves
/// its best quality in it; older players also choke on VP9 or AV1 inside an
/// MP4, and on HE-AAC sound.
fn fixes_needed(info: &StreamInfo) -> Fixes {
    let video = info.video_codec.as_deref().is_some_and(|codec| {
        let pixels_ok = info.pixel_format.as_deref().is_none_or(|pixels| pixels == "yuv420p" || pixels == "yuvj420p");
        codec != "h264" || !pixels_ok
    });
    let audio = match info.audio_codec.as_deref() {
        None | Some("mp3") => false,
        Some("aac") => !matches!(info.audio_profile.as_deref(), None | Some("LC")),
        Some(_) => true,
    };
    // Vertical videos (TikTok, Reels) are 1920 tall at 1080p: what counts is the shorter side.
    let shorter_side = match (info.width, info.height) {
        (Some(width), Some(height)) => Some(width.min(height)),
        (other, None) | (None, other) => other,
    };
    let affordable = shorter_side.is_none_or(|side| side <= LARGEST_VIDEO_TO_CONVERT)
        && info.seconds.is_none_or(|seconds| seconds <= LONGEST_VIDEO_TO_CONVERT_SECS);
    Fixes { video: video && affordable, audio }
}

/// The ffmpeg command that rewrites only what `fixes` says is a problem.
fn playable_args(input: &Path, output: &Path, fixes: Fixes) -> Vec<String> {
    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-i"].map(String::from).to_vec();
    args.push(input.to_string_lossy().into_owned());
    args.extend(["-map", "0:v:0", "-map", "0:a:0?"].map(String::from));
    if fixes.video {
        // Close to the source (CRF 21 measures 0.99 SSIM against a TikTok original
        // at a bit over half the size of CRF 18), and even dimensions, which H.264 in
        // 4:2:0 requires.
        args.extend(
            ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
                .map(String::from),
        );
    } else {
        args.extend(["-c:v", "copy"].map(String::from));
    }
    if fixes.audio {
        args.extend(["-c:a", "aac", "-b:a", "192k", "-ac", "2"].map(String::from));
    } else {
        args.extend(["-c:a", "copy"].map(String::from));
    }
    args.extend(["-movflags", "+faststart"].map(String::from));
    args.push(output.to_string_lossy().into_owned());
    args
}

pub(crate) fn probe(ffmpeg: &Path, file: &Path) -> Option<StreamInfo> {
    // Without an output file ffmpeg prints the report on stderr, then stops.
    let output = quiet_command(ffmpeg).args(["-hide_banner", "-i"]).arg(file).output().ok()?;
    let info = parse_streams(&String::from_utf8_lossy(&output.stderr));
    (info.video_codec.is_some() || info.audio_codec.is_some()).then_some(info)
}

/// How a running conversion is tied to its download, so that Cancel stops it too.
struct Tether<'a> {
    started: &'a dyn Fn(Arc<Mutex<Child>>),
    finished: &'a dyn Fn(),
    canceled: &'a dyn Fn() -> bool,
}

enum Conversion {
    Canceled,
    Failed(String),
}

fn run_ffmpeg(ffmpeg: &Path, args: &[String], tether: &Tether) -> Result<(), Conversion> {
    let mut command = quiet_command(ffmpeg);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| Conversion::Failed(e.to_string()))?;

    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    (tether.started)(child.clone());
    // Drained on the side, so a chatty ffmpeg can never fill the pipe and stall.
    let reader = stderr.map(|mut stderr| {
        thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        })
    });

    let status = loop {
        let polled = child.lock().map_err(|e| Conversion::Failed(e.to_string()))?.try_wait();
        match polled {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(e) => {
                (tether.finished)();
                return Err(Conversion::Failed(e.to_string()));
            }
        }
    };
    (tether.finished)();
    let report = reader.and_then(|reader| reader.join().ok()).unwrap_or_default();

    if (tether.canceled)() {
        return Err(Conversion::Canceled);
    }
    if status.success() {
        Ok(())
    } else {
        Err(Conversion::Failed(report.lines().last().unwrap_or("ffmpeg failed").trim().to_string()))
    }
}

/// Makes a saved video play everywhere, converting only what needs it and
/// replacing the file in place. A conversion that fails leaves the video as it
/// was downloaded; only Cancel is reported as an error.
fn make_playable(ffmpeg: &Path, video: &Path, tether: &Tether, announce: &dyn Fn()) -> Result<(), String> {
    let Some(info) = probe(ffmpeg, video) else {
        return Ok(());
    };
    let fixes = fixes_needed(&info);
    if !fixes.video && !fixes.audio {
        return Ok(());
    }
    announce();

    let mut name = video.as_os_str().to_owned();
    name.push(".cleangrab.mp4");
    let scratch = PathBuf::from(name);

    match run_ffmpeg(ffmpeg, &playable_args(video, &scratch, fixes), tether) {
        Ok(()) => {
            // Renaming over the video replaces it in one step, so it is never missing. If that
            // is refused (a synced folder, or a player has the file open), the video stays as
            // it was downloaded: the original is never deleted before its replacement is in place.
            if let Err(error) = std::fs::rename(&scratch, video) {
                eprintln!("CleanGrab: could not replace the video with its converted copy: {error}");
                let _ = std::fs::remove_file(&scratch);
            }
            Ok(())
        }
        Err(Conversion::Canceled) => {
            let _ = std::fs::remove_file(&scratch);
            Err("Canceled".into())
        }
        Err(Conversion::Failed(reason)) => {
            eprintln!("CleanGrab: could not convert the video for compatibility: {reason}");
            let _ = std::fs::remove_file(&scratch);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_trim_result_is_never_kept() {
        let audio = |seconds: Option<f64>| StreamInfo { audio_codec: Some("mp3".into()), seconds, ..Default::default() };
        assert!(trimmed_audio_is_usable(Some(&audio(Some(2.2)))));
        assert!(!trimmed_audio_is_usable(Some(&audio(Some(0.0)))));
        assert!(!trimmed_audio_is_usable(Some(&audio(None))));
        assert!(!trimmed_audio_is_usable(Some(&StreamInfo { seconds: Some(3.0), ..Default::default() })));
        assert!(!trimmed_audio_is_usable(None));
    }

    #[test]
    fn formats_a_closed_section() {
        let range = Trim { start: 30.0, end: Some(70.5) };
        assert_eq!(section_arg(range), "*30-70.5");
        assert_eq!(trim_label(range), "trim 30s-70.5s");
    }

    #[test]
    fn open_ended_section_runs_to_the_end() {
        let range = Trim { start: 0.0, end: None };
        assert_eq!(section_arg(range), "*0-inf");
    }

    #[test]
    fn caps_video_height_and_keeps_the_tiktok_fallback() {
        assert_eq!(video_selector("best", false), "bv*+ba/b");
        assert_eq!(video_selector("720", false), "bv*[height<=?720]+ba/b[height<=?720]");
        let tiktok = video_selector("480", true);
        assert!(tiktok.starts_with("bv*[height<=?480][format_note!*=watermarked]+ba"));
        assert!(tiktok.ends_with("/bv*[height<=?480]+ba/b[height<=?480]"));
    }

    #[test]
    fn prefers_resolution_over_h264_for_best_2k_and_4k() {
        assert_eq!(sort_arg("best"), "res,vcodec:h264,acodec:m4a");
        assert_eq!(sort_arg("2160"), "res,vcodec:h264,acodec:m4a");
        assert_eq!(sort_arg("1440"), "res,vcodec:h264,acodec:m4a");
        assert_eq!(sort_arg("1080"), "vcodec:h264,res,acodec:m4a");
        assert_eq!(sort_arg("720"), "vcodec:h264,res,acodec:m4a");
    }

    fn sample_track() -> Track {
        Track {
            title: "Blinding Lights".to_string(),
            artists: vec!["The Weeknd".to_string()],
            duration_secs: Some(200.04),
        }
    }

    #[test]
    fn searches_for_matching_lengths_first_then_the_top_result() {
        let plans = spotify_plans(&sample_track());
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].query, "ytsearch6:The Weeknd - Blinding Lights audio");
        assert_eq!(plans[0].filter.as_deref(), Some("duration >= 196 & duration <= 205"));
        assert_eq!(plans[1].query, "ytsearch1:The Weeknd - Blinding Lights audio");
        assert_eq!(plans[1].filter, None);

        let unknown_length = Track { duration_secs: None, ..sample_track() };
        assert_eq!(spotify_plans(&unknown_length).len(), 1);
    }

    #[test]
    fn names_files_safely() {
        assert_eq!(sanitize_file_name("The Weeknd - Blinding Lights"), "The Weeknd - Blinding Lights");
        assert_eq!(sanitize_file_name("AC/DC - Who Made Who?"), "AC_DC - Who Made Who_");
        assert_eq!(sanitize_file_name("  spaced   out . "), "spaced out");
        assert_eq!(escape_template("100% Pure"), "100%% Pure");
        assert_eq!(tag_value("Say \"Hi\" \\ there"), "Say Hi  there");
    }

    #[test]
    fn a_spotify_download_is_named_and_tagged_after_the_track() {
        let settings = Settings::default();
        let link = DetectedLink {
            url: "https://open.spotify.com/track/abc".to_string(),
            platform: "Spotify".to_string(),
            removed_trackers: 0,
        };
        let plans = spotify_plans(&sample_track());
        let args = build_args(&Plan {
            settings: &settings,
            link: &link,
            format: "mp3",
            ffmpeg: Path::new("ffmpeg"),
            out_dir: Path::new("music"),
            source: &plans[0].query,
            trim: None,
            quality: "192",
            spotify: Some(&plans[0]),
        });

        let output = &args[args.iter().position(|a| a == "-o").unwrap() + 1];
        assert!(output.ends_with("The Weeknd - Blinding Lights (192kbps).%(ext)s"), "{output}");
        assert!(args.windows(2).any(|w| w == ["--match-filter", "duration >= 196 & duration <= 205"]));
        assert!(args.windows(2).any(|w| w == ["--max-downloads", "1"]));
        assert!(!args.iter().any(|a| a == "--playlist-items"), "a Spotify search looks at all its results");
        let tags = &args[args.iter().position(|a| a == "--postprocessor-args").unwrap() + 1];
        assert_eq!(tags, "ExtractAudio:-metadata \"title=Blinding Lights\" -metadata \"artist=The Weeknd\"");
        assert_eq!(args.last().unwrap(), "ytsearch6:The Weeknd - Blinding Lights audio");
    }

    #[test]
    fn certificates_are_checked_unless_the_person_allowed_otherwise() {
        let link = DetectedLink {
            url: "https://youtu.be/dQw4w9WgXcQ".to_string(),
            platform: "YouTube".to_string(),
            removed_trackers: 0,
        };
        let build = |settings: &Settings, format: &str| {
            build_args(&Plan {
                settings,
                link: &link,
                format,
                ffmpeg: Path::new("ffmpeg"),
                out_dir: Path::new("music"),
                source: &link.url,
                trim: None,
                quality: "best",
                spotify: None,
            })
        };
        let allowed = Settings { allow_untrusted_certificates: true, ..Settings::default() };
        for format in ["mp3", "mp4"] {
            assert!(!build(&Settings::default(), format).iter().any(|a| a == "--no-check-certificates"));
            assert!(build(&allowed, format).iter().any(|a| a == "--no-check-certificates"));
        }
    }

    #[test]
    fn reading_output_survives_bytes_that_are_not_utf8() {
        // "CG_TITLE:Alizée" in Windows-1252 (é = 0xE9), then two more lines.
        let bytes: &[u8] = b"CG_TITLE:Aliz\xe9e\r\nCG_PATH:C:\\music\\Aliz\xe9e.mp3\nlast";
        let lines: Vec<String> = lossy_lines(bytes).collect();
        assert_eq!(lines.len(), 3, "later lines must not be lost: {lines:?}");
        assert!(lines[0].starts_with("CG_TITLE:Aliz"));
        assert!(lines[1].starts_with("CG_PATH:C:\\music\\Aliz"));
        assert_eq!(lines[2], "last");
    }

    #[test]
    fn utf8_is_requested_from_yt_dlp() {
        let link = DetectedLink {
            url: "https://youtu.be/dQw4w9WgXcQ".to_string(),
            platform: "YouTube".to_string(),
            removed_trackers: 0,
        };
        let settings = Settings::default();
        let args = build_args(&Plan {
            settings: &settings,
            link: &link,
            format: "mp3",
            ffmpeg: Path::new("ffmpeg"),
            out_dir: Path::new("music"),
            source: &link.url,
            trim: None,
            quality: "best",
            spotify: None,
        });
        assert!(args.windows(2).any(|w| w == ["--encoding", "utf-8"]));
    }

    #[test]
    fn a_normal_download_keeps_the_sites_title_and_no_filter() {
        let settings = Settings::default();
        let link = DetectedLink {
            url: "https://youtu.be/dQw4w9WgXcQ".to_string(),
            platform: "YouTube".to_string(),
            removed_trackers: 0,
        };
        let args = build_args(&Plan {
            settings: &settings,
            link: &link,
            format: "mp3",
            ffmpeg: Path::new("ffmpeg"),
            out_dir: Path::new("music"),
            source: &link.url,
            trim: None,
            quality: "best",
            spotify: None,
        });
        let output = &args[args.iter().position(|a| a == "-o").unwrap() + 1];
        assert!(output.ends_with("%(title)s.%(ext)s"), "{output}");
        assert!(!args.iter().any(|a| a == "--match-filter" || a == "--postprocessor-args"));
    }

    #[test]
    fn says_plainly_when_a_link_has_no_video_or_a_protected_one() {
        let none = friendly_error(&["ERROR: Unsupported URL: https://example.org/page".to_string()]);
        assert_eq!(none, "No video could be found at this link");
        let protected = friendly_error(&["ERROR: [site] abc: This video is DRM protected".to_string()]);
        assert_eq!(protected, "This video is protected (DRM) and can't be saved");
    }

    #[test]
    fn a_playlist_link_saves_only_its_first_video() {
        let link = DetectedLink { url: "https://videos.example.org/playlist/1".to_string(), platform: "videos.example.org".to_string(), removed_trackers: 0 };
        let settings = Settings::default();
        let args = build_args(&Plan {
            settings: &settings,
            link: &link,
            format: "mp4",
            ffmpeg: Path::new("ffmpeg"),
            out_dir: Path::new("videos"),
            source: &link.url,
            trim: None,
            quality: "best",
            spotify: None,
        });
        assert!(args.windows(2).any(|w| w == ["--playlist-items", "1"]));
        // The link is still the last thing, after the "--" that keeps it from being read as an option.
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args[args.len() - 1], link.url);
    }

    #[test]
    fn explains_certificate_failures_in_plain_words() {
        let lines = vec![
            "ERROR: [youtube] abc: Unable to download API page: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1007)".to_string(),
        ];
        let message = friendly_error(&lines);
        assert!(message.starts_with("Security certificate not trusted"), "{message}");
        assert!(!message.contains("_ssl.c"));
        assert_eq!(certs::kind_of_message(&message), Some("certificate-untrusted"));
    }

    #[test]
    fn explains_certificate_failures_reported_by_curl() {
        // TikTok goes through curl_cffi, which words the same problem differently.
        let lines = vec![
            "ERROR: [TikTok] 7669788069335223585: Unable to download webpage: Failed to perform, curl: (60) SSL certificate OpenSSL verify result: unable to get local issuer certificate (20). (caused by CertificateVerifyError('Failed to perform'))".to_string(),
        ];
        let message = friendly_error(&lines);
        assert_eq!(certs::kind_of_message(&message), Some("certificate-untrusted"), "{message}");
    }

    #[test]
    fn an_expired_or_foreign_certificate_is_named_as_such() {
        let expired = vec!["ERROR: [generic] x: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired (_ssl.c:1007)".to_string()];
        let foreign = vec!["ERROR: [generic] x: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: Hostname mismatch, certificate is not valid for 'x.com'. (_ssl.c:1007)".to_string()];
        assert_eq!(certs::kind_of_message(&friendly_error(&expired)), Some("certificate-expired"));
        assert_eq!(certs::kind_of_message(&friendly_error(&foreign)), Some("certificate-site"));
    }

    #[test]
    fn other_failures_keep_their_own_wording() {
        let lines = vec!["ERROR: [youtube] abc: Video unavailable. This video is private".to_string()];
        assert_eq!(friendly_error(&lines), "This video is private or needs you to sign in");
        assert_eq!(certs::kind_of_message(&friendly_error(&lines)), None);
    }

    #[test]
    fn maps_audio_quality_to_a_bitrate() {
        assert_eq!(audio_quality_arg("best"), "0");
        assert_eq!(audio_quality_arg("192"), "192K");
    }

    #[test]
    fn only_accepts_qualities_that_fit_the_format() {
        assert!(validate_quality("mp3", "320").is_ok());
        assert!(validate_quality("mp3", "720").is_err());
        assert!(validate_quality("mp4", "720").is_ok());
        assert!(validate_quality("mp4", "320").is_err());
        assert!(validate_quality("mp4", "best").is_ok());
        assert!(validate_quality("mp4", "2160").is_ok());
        assert!(validate_quality("mp4", "1440").is_ok());
        assert!(validate_quality("mp3", "2160").is_err());
    }

    #[test]
    fn names_copies_after_what_differs() {
        assert_eq!(name_suffix("mp4", "best", None), None);
        assert_eq!(name_suffix("mp3", "192", None).as_deref(), Some("192kbps"));
        assert_eq!(name_suffix("mp4", "720", None).as_deref(), Some("720p"));
        assert_eq!(name_suffix("mp4", "2160", None).as_deref(), Some("2160p"));
        let range = Trim { start: 30.0, end: Some(70.0) };
        assert_eq!(
            name_suffix("mp4", "720", Some(range)).as_deref(),
            Some("720p, trim 30s-70s")
        );
        assert_eq!(name_suffix("mp3", "best", Some(range)).as_deref(), Some("trim 30s-70s"));
    }

    #[test]
    fn rejects_backwards_and_negative_ranges() {
        assert!(validate_trim(Trim { start: 10.0, end: Some(10.0) }).is_err());
        assert!(validate_trim(Trim { start: 20.0, end: Some(5.0) }).is_err());
        assert!(validate_trim(Trim { start: -1.0, end: None }).is_err());
        assert!(validate_trim(Trim { start: 5.0, end: Some(6.0) }).is_ok());
    }

    // ffmpeg's own report for the TikTok video that would not play: HEVC + HE-AACv2.
    const TIKTOK_REPORT: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':\n  Duration: 00:00:33.74, start: 0.000000, bitrate: 128 kb/s\n  Stream #0:0[0x1](und): Audio: aac (HE-AACv2) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 64 kb/s (default)\n  Stream #0:1[0x2](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1076, 54 kb/s, SAR 1:1 DAR 480:269, 53.41 fps, 54 tbr, 13824 tbn (default)\n";
    const NORMAL_REPORT: &str = "  Duration: 00:03:10.00, start: 0.0, bitrate: 900 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 800 kb/s, 30 fps\n  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s\n";

    #[test]
    fn reads_what_ffmpeg_says_about_a_file() {
        let info = parse_streams(TIKTOK_REPORT);
        assert_eq!(info.video_codec.as_deref(), Some("hevc"));
        assert_eq!(info.pixel_format.as_deref(), Some("yuv420p"));
        assert_eq!((info.width, info.height), (Some(1920), Some(1076)));
        assert_eq!(info.audio_codec.as_deref(), Some("aac"));
        assert_eq!(info.audio_profile.as_deref(), Some("HE-AACv2"));
        assert!(info.seconds.is_some_and(|s| (s - 33.74).abs() < 0.01));

        let normal = parse_streams(NORMAL_REPORT);
        assert_eq!((normal.video_codec.as_deref(), normal.audio_profile.as_deref()), (Some("h264"), Some("LC")));
    }

    #[test]
    fn a_tiktok_hevc_video_is_converted_and_a_normal_one_left_alone() {
        assert_eq!(fixes_needed(&parse_streams(TIKTOK_REPORT)), Fixes { video: true, audio: true });
        assert_eq!(fixes_needed(&parse_streams(NORMAL_REPORT)), Fixes { video: false, audio: false });
    }

    #[test]
    fn only_what_is_wrong_is_converted() {
        // H.264 with HE-AAC: the picture is copied, only the sound is rewritten.
        let info = parse_streams(&NORMAL_REPORT.replace("aac (LC)", "aac (HE-AAC)"));
        assert_eq!(fixes_needed(&info), Fixes { video: false, audio: true });
        // 10-bit H.264 does not play everywhere either.
        let ten_bit = parse_streams(&NORMAL_REPORT.replace("yuv420p(progressive)", "yuv420p10le(progressive)"));
        assert_eq!(fixes_needed(&ten_bit), Fixes { video: true, audio: false });
        // A video with no sound at all is fine.
        let silent = parse_streams("  Duration: 00:00:10.00\n  Stream #0:0: Video: h264 (High), yuv420p, 640x360, 30 fps\n");
        assert_eq!(fixes_needed(&silent), Fixes { video: false, audio: false });
    }

    #[test]
    fn a_vertical_1080p_video_is_converted_however_tall_it_is() {
        // TikTok and Reels are portrait: 1080 wide, 1920 tall. That is 1080p, not 2K+.
        let portrait = parse_streams(&TIKTOK_REPORT.replace("1920x1076", "1080x1920"));
        assert_eq!((portrait.width, portrait.height), (Some(1080), Some(1920)));
        assert_eq!(fixes_needed(&portrait), Fixes { video: true, audio: true });
        // A vertical 4K video is as big as a horizontal one.
        let portrait_4k = parse_streams(&TIKTOK_REPORT.replace("1920x1076", "2160x3840"));
        assert_eq!(fixes_needed(&portrait_4k), Fixes { video: false, audio: true });
    }

    #[test]
    fn a_very_long_or_very_big_video_is_not_re_encoded() {
        let long = parse_streams(&TIKTOK_REPORT.replace("00:00:33.74", "01:20:00.00"));
        assert_eq!(fixes_needed(&long), Fixes { video: false, audio: true });
        let tall = parse_streams(&TIKTOK_REPORT.replace("1920x1076", "3840x2160"));
        assert_eq!(fixes_needed(&tall), Fixes { video: false, audio: true });
    }

    #[test]
    fn the_command_copies_what_it_does_not_change() {
        let args = playable_args(Path::new("in.mp4"), Path::new("out.mp4"), Fixes { video: false, audio: true });
        assert!(args.windows(2).any(|w| w == ["-c:v", "copy"]));
        assert!(args.windows(2).any(|w| w == ["-c:a", "aac"]));
        let both = playable_args(Path::new("in.mp4"), Path::new("out.mp4"), Fixes { video: true, audio: true });
        assert!(both.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(both.windows(2).any(|w| w == ["-pix_fmt", "yuv420p"]));
        assert_eq!(both.last().unwrap(), "out.mp4");
    }

    /// Finds ffmpeg where CleanGrab keeps it, or on the PATH.
    fn ffmpeg_for_tests() -> Option<PathBuf> {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let installed = std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join("com.cleangrab.app").join("bin").join(name));
        installed.filter(|path| path.is_file()).or_else(|| {
            std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join(name)).find(|path| path.is_file()))
        })
    }

    fn no_tether<R>(then: impl FnOnce(&Tether) -> R) -> R {
        then(&Tether { started: &|_| {}, finished: &|| {}, canceled: &|| false })
    }

    /// Makes a real video in a codec that is not H.264 (MPEG-4 stands in for
    /// HEVC, which not every ffmpeg can encode), converts it and reads it back.
    /// Skipped when ffmpeg is missing.
    #[test]
    fn a_real_video_in_another_codec_becomes_one_that_plays_everywhere() {
        let Some(ffmpeg) = ffmpeg_for_tests() else {
            eprintln!("skipped: no ffmpeg");
            return;
        };
        let dir = std::env::temp_dir().join(format!("cleangrab-playable-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");

        let made = quiet_command(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=321x241:rate=25:duration=2"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=2"])
            .args(["-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
            .arg(&video)
            .output()
            .unwrap();
        if !made.status.success() {
            eprintln!("skipped: this ffmpeg cannot make the sample video");
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let before = probe(&ffmpeg, &video).unwrap();
        assert_eq!(before.video_codec.as_deref(), Some("mpeg4"));

        let announced = std::cell::Cell::new(false);
        no_tether(|tether| make_playable(&ffmpeg, &video, tether, &|| announced.set(true))).unwrap();
        assert!(announced.get(), "the person is told the video is being converted");

        let after = probe(&ffmpeg, &video).unwrap();
        assert_eq!(after.video_codec.as_deref(), Some("h264"));
        assert_eq!(after.pixel_format.as_deref(), Some("yuv420p"));
        assert_eq!(after.audio_codec.as_deref(), Some("aac"));
        assert_eq!(after.height, Some(240), "odd sizes are rounded to even ones");
        assert!(!dir.join("clip.mp4.cleangrab.mp4").exists(), "no scratch file left behind");

        // A file that already plays everywhere is not touched again.
        let untouched = std::fs::metadata(&video).unwrap().modified().unwrap();
        no_tether(|tether| make_playable(&ffmpeg, &video, tether, &|| panic!("nothing to convert"))).unwrap();
        assert_eq!(std::fs::metadata(&video).unwrap().modified().unwrap(), untouched);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Cancel while converting ends the conversion and leaves the download as it was.
    #[test]
    fn cancelling_a_conversion_leaves_the_original() {
        let Some(ffmpeg) = ffmpeg_for_tests() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("cleangrab-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        let made = quiet_command(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1"])
            .args(["-c:v", "mpeg4", "-pix_fmt", "yuv420p"])
            .arg(&video)
            .output()
            .unwrap();
        if !made.status.success() {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let size = std::fs::metadata(&video).unwrap().len();

        let result = make_playable(
            &ffmpeg,
            &video,
            &Tether { started: &|_| {}, finished: &|| {}, canceled: &|| true },
            &|| {},
        );
        assert_eq!(result, Err("Canceled".to_string()));
        assert_eq!(std::fs::metadata(&video).unwrap().len(), size);
        assert!(!dir.join("clip.mp4.cleangrab.mp4").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Runs the conversion on a real file: set CLEANGRAB_SAMPLE_VIDEO to a video
    /// (a TikTok download, say) and run `cargo test -- --ignored the_sample_video`.
    #[test]
    #[ignore = "needs a sample video and ffmpeg"]
    fn the_sample_video_plays_everywhere_afterwards() {
        let ffmpeg = ffmpeg_for_tests().expect("ffmpeg");
        let sample = PathBuf::from(std::env::var_os("CLEANGRAB_SAMPLE_VIDEO").expect("CLEANGRAB_SAMPLE_VIDEO"));
        let copy = std::env::temp_dir().join("cleangrab-sample-copy.mp4");
        std::fs::copy(&sample, &copy).unwrap();
        let before = probe(&ffmpeg, &copy).unwrap();
        eprintln!("before: {before:?}");
        no_tether(|tether| make_playable(&ffmpeg, &copy, tether, &|| {})).unwrap();
        let after = probe(&ffmpeg, &copy).unwrap();
        eprintln!("after:  {after:?}");
        assert_eq!(after.video_codec.as_deref(), Some("h264"));
        assert_eq!(after.pixel_format.as_deref(), Some("yuv420p"));
        assert_eq!(after.audio_codec.as_deref(), Some("aac"));
        assert!(matches!(after.audio_profile.as_deref(), None | Some("LC")));
        let _ = std::fs::remove_file(&copy);
    }
}
