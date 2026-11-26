//! A window that turns black on the Mac. When the window comes back into view after a long time out of it, WebKit
//! finds its GPU process "unresponsive" and ends it. The page's own process reconnects to a new one and never draws
//! again, and a new address reuses that process. Only a new web content process draws, so the window notices the new
//! GPU process and ends the page's process (WebKit's private methods, behind `respondsToSelector:`, decision
//! 2026-11-26) and loads the page again where it was. A web content process the system ended is loaded again the same
//! way. Without the private methods nothing here does anything.

use crate::App;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::NSString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url, Webview, Wry};

/// How often a window in view is asked for its GPU process: WebKit ends an unresponsive one some seconds after the
/// window is back, so a look when it comes back is too early.
const EVERY: Duration = Duration::from_secs(2);
/// The time after a recovery in which there is no other: a GPU process that keeps going would reload the page forever.
const COOLDOWN: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Watch {
    /// The GPU process the window drew with when last looked at, if it had one.
    recorded: Mutex<Option<i32>>,
    /// When the page was last loaded again for a new GPU process.
    recovered: Mutex<Option<Instant>>,
    /// A recovery is ending the web content process: its ending is not a second reason to load the page.
    recovering: AtomicBool,
}

#[derive(Debug, PartialEq)]
enum Next {
    Nothing,
    /// The GPU process now is the one to compare with from here on.
    Remember(i32),
    /// The GPU process is a new one while a botdot's page is shown.
    Recover,
}

/// What to do with the GPU process the window has now. `current` is `None` when WebKit has none (it starts one when a
/// page draws) or the private method is missing. The app's own screen takes a new GPU process without harm.
fn next(recorded: Option<i32>, current: Option<i32>, on_page: bool, cooling: bool) -> Next {
    let Some(current) = current.filter(|pid| *pid > 0) else { return Next::Nothing };
    match recorded {
        Some(was) if was == current => Next::Nothing,
        Some(_) if on_page && cooling => Next::Nothing,
        Some(_) if on_page => Next::Recover,
        _ => Next::Remember(current),
    }
}

fn has(view: &AnyObject, method: Sel) -> bool {
    let yes: Bool = unsafe { msg_send![view, respondsToSelector: method] };
    yes.as_bool()
}

fn gpu_process(view: &AnyObject) -> Option<i32> {
    if !has(view, sel!(_gpuProcessIdentifier)) {
        return None;
    }
    let pid: i32 = unsafe { msg_send![view, _gpuProcessIdentifier] };
    Some(pid)
}

// The page it shows now, or where it was when there is none (WebKit drops the address of a page whose process went).
fn address_of(view: &AnyObject, instead: Option<Url>) -> Option<Retained<AnyObject>> {
    let shown: Option<Retained<AnyObject>> = unsafe { msg_send![view, URL] };
    shown.or_else(|| {
        let text = NSString::from_str(instead?.as_str());
        unsafe { msg_send![class!(NSURL), URLWithString: &*text] }
    })
}

fn load(view: &AnyObject, address: &AnyObject) {
    unsafe {
        let request: Option<Retained<AnyObject>> = msg_send![class!(NSURLRequest), requestWithURL: address];
        if let Some(request) = request {
            let _: Option<Retained<AnyObject>> = msg_send![view, loadRequest: &*request];
        }
    }
}

// The web content process ended and a new one draws the page loaded again.
fn recover(watch: &Watch, view: &AnyObject, instead: Option<Url>) {
    let kill = sel!(_killWebContentProcessAndResetState);
    if !has(view, kill) {
        return;
    }
    let Some(address) = address_of(view, instead) else { return };
    watch.recovering.store(true, Ordering::SeqCst);
    let _: () = unsafe { msg_send![view, _killWebContentProcessAndResetState] };
    load(view, &address);
    watch.recovering.store(false, Ordering::SeqCst);
}

/// The page where it was: for the front door's page, the botdot's; for the app's screen, its own.
fn where_it_was(app: &AppHandle, label: &str) -> Option<Url> {
    let state = app.state::<App>();
    if label != "main" {
        return None;
    }
    state.door().or_else(|| state.screen.lock().unwrap().clone())
}

/// A look at the main window's GPU process: when it is a new one and the window is on a botdot's page, the page is
/// loaded again in a new process. Any thread.
pub fn check(app: &AppHandle) {
    let Some(window) = crate::main_window(app) else { return };
    let app = app.clone();
    let _ = window.with_webview(move |webview| {
        let view = unsafe { &*(webview.inner() as *const AnyObject) };
        let state = app.state::<App>();
        let watch = &state.gpu;
        let cooling = watch.recovered.lock().unwrap().is_some_and(|at| at.elapsed() < COOLDOWN);
        let mut recorded = watch.recorded.lock().unwrap();
        match next(*recorded, gpu_process(view), state.door().is_some(), cooling) {
            Next::Nothing => {}
            Next::Remember(pid) => *recorded = Some(pid),
            Next::Recover => {
                // The new page's own GPU process is the one to compare with, once it has one.
                *recorded = None;
                drop(recorded);
                *watch.recovered.lock().unwrap() = Some(Instant::now());
                recover(watch, view, where_it_was(&app, "main"));
            }
        }
    });
}

/// Every look the window gets while it is in view, as long as the app runs.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(EVERY);
        let in_view = crate::main_window(&app).is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
        if in_view {
            check(&app);
        }
    });
}

/// The system ended a window's web content process (memory, a crash): its page is loaded again, or the window stays
/// blank. Tauri's own answer is a plain reload, which has no address to load where WebKit dropped it: this loads the
/// address the window kept.
pub fn process_ended(webview: &Webview<Wry>) {
    if webview.state::<App>().gpu.recovering.load(Ordering::SeqCst) {
        return;
    }
    let instead = where_it_was(webview.app_handle(), webview.label());
    let app = webview.app_handle().clone();
    // From a thread of the app's own, which the window's call comes back to on the main thread: this is WebKit's
    // callback, which the window's own call must not be made inside.
    let shown = webview.clone();
    tauri::async_runtime::spawn(async move {
        let _ = shown.with_webview(move |webview| {
            let view = unsafe { &*(webview.inner() as *const AnyObject) };
            let watch = &app.state::<App>().gpu;
            *watch.recorded.lock().unwrap() = None;
            if let Some(address) = address_of(view, instead) {
                load(view, &address);
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_first_look_remembers_the_process() {
        assert_eq!(next(None, Some(10), true, false), Next::Remember(10));
        assert_eq!(next(None, Some(10), false, false), Next::Remember(10));
    }

    #[test]
    fn the_same_process_is_left_alone() {
        assert_eq!(next(Some(10), Some(10), true, false), Next::Nothing);
    }

    #[test]
    fn a_new_process_on_a_botdots_page_recovers_it() {
        assert_eq!(next(Some(10), Some(11), true, false), Next::Recover);
    }

    #[test]
    fn a_new_process_on_the_apps_screen_is_only_remembered() {
        assert_eq!(next(Some(10), Some(11), false, false), Next::Remember(11));
    }

    #[test]
    fn a_new_process_straight_after_a_recovery_waits() {
        assert_eq!(next(Some(10), Some(11), true, true), Next::Nothing);
    }

    #[test]
    fn no_process_now_decides_nothing() {
        assert_eq!(next(Some(10), None, true, false), Next::Nothing);
        assert_eq!(next(Some(10), Some(0), true, false), Next::Nothing);
        assert_eq!(next(None, Some(-1), true, false), Next::Nothing);
        assert_eq!(next(None, None, false, false), Next::Nothing);
    }
}
