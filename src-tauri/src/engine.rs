// SPDX-License-Identifier: GPL-3.0-only
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::certs;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
#[cfg(target_os = "macos")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

#[cfg(target_os = "windows")]
const FFMPEG_URL: Option<&str> = Some(
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
);
#[cfg(target_os = "macos")]
const FFMPEG_URL: Option<&str> = Some("https://evermeet.cx/ffmpeg/getrelease/zip");
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
const FFMPEG_URL: Option<&str> = None;

/// A small yt-dlp plugin that makes it trust the operating system's certificate
/// store. yt-dlp otherwise only trusts its own list, so an antivirus that scans
/// HTTPS (with a certificate it adds to Windows) makes every download fail.
const CERTIFICATE_PLUGIN: &str = include_str!("../resources/cleangrab_system_certs.py");

/// Where yt-dlp looks for plugins: `yt-dlp-plugins` next to its executable.
fn plugin_root(bin_dir: &Path) -> PathBuf {
    bin_dir.join("yt-dlp-plugins").join("cleangrab-system-certs")
}

fn plugin_file(bin_dir: &Path) -> PathBuf {
    plugin_root(bin_dir)
        .join("yt_dlp_plugins")
        .join("extractor")
        .join("cleangrab_system_certs.py")
}

/// Installs the plugin in `bin_dir`, or brings an outdated copy up to date.
/// Safe to call repeatedly.
fn install_certificate_plugin(bin_dir: &Path) -> io::Result<()> {
    let file = plugin_file(bin_dir);
    if fs::read_to_string(&file).is_ok_and(|current| current == CERTIFICATE_PLUGIN) {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(file, CERTIFICATE_PLUGIN)
}

/// Makes sure the certificate plugin is in place. It is always on: downloads
/// are always checked, and always against the system's store as well, so an
/// antivirus that scans HTTPS does not break them. It lives in CleanGrab's own
/// folder, next to the yt-dlp it installed, so nothing else on the computer is
/// touched.
pub fn sync_certificate_plugin(app: &AppHandle) {
    let Ok(dir) = bin_dir(app) else {
        return;
    };
    if let Err(error) = install_certificate_plugin(&dir) {
        eprintln!("CleanGrab: could not update the certificate plugin: {error}");
    }
}

/// A `Command` that never flashes a console window on Windows.
pub fn quiet_command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("bin"))
        .map_err(|e| e.to_string())
}

/// Finds a tool: the copy CleanGrab installed, one bundled next to the app,
/// then anything already on PATH.
pub fn resolve(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = bin_dir(app) {
        candidates.push(dir.join(&file));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("binaries").join(&file));
            candidates.push(dir.join(&file));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            candidates.push(dir.join(&file));
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub yt_dlp_installed: bool,
    /// Only filled in when asked for: finding it out means starting yt-dlp.
    pub yt_dlp_version: Option<String>,
    pub ffmpeg_installed: bool,
    pub ready: bool,
}

/// The last version read, with the file it came from, so asking again (and
/// starting yt-dlp again) is only needed after an update.
type VersionKey = (PathBuf, Option<std::time::SystemTime>, u64);
static VERSION_CACHE: Mutex<Option<(VersionKey, String)>> = Mutex::new(None);

fn yt_dlp_version(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let key: VersionKey = (path.to_path_buf(), meta.modified().ok(), meta.len());
    if let Some((cached, version)) = VERSION_CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if *cached == key {
            return Some(version.clone());
        }
    }

    let output = quiet_command(path).arg("--version").output().ok()?;
    let version = output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())?;
    *VERSION_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((key, version.clone()));
    Some(version)
}

fn status(app: &AppHandle, with_version: bool) -> EngineStatus {
    let yt_dlp = resolve(app, "yt-dlp");
    let yt_dlp_installed = yt_dlp.is_some();
    let yt_dlp_version = yt_dlp.as_deref().filter(|_| with_version).and_then(yt_dlp_version);
    let ffmpeg_installed = resolve(app, "ffmpeg").is_some();
    EngineStatus {
        ready: yt_dlp_installed && ffmpeg_installed,
        yt_dlp_installed,
        yt_dlp_version,
        ffmpeg_installed,
    }
}

/// What is installed. Cheap unless `with_version` is set, which also starts
/// yt-dlp once to read its version.
#[tauri::command]
pub async fn engine_status(app: AppHandle, with_version: Option<bool>) -> Result<EngineStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&app, with_version.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EngineProgress {
    stage: &'static str,
    percent: f32,
    message: Option<String>,
    /// Set when the failure is a certificate problem (see `certs`).
    kind: Option<&'static str>,
}

fn emit(app: &AppHandle, stage: &'static str, percent: f32, message: Option<String>) {
    let _ = app.emit(
        "engine-progress",
        EngineProgress {
            stage,
            percent,
            message,
            kind: None,
        },
    );
}

/// Reports a failed setup, saying whether it was a certificate problem.
fn emit_error(app: &AppHandle, message: String) {
    let kind = certs::kind_of_message(&message);
    let _ = app.emit(
        "engine-progress",
        EngineProgress {
            stage: "error",
            percent: 0.0,
            message: Some(message),
            kind,
        },
    );
}

/// A failed request, in words: a certificate problem is explained as one, and
/// anything else keeps what went wrong.
fn network_error(action: &str, error: &ureq::Error) -> String {
    certs::explain(&certs::describe(error)).unwrap_or_else(|| format!("Could not {action}: {error}"))
}

/// The agent for downloading the tools: the normal one (system certificates, proxy from the
/// environment), with limits so that a connection that goes quiet ends in an error instead of
/// leaving the setup "downloading" for ever.
pub(crate) fn download_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(45))
        .build()
}

/// Streams `url` into `dest`, reporting progress mapped onto `base..base+span`.
fn download_to(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    stage: &'static str,
    base: f32,
    span: f32,
) -> Result<(), String> {
    let response = download_agent()
        .get(url)
        .set("User-Agent", "CleanGrab")
        .call()
        .map_err(|e| network_error(&format!("download {stage}"), &e))?;
    let total: Option<u64> = response
        .header("Content-Length")
        .and_then(|value| value.parse().ok());

    let mut reader = response.into_reader();
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last_reported = -1.0f32;

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        received += read as u64;

        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = base + span * (received as f32 / total as f32).min(1.0);
            if percent - last_reported >= 0.5 {
                emit(app, stage, percent, None);
                last_reported = percent;
            }
        }
    }
    Ok(())
}

/// SHA-256 of a file, as lowercase hex.
pub(crate) fn sha256_of(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The hash listed for `file_name` in a checksums file. Each line reads
/// `<64 hex digits>  <name>`, or `<hash> *<name>` for binary files.
fn expected_hash(sums: &str, file_name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, name) = line.trim().split_once(char::is_whitespace)?;
        let is_hash = hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit());
        (is_hash && name.trim().trim_start_matches('*') == file_name).then(|| hash.to_ascii_lowercase())
    })
}

/// Where the publisher lists the checksum of the file at `url`, and the name it
/// is listed under. Only the sources CleanGrab downloads from publish one.
fn checksum_source(url: &str) -> Option<(String, String)> {
    let (base, file) = url.rsplit_once('/')?;
    let list = if base.starts_with("https://github.com/yt-dlp/yt-dlp/") {
        "SHA2-256SUMS"
    } else if base.starts_with("https://github.com/yt-dlp/FFmpeg-Builds/") {
        "checksums.sha256"
    } else {
        return None;
    };
    Some((format!("{base}/{list}"), file.to_string()))
}

/// Compares `path` with the hash `sums` lists for `file_name`.
fn check_against_list(path: &Path, sums: &str, file_name: &str, what: &str) -> Result<(), String> {
    let expected = expected_hash(sums, file_name)
        .ok_or_else(|| format!("The official checksum list has no entry for {what}"))?;
    let actual = sha256_of(path).map_err(|e| e.to_string())?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{what} does not match its official checksum, so it was not installed"))
    }
}

/// Refuses a download that does not match the checksum its publisher lists, so
/// a tampered or corrupted file (for instance by something sitting between this
/// computer and GitHub) is never installed or run. The bad file is deleted.
fn verify_download(path: &Path, url: &str, what: &str) -> Result<(), String> {
    let Some((sums_url, file_name)) = checksum_source(url) else {
        return Ok(());
    };
    let result = download_agent()
        .get(&sums_url)
        .set("User-Agent", "CleanGrab")
        .call()
        .map_err(|e| network_error(&format!("fetch the official checksums for {what}"), &e))
        .and_then(|response| response.into_string().map_err(|e| e.to_string()))
        .and_then(|sums| check_against_list(path, &sums, &file_name, what));
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn install_yt_dlp(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let target = dir.join(exe_name("yt-dlp"));
    let partial = dir.join("yt-dlp.part");
    let downloaded = download_to(app, YT_DLP_URL, &partial, "yt-dlp", 0.0, 15.0);
    if downloaded.is_err() {
        let _ = fs::remove_file(&partial);
    }
    downloaded?;
    verify_download(&partial, YT_DLP_URL, "yt-dlp")?;
    fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    make_executable(&target);
    Ok(())
}

fn extract_ffmpeg(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let wanted = exe_name("ffmpeg");

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let is_match = entry.is_file()
            && Path::new(entry.name())
                .file_name()
                .is_some_and(|name| name == wanted.as_str());
        if is_match {
            let mut out = fs::File::create(dest).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("FFmpeg was not found in the downloaded archive".into())
}

fn install_ffmpeg(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let url = FFMPEG_URL
        .ok_or("Install FFmpeg with your package manager, then reopen CleanGrab.")?;
    let target = dir.join(exe_name("ffmpeg"));
    let archive = dir.join("ffmpeg.zip.part");

    let downloaded = download_to(app, url, &archive, "FFmpeg", 15.0, 80.0);
    if downloaded.is_err() {
        let _ = fs::remove_file(&archive);
    }
    downloaded?;
    verify_download(&archive, url, "FFmpeg")?;
    emit(app, "FFmpeg", 96.0, None);
    let extracted = extract_ffmpeg(&archive, &target);
    let _ = fs::remove_file(&archive);
    extracted?;
    make_executable(&target);
    Ok(())
}

/// Set while the tools are being downloaded: a second request (the page asking twice) must not
/// start another download into the same files.
static INSTALLING: AtomicBool = AtomicBool::new(false);

fn install(app: &AppHandle) -> Result<(), String> {
    if !crate::terms::is_accepted() {
        return Err("Terms of Use not accepted".into());
    }
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Ok(()); // already on its way: its progress and result reach the page as usual
    }
    let result = install_tools(app);
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

fn install_tools(app: &AppHandle) -> Result<(), String> {

    let dir = bin_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let result: Result<(), String> = (|| {
        if resolve(app, "yt-dlp").is_none() {
            install_yt_dlp(app, &dir)?;
        }
        if resolve(app, "ffmpeg").is_none() {
            install_ffmpeg(app, &dir)?;
        }
        Ok(())
    })();

    // yt-dlp is new, so give it the certificate plugin too.
    sync_certificate_plugin(app);

    match &result {
        Ok(()) => emit(app, "done", 100.0, None),
        Err(message) => emit_error(app, message.clone()),
    }
    result
}

/// Downloads yt-dlp and FFmpeg from their official release pages into the
/// app's data folder. Progress arrives on the `engine-progress` event.
#[tauri::command]
pub async fn install_engine(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Runs `yt-dlp -U` so extractors keep up with the platforms.
#[tauri::command]
pub async fn update_yt_dlp(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(&app, "yt-dlp").ok_or("yt-dlp is not installed")?;
        let output = quiet_command(&path).arg("-U").output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout);
        let message = text
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Done")
            .trim()
            .to_string();
        if output.status.success() {
            Ok(message)
        } else {
            // Say so plainly when the update was refused because of a certificate.
            let everything = format!("{text}\n{}", String::from_utf8_lossy(&output.stderr));
            Err(certs::explain(&everything).unwrap_or(message))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cleangrab-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn hashes_a_file_the_way_the_publishers_do() {
        let dir = scratch_dir("hash");
        let file = dir.join("abc.txt");
        fs::write(&file, "abc").unwrap();
        // The standard SHA-256 test vector for "abc".
        assert_eq!(
            sha256_of(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn reads_the_hash_listed_for_a_file() {
        let a = "a".repeat(64);
        let b = "B".repeat(64);
        let sums = format!("{a}  yt-dlp.exe\n{b} *other.zip\nnot-a-hash  broken\n");
        assert_eq!(expected_hash(&sums, "yt-dlp.exe"), Some(a));
        assert_eq!(expected_hash(&sums, "other.zip"), Some("b".repeat(64)));
        assert_eq!(expected_hash(&sums, "broken"), None);
        assert_eq!(expected_hash(&sums, "missing"), None);
        // A name that merely contains the wanted one is not a match.
        assert_eq!(expected_hash(&format!("{}  my-yt-dlp.exe", "c".repeat(64)), "yt-dlp.exe"), None);
    }

    #[test]
    fn knows_where_each_publisher_lists_its_checksums() {
        assert_eq!(
            checksum_source("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"),
            Some((
                "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS".to_string(),
                "yt-dlp.exe".to_string()
            ))
        );
        assert_eq!(
            checksum_source("https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"),
            Some((
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/checksums.sha256".to_string(),
                "ffmpeg-master-latest-win64-gpl.zip".to_string()
            ))
        );
        // A host that is not one of ours is never given a list to check against.
        assert_eq!(checksum_source("https://evil.example/yt-dlp/yt-dlp/releases/yt-dlp.exe"), None);
    }

    #[test]
    fn accepts_a_matching_file_and_refuses_any_other() {
        let dir = scratch_dir("check");
        let file = dir.join("tool.exe");
        fs::write(&file, "abc").unwrap();
        let good = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  tool.exe\n";
        let other = format!("{}  tool.exe\n", "0".repeat(64));

        assert!(check_against_list(&file, good, "tool.exe", "tool").is_ok());
        let error = check_against_list(&file, &other, "tool.exe", "tool").unwrap_err();
        assert!(error.contains("does not match"), "{error}");
        // Not listed at all is a refusal too, never a pass.
        assert!(check_against_list(&file, good, "unlisted.exe", "tool").is_err());
    }

    #[test]
    fn the_certificate_plugin_is_installed_where_yt_dlp_looks() {
        let dir = scratch_dir("install");
        install_certificate_plugin(&dir).unwrap();

        let file = dir
            .join("yt-dlp-plugins")
            .join("cleangrab-system-certs")
            .join("yt_dlp_plugins")
            .join("extractor")
            .join("cleangrab_system_certs.py");
        assert_eq!(fs::read_to_string(&file).unwrap(), CERTIFICATE_PLUGIN);
        assert!(CERTIFICATE_PLUGIN.contains("make_ssl_context"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn installing_the_plugin_leaves_the_tools_alone() {
        let dir = scratch_dir("beside");
        fs::write(dir.join("yt-dlp.exe"), b"tool").unwrap();

        install_certificate_plugin(&dir).unwrap();
        install_certificate_plugin(&dir).unwrap(); // repeating it is fine
        assert_eq!(fs::read(dir.join("yt-dlp.exe")).unwrap(), b"tool");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_plugin_that_was_deleted_comes_back() {
        let dir = scratch_dir("restore");
        install_certificate_plugin(&dir).unwrap();
        fs::remove_dir_all(plugin_root(&dir)).unwrap();

        install_certificate_plugin(&dir).unwrap();
        assert_eq!(fs::read_to_string(plugin_file(&dir)).unwrap(), CERTIFICATE_PLUGIN);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_outdated_copy_is_replaced() {
        let dir = scratch_dir("update");
        let file = plugin_file(&dir);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "old version").unwrap();

        install_certificate_plugin(&dir).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), CERTIFICATE_PLUGIN);
        let _ = fs::remove_dir_all(&dir);
    }
}
