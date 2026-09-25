// SPDX-License-Identifier: GPL-3.0-only
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::link::{self, DetectedLink};
use crate::{settings, terms};

const POLL_INTERVAL_MS: u64 = 700;

/// Some apps write the clipboard twice for one copy. The same link seen again
/// within this window is treated as that echo, not a new copy.
const ECHO_WINDOW: Duration = Duration::from_secs(2);

/// After this many failed reads in a row (clipboard held open by another app,
/// or not text) the change is given up on instead of retried forever.
const MAX_FAILED_READS: u8 = 4;

/// Windows numbers every clipboard change, so copying the same link twice is
/// still seen as two copies. Other systems fall back to comparing the text.
#[cfg(target_os = "windows")]
fn clipboard_sequence() -> Option<u32> {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    // SAFETY: takes no arguments and only reads a counter kept by the OS.
    Some(unsafe { GetClipboardSequenceNumber() })
}

#[cfg(not(target_os = "windows"))]
fn clipboard_sequence() -> Option<u32> {
    None
}

/// Decides, poll after poll, whether the clipboard holds a *new* supported link.
/// Kept free of any I/O so it can be tested.
struct ClipboardTracker {
    primed: bool,
    last_sequence: Option<u32>,
    last_seen: String,
    failed_reads: u8,
    last_emitted: Option<(String, Instant)>,
    /// Any web link is offered, not only the ones from sites CleanGrab knows (a setting).
    any_link: bool,
}

impl ClipboardTracker {
    fn new() -> Self {
        Self {
            primed: false,
            last_sequence: None,
            last_seen: String::new(),
            failed_reads: 0,
            last_emitted: None,
            any_link: false,
        }
    }

    /// Watching stopped: the next poll starts from a fresh baseline.
    fn pause(&mut self) {
        self.primed = false;
    }

    /// `sequence` is the OS change counter when there is one; `read` fetches the
    /// clipboard text and is only called when there may be something new.
    fn observe(
        &mut self,
        sequence: Option<u32>,
        read: impl FnOnce() -> Option<String>,
        now: Instant,
    ) -> Option<DetectedLink> {
        // First poll after (re)starting: whatever is on the clipboard now is
        // already seen. This must happen even when the clipboard holds no text,
        // otherwise the first real copy would be mistaken for the baseline.
        if !self.primed {
            self.primed = true;
            self.last_sequence = sequence;
            self.last_seen = read().unwrap_or_default();
            return None;
        }

        if sequence.is_some() && sequence == self.last_sequence {
            return None;
        }

        let Some(text) = read() else {
            self.failed_reads += 1;
            if self.failed_reads >= MAX_FAILED_READS {
                self.failed_reads = 0;
                self.last_sequence = sequence;
            }
            return None;
        };
        self.failed_reads = 0;

        if sequence.is_none() && text == self.last_seen {
            return None;
        }
        self.last_sequence = sequence;
        self.last_seen = text.clone();

        let found = if self.any_link { link::detect(&text)? } else { link::detect_known(&text)? };
        let is_echo = self
            .last_emitted
            .as_ref()
            .is_some_and(|(url, at)| *url == found.url && now.duration_since(*at) < ECHO_WINDOW);
        if is_echo {
            return None;
        }
        self.last_emitted = Some((found.url.clone(), now));
        Some(found)
    }
}

/// Spawns a background thread that polls the system clipboard for supported
/// media links. Runs as a lightweight daemon so background RAM stays low.
///
/// The clipboard is only read while the Terms of Use are accepted and
/// monitoring is switched on.
pub fn start_watcher(app: AppHandle) {
    thread::spawn(move || {
        // Another program can hold the clipboard when CleanGrab starts (at login,
        // for instance): keep trying instead of giving up for the whole session.
        let mut reported = false;
        let mut clipboard = loop {
            match arboard::Clipboard::new() {
                Ok(clipboard) => break clipboard,
                Err(err) => {
                    if !reported {
                        eprintln!("CleanGrab: failed to access clipboard, retrying: {err}");
                        reported = true;
                    }
                    thread::sleep(Duration::from_secs(5));
                }
            }
        };

        let mut tracker = ClipboardTracker::new();

        loop {
            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

            let current = settings::current(&app);
            let active = terms::is_accepted() && current.watch_clipboard;
            tracker.any_link = current.offer_any_link;
            if !active {
                tracker.pause();
                continue;
            }

            let found = tracker.observe(
                clipboard_sequence(),
                || clipboard.get_text().ok(),
                Instant::now(),
            );

            if let Some(found) = found {
                #[cfg(debug_assertions)]
                eprintln!("CleanGrab: link detected ({}): {}", found.platform, found.url);

                // The quick-save page sizes and shows its own window (present_toast).
                let _ = app.emit("clipboard-media-detected", found);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINK: &str = "https://youtu.be/dQw4w9WgXcQ";
    const OTHER_LINK: &str = "https://youtu.be/aaaaaaaaaaa";

    fn text(value: &str) -> impl FnOnce() -> Option<String> + '_ {
        move || Some(value.to_string())
    }

    #[test]
    fn a_link_already_on_the_clipboard_at_start_is_not_announced() {
        let mut tracker = ClipboardTracker::new();
        let now = Instant::now();
        assert!(tracker.observe(Some(1), text(LINK), now).is_none());
        assert!(tracker.observe(Some(1), text(LINK), now).is_none());
    }

    #[test]
    fn the_first_copy_counts_even_if_the_clipboard_had_no_text_at_start() {
        // Empty (or image-only) clipboard when watching starts: reading fails.
        for sequence in [Some(1), None] {
            let mut tracker = ClipboardTracker::new();
            let now = Instant::now();
            assert!(tracker.observe(sequence, || None, now).is_none());

            let next = sequence.map(|n| n + 1);
            let found = tracker.observe(next, text(LINK), now);
            assert_eq!(found.map(|l| l.url), Some(LINK.to_string()));
        }
    }

    #[test]
    fn copying_the_same_link_again_is_announced_again_on_windows() {
        let mut tracker = ClipboardTracker::new();
        let start = Instant::now();
        tracker.observe(Some(1), || None, start);

        assert!(tracker.observe(Some(2), text(LINK), start).is_some());
        // Same link copied a moment later: the echo window swallows it.
        assert!(tracker.observe(Some(3), text(LINK), start + Duration::from_millis(500)).is_none());
        // Copied again later on: announced again.
        assert!(tracker.observe(Some(4), text(LINK), start + Duration::from_secs(10)).is_some());
    }

    #[test]
    fn without_a_change_counter_the_same_text_is_not_repeated() {
        let mut tracker = ClipboardTracker::new();
        let start = Instant::now();
        tracker.observe(None, || None, start);

        assert!(tracker.observe(None, text(LINK), start).is_some());
        assert!(tracker.observe(None, text(LINK), start + Duration::from_secs(10)).is_none());
        assert!(tracker.observe(None, text(OTHER_LINK), start + Duration::from_secs(11)).is_some());
    }

    #[test]
    fn an_unchanged_counter_does_not_read_the_clipboard_at_all() {
        let mut tracker = ClipboardTracker::new();
        let now = Instant::now();
        tracker.observe(Some(7), text("baseline"), now);
        let found = tracker.observe(Some(7), || panic!("must not read"), now);
        assert!(found.is_none());
    }

    #[test]
    fn a_read_that_fails_once_is_retried_on_the_next_poll() {
        let mut tracker = ClipboardTracker::new();
        let now = Instant::now();
        tracker.observe(Some(1), || None, now);

        // Another app holds the clipboard open for one poll.
        assert!(tracker.observe(Some(2), || None, now).is_none());
        assert!(tracker.observe(Some(2), text(LINK), now).is_some());
    }

    #[test]
    fn non_link_text_is_remembered_but_not_announced() {
        let mut tracker = ClipboardTracker::new();
        let now = Instant::now();
        tracker.observe(Some(1), || None, now);
        assert!(tracker.observe(Some(2), text("just some words"), now).is_none());
        assert!(tracker.observe(Some(3), text(LINK), now).is_some());
    }

    #[test]
    fn only_known_sites_are_offered_unless_any_link_is_asked_for() {
        let other = "https://videos.example.org/watch/abc";
        let now = Instant::now();

        let mut tracker = ClipboardTracker::new();
        tracker.observe(Some(1), || None, now);
        assert!(tracker.observe(Some(2), text(other), now).is_none());
        assert!(tracker.observe(Some(3), text("https://vimeo.com/76979871"), now).is_some());

        let mut tracker = ClipboardTracker::new();
        tracker.any_link = true;
        tracker.observe(Some(1), || None, now);
        assert_eq!(tracker.observe(Some(2), text(other), now).map(|l| l.platform), Some("videos.example.org".to_string()));
    }

    #[test]
    fn pausing_starts_a_fresh_baseline() {
        let mut tracker = ClipboardTracker::new();
        let now = Instant::now();
        tracker.observe(Some(1), || None, now);
        tracker.pause();
        // A link copied while paused is not announced when watching resumes.
        assert!(tracker.observe(Some(5), text(LINK), now).is_none());
        assert!(tracker.observe(Some(6), text(OTHER_LINK), now).is_some());
    }
}
