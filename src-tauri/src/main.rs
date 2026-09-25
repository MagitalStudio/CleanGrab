// SPDX-License-Identifier: GPL-3.0-only
// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod certs;
mod clipboard;
mod engine;
mod fsutil;
mod instance;
mod jobs;
mod link;
mod media;
mod player;
mod settings;
mod spotify;
mod terms;
mod tray;
mod updates;
mod windows;

use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(target_os = "macos")]
fn build_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let settings_item = MenuItem::with_id(app, "open-settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "CleanGrab",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    // Without an Edit menu, Cmd+C / Cmd+V do not work inside the webview.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit_menu])?)?;
    Ok(())
}

fn main() {
    // Already running in the tray? Ask it to open its window and stop here.
    // Skipped in debug builds so `tauri dev` can restart the app freely.
    if !cfg!(debug_assertions) && instance::hand_over_to_running_instance(instance::running_instance_address()) {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::install_engine,
            engine::update_yt_dlp,
            jobs::list_jobs,
            jobs::cancel_job,
            jobs::remove_job,
            jobs::clear_finished,
            jobs::reveal_job,
            link::parse_link,
            media::start_download,
            player::pick_media_file,
            player::prepare_playback,
            player::cancel_playback,
            settings::get_settings,
            settings::update_settings,
            settings::get_save_dir,
            settings::choose_folder,
            settings::open_save_dir,
            terms::terms_accepted,
            terms::accept_terms,
            terms::decline_terms,
            windows::open_main,
            windows::ui_zoom,
            tray::set_tray_labels,
            updates::check_for_update,
            updates::latest_update,
            updates::open_update_page,
            updates::update_progress,
            updates::download_update,
            updates::install_update,
            updates::launched_after_update,
            windows::present_toast,
            windows::activate_toast,
            windows::preview_toast,
        ])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "open-settings" {
                windows::show_main(app, Some("settings"));
            }
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps CleanGrab running in the tray,
            // unless the Terms of Use are still pending.
            match event {
                WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    if terms::is_accepted() {
                        api.prevent_close();
                        let _ = window.hide();
                        // What was playing in the window stops: nothing is left to control it.
                        let _ = window.emit("window-hidden", ());
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                // The interface grows with the window (maximised, dragged bigger, or on another screen).
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } if window.label() == "main" => {
                    windows::fit_main_zoom(window.app_handle());
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            let saved = settings::load(&handle);
            settings::apply_theme(&handle, saved.appearance);
            engine::sync_certificate_plugin(&handle);
            app.manage(settings::SettingsStore(Mutex::new(saved)));
            app.manage(jobs::JobStore::load(&handle));
            terms::load(&handle);
            player::clean_cache();
            updates::clean_downloads();

            // The windows are created here, not by Tauri before this hook runs: as
            // soon as a page loads it asks for the settings, the downloads and the
            // terms, and those must exist by then. Asked any earlier, the app
            // crashes ("state() called before manage()").
            for window in app.config().app.windows.clone() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window)?.build()?;
            }
            windows::fit_main_zoom(app.handle());

            // Later launches ask this instance to show its window.
            let opener = handle.clone();
            instance::listen(move || windows::show_main(&opener, None));

            // The watcher stays idle until the Terms of Use are accepted.
            clipboard::start_watcher(handle.clone());
            updates::start_checker(handle);
            tray::build(app)?;

            #[cfg(target_os = "macos")]
            {
                // Windows and Linux draw their own title bar; macOS keeps its traffic lights.
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_decorations(true);
                }
                build_app_menu(app)?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building CleanGrab")
        .run(|app, event| {
            // Quitting must not leave downloads running with nobody to show them.
            if let tauri::RunEvent::Exit = event {
                jobs::stop_all(app);
                player::clean_cache();
            }
        });
}
