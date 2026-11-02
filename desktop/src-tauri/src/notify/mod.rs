//! The system's own notifications (ADR 138): shown under their tag, so a newer one of the same tag takes the older one's
//! place, removed by tag, and a click hands back the target. On the Mac the User Notifications framework, on Windows
//! the toasts of the Action Center.

use crate::feed::Notice;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
use mac as system;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use self::windows as system;

#[cfg(not(any(target_os = "macos", windows)))]
mod system {
    pub fn start(_: &str) {}
    pub fn show(_: &crate::feed::Notice) {}
    pub fn remove(_: &str) {}
}

/// A tag as Windows takes it, at most 64 characters: a longer one, as `job:<bot>/<job>` can be, is its hash.
#[cfg_attr(not(windows), allow(dead_code))]
fn short_tag(tag: &str) -> String {
    use sha2::{Digest, Sha256};
    if tag.len() <= 64 {
        return tag.to_string();
    }
    Sha256::digest(tag.as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect()
}

type Click = Box<dyn Fn(String, String) + Send + Sync>;
static CLICKED: OnceLock<Click> = OnceLock::new();
/// What is shown, by botdot address: the system's ids of its notifications.
static SHOWN: Mutex<Option<HashMap<String, HashSet<String>>>> = Mutex::new(None);

// Several botdots can have a chat of the same id: the system knows a notification by its address and its tag, and a
// click hands back its address and its target, each as `<address>\n<what>`.
fn joined(address: &str, what: &str) -> String {
    format!("{address}\n{what}")
}

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
fn clicked(joined: String) {
    let Some((address, target)) = joined.split_once('\n') else { return };
    if let Some(on) = CLICKED.get() {
        on(address.to_string(), target.to_string());
    }
}

/// Once, at the start. `id`: the app's identifier, which Windows shows its toasts under. The Mac asks the owner's
/// permission the first time. `on_click` gets the botdot's address and the target.
pub fn start(id: &str, on_click: impl Fn(String, String) + Send + Sync + 'static) {
    let _ = CLICKED.set(Box::new(on_click));
    system::start(id);
}

pub fn show(address: &str, notice: &Notice) {
    let id = joined(address, &notice.tag);
    system::show(&Notice { tag: id.clone(), target: joined(address, &notice.target), ..notice.clone() });
    SHOWN.lock().unwrap().get_or_insert_with(HashMap::new).entry(address.to_string()).or_default().insert(id);
}

pub fn remove(address: &str, tag: &str) {
    let id = joined(address, tag);
    if let Some(ids) = SHOWN.lock().unwrap().get_or_insert_with(HashMap::new).get_mut(address) {
        ids.remove(&id);
    }
    system::remove(&id);
}

/// The session of this botdot is over, or it went: what it rang goes.
pub fn remove_all_of(address: &str) {
    let ids = SHOWN.lock().unwrap().get_or_insert_with(HashMap::new).remove(address).unwrap_or_default();
    for id in ids {
        system::remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::{joined, short_tag};

    #[test]
    fn a_tag_windows_takes_stays_and_a_longer_one_is_its_hash() {
        assert_eq!(short_tag("bot:b1"), "bot:b1");
        let long = format!("job:{}/{}", "b".repeat(40), "j".repeat(40));
        assert_eq!(short_tag(&long).len(), 32);
        assert_eq!(short_tag(&long), short_tag(&long), "the same tag is the same toast");
        assert_ne!(short_tag(&long), short_tag(&format!("{long}x")));
    }

    #[test]
    fn a_click_hands_back_its_botdot_and_its_target() {
        let got = std::sync::Arc::new(std::sync::Mutex::new(None));
        let keep = got.clone();
        let _ = super::CLICKED.set(Box::new(move |a, t| *keep.lock().unwrap() = Some((a, t))));
        super::clicked(joined("https://botdot.example.com/", "bot:b1"));
        assert_eq!(got.lock().unwrap().clone(), Some(("https://botdot.example.com/".to_string(), "bot:b1".to_string())));
        assert_ne!(joined("https://a.example/", "bot:b1"), joined("https://b.example/", "bot:b1"), "the same chat of two botdots is two notifications");
    }
}
