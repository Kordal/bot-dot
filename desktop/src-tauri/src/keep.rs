//! What the app keeps between starts: its botdot address and that address's session.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct Kept {
    pub address: Option<String>,
    /// The session's `Set-Cookie`, as the front door sent it.
    pub cookie: Option<String>,
}

pub fn load(file: &Path) -> Kept {
    fs::read(file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Whole or not at all, readable only by this user: by the file's mode on the Mac, by the user's own AppData on Windows.
pub fn save(file: &Path, kept: &Kept) -> std::io::Result<()> {
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder)?;
    }
    let draft = file.with_extension("draft");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(&draft)?.write_all(&serde_json::to_vec(kept)?)?;
    fs::rename(draft, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("botdot-keep-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn a_session_comes_back_after_a_restart() {
        let file = folder("back").join("nested").join("kept.json");
        let kept = Kept { address: Some("https://botdot.example.com/".into()), cookie: Some("botdot_session=s3; Path=/".into()) };
        save(&file, &kept).unwrap();
        assert_eq!(load(&file), kept);
    }

    #[test]
    fn nothing_kept_or_something_broken_is_nothing() {
        let file = folder("broken").join("kept.json");
        assert_eq!(load(&file), Kept::default());
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "{").unwrap();
        assert_eq!(load(&file), Kept::default());
    }

    #[cfg(unix)]
    #[test]
    fn only_its_user_can_read_it() {
        use std::os::unix::fs::PermissionsExt;
        let file = folder("mode").join("kept.json");
        save(&file, &Kept::default()).unwrap();
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
