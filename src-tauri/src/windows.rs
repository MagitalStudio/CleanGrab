// SPDX-License-Identifier: GPL-3.0-only
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Width of the quick-save popup. Its height follows its content.
const TOAST_WIDTH: f64 = 380.0;
const TOAST_MIN_HEIGHT: f64 = 120.0;
/// Space kept between the popup and the screen edge, in logical pixels.
const TOAST_MARGIN: f64 = 16.0;

/// Brings the main window forward, optionally switching its view
/// ("home" or "settings").
pub fn show_main(app: &AppHandle, view: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(view) = view {
        let _ = app.emit("navigate", view);
    }
}

#[tauri::command]
pub fn open_main(app: AppHandle, view: Option<String>) {
    show_main(&app, view.as_deref());
}

/// The primary monitor's usable area and scale, in physical pixels.
struct Screen {
    /// x, y, width, height of the work area (the screen minus the taskbar).
    area: (i32, i32, u32, u32),
    scale: f64,
}

fn primary_screen(window: &WebviewWindow) -> Option<Screen> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let area = monitor.work_area();
    Some(Screen {
        area: (area.position.x, area.position.y, area.size.width, area.size.height),
        scale: monitor.scale_factor(),
    })
}

/// Top-left corner for a popup of `size`, pinned `margin` pixels from the
/// bottom-right corner of the work area (`area`: x, y, width, height), or from
/// the top-right corner when `top` is set. Keeping the corner fixed is what
/// makes the popup grow away from it.
fn anchored_origin(area: (i32, i32, u32, u32), size: (u32, u32), margin: i32, top: bool) -> (i32, i32) {
    let (area_x, area_y, area_width, area_height) = area;
    let x = area_x + area_width as i32 - size.0 as i32 - margin;
    let y = if top {
        area_y + margin
    } else {
        area_y + area_height as i32 - size.1 as i32 - margin
    };
    (x, y)
}

/// Where a popup with a content height of `height` logical pixels goes, as
/// (x, y, width, height) in physical pixels.
fn toast_bounds(screen: &Screen, height: f64) -> (i32, i32, u32, u32) {
    let size = (
        (TOAST_WIDTH * screen.scale).round() as u32,
        (height * screen.scale).round() as u32,
    );
    let (x, y) = anchored_origin(
        screen.area,
        size,
        (TOAST_MARGIN * screen.scale) as i32,
        cfg!(target_os = "macos"),
    );
    (x, y, size.0, size.1)
}

/// The tallest the popup may get: the work area minus a margin on each side.
fn max_toast_height(screen: Option<&Screen>) -> f64 {
    screen
        .map(|screen| screen.area.3 as f64 / screen.scale - 2.0 * TOAST_MARGIN)
        .unwrap_or(720.0)
        .max(TOAST_MIN_HEIGHT)
}

/// The part of a window of `window` size (physical pixels) that the card
/// covers: (left, top, right, bottom). The card hangs from the top of the
/// window when `top` is set, otherwise it sits on the bottom.
fn card_rect(window: (u32, u32), card_height: u32, top: bool) -> (i32, i32, i32, i32) {
    let (width, height) = (window.0 as i32, window.1 as i32);
    let card = (card_height as i32).min(height);
    if top {
        (0, 0, width, card)
    } else {
        (0, height - card, width, height)
    }
}

/// Windows-only: place the popup without ever resizing its window.
///
/// The web view inside a window repaints a frame or two after the window is
/// resized. In between, the old picture sits in the corner of the bigger
/// window, so a card that is pinned to the bottom jumps up and back: a flash.
/// So the window is made tall enough for the biggest popup once, and a window
/// region cuts it down to the card. The region only decides what is visible and
/// clickable, so changing it never disturbs the page.
#[cfg(target_os = "windows")]
mod native {
    use super::*;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn SetWindowRgn(hwnd: isize, region: isize, redraw: i32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> isize;
        fn DeleteObject(object: isize) -> i32;
    }
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const HWND_TOPMOST: isize = -1;

    /// Puts the window above every ordinary window, without moving it or taking focus.
    ///
    /// The "always on top" setting alone is not enough: it is remembered as a flag, and a window
    /// whose flag was switched off and on again while hidden (as happens around a file dialog)
    /// keeps the flag but can stay stacked below other windows, so the popup showed up behind them.
    pub fn raise(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        // SAFETY: `hwnd` is this window's live handle, and the call only changes its stacking.
        unsafe {
            SetWindowPos(hwnd.0 as isize, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    /// Moves and resizes the window in one call.
    pub fn set_bounds(window: &WebviewWindow, (x, y, width, height): (i32, i32, u32, u32)) -> bool {
        let Ok(hwnd) = window.hwnd() else {
            return false;
        };
        // SAFETY: `hwnd` is this window's live handle, and the call only
        // changes its position and size.
        unsafe { SetWindowPos(hwnd.0 as isize, 0, x, y, width as i32, height as i32, SWP_NOZORDER | SWP_NOACTIVATE) != 0 }
    }

    /// Limits what is drawn and clickable to `rect`, or lifts the limit.
    pub fn set_region(window: &WebviewWindow, rect: Option<(i32, i32, i32, i32)>) -> bool {
        let Ok(hwnd) = window.hwnd() else {
            return false;
        };
        let hwnd = hwnd.0 as isize;
        // SAFETY: the region is created here and handed to the system, which
        // owns it after a successful call; on failure it is released.
        unsafe {
            match rect {
                None => SetWindowRgn(hwnd, 0, 1) != 0,
                Some((left, top, right, bottom)) => {
                    let region = CreateRectRgn(left, top, right, bottom);
                    if region == 0 {
                        return false;
                    }
                    if SetWindowRgn(hwnd, region, 1) == 0 {
                        DeleteObject(region);
                        return false;
                    }
                    true
                }
            }
        }
    }
}

/// Puts the popup where its content height calls for.
fn place_toast(window: &WebviewWindow, screen: Option<&Screen>, height: f64) {
    let Some(screen) = screen else {
        let _ = window.set_size(LogicalSize::new(TOAST_WIDTH, height));
        return;
    };

    #[cfg(target_os = "windows")]
    {
        // One window as tall as the biggest popup, cut down to the card.
        let full = toast_bounds(screen, max_toast_height(Some(screen)));
        let current = (window.outer_position().ok(), window.outer_size().ok());
        let already_there = matches!(
            current,
            (Some(position), Some(size)) if (position.x, position.y, size.width, size.height) == full
        );
        let fits = already_there || native::set_bounds(window, full);
        if fits {
            let card = (height * screen.scale).round() as u32;
            if native::set_region(window, Some(card_rect((full.2, full.3), card, false))) {
                return;
            }
        }
        // Without regions, fall back to resizing the window to the card.
        native::set_region(window, None);
    }

    let (x, y, width, height) = toast_bounds(screen, height);
    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Sizes the quick-save popup to its content and shows it if it is hidden.
///
/// The page calls this once it has rendered, so the window never appears empty,
/// and again whenever its content grows or shrinks (a link was added, trim
/// options were opened). It appears without taking focus, so it never steals
/// what the person is typing in another app.
#[tauri::command]
pub fn present_toast(app: AppHandle, height: f64) {
    let Some(window) = app.get_webview_window("toast") else {
        eprintln!("CleanGrab: the quick-save window \"toast\" does not exist");
        return;
    };

    let screen = primary_screen(&window);
    let height = height.clamp(TOAST_MIN_HEIGHT, max_toast_height(screen.as_ref()));
    place_toast(&window, screen.as_ref(), height);

    if !window.is_visible().unwrap_or(false) {
        let _ = window.set_focusable(false);
        // A window that never takes focus can otherwise end up behind others.
        let _ = window.set_always_on_top(true);
        if let Err(err) = window.show() {
            eprintln!("CleanGrab: could not show the quick-save window: {err}");
        }
    }

    // Every time, not only when it appears: see `native::raise`.
    #[cfg(target_os = "windows")]
    native::raise(&window);
}

/// Shows the popup with a sample link, so its look (opacity, layout) can be
/// judged from Settings without having to copy anything.
#[tauri::command]
pub fn preview_toast(app: AppHandle) {
    let sample = crate::link::DetectedLink {
        url: "https://youtu.be/dQw4w9WgXcQ".to_string(),
        platform: "YouTube".to_string(),
        removed_trackers: 2,
    };
    let _ = app.emit("clipboard-media-detected", sample);
}

/// Lets the popup take keyboard focus. Called when the person clicks into it,
/// so trim fields can be typed in.
#[tauri::command]
pub fn activate_toast(app: AppHandle) {
    if let Some(window) = app.get_webview_window("toast") {
        let _ = window.set_focusable(true);
        let _ = window.set_focus();
    }
}

/// The main window size (logical pixels) the interface is drawn for. A bigger
/// window enlarges the whole interface in proportion instead of leaving it lost
/// in the middle of empty space; a smaller one keeps the normal size.
const UI_BASE_WIDTH: f64 = 1280.0;
const UI_BASE_HEIGHT: f64 = 800.0;
/// The tighter side may be at most this many times the base size.
const UI_MAX_FIT: f64 = 2.5;
/// How much of that extra room the interface takes: 0.5 enlarges it by half as much as the window grew.
const UI_GROWTH: f64 = 0.5;
/// The zoom last given to the page, in hundredths, so an unchanged value is not sent again.
static APPLIED_ZOOM: AtomicU32 = AtomicU32::new(100);

/// How much to enlarge the interface for a window of this size: 1.0 up to the base size, then a
/// share (`UI_GROWTH`) of what the tighter of the two sides allows, in steps of 0.05.
fn ui_scale(width: f64, height: f64) -> f64 {
    if !(width > 0.0 && height > 0.0) {
        return 1.0; // minimised, or not laid out yet
    }
    let fit = (width / UI_BASE_WIDTH).min(height / UI_BASE_HEIGHT).clamp(1.0, UI_MAX_FIT);
    ((1.0 + (fit - 1.0) * UI_GROWTH) * 20.0).round() / 20.0
}

/// The zoom the page has now, for the parts of the interface that must keep their real size.
#[tauri::command]
pub fn ui_zoom() -> f64 {
    f64::from(APPLIED_ZOOM.load(Ordering::Relaxed)) / 100.0
}

/// Sizes the main window's page to the window (see `ui_scale`). Called when the window is
/// resized, maximised or moved to a screen with another scale.
pub fn fit_main_zoom(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let (Ok(size), Ok(factor)) = (window.inner_size(), window.scale_factor()) else { return };
    let zoom = ui_scale(f64::from(size.width) / factor, f64::from(size.height) / factor);
    let hundredths = (zoom * 100.0).round() as u32;
    if APPLIED_ZOOM.swap(hundredths, Ordering::Relaxed) != hundredths {
        let _ = window.set_zoom(zoom);
        let _ = app.emit("ui-zoom", zoom);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sits_in_the_bottom_right_corner_and_grows_upwards() {
        let area = (0, 0, 1920, 1040); // 1080p minus a 40px taskbar
        let short = anchored_origin(area, (380, 242), 16, false);
        let tall = anchored_origin(area, (380, 388), 16, false);

        assert_eq!(short, (1524, 782));
        // Same x, and the bottom edge (y + height) stays put: only the top moves.
        assert_eq!(tall.0, short.0);
        assert_eq!(short.1 + 242, tall.1 + 388);
        assert!(tall.1 < short.1);
    }

    #[test]
    fn on_macos_it_hangs_from_the_top_right() {
        let area = (0, 25, 1440, 875); // below the menu bar
        let short = anchored_origin(area, (380, 242), 16, true);
        let tall = anchored_origin(area, (380, 388), 16, true);

        assert_eq!(short, (1044, 41));
        // The top edge stays put: only the bottom moves.
        assert_eq!(short, tall);
    }

    #[test]
    fn respects_a_work_area_that_does_not_start_at_the_origin() {
        // A taskbar on the left and on top of the screen.
        let (x, y) = anchored_origin((60, 40, 1860, 1000), (380, 300), 16, false);
        assert_eq!((x, y), (60 + 1860 - 380 - 16, 40 + 1000 - 300 - 16));
    }

    #[test]
    fn the_card_sits_on_the_bottom_of_the_tall_window() {
        let window = (380, 1000);
        let short = card_rect(window, 242, false);
        let tall = card_rect(window, 388, false);

        assert_eq!(short, (0, 758, 380, 1000));
        // The bottom edge never moves; only the top edge does.
        assert_eq!(tall.3, short.3);
        assert_eq!(tall.1, 1000 - 388);
    }

    #[test]
    fn the_interface_grows_with_a_large_window_and_never_shrinks() {
        // Default and small windows keep the normal size.
        assert_eq!(ui_scale(720.0, 760.0), 1.0);
        assert_eq!(ui_scale(1280.0, 800.0), 1.0);
        assert_eq!(ui_scale(560.0, 520.0), 1.0);
        // A full-HD screen with the taskbar: the height is the tighter side (1.3), and half of that is taken.
        assert_eq!(ui_scale(1920.0, 1040.0), 1.15);
        // Ultra-wide: still bound by the height.
        assert_eq!(ui_scale(3440.0, 1400.0), 1.4);
        // Never beyond the maximum, and never on a window without a size.
        assert_eq!(ui_scale(9000.0, 9000.0), 1.75);
        assert_eq!(ui_scale(0.0, 0.0), 1.0);
    }

    #[test]
    fn the_card_can_hang_from_the_top() {
        assert_eq!(card_rect((380, 1000), 242, true), (0, 0, 380, 242));
    }

    #[test]
    fn a_card_taller_than_the_window_is_cut_to_it() {
        assert_eq!(card_rect((380, 300), 500, false), (0, 0, 380, 300));
    }

    #[test]
    fn the_tallest_popup_leaves_a_margin_on_both_sides() {
        let screen = Screen { area: (0, 0, 1920, 1040), scale: 1.0 };
        assert_eq!(max_toast_height(Some(&screen)), 1040.0 - 32.0);
        // A 125% display has fewer logical pixels to work with.
        let scaled = Screen { area: (0, 0, 2400, 1300), scale: 1.25 };
        assert_eq!(max_toast_height(Some(&scaled)), 1040.0 - 32.0);
        assert_eq!(max_toast_height(None), 720.0);
    }
}
