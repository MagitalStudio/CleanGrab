// SPDX-License-Identifier: GPL-3.0-only
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager};

const HISTORY_FILE: &str = "history.json";
const HISTORY_LIMIT: usize = 200;

fn best_quality() -> String {
    "best".to_string()
}

/// Part of the media to keep, in seconds. `end: None` means "until the end".
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trim {
    pub start: f64,
    pub end: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub url: String,
    pub platform: String,
    /// "mp3" or "mp4".
    pub format: String,
    pub title: Option<String>,
    /// "running", "done", "error" or "canceled".
    pub status: String,
    /// While running: "starting", "downloading" or "converting".
    pub stage: String,
    pub percent: f32,
    pub path: Option<String>,
    pub error: Option<String>,
    /// Set when the failure is a certificate problem ("certificate-untrusted",
    /// "certificate-expired" or "certificate-site"), so the interface can explain it.
    #[serde(default)]
    pub error_kind: Option<String>,
    pub created_at: u64,
    /// Set when only part of the media was requested.
    pub trim: Option<Trim>,
    /// "best", an audio bitrate in kbps ("320", "192", "128") for MP3, or a
    /// maximum video height ("1080", "720", "480", "360") for MP4.
    #[serde(default = "best_quality")]
    pub quality: String,
}

impl Job {
    fn is_finished(&self) -> bool {
        self.status != "running"
    }
}

/// Single source of truth for downloads. Every window renders the snapshot
/// that arrives on the `jobs-changed` event.
#[derive(Default)]
pub struct JobStore {
    jobs: Mutex<Vec<Job>>,
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn history_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(HISTORY_FILE))
}

impl JobStore {
    /// Restores finished downloads from the previous session.
    pub fn load(app: &AppHandle) -> Self {
        let jobs: Vec<Job> = history_path(app)
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            jobs: Mutex::new(jobs),
            children: Mutex::default(),
        }
    }
}

fn store(app: &AppHandle) -> &JobStore {
    app.state::<JobStore>().inner()
}

fn persist(app: &AppHandle, jobs: &[Job]) {
    let Some(path) = history_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let finished: Vec<&Job> = jobs
        .iter()
        .filter(|job| job.is_finished())
        .take(HISTORY_LIMIT)
        .collect();
    if let Ok(raw) = serde_json::to_string(&finished) {
        let _ = crate::fsutil::write_atomic(&path, raw);
    }
}

fn publish(app: &AppHandle, snapshot: &[Job]) {
    let _ = app.emit("jobs-changed", snapshot);
}

pub fn snapshot(app: &AppHandle) -> Vec<Job> {
    lock(&store(app).jobs).clone()
}

/// Adds a job at the top of the list.
pub fn add(app: &AppHandle, job: Job) {
    let snapshot = {
        let mut jobs = lock(&store(app).jobs);
        jobs.insert(0, job);
        // Finished downloads past the history limit are not kept on disk, nor here: the list
        // is sent to every window on each change, so it must not grow for as long as CleanGrab runs.
        let mut finished = 0;
        jobs.retain(|job| {
            if job.is_finished() {
                finished += 1;
                finished <= HISTORY_LIMIT
            } else {
                true
            }
        });
        jobs.clone()
    };
    publish(app, &snapshot);
}

/// Applies `change` to a job, persists if it finished, and notifies windows.
pub fn update(app: &AppHandle, id: &str, change: impl FnOnce(&mut Job)) {
    let (snapshot, finished) = {
        let mut jobs = lock(&store(app).jobs);
        let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
            return;
        };
        change(job);
        let finished = job.is_finished();
        (jobs.clone(), finished)
    };
    if finished {
        persist(app, &snapshot);
    }
    publish(app, &snapshot);
}

pub fn is_canceled(app: &AppHandle, id: &str) -> bool {
    lock(&store(app).jobs)
        .iter()
        .any(|job| job.id == id && job.status == "canceled")
}

/// Stops a download and everything it started. yt-dlp's Windows build does its
/// work in a second process and starts FFmpeg too, so ending only the process
/// CleanGrab launched would leave the download running.
pub(crate) fn kill_tree(child: &mut Child) {
    // A process that already ended may have its number reused by another one.
    if !matches!(child.try_wait(), Ok(None)) {
        return;
    }
    let pid = child.id().to_string();
    #[cfg(target_os = "windows")]
    let _ = crate::engine::quiet_command(Path::new("taskkill"))
        .args(["/T", "/F", "/PID", &pid])
        .output();
    #[cfg(not(target_os = "windows"))]
    let _ = std::process::Command::new("pkill").args(["-KILL", "-P", &pid]).output();
    let _ = child.kill();
}

/// Stops every download still running. Called when CleanGrab quits.
pub fn stop_all(app: &AppHandle) {
    let Some(store) = app.try_state::<JobStore>() else {
        return;
    };
    let children: Vec<_> = lock(&store.children).values().cloned().collect();
    for child in children {
        kill_tree(&mut lock(&child));
    }
}

pub fn register_child(app: &AppHandle, id: &str, child: Arc<Mutex<Child>>) {
    lock(&store(app).children).insert(id.to_string(), child);
}

pub fn unregister_child(app: &AppHandle, id: &str) {
    lock(&store(app).children).remove(id);
}

#[tauri::command]
pub fn list_jobs(app: AppHandle) -> Vec<Job> {
    snapshot(&app)
}

/// Stops a running download. The runner sees the "canceled" status and exits.
#[tauri::command]
pub fn cancel_job(app: AppHandle, id: String) {
    update(&app, &id, |job| {
        if job.status == "running" {
            job.status = "canceled".into();
        }
    });
    let child = lock(&store(&app).children).get(&id).cloned();
    if let Some(child) = child {
        kill_tree(&mut lock(&child));
    }
}

#[tauri::command]
pub fn remove_job(app: AppHandle, id: String) {
    let snapshot = {
        let mut jobs = lock(&store(&app).jobs);
        jobs.retain(|job| job.id != id || !job.is_finished());
        jobs.clone()
    };
    persist(&app, &snapshot);
    publish(&app, &snapshot);
}

#[tauri::command]
pub fn clear_finished(app: AppHandle) {
    let snapshot = {
        let mut jobs = lock(&store(&app).jobs);
        jobs.retain(|job| !job.is_finished());
        jobs.clone()
    };
    persist(&app, &snapshot);
    publish(&app, &snapshot);
}

#[tauri::command]
pub fn reveal_job(app: AppHandle, id: String) -> Result<(), String> {
    let path = snapshot(&app)
        .into_iter()
        .find(|job| job.id == id)
        .and_then(|job| job.path)
        .ok_or("This download has no file")?;
    if !std::path::Path::new(&path).exists() {
        return Err("The file has been moved or deleted".into());
    }
    crate::settings::reveal(&path);
    Ok(())
}
