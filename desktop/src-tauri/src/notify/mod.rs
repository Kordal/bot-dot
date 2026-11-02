//! The system's own notifications (ADR 138): shown under their tag, so a newer one of the same tag takes the older one's
//! place, removed by tag, and a click hands back the target. On the Mac the User Notifications framework, on Windows
//! the toasts of the Action Center.

use crate::feed::Notice;
use std::sync::OnceLock;

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
    pub fn remove_all() {}
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

type Click = Box<dyn Fn(String) + Send + Sync>;
static CLICKED: OnceLock<Click> = OnceLock::new();

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
fn clicked(target: String) {
    if let Some(on) = CLICKED.get() {
        on(target);
    }
}

/// Once, at the start. `id`: the app's identifier, which Windows shows its toasts under. The Mac asks the owner's
/// permission the first time.
pub fn start(id: &str, on_click: impl Fn(String) + Send + Sync + 'static) {
    let _ = CLICKED.set(Box::new(on_click));
    system::start(id);
}

pub fn show(notice: &Notice) {
    system::show(notice);
}

pub fn remove(tag: &str) {
    system::remove(tag);
}

/// The session is over: what it rang goes.
pub fn remove_all() {
    system::remove_all();
}

#[cfg(test)]
mod tests {
    use super::short_tag;

    #[test]
    fn a_tag_windows_takes_stays_and_a_longer_one_is_its_hash() {
        assert_eq!(short_tag("bot:b1"), "bot:b1");
        let long = format!("job:{}/{}", "b".repeat(40), "j".repeat(40));
        assert_eq!(short_tag(&long).len(), 32);
        assert_eq!(short_tag(&long), short_tag(&long), "the same tag is the same toast");
        assert_ne!(short_tag(&long), short_tag(&format!("{long}x")));
    }
}
