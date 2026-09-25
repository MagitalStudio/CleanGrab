// SPDX-License-Identifier: GPL-3.0-only
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;
use tauri::{App, AppHandle, Manager, Wry};

use crate::settings::{self, Settings};
use crate::windows;

/// Kept so the "Watch Clipboard" check mark follows the setting, and the labels the language.
pub struct TrayState {
    open: MenuItem<Wry>,
    watch: CheckMenuItem<Wry>,
    quit: MenuItem<Wry>,
    /// "Update to 0.2.0": only in the menu while a newer version is out.
    menu: Menu<Wry>,
    update: MenuItem<Wry>,
    update_shown: Mutex<bool>,
}

pub fn build(app: &App) -> tauri::Result<()> {
    let watching = settings::current(app.handle()).watch_clipboard;

    let open = MenuItem::with_id(app, "tray-open", "Open CleanGrab", true, None::<&str>)?;
    let watch = CheckMenuItem::with_id(app, "tray-watch", "Watch Clipboard", true, watching, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit CleanGrab", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &watch, &separator, &quit])?;
    let update = MenuItem::with_id(app, "tray-update", "Update available", true, None::<&str>)?;

    app.manage(TrayState { open, watch, quit, menu: menu.clone(), update, update_shown: Mutex::new(false) });

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("CleanGrab");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-open" => windows::show_main(app, None),
            "tray-watch" => {
                let mut next = settings::current(app);
                next.watch_clipboard = !next.watch_clipboard;
                let _ = settings::apply(app, next);
            }
            // The update is offered on the Home page, where it can be downloaded and installed.
            "tray-update" => windows::show_main(app, Some("home")),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::show_main(tray.app_handle(), None);
            }
        })
        .build(app)?;

    Ok(())
}

/// Puts the tray menu in the language of the interface. The texts come from the page, which holds
/// all the translations; until it has sent them, the menu is in English.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, open: String, watch: String, quit: String, update: String) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.open.set_text(open);
        let _ = state.watch.set_text(watch);
        let _ = state.quit.set_text(quit);

        // An empty label means there is no update: the entry is left out of the menu.
        let mut shown = state.update_shown.lock().unwrap_or_else(|e| e.into_inner());
        if update.is_empty() {
            if *shown && state.menu.remove(&state.update).is_ok() {
                *shown = false;
            }
        } else {
            let _ = state.update.set_text(update);
            if !*shown && state.menu.insert(&state.update, 0).is_ok() {
                *shown = true;
            }
        }
    }
}

/// Reflects the current settings in the tray menu.
pub fn sync(app: &AppHandle, settings: &Settings) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.watch.set_checked(settings.watch_clipboard);
    }
}
