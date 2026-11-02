// The desktop app: a window onto a front door's web page (ADR 137). The one screen of its own, ui/, asks for an
// address; the tray icon's menu (the menu bar's on the Mac) holds the rest. No console on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod address;
#[cfg(target_os = "macos")]
mod dialogs;
mod handoff;
mod keep;
mod menu;
mod route;

use handoff::Secret;
use keep::Kept;
use menu::Asked;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::webview::{cookie::Cookie, NewWindowResponse, PageLoadEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

/// How a start at login starts: in the tray, with no window.
const HIDDEN: &str = "--hidden";

struct App {
    file: PathBuf,
    /// What the file holds.
    kept: Mutex<Kept>,
    /// The address of the app's own screen.
    screen: Mutex<Option<Url>>,
    /// The front door the window is on, once signed in.
    door: Mutex<Option<Url>>,
    /// Numbers the windows of the front door's own links.
    windows: AtomicUsize,
    /// A sign-in waiting in the browser.
    waiting: Mutex<Option<(Url, Secret)>>,
}

impl App {
    fn door(&self) -> Option<Url> {
        self.door.lock().unwrap().clone()
    }

    /// A change to what is kept, written at once.
    fn keep<T>(&self, change: impl FnOnce(&mut Kept) -> T) -> std::io::Result<T> {
        let mut kept = self.kept.lock().unwrap();
        let result = change(&mut kept);
        keep::save(&self.file, &kept)?;
        Ok(result)
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn bring_forward(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_in_browser(app: &AppHandle, url: &Url) {
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

// The cookie, for this address and no other, then the page.
fn enter(app: &AppHandle, address: &Url, set_cookie: &str) -> Option<()> {
    let window = main_window(app)?;
    let mut cookie = Cookie::parse(set_cookie.to_string()).ok()?;
    cookie.set_domain(address.host_str()?.to_string());
    window.set_cookie(cookie).ok()?;
    *app.state::<App>().door.lock().unwrap() = Some(address.clone());
    window.navigate(address.clone()).ok()
}

// The session is over: its cookie goes, here and in the window, the windows of its links close, and the app's screen
// comes back with the address.
fn session_over(app: &AppHandle, door: &Url) {
    let _ = app.state::<App>().keep(|kept| kept.session_over(door.as_str()));
    forget_cookies(app, door);
    to_screen(app, false);
}

// All cookies and not cookies_for_url: that one finds nothing for an address that is a number, as 127.0.0.1.
fn forget_cookies(app: &AppHandle, door: &Url) {
    if let Some(window) = main_window(app) {
        for cookie in window.cookies().unwrap_or_default() {
            if cookie.domain() == door.host_str() {
                let _ = window.delete_cookie(cookie);
            }
        }
    }
}

// Off the front door, to the app's screen: it enters the botdot shown now, or asks for a new address when `adding`.
// The windows of the front door's links close with it.
fn to_screen(app: &AppHandle, adding: bool) {
    let state = app.state::<App>();
    *state.door.lock().unwrap() = None;
    for (label, window) in app.webview_windows() {
        if label != "main" {
            let _ = window.close();
        }
    }
    let screen = state.screen.lock().unwrap().clone();
    if let (Some(window), Some(mut screen)) = (main_window(app), screen) {
        screen.set_query(adding.then_some("add"));
        let _ = window.navigate(screen);
    }
}

// The menus again, after the list or "Open at login" changed.
fn refresh_menus(app: &AppHandle) {
    let login = app.autolaunch().is_enabled().unwrap_or(false);
    let state = app.state::<App>();
    let kept = state.kept.lock().unwrap();
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("tray"), menu::tray(app, &kept, login)) {
        let _ = tray.set_menu(Some(menu));
    }
    #[cfg(target_os = "macos")]
    if let Ok(menu) = menu::app_menu(app, &kept, login) {
        let _ = app.set_menu(menu);
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match menu::asked(id) {
        Asked::Show(address) => {
            bring_forward(app);
            // The one already in the window stays as it is.
            if app.state::<App>().door().is_none_or(|door| door.as_str() != address) {
                let _ = app.state::<App>().keep(|kept| kept.choose(&address));
                to_screen(app, false);
            }
        }
        Asked::Add => {
            bring_forward(app);
            to_screen(app, true);
        }
        Asked::Remove => {
            let state = app.state::<App>();
            let current = state.kept.lock().unwrap().current().map(|b| b.address.clone());
            if let Some(address) = current {
                let _ = state.keep(|kept| kept.remove(&address));
                if let Some(url) = address::parse(&address) {
                    forget_cookies(app, &url);
                }
                to_screen(app, false);
            }
        }
        Asked::Login => {
            let autolaunch = app.autolaunch();
            let _ = if autolaunch.is_enabled().unwrap_or(false) { autolaunch.disable() } else { autolaunch.enable() };
        }
        Asked::Quit => app.exit(0),
        Asked::Other => return,
    }
    refresh_menus(app);
}

// Every window of the app: where its page may go.
fn guarded<'a>(app: &AppHandle, builder: WebviewWindowBuilder<'a, Wry, AppHandle>) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let (on_load, on_new_window) = (app.clone(), app.clone());
    builder
        .on_page_load(move |window, load| {
            let Some(door) = on_load.state::<App>().door() else { return };
            if load.event() != PageLoadEvent::Started {
                return;
            }
            if route::session_over(&door, load.url()) {
                let app = on_load.clone();
                tauri::async_runtime::spawn(async move { session_over(&app, &door) });
            } else if route::left_door(&door, load.url()) {
                open_in_browser(&on_load, load.url());
                let _ = if window.label() == "main" { window.eval("history.back()") } else { window.close() };
            }
        })
        .on_new_window(move |to, features| {
            let Some(door) = on_new_window.state::<App>().door() else { return NewWindowResponse::Deny };
            match route::new_window(&door, &to) {
                route::Window::OfTheApp => {
                    let number = on_new_window.state::<App>().windows.fetch_add(1, Ordering::Relaxed);
                    let builder = WebviewWindowBuilder::new(&on_new_window, format!("page-{number}"), WebviewUrl::External(to)).title("botdot").window_features(features);
                    match guarded(&on_new_window, builder).build() {
                        Ok(window) => {
                            #[cfg(target_os = "macos")]
                            dialogs::add(&window);
                            NewWindowResponse::Create { window }
                        }
                        Err(_) => NewWindowResponse::Deny,
                    }
                }
                route::Window::Browser => {
                    open_in_browser(&on_new_window, &to);
                    NewWindowResponse::Deny
                }
                route::Window::Nothing => NewWindowResponse::Deny,
            }
        })
        .on_download(|_, _| true)
}

async fn reachable(address: &Url) -> bool {
    let address = address.clone();
    tauri::async_runtime::spawn_blocking(move || handoff::reachable(&address)).await.unwrap_or(false)
}

#[derive(Serialize, Default)]
struct Start {
    address: Option<String>,
    entering: bool,
    error: Option<&'static str>,
}

/// What the screen shows when it opens: the botdot shown now goes straight in with its session, unless a new address is
/// being added.
#[tauri::command]
async fn start(app: AppHandle, adding: bool) -> Start {
    let current = if adding { None } else { app.state::<App>().kept.lock().unwrap().current().cloned() };
    let address = current.as_ref().and_then(|b| address::parse(&b.address));
    let shown = address.as_ref().map(|a| a.as_str().trim_end_matches('/').to_string());
    let (Some(address), Some(cookie)) = (address, current.and_then(|b| b.cookie)) else {
        return Start { address: shown, ..Start::default() };
    };
    if !reachable(&address).await {
        return Start { address: shown, error: Some("unreachable"), ..Start::default() };
    }
    Start { address: shown, entering: enter(&app, &address, &cookie).is_some(), ..Start::default() }
}

/// The button of the screen: in with the session the app has for this address, or out to the browser for a sign-in.
#[tauri::command]
async fn connect(app: AppHandle, address: String) -> Result<(), &'static str> {
    let address = address::parse(&address).ok_or("invalid")?;
    if !reachable(&address).await {
        return Err("unreachable");
    }
    let state = app.state::<App>();
    let cookie = state.kept.lock().unwrap().get(address.as_str()).and_then(|b| b.cookie.clone());
    if let Some(cookie) = cookie {
        state.keep(|kept| kept.choose(address.as_str())).map_err(|_| "failed")?;
        refresh_menus(&app);
        return enter(&app, &address, &cookie).ok_or("failed");
    }
    let secret = Secret::new();
    open_in_browser(&app, &secret.page(&address));
    *state.waiting.lock().unwrap() = Some((address, secret));
    Ok(())
}

// The browser came back with `botdot://signed-in?code=…`. A link nobody waits for is nothing. The sign-in waits on
// until a code works: a link from an older try fails without ending the newest.
fn signed_in(app: &AppHandle, link: &Url) {
    let Some(code) = handoff::code_of(link) else { return };
    let Some((address, secret)) = app.state::<App>().waiting.lock().unwrap().clone() else { return };
    bring_forward(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let session = tauri::async_runtime::spawn_blocking({
            let address = address.clone();
            move || handoff::take_session(&address, &code, &secret)
        })
        .await
        .ok()
        .flatten();
        let state = app.state::<App>();
        let saved = session.as_ref().is_some_and(|cookie| state.keep(|kept| kept.signed_in(address.as_str(), cookie)).is_ok());
        refresh_menus(&app);
        if !saved || enter(&app, &address, session.as_deref().unwrap_or_default()).is_none() {
            let _ = app.emit("sign-in-failed", ());
            return;
        }
        *state.waiting.lock().unwrap() = None;
    });
}

fn main() {
    let hidden = std::env::args().any(|arg| arg == HIDDEN);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| bring_forward(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().args([HIDDEN]).build())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).with_filter(|label| label == "main").build())
        .invoke_handler(tauri::generate_handler![start, connect])
        .setup(move |app| {
            let handle = app.handle().clone();
            let file = app.path().app_data_dir()?.join("session.json");
            app.manage(App {
                kept: Mutex::new(keep::load(&file)),
                file,
                screen: Mutex::new(None),
                door: Mutex::new(None),
                windows: AtomicUsize::new(0),
                waiting: Mutex::new(None),
            });
            let builder = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into())).title("botdot").inner_size(1200.0, 800.0).min_inner_size(420.0, 500.0).visible(!hidden);
            let window = guarded(&handle, builder).build()?;
            // Closing the window keeps the app in the tray: Quit ends it.
            let hide = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hide.hide();
                }
            });
            #[cfg(target_os = "macos")]
            dialogs::add(&window);
            *app.state::<App>().screen.lock().unwrap() = Some(window.url()?);
            let links = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for link in event.urls() {
                    signed_in(&links, &link);
                }
            });
            // "Open at login" is on from the first start of a built app, and the owner's after that.
            if cfg!(not(debug_assertions)) && !app.state::<App>().kept.lock().unwrap().login_set_up {
                let on = app.autolaunch().enable().is_ok();
                let _ = app.state::<App>().keep(|kept| kept.login_set_up = on);
            }
            let tray = TrayIconBuilder::with_id("tray").tooltip("botdot").on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    bring_forward(tray.app_handle());
                }
            });
            let tray = match app.default_window_icon() {
                Some(icon) => tray.icon(icon.clone()),
                None => tray,
            };
            // A click shows the window on Windows, and the menu on the Mac, as the menu bar's icons do there.
            tray.show_menu_on_left_click(cfg!(target_os = "macos")).build(app)?;
            refresh_menus(&handle);
            Ok(())
        })
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .build(tauri::generate_context!())
        .expect("the app");
    app.run(|app, event| {
        // The Dock's icon brings back the window that was closed.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            bring_forward(app);
        }
        let _ = (app, event);
    });
}
