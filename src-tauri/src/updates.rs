// SPDX-License-Identifier: GPL-3.0-only
//! Keeping CleanGrab up to date, from GitHub.
//!
//! CleanGrab asks GitHub, once a day and on request, for the latest release of one repository
//! (`REPO`). When it is newer than the running version, the person is offered it (a banner on
//! Home, an entry in the tray menu): CleanGrab downloads the installer from the release itself,
//! checks it against the SHA-256 that GitHub records for that file, and only installs it when the
//! person presses "Install and restart" (the installer runs in its passive mode, then CleanGrab
//! starts again with the settings kept).
//!
//! The search is only made with the Terms of Use accepted and with "Check for updates" on in
//! Settings (asking by hand always works), certificates are always verified, and nothing but plain
//! requests for the public release and its installer go out. A release that has no installer with a
//! recorded checksum can still be announced, but is then opened on its page instead.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{certs, engine, jobs, settings, terms};

/// The GitHub repository whose releases announce new versions, as `account/repository`. Left empty,
/// CleanGrab never looks for updates. It can be a repository that holds nothing but releases.
const REPO: &str = "MagitalStudio/CleanGrab";

const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// A release is a few kilobytes of text; anything far bigger is not one.
const MAX_REPLY_BYTES: u64 = 512 * 1024;
const MAX_NOTES_CHARS: usize = 2000;
/// The installer is a few megabytes; one bigger than this is not the installer.
const MAX_INSTALLER_BYTES: u64 = 300 * 1024 * 1024;
/// How the installer of a release is named (`CleanGrab_0.2.0_x64-setup.exe`).
const INSTALLER_PREFIX: &str = "cleangrab_";
const INSTALLER_SUFFIX: &str = "_x64-setup.exe";

const NOT_SET_UP: &str = "Updates are not set up in this version";
const FAILED: &str = "Could not check for updates";
const DOWNLOAD_FAILED: &str = "Could not download the update";
const CHECKSUM_MISMATCH: &str = "The downloaded update does not match its published checksum, so it was not kept";
const NOT_DOWNLOADED: &str = "The update has not been downloaded yet";
const DOWNLOADS_RUNNING: &str = "Downloads are still running";
const INSTALLER_FAILED: &str = "Could not start the installer";

/// Remembers, in the settings folder, the version an update was last installed as.
const INSTALLED_FILE: &str = "updates.json";

/// The installer of a release, as GitHub lists it.
#[derive(Clone, Debug, PartialEq)]
struct Asset {
    name: String,
    /// Where it is downloaded from (a github.com address of this repository's releases).
    url: String,
    /// The SHA-256 GitHub records for the file, in lowercase hex.
    sha256: String,
    size: u64,
}

/// A version newer than this one, as published on GitHub.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    /// "0.2.0", without the "v" of the tag.
    pub version: String,
    /// What the release says is new (plain text).
    pub notes: String,
    /// The release's page on github.com.
    pub url: String,
    /// CleanGrab can download and install it itself: the release has an installer whose checksum is
    /// recorded. If not, the person is sent to the release's page.
    pub installable: bool,
    #[serde(skip)]
    asset: Option<Asset>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// The version running now.
    pub current: String,
    pub update: Option<Update>,
}

/// Where the update stands: "idle", "downloading", "ready" (downloaded and checked) or "error".
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: &'static str,
    pub percent: f32,
    pub message: Option<String>,
}

/// An installer that has been downloaded and checked.
struct Ready {
    path: PathBuf,
    sha256: String,
}

/// The newest update found so far, kept for the page that opens later.
static FOUND: Mutex<Option<Update>> = Mutex::new(None);
static PROGRESS: Mutex<Progress> = Mutex::new(Progress { stage: "idle", percent: 0.0, message: None });
static READY: Mutex<Option<Ready>> = Mutex::new(None);
/// Set while an installer is being downloaded: asking twice must not start a second download.
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn found() -> Option<Update> {
    lock(&FOUND).clone()
}

/// `account/repository`, and nothing that could change the address it is put in.
fn valid_repo(repo: &str) -> bool {
    let plain = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let mut parts = repo.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(name), None) if plain(owner) && plain(name))
}

/// "v1.2.3", "1.2" or "1.2.3-beta.1" as [major, minor, patch].
fn parse_version(text: &str) -> Option<[u64; 3]> {
    let core = text.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major: u64 = parts.next()?.parse().ok()?;
    let minor: u64 = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    let patch: u64 = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    if parts.next().is_some() {
        return None;
    }
    Some([major, minor, patch])
}

fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

/// Whether `url` starts with `prefix` (an address of this repository), whatever the case.
fn starts_with_ignoring_case(url: &str, prefix: &str) -> bool {
    url.to_ascii_lowercase().starts_with(&prefix.to_ascii_lowercase())
}

/// Whether `url` is a page of this repository's releases, and nowhere else.
fn is_release_page(url: &str, repo: &str) -> bool {
    starts_with_ignoring_case(url, &format!("https://github.com/{repo}/releases/"))
}

/// The Windows installer of a release: named like CleanGrab's, downloaded from this repository's
/// releases, of a sensible size, with the SHA-256 GitHub recorded for it.
fn find_asset(release: &Value, repo: &str) -> Option<Asset> {
    if !cfg!(target_os = "windows") {
        return None; // the installer is a Windows one
    }
    let downloads = format!("https://github.com/{repo}/releases/download/");
    release["assets"].as_array()?.iter().find_map(|asset| {
        let name = asset["name"].as_str()?;
        let plain = name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        let lower = name.to_ascii_lowercase();
        if !plain || !lower.starts_with(INSTALLER_PREFIX) || !lower.ends_with(INSTALLER_SUFFIX) {
            return None;
        }
        let url = asset["browser_download_url"].as_str().filter(|url| starts_with_ignoring_case(url, &downloads))?;
        let size = asset["size"].as_u64().filter(|size| *size > 0 && *size <= MAX_INSTALLER_BYTES)?;
        let sha256 = asset["digest"].as_str()?.strip_prefix("sha256:")?.to_ascii_lowercase();
        if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        Some(Asset { name: name.to_string(), url: url.to_string(), sha256, size })
    })
}

/// The update a release announces, if it is a published (not draft, not pre-release) release of a
/// newer version than `current`, with its page on this repository.
fn read_release(body: &str, repo: &str, current: &str) -> Option<Update> {
    let release: Value = serde_json::from_str(body).ok()?;
    if release["draft"].as_bool() == Some(true) || release["prerelease"].as_bool() == Some(true) {
        return None;
    }
    let tag = release["tag_name"].as_str()?;
    if !is_newer(tag, current) {
        return None;
    }
    let url = release["html_url"].as_str().filter(|url| is_release_page(url, repo))?;
    let notes: String = release["body"].as_str().unwrap_or("").trim().chars().take(MAX_NOTES_CHARS).collect();
    let asset = find_asset(&release, repo);
    Some(Update {
        version: tag.trim().trim_start_matches(['v', 'V']).to_string(),
        notes,
        url: url.to_string(),
        installable: asset.is_some(),
        asset,
    })
}

/// The latest release of `repo` as GitHub describes it; `None` when nothing has been published yet.
fn latest_release(repo: &str) -> Result<Option<String>, String> {
    let response = match certs::agent(false)
        .get(&format!("https://api.github.com/repos/{repo}/releases/latest"))
        .set("User-Agent", "CleanGrab")
        .set("Accept", "application/vnd.github+json")
        .timeout(REQUEST_TIMEOUT)
        .call()
    {
        Ok(response) => response,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(error) => return Err(certs::explain(&certs::describe(&error)).unwrap_or_else(|| FAILED.to_string())),
    };
    let mut text = String::new();
    response.into_reader().take(MAX_REPLY_BYTES).read_to_string(&mut text).map_err(|_| FAILED.to_string())?;
    Ok(Some(text))
}

fn installed_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(INSTALLED_FILE))
}

/// The version an update was last installed as, if one ever was through CleanGrab.
fn installed_version(app: &AppHandle) -> Option<String> {
    let raw = fs::read_to_string(installed_path(app)?).ok()?;
    let record: Value = serde_json::from_str(&raw).ok()?;
    record["installed"].as_str().map(str::to_string)
}

/// Written when the installer is started: from then on that version is never offered again, even by a
/// build that still reports an older number (the version was not raised before it was built).
fn remember_installed(app: &AppHandle, version: &str) {
    let Some(path) = installed_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = crate::fsutil::write_atomic(&path, serde_json::json!({ "installed": version }).to_string());
}

/// The update, unless it is the version (or an older one) that was already installed by an update.
fn not_yet_installed(update: Update, installed: Option<&str>) -> Option<Update> {
    match installed {
        Some(done) if !is_newer(&update.version, done) => None,
        _ => Some(update),
    }
}

/// Where the installer is downloaded: a folder of its own in the temp folder, emptied at start.
fn download_dir() -> PathBuf {
    std::env::temp_dir().join("CleanGrab-update")
}

/// Removes what an earlier update left in the temp folder.
pub fn clean_downloads() {
    let _ = fs::remove_dir_all(download_dir());
}

/// Tells every window where the update stands, and remembers it for a window that opens later.
fn set_progress(app: &AppHandle, stage: &'static str, percent: f32, message: Option<String>) {
    let progress = Progress { stage, percent, message };
    *lock(&PROGRESS) = progress.clone();
    let _ = app.emit("update-progress", progress);
}

/// Keeps what the search found. A different version than before starts again: what was
/// downloaded for the old one is forgotten.
fn remember(app: &AppHandle, update: Option<Update>) {
    let changed = {
        let mut current = lock(&FOUND);
        let changed = current.as_ref().map(|old| &old.version) != update.as_ref().map(|new| &new.version);
        *current = update;
        changed
    };
    if changed && !DOWNLOADING.load(Ordering::SeqCst) {
        *lock(&READY) = None;
        clean_downloads();
        set_progress(app, "idle", 0.0, None);
    }
}

/// Asks GitHub now and remembers what it says.
fn check_now(app: &AppHandle) -> Result<UpdateStatus, String> {
    if !valid_repo(REPO) {
        return Err(NOT_SET_UP.into());
    }
    let current = env!("CARGO_PKG_VERSION");
    let installed = installed_version(app);
    let update = latest_release(REPO)?
        .and_then(|body| read_release(&body, REPO, current))
        .and_then(|update| not_yet_installed(update, installed.as_deref()));
    remember(app, update.clone());
    Ok(UpdateStatus { current: current.to_string(), update })
}

/// Tells every window when a newer version is out.
fn announce(app: &AppHandle, status: &UpdateStatus) {
    if let Some(update) = &status.update {
        let _ = app.emit("update-available", update);
    }
}

/// Looks for an update shortly after start and then once a day, for as long as CleanGrab runs in
/// the tray. It stays quiet without a repository, without the Terms accepted, or when the person
/// turned the check off.
pub fn start_checker(app: AppHandle) {
    if !valid_repo(REPO) {
        return;
    }
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_AFTER);
        loop {
            if terms::is_accepted() && settings::current(&app).check_for_updates {
                if let Ok(status) = check_now(&app) {
                    announce(&app, &status);
                }
            }
            thread::sleep(CHECK_EVERY);
        }
    });
}

/// Looks now, whatever the setting says: the person asked.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateStatus, String> {
    if !terms::is_accepted() {
        return Err("Terms of Use not accepted".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let status = check_now(&app)?;
        announce(&app, &status);
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The update found earlier, for a page that opens after the search.
#[tauri::command]
pub fn latest_update() -> Option<Update> {
    found()
}

/// How far the download of the update has got.
#[tauri::command]
pub fn update_progress() -> Progress {
    lock(&PROGRESS).clone()
}

/// Downloads the installer into the temp folder and checks it against the checksum GitHub records.
fn fetch_installer(app: &AppHandle, asset: &Asset) -> Result<Ready, String> {
    let dir = download_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&asset.name);
    let partial = dir.join(format!("{}.part", asset.name));

    let response = engine::download_agent()
        .get(&asset.url)
        .set("User-Agent", "CleanGrab")
        .call()
        .map_err(|error| certs::explain(&certs::describe(&error)).unwrap_or_else(|| DOWNLOAD_FAILED.to_string()))?;
    // Never more than what the release says the file is (plus one byte, to notice a longer one).
    let mut reader = response.into_reader().take(asset.size + 1);
    let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;

    let mut buffer = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last_reported = -1.0f32;
    let copied: Result<(), String> = loop {
        let read = match reader.read(&mut buffer) {
            Ok(read) => read,
            Err(_) => break Err(DOWNLOAD_FAILED.to_string()),
        };
        if read == 0 {
            break Ok(());
        }
        if let Err(error) = file.write_all(&buffer[..read]) {
            break Err(error.to_string());
        }
        received += read as u64;
        // 100 is kept for once the file has been checked.
        let percent = (received as f32 / asset.size as f32 * 100.0).min(99.0);
        if percent - last_reported >= 1.0 {
            last_reported = percent;
            set_progress(app, "downloading", percent, None);
        }
    };
    drop(file);

    let checked = copied
        .and_then(|()| if received == asset.size { Ok(()) } else { Err(DOWNLOAD_FAILED.to_string()) })
        .and_then(|()| engine::sha256_of(&partial).map_err(|e| e.to_string()))
        .and_then(|actual| if actual == asset.sha256 { Ok(actual) } else { Err(CHECKSUM_MISMATCH.to_string()) })
        .and_then(|actual| fs::rename(&partial, &target).map(|()| actual).map_err(|e| e.to_string()));
    match checked {
        Ok(sha256) => Ok(Ready { path: target, sha256 }),
        Err(message) => {
            let _ = fs::remove_file(&partial);
            Err(message)
        }
    }
}

/// Downloads the update found and checks it. Progress arrives on the `update-progress` event.
#[tauri::command]
pub async fn download_update(app: AppHandle) -> Result<(), String> {
    if !terms::is_accepted() {
        return Err("Terms of Use not accepted".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let asset = found().and_then(|update| update.asset).ok_or("There is no update to download")?;
        if DOWNLOADING.swap(true, Ordering::SeqCst) {
            return Ok(()); // already on its way: its progress and result reach the page as usual
        }
        set_progress(&app, "downloading", 0.0, None);
        let result = fetch_installer(&app, &asset);
        DOWNLOADING.store(false, Ordering::SeqCst);
        match result {
            Ok(ready) => {
                *lock(&READY) = Some(ready);
                set_progress(&app, "ready", 100.0, None);
                Ok(())
            }
            Err(message) => {
                set_progress(&app, "error", 0.0, Some(message.clone()));
                Err(message)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Runs the installer that was downloaded and checked, then quits so that it can replace CleanGrab.
/// It runs in its passive mode (a small progress window), as an update (settings and shortcuts are
/// kept), and starts CleanGrab again when it is done, telling it to show its window.
#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Updates are installed on Windows only".into());
    }
    if !terms::is_accepted() {
        return Err("Terms of Use not accepted".into());
    }
    let (path, expected) = lock(&READY)
        .as_ref()
        .map(|ready| (ready.path.clone(), ready.sha256.clone()))
        .ok_or(NOT_DOWNLOADED)?;
    // Quitting stops downloads: not while the person is waiting for one.
    if jobs::snapshot(&app).iter().any(|job| job.status == "running") {
        return Err(DOWNLOADS_RUNNING.into());
    }
    // Checked again just before it runs: the file sits in a folder other programs can write to.
    let actual = engine::sha256_of(&path).map_err(|_| NOT_DOWNLOADED.to_string())?;
    if actual != expected {
        let _ = fs::remove_file(&path);
        *lock(&READY) = None;
        set_progress(&app, "idle", 0.0, None);
        return Err(CHECKSUM_MISMATCH.into());
    }
    let version = found().map(|update| update.version);
    Command::new(&path)
        .args(["/P", "/UPDATE", "/R", "/ARGS", "--after-update"])
        .spawn()
        .map_err(|e| format!("{INSTALLER_FAILED}: {e}"))?;
    if let Some(version) = version {
        remember_installed(&app, &version);
    }
    app.exit(0);
    Ok(())
}

/// Whether the installer of an update has just started CleanGrab: the window then opens even
/// when CleanGrab is set to start quietly in the tray.
#[tauri::command]
pub fn launched_after_update() -> bool {
    std::env::args().any(|argument| argument == "--after-update")
}

/// Opens the page of the update found, in the browser (for a release CleanGrab cannot install by
/// itself). The page is the one recorded by the search, never an address the window supplies.
pub fn open_page() -> Result<(), String> {
    let update = found().ok_or("There is no update to open")?;
    if !is_release_page(&update.url, REPO) {
        return Err("There is no update to open".into());
    }
    settings::open_web_page(&update.url);
    Ok(())
}

#[tauri::command]
pub fn open_update_page() -> Result<(), String> {
    open_page()
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPO_FOR_TESTS: &str = "MagitalStudio/CleanGrab";
    const PAGE: &str = "https://github.com/MagitalStudio/CleanGrab/releases/tag/v0.2.0";
    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn release(tag: &str, url: &str, extra: &str) -> String {
        format!(r#"{{"tag_name":"{tag}","html_url":"{url}","body":"  Fixes and a new player.  "{extra}}}"#)
    }

    fn with_asset(name: &str, url: &str, size: u64, digest: &str) -> String {
        let assets = format!(r#","assets":[{{"name":"{name}","browser_download_url":"{url}","size":{size},"digest":"{digest}"}}]"#);
        release("v0.2.0", PAGE, &assets)
    }

    const INSTALLER: &str = "CleanGrab_0.2.0_x64-setup.exe";
    const INSTALLER_URL: &str = "https://github.com/MagitalStudio/CleanGrab/releases/download/v0.2.0/CleanGrab_0.2.0_x64-setup.exe";

    #[test]
    fn versions_are_read_and_compared_by_number_not_by_text() {
        assert_eq!(parse_version("v1.2.3"), Some([1, 2, 3]));
        assert_eq!(parse_version("0.10"), Some([0, 10, 0]));
        assert_eq!(parse_version("2.0.0-beta.1"), Some([2, 0, 0]));
        assert_eq!(parse_version("latest"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert!(is_newer("v0.10.0", "0.9.5"), "10 is more than 9");
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(!is_newer("nightly", "0.1.0"));
    }

    #[test]
    fn only_account_slash_repository_is_an_address_part() {
        assert!(valid_repo("MagitalStudio/CleanGrab"));
        assert!(valid_repo("a-b/c_d.e"));
        for bad in ["", "CleanGrab", "a/b/c", "/b", "a/", "a b/c", "a/b?x=1", "a/../b", "a\\b/c"] {
            assert!(!valid_repo(bad), "{bad}");
        }
    }

    #[test]
    fn a_newer_published_release_is_an_update() {
        let update = read_release(&release("v0.2.0", PAGE, ""), REPO_FOR_TESTS, "0.1.0").expect("an update");
        assert_eq!(update.version, "0.2.0");
        assert_eq!(update.notes, "Fixes and a new player.");
        assert_eq!(update.url, PAGE);
        assert!(!update.installable, "no installer was attached");
    }

    #[test]
    fn the_same_older_draft_or_pre_release_is_not() {
        assert!(read_release(&release("v0.1.0", PAGE, ""), REPO_FOR_TESTS, "0.1.0").is_none());
        assert!(read_release(&release("v0.0.5", PAGE, ""), REPO_FOR_TESTS, "0.1.0").is_none());
        assert!(read_release(&release("v0.2.0", PAGE, r#","draft":true"#), REPO_FOR_TESTS, "0.1.0").is_none());
        assert!(read_release(&release("v0.2.0", PAGE, r#","prerelease":true"#), REPO_FOR_TESTS, "0.1.0").is_none());
        assert!(read_release("not json", REPO_FOR_TESTS, "0.1.0").is_none());
    }

    #[test]
    fn a_page_outside_the_repository_is_never_offered() {
        for url in [
            "https://evil.example/MagitalStudio/CleanGrab/releases/tag/v9.0.0",
            "https://github.com/someone-else/CleanGrab/releases/tag/v9.0.0",
            "http://github.com/MagitalStudio/CleanGrab/releases/tag/v9.0.0",
            "https://github.com/MagitalStudio/CleanGrab-fake/releases/tag/v9.0.0",
            "https://github.com/MagitalStudio/CleanGrab/issues/1",
        ] {
            assert!(read_release(&release("v9.0.0", url, ""), REPO_FOR_TESTS, "0.1.0").is_none(), "{url}");
        }
        // GitHub may write the account or repository in another case.
        let lower = release("v9.0.0", "https://github.com/magitalstudio/cleangrab/releases/tag/v9.0.0", "");
        assert!(read_release(&lower, REPO_FOR_TESTS, "0.1.0").is_some());
    }

    #[test]
    fn very_long_notes_are_cut() {
        let long = "x".repeat(MAX_NOTES_CHARS * 3);
        let body = format!(r#"{{"tag_name":"v0.2.0","html_url":"{PAGE}","body":"{long}"}}"#);
        assert_eq!(read_release(&body, REPO_FOR_TESTS, "0.1.0").unwrap().notes.chars().count(), MAX_NOTES_CHARS);
    }

    #[test]
    fn a_proper_installer_with_a_recorded_checksum_can_be_installed_by_the_app() {
        let body = with_asset(INSTALLER, INSTALLER_URL, 2_828_266, &format!("sha256:{HASH}"));
        let update = read_release(&body, REPO_FOR_TESTS, "0.1.0").expect("an update");
        if cfg!(target_os = "windows") {
            assert!(update.installable);
            let asset = update.asset.expect("the installer");
            assert_eq!(asset.name, INSTALLER);
            assert_eq!(asset.sha256, HASH);
            assert_eq!(asset.size, 2_828_266);
        } else {
            assert!(!update.installable, "the installer is a Windows one");
        }
    }

    #[test]
    fn an_installer_that_cannot_be_trusted_is_left_to_the_release_page() {
        let upper_hash = HASH.to_uppercase();
        let cases = [
            // no checksum recorded, or not a SHA-256
            with_asset(INSTALLER, INSTALLER_URL, 1000, ""),
            with_asset(INSTALLER, INSTALLER_URL, 1000, "sha1:abcdef"),
            with_asset(INSTALLER, INSTALLER_URL, 1000, "sha256:abc"),
            // not CleanGrab's installer
            with_asset("other-setup.exe", INSTALLER_URL, 1000, &format!("sha256:{HASH}")),
            with_asset("CleanGrab_0.2.0_x64.zip", INSTALLER_URL, 1000, &format!("sha256:{HASH}")),
            with_asset("CleanGrab_0.2.0 x64-setup.exe", INSTALLER_URL, 1000, &format!("sha256:{HASH}")),
            // not downloaded from this repository's releases
            with_asset(INSTALLER, "https://evil.example/CleanGrab_0.2.0_x64-setup.exe", 1000, &format!("sha256:{HASH}")),
            with_asset(INSTALLER, "https://github.com/someone-else/CleanGrab/releases/download/v0.2.0/CleanGrab_0.2.0_x64-setup.exe", 1000, &format!("sha256:{HASH}")),
            // an impossible size
            with_asset(INSTALLER, INSTALLER_URL, 0, &format!("sha256:{HASH}")),
            with_asset(INSTALLER, INSTALLER_URL, MAX_INSTALLER_BYTES + 1, &format!("sha256:{HASH}")),
        ];
        for body in cases {
            let update = read_release(&body, REPO_FOR_TESTS, "0.1.0").expect("still an update to announce");
            assert!(!update.installable, "{body}");
        }
        // The checksum's case does not matter.
        let upper = with_asset(INSTALLER, INSTALLER_URL, 1000, &format!("sha256:{upper_hash}"));
        let update = read_release(&upper, REPO_FOR_TESTS, "0.1.0").unwrap();
        assert_eq!(update.installable, cfg!(target_os = "windows"));
    }

    #[test]
    fn an_update_that_was_installed_is_not_offered_again() {
        let update = read_release(&release("v0.2.0", PAGE, ""), REPO_FOR_TESTS, "0.1.0").unwrap();
        // Nothing installed yet, or an older version installed: it is offered.
        assert!(not_yet_installed(update.clone(), None).is_some());
        assert!(not_yet_installed(update.clone(), Some("0.1.5")).is_some());
        // The same version installed, even by a build that still says 0.1.0: not offered again.
        assert!(not_yet_installed(update.clone(), Some("0.2.0")).is_none());
        assert!(not_yet_installed(update, Some("0.3.0")).is_none());
        // A newer release than the one installed is offered.
        let newer = read_release(&release("v0.3.0", PAGE, ""), REPO_FOR_TESTS, "0.1.0").unwrap();
        assert!(not_yet_installed(newer, Some("0.2.0")).is_some());
    }

    #[test]
    fn what_the_page_is_given_does_not_carry_the_download_address() {
        let body = with_asset(INSTALLER, INSTALLER_URL, 1000, &format!("sha256:{HASH}"));
        let update = read_release(&body, REPO_FOR_TESTS, "0.1.0").unwrap();
        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("\"installable\""));
        assert!(!json.contains("download"), "{json}");
        assert!(!json.contains(HASH), "{json}");
    }
}
