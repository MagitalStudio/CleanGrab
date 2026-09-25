// SPDX-License-Identifier: GPL-3.0-only
//! Keeps a single CleanGrab running.
//!
//! CleanGrab lives in the tray with no window, so launching it again (from the
//! Start menu, a shortcut...) must not start a second copy with its own
//! clipboard watcher and tray icon. Instead the new launch asks the running one
//! to open its window, then exits.
//!
//! The two talk over a loopback socket, using only the standard library. A
//! short handshake makes sure the port is really held by CleanGrab and not by
//! some unrelated program.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

/// Fixed loopback port shared by every CleanGrab launch.
pub const PORT: u16 = 47653;

const HELLO: &[u8] = b"CLEANGRAB-SHOW\n";
const REPLY: &[u8] = b"CLEANGRAB-OK\n";

fn local(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Asks a running CleanGrab to show its window. Returns `true` when one
/// answered, which means this launch should quit.
pub fn hand_over_to_running_instance(addr: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    if stream.write_all(HELLO).is_err() {
        return false;
    }

    let mut buffer = [0u8; 32];
    matches!(stream.read(&mut buffer), Ok(read) if &buffer[..read] == REPLY)
}

/// Answers later launches on `listener`: every valid request calls `on_show`.
pub fn serve(listener: TcpListener, on_show: impl Fn() + Send + 'static) {
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut stream = stream;
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));

            let mut buffer = [0u8; 32];
            let Ok(read) = stream.read(&mut buffer) else {
                continue;
            };
            if &buffer[..read] == HELLO {
                let _ = stream.write_all(REPLY);
                on_show();
            }
        }
    });
}

/// Starts listening on the shared port. Returns `false` when the port is already
/// taken (another copy, or another program); CleanGrab then simply runs without
/// this feature.
pub fn listen(on_show: impl Fn() + Send + 'static) -> bool {
    match TcpListener::bind(local(PORT)) {
        Ok(listener) => {
            serve(listener, on_show);
            true
        }
        Err(_) => false,
    }
}

pub fn running_instance_address() -> SocketAddr {
    local(PORT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn free_listener() -> (TcpListener, SocketAddr) {
        let listener = TcpListener::bind(local(0)).unwrap();
        let addr = listener.local_addr().unwrap();
        (listener, addr)
    }

    #[test]
    fn a_second_launch_reaches_the_running_instance() {
        let (listener, addr) = free_listener();
        let shown = Arc::new(AtomicUsize::new(0));
        let counter = shown.clone();
        serve(listener, move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });

        assert!(hand_over_to_running_instance(addr));
        assert!(hand_over_to_running_instance(addr));
        // Give the serving thread a moment to run its callback.
        thread::sleep(Duration::from_millis(100));
        assert_eq!(shown.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn nothing_listening_means_this_launch_is_the_first() {
        let (listener, addr) = free_listener();
        drop(listener);
        assert!(!hand_over_to_running_instance(addr));
    }

    #[test]
    fn a_stranger_on_the_port_is_not_mistaken_for_cleangrab() {
        let (listener, addr) = free_listener();
        // Accepts and replies with something else entirely.
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buffer = [0u8; 32];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n");
            }
        });
        assert!(!hand_over_to_running_instance(addr));
    }
}
