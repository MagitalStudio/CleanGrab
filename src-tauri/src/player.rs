// SPDX-License-Identifier: GPL-3.0-only
//! The built-in player: which files it opens, and getting a file into a form
//! the window can play.
//!
//! The window plays what its web engine plays: MP4/MOV (H.264), WebM, MP3, AAC,
//! WAV, FLAC, Ogg... Everything else ffmpeg can read (AVI, MKV, WMV, WMA, HEVC,
//! Apple Lossless...) is converted first into an MP4, keeping every stream that
//! can be kept as it is so that most conversions are instant. Only audio and
//! video are opened, and only those files are made readable by the window.

use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::{self, quiet_command};
use crate::media::{probe, StreamInfo};
use crate::{jobs, settings};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "f4v", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "ogv", "vob", "asf",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "alac", "ape", "amr", "ac3", "mka", "weba", "wv", "mp2", "mpc",
];

/// Containers the window opens by itself.
const NATIVE_CONTAINERS: &[&str] = &["mp4", "m4v", "mov", "webm", "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"];
/// Codecs it decodes by itself. HEVC is left out: it depends on a paid Windows extension.
const NATIVE_VIDEO: &[&str] = &["h264", "vp8", "vp9", "av1"];
const NATIVE_AUDIO: &[&str] = &["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_u8", "pcm_f32le"];
/// What an MP4 can hold as it is, so that a conversion need not re-encode it.
const COPYABLE_VIDEO_IN_MP4: &[&str] = &["h264", "vp9", "av1"];
const COPYABLE_AUDIO_IN_MP4: &[&str] = &["aac", "mp3", "opus", "flac"];

fn extension_of(path: &Path) -> Option<String> {
    path.extension().map(|ext| ext.to_string_lossy().to_lowercase())
}

/// Whether `path` looks like a file the player opens (audio or video).
pub fn is_playable_extension(path: &Path) -> bool {
    extension_of(path).is_some_and(|ext| VIDEO_EXTENSIONS.contains(&ext.as_str()) || AUDIO_EXTENSIONS.contains(&ext.as_str()))
}

/// What has to happen to a file before the window can play it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Plan {
    /// Play the file as it is.
    Native,
    /// Rewrite it as an MP4, re-encoding only the streams marked.
    Convert { video: bool, audio: bool },
}

fn video_is_native(info: &StreamInfo) -> bool {
    match (info.video_codec.as_deref(), info.pixel_format.as_deref()) {
        (None, _) => true,
        (Some(codec), pixels) => {
            NATIVE_VIDEO.contains(&codec) && (codec != "h264" || pixels.is_none_or(|p| p == "yuv420p" || p == "yuvj420p"))
        }
    }
}

fn plan_for(extension: &str, info: &StreamInfo) -> Plan {
    let audio_native = info.audio_codec.as_deref().is_none_or(|codec| NATIVE_AUDIO.contains(&codec));
    if video_is_native(info) && audio_native && NATIVE_CONTAINERS.contains(&extension) {
        return Plan::Native;
    }
    let video = info.video_codec.is_some()
        && !(info.video_codec.as_deref().is_some_and(|codec| COPYABLE_VIDEO_IN_MP4.contains(&codec)) && video_is_native(info));
    let audio = info.audio_codec.as_deref().is_some_and(|codec| !COPYABLE_AUDIO_IN_MP4.contains(&codec));
    Plan::Convert { video, audio }
}

/// The ffmpeg command that rewrites `input` as an MP4 the window can play.
fn convert_args(input: &Path, output: &Path, info: &StreamInfo, video: bool, audio: bool) -> Vec<String> {
    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i"]
        .map(String::from)
        .to_vec();
    args.push(input.to_string_lossy().into_owned());

    // Cover art counts as a picture stream in some files; it is not a video.
    if info.video_codec.is_some() {
        args.extend(["-map", "0:v:0"].map(String::from));
    } else {
        args.push("-vn".into());
    }
    if info.audio_codec.is_some() {
        args.extend(["-map", "0:a:0"].map(String::from));
    }
    args.extend(["-sn", "-dn"].map(String::from));

    if info.video_codec.is_some() {
        if video {
            args.extend(
                ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
                    .map(String::from),
            );
        } else {
            args.extend(["-c:v", "copy"].map(String::from));
        }
    }
    if info.audio_codec.is_some() {
        if audio {
            args.extend(["-c:a", "aac", "-b:a", "256k", "-ac", "2"].map(String::from));
        } else {
            args.extend(["-c:a", "copy"].map(String::from));
        }
    }
    args.extend(["-movflags", "+faststart"].map(String::from));
    args.push(output.to_string_lossy().into_owned());
    args
}

/// FNV-1a: a small, stable hash for naming converted files.
fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
}

/// Where converted files go: emptied when CleanGrab starts and quits.
fn cache_dir() -> PathBuf {
    std::env::temp_dir().join("CleanGrab-playback")
}

pub fn clean_cache() {
    let _ = fs::remove_dir_all(cache_dir());
}

/// The file the player is given.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayableMedia {
    /// The file to play: the original, or the converted copy.
    pub path: String,
    /// "video" or "audio".
    pub kind: &'static str,
    /// The file's name without its extension.
    pub title: String,
    pub seconds: Option<f64>,
    /// The original could not be played as it was, and a converted copy is.
    pub converted: bool,
}

/// What a conversion reports to, and how it can be stopped.
struct Hooks<'a> {
    progress: &'a (dyn Fn(f32) + Sync),
    started: &'a (dyn Fn(Arc<Mutex<Child>>) + Sync),
    finished: &'a (dyn Fn() + Sync),
    canceled: &'a (dyn Fn() -> bool + Sync),
}

/// Runs ffmpeg, reporting how far along it is (`-progress` prints the time reached).
fn run_conversion(ffmpeg: &Path, args: &[String], seconds: Option<f64>, hooks: &Hooks) -> Result<(), String> {
    let mut command = quiet_command(ffmpeg);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("Could not start ffmpeg: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    (hooks.started)(child.clone());

    let (status, report) = std::thread::scope(|scope| {
        scope.spawn(|| {
            let Some(stdout) = stdout else { return };
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(micros) = line.strip_prefix("out_time_us=").and_then(|v| v.trim().parse::<f64>().ok()) else {
                    continue;
                };
                if let Some(total) = seconds.filter(|s| *s > 0.0) {
                    (hooks.progress)(((micros / 1_000_000.0 / total) * 100.0).clamp(0.0, 99.0) as f32);
                }
            }
        });
        let errors = scope.spawn(|| {
            let mut text = String::new();
            if let Some(mut stderr) = stderr {
                let _ = stderr.read_to_string(&mut text);
            }
            text
        });

        let status = loop {
            let polled = child.lock().map_err(|e| e.to_string())?.try_wait();
            match polled {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(80)),
                Err(e) => break Err(e.to_string()),
            }
        };
        Ok::<_, String>((status, errors.join().unwrap_or_default()))
    })?;
    (hooks.finished)();

    if (hooks.canceled)() {
        return Err("Canceled".into());
    }
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err(format!("ffmpeg could not convert this file: {}", report.lines().last().unwrap_or("unknown error").trim())),
        Err(e) => Err(e),
    }
}

/// Gets `input` ready to play: as it is when the window can play it, otherwise
/// converted into `cache` (and reused if that was done before).
fn prepare_file(ffmpeg: Option<&Path>, input: &Path, cache: &Path, hooks: &Hooks) -> Result<PlayableMedia, String> {
    if !input.is_file() {
        return Err("This file can't be found. It may have been moved or deleted.".into());
    }
    if !is_playable_extension(input) {
        return Err("CleanGrab's player opens audio and video files only.".into());
    }
    let extension = extension_of(input).unwrap_or_default();
    let title = input.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let original = |kind: &'static str, seconds: Option<f64>| PlayableMedia {
        path: input.to_string_lossy().into_owned(),
        kind,
        title: title.clone(),
        seconds,
        converted: false,
    };

    // Without ffmpeg (setup not done) files can only be judged by their name.
    let Some(ffmpeg) = ffmpeg else {
        return if NATIVE_CONTAINERS.contains(&extension.as_str()) {
            let kind = if AUDIO_EXTENSIONS.contains(&extension.as_str()) { "audio" } else { "video" };
            Ok(original(kind, None))
        } else {
            Err("Finish CleanGrab's one-time setup to play this kind of file.".into())
        };
    };

    let info = probe(ffmpeg, input).ok_or("This file doesn't seem to contain audio or video, or it is damaged.")?;
    let kind = if info.video_codec.is_some() { "video" } else { "audio" };
    let (video, audio) = match plan_for(&extension, &info) {
        Plan::Native => return Ok(original(kind, info.seconds)),
        Plan::Convert { video, audio } => (video, audio),
    };

    // A converted copy from an earlier time is reused while the original is unchanged.
    let meta = fs::metadata(input).map_err(|e| e.to_string())?;
    let stamp = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let name = format!("{:016x}.mp4", fnv(&format!("{}|{}|{stamp}|{video}|{audio}", input.display(), meta.len())));
    let output = cache.join(name);
    let converted = PlayableMedia {
        path: output.to_string_lossy().into_owned(),
        kind,
        title: title.clone(),
        seconds: info.seconds,
        converted: true,
    };
    if fs::metadata(&output).is_ok_and(|m| m.len() > 0) {
        return Ok(converted);
    }

    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let scratch = cache.join(format!("{}.part.mp4", output.file_stem().unwrap_or_default().to_string_lossy()));
    let result = run_conversion(ffmpeg, &convert_args(input, &scratch, &info, video, audio), info.seconds, hooks)
        .and_then(|()| fs::rename(&scratch, &output).map_err(|e| e.to_string()));
    if result.is_err() {
        let _ = fs::remove_file(&scratch);
    }
    result.map(|()| converted)
}

// ------------------------------------------------------------------ commands

/// The conversion in progress, so that opening another file (or closing the
/// player) can stop it.
static ACTIVE: Mutex<Option<Arc<Mutex<Child>>>> = Mutex::new(None);
static CANCELED: AtomicBool = AtomicBool::new(false);
/// One conversion at a time: a new one starts once the old one has been stopped.
static TURN: Mutex<()> = Mutex::new(());

fn stop_active() {
    CANCELED.store(true, Ordering::SeqCst);
    let active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(child) = active {
        jobs::kill_tree(&mut child.lock().unwrap_or_else(|e| e.into_inner()));
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    path: &'a str,
    percent: f32,
}

/// Opens the system's file picker on audio and video files. `None` when the
/// person cancels.
#[tauri::command]
pub async fn pick_media_file(app: AppHandle) -> Option<String> {
    let all: Vec<&str> = VIDEO_EXTENSIONS.iter().chain(AUDIO_EXTENSIONS).copied().collect();
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Choose an audio or video file");
    if let Ok(dir) = settings::save_dir(&settings::current(&app)) {
        dialog = dialog.set_directory(dir);
    }
    dialog
        .add_filter("Audio and video", &all)
        .add_filter("Video", VIDEO_EXTENSIONS)
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .pick_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}

/// Gets a file ready to play and lets the window read it. Progress of a
/// conversion arrives on the `playback-progress` event.
#[tauri::command]
pub async fn prepare_playback(app: AppHandle, path: String) -> Result<PlayableMedia, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stop_active();
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        CANCELED.store(false, Ordering::SeqCst);

        let ffmpeg = engine::resolve(&app, "ffmpeg");
        let progress = |percent: f32| {
            let _ = app.emit("playback-progress", Progress { path: &path, percent });
        };
        let hooks = Hooks {
            progress: &progress,
            started: &|child| *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some(child),
            finished: &|| *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = None,
            canceled: &|| CANCELED.load(Ordering::SeqCst),
        };
        let media = prepare_file(ffmpeg.as_deref(), Path::new(&path), &cache_dir(), &hooks)?;

        // Only this file, and only now, becomes readable by the window.
        app.asset_protocol_scope().allow_file(&media.path).map_err(|e| e.to_string())?;
        Ok(media)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a conversion that is still running (the person left or chose another file).
#[tauri::command]
pub fn cancel_playback() {
    stop_active();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(video: Option<&str>, pixels: Option<&str>, audio: Option<&str>) -> StreamInfo {
        StreamInfo {
            video_codec: video.map(String::from),
            pixel_format: pixels.map(String::from),
            audio_codec: audio.map(String::from),
            ..StreamInfo::default()
        }
    }

    #[test]
    fn opens_audio_and_video_files_and_nothing_else() {
        for name in ["a.mp4", "a.MKV", "a.avi", "a.mp3", "a.FLAC", "a.wma", "a.webm", "a.ogg", "a.m4a"] {
            assert!(is_playable_extension(Path::new(name)), "{name}");
        }
        for name in ["a.txt", "a.pdf", "a.exe", "a.jpg", "a.zip", "a", "a.mp4.txt", ".mp4"] {
            assert!(!is_playable_extension(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn files_the_window_understands_are_played_as_they_are() {
        assert_eq!(plan_for("mp4", &info(Some("h264"), Some("yuv420p"), Some("aac"))), Plan::Native);
        assert_eq!(plan_for("webm", &info(Some("vp9"), Some("yuv420p"), Some("opus"))), Plan::Native);
        assert_eq!(plan_for("mp3", &info(None, None, Some("mp3"))), Plan::Native);
        assert_eq!(plan_for("flac", &info(None, None, Some("flac"))), Plan::Native);
        assert_eq!(plan_for("wav", &info(None, None, Some("pcm_s16le"))), Plan::Native);
        assert_eq!(plan_for("ogg", &info(None, None, Some("vorbis"))), Plan::Native);
        // A silent video, and a video whose picture is fine but named .mov.
        assert_eq!(plan_for("mp4", &info(Some("h264"), Some("yuv420p"), None)), Plan::Native);
        assert_eq!(plan_for("mov", &info(Some("h264"), Some("yuv420p"), Some("aac"))), Plan::Native);
    }

    #[test]
    fn other_containers_are_rewritten_without_re_encoding_when_they_can_be() {
        // MKV or AVI around H.264 + AAC: only the wrapper changes.
        assert_eq!(plan_for("mkv", &info(Some("h264"), Some("yuv420p"), Some("aac"))), Plan::Convert { video: false, audio: false });
        assert_eq!(plan_for("avi", &info(Some("h264"), Some("yuv420p"), Some("mp3"))), Plan::Convert { video: false, audio: false });
        assert_eq!(plan_for("mka", &info(None, None, Some("opus"))), Plan::Convert { video: false, audio: false });
    }

    #[test]
    fn only_the_streams_that_cannot_be_kept_are_re_encoded() {
        // HEVC (TikTok, phones) needs a paid extension on Windows.
        assert_eq!(plan_for("mp4", &info(Some("hevc"), Some("yuv420p"), Some("aac"))), Plan::Convert { video: true, audio: false });
        assert_eq!(plan_for("avi", &info(Some("mpeg4"), Some("yuv420p"), Some("mp3"))), Plan::Convert { video: true, audio: false });
        assert_eq!(plan_for("wmv", &info(Some("wmv3"), Some("yuv420p"), Some("wmav2"))), Plan::Convert { video: true, audio: true });
        assert_eq!(plan_for("wma", &info(None, None, Some("wmav2"))), Plan::Convert { video: false, audio: true });
        assert_eq!(plan_for("m4a", &info(None, None, Some("alac"))), Plan::Convert { video: false, audio: true });
        // 10-bit H.264 does not play in every window either.
        assert_eq!(plan_for("mp4", &info(Some("h264"), Some("yuv420p10le"), Some("aac"))), Plan::Convert { video: true, audio: false });
        // Vorbis cannot go into an MP4 as it is.
        assert_eq!(plan_for("mkv", &info(Some("vp9"), Some("yuv420p"), Some("vorbis"))), Plan::Convert { video: false, audio: true });
    }

    #[test]
    fn the_command_copies_what_it_can_and_never_carries_cover_art_as_video() {
        let with_all = convert_args(Path::new("in.mkv"), Path::new("out.mp4"), &info(Some("h264"), Some("yuv420p"), Some("aac")), false, false);
        assert!(with_all.windows(2).any(|w| w == ["-c:v", "copy"]) && with_all.windows(2).any(|w| w == ["-c:a", "copy"]));

        let both = convert_args(Path::new("in.avi"), Path::new("out.mp4"), &info(Some("mpeg4"), Some("yuv420p"), Some("wmav2")), true, true);
        assert!(both.windows(2).any(|w| w == ["-c:v", "libx264"]) && both.windows(2).any(|w| w == ["-c:a", "aac"]));
        assert_eq!(both.last().unwrap(), "out.mp4");

        // An audio file: no picture stream is mapped, whatever cover it carries.
        let audio = convert_args(Path::new("in.wma"), Path::new("out.mp4"), &info(None, None, Some("wmav2")), false, true);
        assert!(audio.iter().any(|a| a == "-vn"));
        assert!(!audio.iter().any(|a| a == "0:v:0" || a == "-c:v"));
    }

    #[test]
    fn converted_files_get_stable_distinct_names() {
        assert_eq!(fnv("a"), fnv("a"));
        assert_ne!(fnv("a|1"), fnv("a|2"));
        assert_eq!(fnv(""), 0xcbf2_9ce4_8422_2325);
    }

    fn ffmpeg_for_tests() -> Option<PathBuf> {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let installed = std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join("com.cleangrab.app").join("bin").join(name));
        installed.filter(|path| path.is_file()).or_else(|| {
            std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join(name)).find(|path| path.is_file()))
        })
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cleangrab-player-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make(ffmpeg: &Path, out: &Path, args: &[&str]) -> bool {
        quiet_command(ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=2"])
            .args(args)
            .arg(out)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    fn quiet_hooks<R>(canceled: bool, then: impl FnOnce(&Hooks) -> R) -> R {
        let seen = Mutex::new(Vec::<f32>::new());
        let progress = |p: f32| seen.lock().unwrap().push(p);
        let hooks = Hooks { progress: &progress, started: &|_| {}, finished: &|| {}, canceled: &move || canceled };
        then(&hooks)
    }

    #[test]
    fn a_real_avi_and_a_real_mkv_become_files_the_window_can_play() {
        let Some(ffmpeg) = ffmpeg_for_tests() else {
            eprintln!("skipped: no ffmpeg");
            return;
        };
        let dir = scratch("convert");
        let cache = dir.join("cache");

        // AVI with MPEG-4 video: the picture has to be re-encoded.
        let avi = dir.join("clip.avi");
        assert!(make(&ffmpeg, &avi, &["-c:v", "mpeg4", "-c:a", "mp3", "-shortest"]), "ffmpeg makes the AVI");
        let media = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &avi, &cache, hooks)).unwrap();
        assert!(media.converted && media.kind == "video");
        let after = probe(&ffmpeg, Path::new(&media.path)).unwrap();
        assert_eq!(after.video_codec.as_deref(), Some("h264"));
        assert_eq!(after.audio_codec.as_deref(), Some("mp3"), "the sound was kept as it was");

        // MKV with H.264 + AAC: only the wrapper changes, nothing is re-encoded.
        let mkv = dir.join("clip.mkv");
        assert!(make(&ffmpeg, &mkv, &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]), "ffmpeg makes the MKV");
        let remuxed = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &mkv, &cache, hooks)).unwrap();
        assert!(remuxed.converted);
        let after = probe(&ffmpeg, Path::new(&remuxed.path)).unwrap();
        assert_eq!((after.video_codec.as_deref(), after.audio_codec.as_deref()), (Some("h264"), Some("aac")));

        // Asked again, the converted copy is reused rather than made again.
        let before = fs::metadata(&media.path).unwrap().modified().unwrap();
        let again = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &avi, &cache, hooks)).unwrap();
        assert_eq!(again.path, media.path);
        assert_eq!(fs::metadata(&again.path).unwrap().modified().unwrap(), before);

        let leftovers: Vec<_> = fs::read_dir(&cache).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(leftovers.iter().all(|n| !n.contains(".part")), "no unfinished file left: {leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_real_wma_becomes_audio_and_a_real_mp4_is_left_alone() {
        let Some(ffmpeg) = ffmpeg_for_tests() else {
            return;
        };
        let dir = scratch("audio");
        let cache = dir.join("cache");

        let wma = dir.join("song.wma");
        if make(&ffmpeg, &wma, &["-vn", "-c:a", "wmav2"]) {
            let media = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &wma, &cache, hooks)).unwrap();
            assert!(media.converted && media.kind == "audio");
            let after = probe(&ffmpeg, Path::new(&media.path)).unwrap();
            assert_eq!((after.video_codec, after.audio_codec.as_deref()), (None, Some("aac")));
        }

        let mp4 = dir.join("clip.mp4");
        assert!(make(&ffmpeg, &mp4, &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]));
        let media = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &mp4, &cache, hooks)).unwrap();
        assert!(!media.converted, "a file the window plays is not touched");
        assert_eq!(media.path, mp4.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stopping_a_conversion_leaves_nothing_behind() {
        let Some(ffmpeg) = ffmpeg_for_tests() else {
            return;
        };
        let dir = scratch("cancel");
        let avi = dir.join("clip.avi");
        assert!(make(&ffmpeg, &avi, &["-c:v", "mpeg4", "-c:a", "mp3", "-shortest"]));
        let cache = dir.join("cache");
        let result = quiet_hooks(true, |hooks| prepare_file(Some(&ffmpeg), &avi, &cache, hooks));
        assert_eq!(result, Err("Canceled".to_string()));
        assert_eq!(fs::read_dir(&cache).map(|d| d.count()).unwrap_or(0), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_what_is_not_audio_or_video() {
        let dir = scratch("refuse");
        let text = dir.join("notes.txt");
        fs::write(&text, "hello").unwrap();
        let none = quiet_hooks(false, |hooks| prepare_file(None, &text, &dir, hooks));
        assert_eq!(none, Err("CleanGrab's player opens audio and video files only.".to_string()));
        let missing = quiet_hooks(false, |hooks| prepare_file(None, &dir.join("gone.mp3"), &dir, hooks));
        assert!(missing.unwrap_err().contains("can't be found"));

        // Named like a video but not one: ffmpeg says so, and nothing is opened.
        if let Some(ffmpeg) = ffmpeg_for_tests() {
            let fake = dir.join("fake.mp4");
            fs::write(&fake, "this is not a video").unwrap();
            let result = quiet_hooks(false, |hooks| prepare_file(Some(&ffmpeg), &fake, &dir, hooks));
            assert!(result.unwrap_err().contains("doesn't seem to contain audio or video"));
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn without_ffmpeg_only_what_the_window_knows_is_opened() {
        let dir = scratch("noffmpeg");
        let mp3 = dir.join("a.mp3");
        let avi = dir.join("a.avi");
        fs::write(&mp3, "x").unwrap();
        fs::write(&avi, "x").unwrap();
        let ok = quiet_hooks(false, |hooks| prepare_file(None, &mp3, &dir, hooks)).unwrap();
        assert_eq!((ok.kind, ok.converted), ("audio", false));
        assert!(quiet_hooks(false, |hooks| prepare_file(None, &avi, &dir, hooks)).unwrap_err().contains("one-time setup"));
        let _ = fs::remove_dir_all(&dir);
    }
}
