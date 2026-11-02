//! The app's controls: the tray icon's menu on Windows, the menu bar icon's and the app menu on the Mac. They list the
//! botdots, add and remove one, and turn "Open at login" on and off.

use crate::keep::Kept;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{AppHandle, Url, Wry};

pub const ADD: &str = "add";
pub const REMOVE: &str = "remove";
pub const LOGIN: &str = "login";
pub const QUIT: &str = "quit";
const SHOW: &str = "show:";

/// What a click in a menu asks for.
#[derive(PartialEq, Debug)]
pub enum Asked {
    Show(String),
    Add,
    Remove,
    Login,
    Quit,
    Other,
}

pub fn asked(id: &str) -> Asked {
    match id {
        ADD => Asked::Add,
        REMOVE => Asked::Remove,
        LOGIN => Asked::Login,
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

pub struct Words {
    pub add: &'static str,
    pub remove: &'static str,
    pub login: &'static str,
    pub quit: &'static str,
}

const EN: Words = Words { add: "Add botdot…", remove: "Remove", login: "Open at login", quit: "Quit botdot" };
const PL: Words = Words { add: "Dodaj botdota…", remove: "Usuń", login: "Otwieraj po zalogowaniu", quit: "Zakończ botdota" };

pub fn words() -> &'static Words {
    match sys_locale::get_locale() {
        Some(locale) if locale.to_lowercase().starts_with("pl") => &PL,
        _ => &EN,
    }
}

// The botdots, Add, Remove (the one shown), Open at login. `quit` adds Quit, which the Mac's app menu has of its own.
fn items(app: &AppHandle, kept: &Kept, login: bool, quit: bool) -> tauri::Result<Vec<MenuItemKind<Wry>>> {
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
    if let Some(current) = &current {
        let text = format!("{} {}", words.remove, label(current));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, REMOVE, text, true, None::<&str>)?));
    }
    items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?));
    items.push(MenuItemKind::Check(CheckMenuItem::with_id(app, LOGIN, words.login, true, login, None::<&str>)?));
    if quit {
        items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(app, QUIT, words.quit, true, None::<&str>)?));
    }
    Ok(items)
}

fn refs(items: &[MenuItemKind<Wry>]) -> Vec<&dyn IsMenuItem<Wry>> {
    items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect()
}

pub fn tray(app: &AppHandle, kept: &Kept, login: bool) -> tauri::Result<Menu<Wry>> {
    let items = items(app, kept, login, true)?;
    Menu::with_items(app, &refs(&items))
}

/// The Mac's own menu, with the botdots in the app's menu under About.
#[cfg(target_os = "macos")]
pub fn app_menu(app: &AppHandle, kept: &Kept, login: bool) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(first) = menu.items()?.first().and_then(|item| item.as_submenu().cloned()) {
        let mut items = vec![MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?)];
        items.extend(self::items(app, kept, login, false)?);
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
        assert_eq!(asked(LOGIN), Asked::Login);
        assert_eq!(asked(QUIT), Asked::Quit);
        assert_eq!(asked("about"), Asked::Other);
    }
}
