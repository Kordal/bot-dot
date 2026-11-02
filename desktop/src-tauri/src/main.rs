// The desktop app: a window onto a front door's web page (ADR 137). The one screen of its own, ui/, asks for the
// address. No console on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod address;
#[cfg(target_os = "macos")]
mod dialogs;
mod feed;
mod handoff;
mod keep;
mod notify;
mod route;

use handoff::Secret;
use keep::Kept;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
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
    /// The front door the window is on, once signed in.
    door: Mutex<Option<Url>>,
    /// Numbers the windows of the front door's own links.
    windows: AtomicUsize,
    /// A sign-in waiting in the browser.
    waiting: Mutex<Option<(Url, Secret)>>,
    /// Counts the sessions: the feed of one that is over stops.
    session: AtomicU64,
}

impl App {
    fn door(&self) -> Option<Url> {
        self.door.lock().unwrap().clone()
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

// A window of the app in front: what would ring shows there already.
fn in_front(app: &AppHandle) -> bool {
    app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

// The session's feed, for its notifications (ADR 138), until the session is over.
fn follow(app: &AppHandle, address: &Url, set_cookie: &str) {
    let session = app.state::<App>().session.fetch_add(1, Ordering::SeqCst) + 1;
    let (alive, on) = (app.clone(), app.clone());
    feed::follow(
        address.clone(),
        feed::cookie_of(set_cookie).to_string(),
        move || alive.state::<App>().session.load(Ordering::SeqCst) == session,
        move |said| match said {
            feed::Said::Notification(notice) if !in_front(&on) => notify::show(&notice),
            feed::Said::Notification(_) => {}
            feed::Said::Closed(tag) => notify::remove(&tag),
        },
    );
}

// A click on a notification: the window comes forward and its page opens the target, as on a push's tap.
fn open_target(app: &AppHandle, target: &str) {
    bring_forward(app);
    let (Some(window), Some(door)) = (main_window(app), app.state::<App>().door()) else { return };
    if window.url().is_ok_and(|shown| shown.origin() == door.origin()) {
        let target = serde_json::to_string(target).unwrap_or_default();
        let _ = window.eval(format!("postMessage({{ type: 'open', target: {target} }}, location.origin)"));
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
    window.navigate(address.clone()).ok()?;
    follow(app, address, set_cookie);
    Some(())
}

// The session is over: its cookie goes, here and in the window, the windows of its links close, and the app's screen
// comes back with the address.
fn session_over(app: &AppHandle, door: &Url) {
    let state = app.state::<App>();
    let kept = keep::load(&state.file);
    let _ = keep::save(&state.file, &Kept { cookie: None, ..kept });
    *state.door.lock().unwrap() = None;
    state.session.fetch_add(1, Ordering::SeqCst);
    notify::remove_all();
    for (label, window) in app.webview_windows() {
        if label != "main" {
            let _ = window.close();
        }
    }
    let screen = state.screen.lock().unwrap().clone();
    if let (Some(window), Some(screen)) = (main_window(app), screen) {
        // All cookies and not cookies_for_url: that one finds nothing for an address that is a number, as 127.0.0.1.
        for cookie in window.cookies().unwrap_or_default() {
            if cookie.domain() == door.host_str() {
                let _ = window.delete_cookie(cookie);
            }
        }
        let _ = window.navigate(screen);
    }
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

/// What the screen shows when it opens: the session kept from before goes straight in.
#[tauri::command]
async fn start(app: AppHandle) -> Start {
    let kept = keep::load(&app.state::<App>().file);
    let address = kept.address.as_deref().and_then(address::parse);
    let shown = address.as_ref().map(|a| a.as_str().trim_end_matches('/').to_string());
    let (Some(address), Some(cookie)) = (address, kept.cookie) else {
        return Start { address: shown, ..Start::default() };
    };
    if !reachable(&address).await {
        return Start { address: shown, error: Some("unreachable"), ..Start::default() };
    }
    Start { address: shown, entering: enter(&app, &address, &cookie).is_some(), ..Start::default() }
}

/// The button of the screen: in with the session of this address, or out to the browser for a sign-in.
#[tauri::command]
async fn connect(app: AppHandle, address: String) -> Result<(), &'static str> {
    let address = address::parse(&address).ok_or("invalid")?;
    if !reachable(&address).await {
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
        let saved = session.as_ref().is_some_and(|cookie| {
            let kept = Kept { address: Some(address.to_string()), cookie: Some(cookie.clone()) };
            keep::save(&state.file, &kept).is_ok()
        });
        if !saved || enter(&app, &address, session.as_deref().unwrap_or_default()).is_none() {
            let _ = app.emit("sign-in-failed", ());
            return;
        }
        *state.waiting.lock().unwrap() = None;
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| bring_forward(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).with_filter(|label| label == "main").build())
        .invoke_handler(tauri::generate_handler![start, connect])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(App {
                file: app.path().app_data_dir()?.join("session.json"),
                screen: Mutex::new(None),
                door: Mutex::new(None),
                windows: AtomicUsize::new(0),
                waiting: Mutex::new(None),
                session: AtomicU64::new(0),
            });
            let clicks = handle.clone();
            notify::start(&app.config().identifier, move |target| {
                let app = clicks.clone();
                let _ = clicks.run_on_main_thread(move || open_target(&app, &target));
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
