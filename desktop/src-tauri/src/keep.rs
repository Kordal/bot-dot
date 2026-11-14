//! What the app keeps between starts: its botdot addresses, each with its own session, and the one shown last.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct Botdot {
    /// The origin, as `address::parse` gives it.
    pub address: String,
    /// The session's `Set-Cookie`, as the front door sent it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookie: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
#[serde(default)]
pub struct Kept {
    /// In the order they were added.
    pub botdots: Vec<Botdot>,
    /// The address shown last.
    pub last: Option<String>,
    /// "Open at login" was turned on at the first start. After that it is the owner's to change.
    pub login_set_up: bool,
    /// The port of the botdot on this computer, from the moment its setup starts until it is removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<u16>,
}

// What the file holds: a file from before several addresses has one `address` and its `cookie`.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Stored {
    #[serde(flatten)]
    kept: Kept,
    address: Option<String>,
    cookie: Option<String>,
}

impl Kept {
    fn position(&self, address: &str) -> Option<usize> {
        self.botdots.iter().position(|b| b.address == address)
    }

    pub fn get(&self, address: &str) -> Option<&Botdot> {
        self.position(address).map(|i| &self.botdots[i])
    }

    /// The address of the botdot on this computer, as `address::parse` gives it.
    pub fn local_address(&self) -> Option<String> {
        self.local.map(|port| format!("http://localhost:{port}/"))
    }

    /// The botdot on this computer got as far as a session once: its setup needs nothing more.
    pub fn has_local(&self) -> bool {
        self.local_address().is_some_and(|address| self.get(&address).is_some())
    }

    /// The botdot on this computer started its setup and has had no session yet.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn setup_stopped(&self) -> bool {
        self.local.is_some() && !self.has_local()
    }

    /// The botdot shown last, or the first one when that one is gone.
    pub fn current(&self) -> Option<&Botdot> {
        self.last.as_deref().and_then(|a| self.get(a)).or_else(|| self.botdots.first())
    }

    /// Shows this one from now on. Nothing for an address the app doesn't have.
    pub fn choose(&mut self, address: &str) -> bool {
        let known = self.position(address).is_some();
        if known {
            self.last = Some(address.to_string());
        }
        known
    }

    /// A new session for an address, which joins the list if it is new, and is shown.
    pub fn signed_in(&mut self, address: &str, cookie: &str) {
        match self.position(address) {
            Some(i) => self.botdots[i].cookie = Some(cookie.to_string()),
            None => self.botdots.push(Botdot { address: address.to_string(), cookie: Some(cookie.to_string()) }),
        }
        self.last = Some(address.to_string());
    }

    /// The session of this address is over. The address stays.
    pub fn session_over(&mut self, address: &str) {
        if let Some(i) = self.position(address) {
            self.botdots[i].cookie = None;
        }
    }

    /// The address and its session go. When it was the one shown, the first that is left is shown.
    pub fn remove(&mut self, address: &str) {
        self.botdots.retain(|b| b.address != address);
        if self.last.as_deref() == Some(address) {
            self.last = self.botdots.first().map(|b| b.address.clone());
        }
    }
}

pub fn load(file: &Path) -> Kept {
    let stored: Stored = fs::read(file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    let mut kept = stored.kept;
    if let (true, Some(address)) = (kept.botdots.is_empty(), stored.address) {
        kept.botdots.push(Botdot { address: address.clone(), cookie: stored.cookie });
        kept.last = Some(address);
    }
    kept
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

    #[test]
    fn the_botdot_on_this_computer_is_set_up_once_it_has_had_a_session() {
        let mut kept = Kept::default();
        assert_eq!(kept.local_address(), None);
        assert!(!kept.has_local());
        assert!(!kept.setup_stopped());
        kept.local = Some(4700);
        assert_eq!(kept.local_address().as_deref(), Some("http://localhost:4700/"));
        assert!(!kept.has_local(), "its setup stopped before the passkey");
        assert!(kept.setup_stopped(), "and carries on");
        kept.signed_in("http://localhost:4700/", "sid=1");
        kept.session_over("http://localhost:4700/");
        assert!(kept.has_local());
        assert!(!kept.setup_stopped());
    }

    const HQ: &str = "https://hq.example.com/";
    const STAGING: &str = "https://staging.example.com/";

    fn folder(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("botdot-keep-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    fn two() -> Kept {
        let mut kept = Kept::default();
        kept.signed_in(HQ, "botdot_session=hq");
        kept.signed_in(STAGING, "botdot_session=staging");
        kept
    }

    #[test]
    fn every_address_keeps_its_own_session_after_a_restart() {
        let file = folder("back").join("nested").join("kept.json");
        let kept = Kept { login_set_up: true, ..two() };
        save(&file, &kept).unwrap();
        let back = load(&file);
        assert_eq!(back, kept);
        assert_eq!(back.get(HQ).unwrap().cookie.as_deref(), Some("botdot_session=hq"));
        assert_eq!(back.current().unwrap().address, STAGING);
    }

    #[test]
    fn nothing_kept_or_something_broken_is_nothing() {
        let file = folder("broken").join("kept.json");
        assert_eq!(load(&file), Kept::default());
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "{").unwrap();
        assert_eq!(load(&file), Kept::default());
    }

    #[test]
    fn the_one_address_from_before_comes_back_with_its_session() {
        let file = folder("before").join("kept.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, format!(r#"{{"address":"{HQ}","cookie":"botdot_session=s3; Path=/"}}"#)).unwrap();
        let kept = load(&file);
        assert_eq!(kept.botdots, vec![Botdot { address: HQ.into(), cookie: Some("botdot_session=s3; Path=/".into()) }]);
        assert_eq!(kept.last.as_deref(), Some(HQ));
        assert!(!kept.login_set_up);
    }

    #[test]
    fn switching_keeps_both_sessions() {
        let mut kept = two();
        assert!(kept.choose(HQ));
        assert_eq!(kept.current().unwrap().address, HQ);
        assert_eq!(kept.get(STAGING).unwrap().cookie.as_deref(), Some("botdot_session=staging"));
        assert!(!kept.choose("https://other.example.com/"));
        assert_eq!(kept.current().unwrap().address, HQ);
    }

    #[test]
    fn signing_in_again_replaces_the_session_and_keeps_the_order() {
        let mut kept = two();
        kept.signed_in(HQ, "botdot_session=new");
        assert_eq!(kept.botdots.iter().map(|b| b.address.as_str()).collect::<Vec<_>>(), [HQ, STAGING]);
        assert_eq!(kept.get(HQ).unwrap().cookie.as_deref(), Some("botdot_session=new"));
        assert_eq!(kept.current().unwrap().address, HQ);
    }

    #[test]
    fn a_session_that_is_over_keeps_its_address() {
        let mut kept = two();
        kept.session_over(STAGING);
        assert_eq!(kept.get(STAGING).unwrap().cookie, None);
        assert_eq!(kept.get(HQ).unwrap().cookie.as_deref(), Some("botdot_session=hq"));
        assert_eq!(kept.current().unwrap().address, STAGING);
    }

    #[test]
    fn removing_the_one_shown_shows_the_first_left() {
        let mut kept = two();
        kept.remove(STAGING);
        assert_eq!(kept.get(STAGING), None);
        assert_eq!(kept.current().unwrap().address, HQ);
        kept.choose(HQ);
        kept.remove(HQ);
        assert_eq!(kept.current(), None);
        assert_eq!(kept.last, None);
    }

    #[test]
    fn removing_another_keeps_the_one_shown() {
        let mut kept = two();
        kept.remove(HQ);
        assert_eq!(kept.current().unwrap().address, STAGING);
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
