//! The iOS app's sign-in sheet (#965): the front door's sign-in page in an `ASWebAuthenticationSession`, so iCloud
//! Keychain or the owner's password manager answers the passkey for the site itself. The sheet ends at
//! `botdot://signed-in?code=…`, which goes to this app alone, and never to the window's page.

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_authentication_services::{ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession};
use objc2_foundation::{NSError, NSString, NSURL};
use objc2_ui_kit::{UIView, UIWindow};
use std::cell::RefCell;

/// How the sheet ended: the link it came back with, or none (the owner closed it, or it failed).
pub type Done = Box<dyn Fn(Option<String>)>;

define_class!(
    // The window the sheet is shown over.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "BotdotSignInAnchor"]
    #[ivars = Retained<UIWindow>]
    struct Anchor;

    unsafe impl NSObjectProtocol for Anchor {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for Anchor {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSObject> {
            Retained::into_super(Retained::into_super(Retained::into_super(self.ivars().clone())))
        }
    }
);

/// A sheet that is shown: its number, the session and its anchor (only held, for the session holds it weakly).
struct Shown(u64, Retained<ASWebAuthenticationSession>, #[allow(dead_code)] Retained<Anchor>);

thread_local! {
    // The sheet shown now, its number and its anchor, which the session holds only weakly: kept until it ends.
    static SHOWN: RefCell<Option<Shown>> = const { RefCell::new(None) };
    static NUMBERS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Shows the sheet on `page` over the window of `webview` (a `WKWebView`). On the main thread. A sheet shown already is
/// closed first, and says nothing: the newest sign-in is the one that counts.
///
/// # Safety
///
/// `webview` is a live `WKWebView`.
pub unsafe fn show(webview: *mut std::ffi::c_void, page: &str, done: Done) -> bool {
    let Some(mtm) = MainThreadMarker::new() else { return false };
    let view = &*(webview as *const UIView);
    let Some(window) = view.window() else { return false };
    let Some(url) = NSURL::URLWithString(&NSString::from_str(page)) else { return false };
    close();
    let number = NUMBERS.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    let handler = RcBlock::new(move |link: *mut NSURL, _error: *mut NSError| {
        let ours = SHOWN.with(|shown| {
            let mut shown = shown.borrow_mut();
            let ours = shown.as_ref().is_some_and(|s| s.0 == number);
            if ours {
                shown.take();
            }
            ours
        });
        if ours {
            done(unsafe { link.as_ref() }.and_then(|l| l.absoluteString()).map(|s| s.to_string()));
        }
    });
    let anchor = Anchor::alloc(mtm).set_ivars(window);
    let anchor: Retained<Anchor> = msg_send![super(anchor), init];
    #[allow(deprecated)] // its successor, with ASWebAuthenticationSessionCallback, is iOS 17.4 and later
    let session = ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
        ASWebAuthenticationSession::alloc(),
        &url,
        Some(&NSString::from_str("botdot")),
        RcBlock::as_ptr(&handler),
    );
    session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor)));
    // The passkey and the password manager the owner has in Safari, not a session of the sheet's own.
    session.setPrefersEphemeralWebBrowserSession(false);
    SHOWN.with(|shown| *shown.borrow_mut() = Some(Shown(number, session.clone(), anchor)));
    let started = session.start();
    if !started {
        SHOWN.with(|shown| shown.borrow_mut().take());
    }
    started
}

/// Closes the sheet shown now, if any, with nothing said of it.
pub fn close() {
    if let Some(Shown(_, session, _)) = SHOWN.with(|shown| shown.borrow_mut().take()) {
        unsafe { session.cancel() };
    }
}
