//! The desktop's own notifications on Linux: its notification server (`org.freedesktop.Notifications`) over the session
//! bus, which GNOME, KDE and the others all have. A newer notification of a tag takes its older one's place by its id,
//! and a click on one (its "default" action) reaches the app while it runs.

use crate::feed::Notice;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::Value;

const DESTINATION: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
/// The app's name, and the name its packages give its desktop file.
const APP: &str = "botdot";
/// The name its packages give its icon: the binary's.
const ICON: &str = "botdot-desktop";

static SERVER: OnceLock<Proxy<'static>> = OnceLock::new();
/// What is shown, by tag: the server's id and the target a click opens.
static SHOWN: Mutex<Option<HashMap<String, (u32, String)>>> = Mutex::new(None);

fn shown<T>(change: impl FnOnce(&mut HashMap<String, (u32, String)>) -> T) -> T {
    change(SHOWN.lock().unwrap().get_or_insert_with(HashMap::new))
}

// The target of the notification the server knows by this id.
fn target_of(shown: &HashMap<String, (u32, String)>, id: u32) -> Option<String> {
    shown.values().find(|(shown, _)| *shown == id).map(|(_, target)| target.clone())
}

// The server's signals: a click, and a notification that closed, which a later one of its tag doesn't replace.
fn listen(server: &Proxy<'static>) -> zbus::Result<()> {
    for signal in server.receive_all_signals()? {
        let header = signal.header();
        match header.member().map(|m| m.as_str()) {
            Some("ActionInvoked") => {
                let Ok((id, action)) = signal.body().deserialize::<(u32, String)>() else { continue };
                if action == "default" {
                    if let Some(target) = shown(|shown| target_of(shown, id)) {
                        super::clicked(target);
                    }
                }
            }
            Some("NotificationClosed") => {
                let Ok((id, _reason)) = signal.body().deserialize::<(u32, u32)>() else { continue };
                shown(|shown| shown.retain(|_, (shown, _)| *shown != id));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Off the main thread: a desktop without a notification server shows none, and the app goes on.
pub fn start(_: &str) {
    std::thread::spawn(|| {
        let Ok(bus) = Connection::session() else { return };
        let Ok(server) = Proxy::new(&bus, DESTINATION, PATH, DESTINATION) else { return };
        let server = SERVER.get_or_init(|| server);
        let _ = listen(server);
    });
}

/// The desktop has no setting of its own to read or open.
pub fn check() {}

pub fn settings(_: &str) -> Option<String> {
    None
}

pub fn show(notice: &Notice) {
    let Some(server) = SERVER.get() else { return };
    let replaces = shown(|shown| shown.get(&notice.tag).map_or(0, |(id, _)| *id));
    let hints: HashMap<&str, Value> = HashMap::from([("desktop-entry", Value::from(APP))]);
    let actions = ["default", "Open"];
    let args = (APP, replaces, ICON, notice.title.as_str(), notice.body.as_str(), &actions[..], hints, -1i32);
    if let Ok(id) = server.call::<_, _, u32>("Notify", &args) {
        shown(|shown| shown.insert(notice.tag.clone(), (id, notice.target.clone())));
    }
}

pub fn remove(tag: &str) {
    let Some((id, _)) = shown(|shown| shown.remove(tag)) else { return };
    if let Some(server) = SERVER.get() {
        let _ = server.call::<_, _, ()>("CloseNotification", &(id,));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_click_opens_the_target_of_the_notification_it_was_on() {
        let shown = HashMap::from([("a\nbot:b1".to_string(), (7, "a\nbot:b1".to_string())), ("a\nbot:b2".to_string(), (9, "a\nbot:b2".to_string()))]);
        assert_eq!(target_of(&shown, 9).as_deref(), Some("a\nbot:b2"));
        assert_eq!(target_of(&shown, 3), None, "one the app didn't show is nothing");
    }
}
