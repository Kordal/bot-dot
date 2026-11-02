// The desktop app: a window onto a front door's web page (ADR 137). The one screen of its own, ui/, asks for the
// address. No console on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod address;
#[cfg(target_os = "macos")]
mod dialogs;
mod handoff;
mod keep;
mod route;

use handoff::Secret;
use keep::Kept;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::webview::{cookie::Cookie, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

struct App {
    file: PathBuf,
    /// The address of the app's own screen.
    screen: Mutex<Option<Url>>,
    /// The botdot the window is on, once signed in.
    home: Mutex<Option<Url>>,
    /// A sign-in waiting in the browser.
    waiting: Mutex<Option<(Url, Secret)>>,
}

impl App {
    fn home(&self) -> Option<Url> {
        self.home.lock().unwrap().clone()
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
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
    *app.state::<App>().home.lock().unwrap() = Some(address.clone());
    window.navigate(address.clone()).ok()
}

// The session is over: its cookie goes, here and in the window, and the app's screen comes back with the address.
fn session_over(app: &AppHandle, home: &Url) {
    let state = app.state::<App>();
    let kept = keep::load(&state.file);
    let _ = keep::save(&state.file, &Kept { cookie: None, ..kept });
    *state.home.lock().unwrap() = None;
    let screen = state.screen.lock().unwrap().clone();
    if let (Some(window), Some(screen)) = (main_window(app), screen) {
        for cookie in window.cookies_for_url(home.clone()).unwrap_or_default() {
            let _ = window.delete_cookie(cookie);
        }
        let _ = window.navigate(screen);
    }
}

// Every window of the app: where its page may go.
fn guarded<'a>(app: &AppHandle, builder: WebviewWindowBuilder<'a, Wry, AppHandle>) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let (on_navigate, on_load, on_new_window) = (app.clone(), app.clone(), app.clone());
    builder
        .on_navigation(move |to| {
            let Some(home) = on_navigate.state::<App>().home() else { return true };
            if !route::session_over(&home, to) {
                return true;
            }
            let app = on_navigate.clone();
            tauri::async_runtime::spawn(async move { session_over(&app, &home) });
            false
        })
        .on_page_load(move |window, load| {
            let Some(home) = on_load.state::<App>().home() else { return };
            if load.event() == PageLoadEvent::Started && route::left_home(&home, load.url()) {
                open_in_browser(&on_load, load.url());
                let _ = window.eval("history.back()");
            }
        })
        .on_new_window(move |to, features| {
            let Some(home) = on_new_window.state::<App>().home() else { return NewWindowResponse::Deny };
            match route::new_window(&home, &to) {
                route::Window::OfTheApp => {
                    let label = format!("page-{}", on_new_window.webview_windows().len());
                    let builder = WebviewWindowBuilder::new(&on_new_window, label, WebviewUrl::External(to)).title("botdot").window_features(features);
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

#[derive(Serialize, Default)]
struct Start {
    address: Option<String>,
    entering: bool,
    error: Option<&'static str>,
}

/// What the screen shows when it opens: the session kept from before goes straight in.
#[tauri::command]
async fn start(app: AppHandle) -> Start {
    let kept = keep::load(&app.state::<App>().file);
    let address = kept.address.as_deref().and_then(address::parse);
    let shown = address.as_ref().map(|a| a.as_str().trim_end_matches('/').to_string());
    let (Some(address), Some(cookie)) = (address, kept.cookie) else {
        return Start { address: shown, ..Start::default() };
    };
    if !tauri::async_runtime::spawn_blocking({
        let address = address.clone();
        move || handoff::reachable(&address)
    })
    .await
    .unwrap_or(false)
    {
        return Start { address: shown, error: Some("unreachable"), ..Start::default() };
    }
    Start { address: shown, entering: enter(&app, &address, &cookie).is_some(), ..Start::default() }
}

/// The button of the screen: in with the session of this address, or out to the browser for a sign-in.
#[tauri::command]
async fn connect(app: AppHandle, address: String) -> Result<(), &'static str> {
    let address = address::parse(&address).ok_or("invalid")?;
    let reachable = tauri::async_runtime::spawn_blocking({
        let address = address.clone();
        move || handoff::reachable(&address)
    })
    .await
    .unwrap_or(false);
    if !reachable {
        return Err("unreachable");
    }
    let state = app.state::<App>();
    let kept = keep::load(&state.file);
    if kept.address.as_deref() == Some(address.as_str()) {
        if let Some(cookie) = kept.cookie {
            return enter(&app, &address, &cookie).ok_or("failed");
        }
    }
    let secret = Secret::new();
    open_in_browser(&app, &secret.page(&address));
    *state.waiting.lock().unwrap() = Some((address, secret));
    Ok(())
}

// The browser came back with `botdot://signed-in?code=…`. A link nobody waits for is nothing.
fn signed_in(app: &AppHandle, link: &Url) {
    let Some(code) = handoff::code_of(link) else { return };
    let state = app.state::<App>();
    let Some((address, secret)) = state.waiting.lock().unwrap().take() else { return };
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let session = tauri::async_runtime::spawn_blocking({
            let address = address.clone();
            move || handoff::take_session(&address, &code, secret)
        })
        .await
        .ok()
        .flatten();
        let saved = session.as_ref().is_some_and(|cookie| {
            let kept = Kept { address: Some(address.to_string()), cookie: Some(cookie.clone()) };
            keep::save(&app.state::<App>().file, &kept).is_ok()
        });
        if !saved || enter(&app, &address, session.as_deref().unwrap_or_default()).is_none() {
            let _ = app.emit("sign-in-failed", ());
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = main_window(app) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).with_filter(|label| label == "main").build())
        .invoke_handler(tauri::generate_handler![start, connect])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(App {
                file: app.path().app_data_dir()?.join("session.json"),
                screen: Mutex::new(None),
                home: Mutex::new(None),
                waiting: Mutex::new(None),
            });
            let builder = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into())).title("botdot").inner_size(1200.0, 800.0).min_inner_size(420.0, 500.0);
            let window = guarded(&handle, builder).build()?;
            #[cfg(target_os = "macos")]
            dialogs::add(&window);
            *app.state::<App>().screen.lock().unwrap() = Some(window.url()?);
            let links = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for link in event.urls() {
                    signed_in(&links, &link);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the app");
}
