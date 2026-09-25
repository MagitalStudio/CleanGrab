// SPDX-License-Identifier: GPL-3.0-only
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Theme};

const SETTINGS_FILE: &str = "settings.json";

/// Below this the popup's text would be hard to read over a busy desktop.
const MIN_POPUP_OPACITY: f64 = 0.5;
const DEFAULT_POPUP_OPACITY: f64 = 0.95;

/// Colour theme: follow the operating system, or force light or dark.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub appearance: Appearance,
    /// Start without opening the main window: CleanGrab just sits in the tray.
    pub start_in_background: bool,
    /// How opaque the quick-save popup's background is, from 0.5 to 1.
    pub popup_opacity: f64,
    /// Whether the clipboard watcher is active.
    pub watch_clipboard: bool,
    /// Custom save folder; `None` means Downloads/CleanGrab.
    pub save_dir: Option<String>,
    /// Prefer the un-watermarked stream for TikTok videos.
    pub remove_watermark: bool,
    /// Re-frame saved videos to 9:16.
    pub vertical_916: bool,
    /// Trim silence at the start and end of saved audio.
    pub trim_audio_silence: bool,
    /// Download even when a site's security certificate can't be trusted. Off
    /// unless the person turns it on knowingly, in Settings. It never applies to
    /// CleanGrab's own setup of yt-dlp and FFmpeg. (Saved as `ignoreCertificates`
    /// by earlier versions, which still counts.)
    #[serde(alias = "ignoreCertificates")]
    pub allow_untrusted_certificates: bool,
    /// The first-run tour has been seen (or skipped). False on a fresh install.
    pub tutorial_done: bool,
    /// The language of the interface: "system" (follow the computer) or one of `LANGUAGES`.
    pub language: String,
    /// Once a day, ask GitHub whether a newer version of CleanGrab is out (see `updates`).
    pub check_for_updates: bool,
    /// Offer to save any web link that is copied, not only the ones from YouTube, TikTok, Instagram,
    /// Spotify and the popular video sites. Off by default: it opens the card for every link.
    pub offer_any_link: bool,
}

/// The languages CleanGrab is translated into, by their two-letter code.
const LANGUAGES: [&str; 10] = ["en", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur"];

fn valid_language(code: &str) -> bool {
    code == "system" || LANGUAGES.contains(&code)
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            appearance: Appearance::System,
            start_in_background: true,
            popup_opacity: DEFAULT_POPUP_OPACITY,
            watch_clipboard: true,
            save_dir: None,
            remove_watermark: true,
            vertical_916: false,
            trim_audio_silence: false,
            allow_untrusted_certificates: false,
            tutorial_done: false,
            language: "system".into(),
            check_for_updates: true,
            offer_any_link: false,
        }
    }
}

pub struct SettingsStore(pub Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn current(app: &AppHandle) -> Settings {
    app.state::<SettingsStore>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// Resolves (and creates) the folder downloads are saved to.
pub fn save_dir(settings: &Settings) -> Result<PathBuf, String> {
    let dir = match settings.save_dir.as_deref() {
        Some(custom) if !custom.is_empty() => PathBuf::from(custom),
        _ => dirs::download_dir()
            .ok_or("Could not locate the Downloads folder")?
            .join("CleanGrab"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Applies the theme to the native window frames (title bar, scroll bars).
/// The web content follows through the `data-theme` attribute set by the UI.
pub fn apply_theme(app: &AppHandle, appearance: Appearance) {
    let theme = match appearance {
        Appearance::System => None,
        Appearance::Light => Some(Theme::Light),
        Appearance::Dark => Some(Theme::Dark),
    };
    for label in ["main", "toast"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_theme(theme);
        }
    }
}

/// Persists new settings, updates the tray and tells every window.
pub fn apply(app: &AppHandle, mut next: Settings) -> Result<Settings, String> {
    next.popup_opacity = if next.popup_opacity.is_finite() {
        next.popup_opacity.clamp(MIN_POPUP_OPACITY, 1.0)
    } else {
        DEFAULT_POPUP_OPACITY
    };

    if !valid_language(&next.language) {
        next.language = "system".into();
    }

    let path = settings_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    crate::fsutil::write_atomic(&path, raw).map_err(|e| e.to_string())?;

    *app.state::<SettingsStore>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = next.clone();

    crate::tray::sync(app, &next);
    apply_theme(app, next.appearance);
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsStore>) -> Settings {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    apply(&app, settings)
}

/// Where downloads currently go, for display in Settings.
#[tauri::command]
pub fn get_save_dir(app: AppHandle) -> Result<String, String> {
    let dir = save_dir(&current(&app))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn choose_folder(app: AppHandle) -> Option<String> {
    // The quick-save popup stays above every window; let the dialog sit over it.
    let popup = app.get_webview_window("toast");
    if let Some(popup) = &popup {
        let _ = popup.set_always_on_top(false);
    }

    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Choose where CleanGrab saves files")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned());

    if let Some(popup) = &popup {
        let _ = popup.set_always_on_top(true);
    }
    chosen
}

#[tauri::command]
pub fn open_save_dir(app: AppHandle) -> Result<(), String> {
    let dir = save_dir(&current(&app))?;
    open_path(&dir.to_string_lossy());
    Ok(())
}

fn open_path(path: &str) {
    #[cfg(target_os = "windows")]
    let _ = Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(path).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(path).spawn();
}

/// Opens a web page in the default browser. Only for addresses CleanGrab checked itself (`updates`).
pub fn open_web_page(url: &str) {
    #[cfg(target_os = "windows")]
    let _ = Command::new("explorer").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

/// Opens the file manager with `path` selected.
pub fn reveal(path: &str) {
    #[cfg(target_os = "windows")]
    let _ = Command::new("explorer").args(["/select,", path]).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").args(["-R", path]).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = Command::new("xdg-open").arg(parent).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_language_follows_the_computer_until_one_is_chosen() {
        assert_eq!(Settings::default().language, "system");
        assert_eq!(serde_json::from_str::<Settings>(r#"{"language":"fr"}"#).unwrap().language, "fr");
        // Settings saved before languages existed load with the default.
        assert_eq!(serde_json::from_str::<Settings>(r#"{"watchClipboard":true}"#).unwrap().language, "system");
        assert!(valid_language("ar") && valid_language("system"));
        assert!(!valid_language("xx") && !valid_language(""));
    }

    #[test]
    fn the_tour_is_shown_on_a_fresh_install_and_only_until_it_is_done() {
        assert!(!Settings::default().tutorial_done);
        // Settings saved before the tour existed have not seen it either.
        assert!(!serde_json::from_str::<Settings>(r#"{"watchClipboard":false}"#).unwrap().tutorial_done);
        assert!(serde_json::from_str::<Settings>(r#"{"tutorialDone":true}"#).unwrap().tutorial_done);
    }

    #[test]
    fn certificates_are_checked_unless_the_person_says_otherwise() {
        assert!(!Settings::default().allow_untrusted_certificates);
        // Settings from before this option existed, or with the unrelated old
        // trust option, still load, and stay strict.
        let old = r#"{"appearance":"dark","useSystemCertificates":false,"watchClipboard":false}"#;
        let settings: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(settings.appearance, Appearance::Dark);
        assert!(!settings.watch_clipboard);
        assert!(!settings.allow_untrusted_certificates);
    }

    #[test]
    fn a_choice_saved_by_an_earlier_version_still_counts() {
        let saved = r#"{"ignoreCertificates":true}"#;
        assert!(serde_json::from_str::<Settings>(saved).unwrap().allow_untrusted_certificates);
        let current = r#"{"allowUntrustedCertificates":true}"#;
        assert!(serde_json::from_str::<Settings>(current).unwrap().allow_untrusted_certificates);
    }
}
