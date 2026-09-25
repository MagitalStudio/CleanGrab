// SPDX-License-Identifier: GPL-3.0-only
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const TERMS_FILE: &str = "terms.json";
/// Bump this when the Terms of Use change materially to re-prompt every user.
const TERMS_VERSION: u32 = 4;

static ACCEPTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
struct TermsRecord {
    version: u32,
    accepted_at: u64,
}

fn terms_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(TERMS_FILE))
        .map_err(|e| e.to_string())
}

/// Reads the persisted acceptance record. Called once at startup, before the
/// clipboard watcher does any work.
pub fn load(app: &AppHandle) {
    let accepted = terms_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<TermsRecord>(&raw).ok())
        .is_some_and(|record| record.version >= TERMS_VERSION);
    ACCEPTED.store(accepted, Ordering::SeqCst);
}

/// Until the user accepts the Terms of Use, CleanGrab must not read the
/// clipboard, download tools or save anything.
pub fn is_accepted() -> bool {
    ACCEPTED.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn terms_accepted() -> bool {
    is_accepted()
}

#[tauri::command]
pub fn accept_terms(app: AppHandle) -> Result<(), String> {
    let path = terms_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let record = TermsRecord {
        version: TERMS_VERSION,
        accepted_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    let raw = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    crate::fsutil::write_atomic(&path, raw).map_err(|e| e.to_string())?;
    ACCEPTED.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn decline_terms(app: AppHandle) {
    app.exit(0);
}
