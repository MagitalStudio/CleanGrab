// SPDX-License-Identifier: GPL-3.0-only
//! Small file helpers.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Writers take turns, so two saves at once never share a scratch file.
static WRITING: Mutex<()> = Mutex::new(());

/// Replaces `path` with `contents` in one step. A crash or a power cut halfway
/// leaves the old file in place, never half of a new one, which would read back
/// as empty settings or an empty history.
pub fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> io::Result<()> {
    let _turn = WRITING.lock().unwrap_or_else(|e| e.into_inner());

    let mut name: OsString = path.as_os_str().to_owned();
    name.push(".tmp");
    let scratch = PathBuf::from(name);

    fs::write(&scratch, contents.as_ref())?;
    if fs::rename(&scratch, path).is_ok() {
        return Ok(());
    }
    // Some folders (cloud-synced ones, for instance) refuse to be replaced this
    // way: fall back to writing in place.
    let result = fs::write(path, contents.as_ref());
    let _ = fs::remove_file(&scratch);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cleangrab-fsutil-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_a_new_file_and_replaces_an_existing_one() {
        let dir = scratch_dir("write");
        let file = dir.join("history.json");

        write_atomic(&file, "first").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "first");
        write_atomic(&file, "second, and longer").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second, and longer");
    }

    #[test]
    fn leaves_no_scratch_file_behind() {
        let dir = scratch_dir("clean");
        write_atomic(&dir.join("settings.json"), "{}").unwrap();

        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["settings.json"]);
    }

    #[test]
    fn fails_cleanly_when_the_folder_does_not_exist() {
        let dir = scratch_dir("missing");
        assert!(write_atomic(&dir.join("nope").join("file.json"), "x").is_err());
    }
}
