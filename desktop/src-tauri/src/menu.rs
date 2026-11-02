//! The app's controls: the tray icon's menu on Windows, the menu bar icon's and the app menu on the Mac. They list the
//! botdots, add and remove one, and turn "Open at login" on and off.

use crate::keep::Kept;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{AppHandle, Url, Wry};

pub const ADD: &str = "add";
pub const REMOVE: &str = "remove";
pub const UPDATE_LOCAL: &str = "update-local";
pub const REMOVE_LOCAL: &str = "remove-local";
pub const LOGIN: &str = "login";
pub const NOTIFICATIONS: &str = "notifications";
pub const QUIT: &str = "quit";
const SHOW: &str = "show:";

/// What a click in a menu asks for.
#[derive(PartialEq, Debug)]
pub enum Asked {
    Show(String),
    Add,
    Remove,
    UpdateLocal,
    RemoveLocal,
    Login,
    Notifications,
    Quit,
    Other,
}

pub fn asked(id: &str) -> Asked {
    match id {
        ADD => Asked::Add,
        REMOVE => Asked::Remove,
        UPDATE_LOCAL => Asked::UpdateLocal,
        REMOVE_LOCAL => Asked::RemoveLocal,
        LOGIN => Asked::Login,
        NOTIFICATIONS => Asked::Notifications,
        QUIT => Asked::Quit,
        _ => id.strip_prefix(SHOW).map_or(Asked::Other, |address| Asked::Show(address.to_string())),
    }
}

/// An address as a menu shows it: its host, and its port when it has one.
pub fn label(address: &str) -> String {
    Url::parse(address)
        .ok()
        .and_then(|url| Some(match url.port() {
            Some(port) => format!("{}:{port}", url.host_str()?),
            None => url.host_str()?.to_string(),
        }))
        .unwrap_or_else(|| address.to_string())
}

// What only the local botdot says is read on the Mac alone.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Words {
    pub add: &'static str,
    pub remove: &'static str,
    pub update_local: &'static str,
    pub remove_local: &'static str,
    pub remove_local_asks: &'static str,
    pub cancel: &'static str,
    pub updating: &'static str,
    pub not_done: &'static str,
    pub login: &'static str,
    pub notifications: &'static str,
    pub quit: &'static str,
}

const EN: Words = Words {
    add: "Add botdot…",
    remove: "Remove",
    update_local: "Update botdot on this Mac",
    remove_local: "Remove botdot on this Mac…",
    remove_local_asks: "This deletes the botdot on this Mac for good: its bots, chats, memory, Vault and logins.",
    cancel: "Cancel",
    updating: "botdot is updating. It comes back in a few minutes.",
    not_done: "That didn't work. Try again.",
    login: "Open at login",
    notifications: "Turn on notifications…",
    quit: "Quit botdot",
};
const PL: Words = Words {
    add: "Dodaj botdota…",
    remove: "Usuń",
    update_local: "Zaktualizuj botdota na tym Macu",
    remove_local: "Usuń botdota z tego Maca…",
    remove_local_asks: "To na zawsze usuwa botdota z tego Maca: jego boty, czaty, pamięć, Sejf i logowania.",
    cancel: "Anuluj",
    updating: "botdot się aktualizuje. Wróci za kilka minut.",
    not_done: "To się nie udało. Spróbuj jeszcze raz.",
    login: "Otwieraj po zalogowaniu",
    notifications: "Włącz powiadomienia…",
    quit: "Zakończ botdota",
};

pub fn words() -> &'static Words {
    match sys_locale::get_locale() {
        Some(locale) if locale.to_lowercase().starts_with("pl") => &PL,
        _ => &EN,
    }
}

/// What the menus show besides the botdots.
#[derive(Clone, Copy)]
pub struct Shown {
    pub login: bool,
    /// The system has the app's notifications turned off: the menu offers its settings.
    pub notifications_off: bool,
}

// The botdots, Add, Remove (the one shown), Turn on notifications while they are off, Open at login. `quit` adds Quit,
// which the Mac's app menu has of its own.
fn items(app: &AppHandle, kept: &Kept, shown: Shown, quit: bool) -> tauri::Result<Vec<MenuItemKind<Wry>>> {
    let words = words();
    let current = kept.current().map(|b| b.address.clone());
    let mut items: Vec<MenuItemKind<Wry>> = Vec::new();
    for botdot in &kept.botdots {
        let shown = current.as_deref() == Some(&botdot.address);
        let id = format!("{SHOW}{}", botdot.address);
        items.push(MenuItemKind::Check(CheckMenuItem::with_id(app, id, label(&botdot.address), true, shown, None::<&str>)?));
    }
    if !items.is_empty() {
        items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?));
    }
    items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, ADD, words.add, true, None::<&str>)?));
    // The botdot on this computer goes with its VM, by its own item.
    if let Some(current) = current.as_ref().filter(|current| kept.local_address().as_ref() != Some(*current)) {
        let text = format!("{} {}", words.remove, label(current));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, REMOVE, text, true, None::<&str>)?));
    }
    if kept.local.is_some() {
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, UPDATE_LOCAL, words.update_local, true, None::<&str>)?));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, REMOVE_LOCAL, words.remove_local, true, None::<&str>)?));
    }
    items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?));
    if shown.notifications_off {
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, NOTIFICATIONS, words.notifications, true, None::<&str>)?));
    }
    items.push(MenuItemKind::Check(CheckMenuItem::with_id(app, LOGIN, words.login, true, shown.login, None::<&str>)?));
    if quit {
        items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, QUIT, words.quit, true, None::<&str>)?));
    }
    Ok(items)
}

fn refs(items: &[MenuItemKind<Wry>]) -> Vec<&dyn IsMenuItem<Wry>> {
    items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect()
}

pub fn tray(app: &AppHandle, kept: &Kept, shown: Shown) -> tauri::Result<Menu<Wry>> {
    let items = items(app, kept, shown, true)?;
    Menu::with_items(app, &refs(&items))
}

/// The Mac's own menu, with the botdots in the app's menu under About.
#[cfg(target_os = "macos")]
pub fn app_menu(app: &AppHandle, kept: &Kept, shown: Shown) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(first) = menu.items()?.first().and_then(|item| item.as_submenu().cloned()) {
        let mut items = vec![MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?)];
        items.extend(self::items(app, kept, shown, false)?);
        first.insert_items(&refs(&items), 1)?;
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_menu_shows_the_host_and_a_port() {
        assert_eq!(label("https://hq.example.com/"), "hq.example.com");
        assert_eq!(label("https://hq.example.com:8443/"), "hq.example.com:8443");
        assert_eq!(label("http://localhost:4700/"), "localhost:4700");
        assert_eq!(label("http://[::1]:4700/"), "[::1]:4700");
    }

    #[test]
    fn a_click_says_what_it_asks_for() {
        assert_eq!(asked("show:https://hq.example.com/"), Asked::Show("https://hq.example.com/".into()));
        assert_eq!(asked(ADD), Asked::Add);
        assert_eq!(asked(REMOVE), Asked::Remove);
        assert_eq!(asked(UPDATE_LOCAL), Asked::UpdateLocal);
        assert_eq!(asked(REMOVE_LOCAL), Asked::RemoveLocal);
        assert_eq!(asked(LOGIN), Asked::Login);
        assert_eq!(asked(NOTIFICATIONS), Asked::Notifications);
        assert_eq!(asked(QUIT), Asked::Quit);
        assert_eq!(asked("about"), Asked::Other);
    }
}
