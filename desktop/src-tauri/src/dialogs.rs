//! `alert()` and `confirm()` on the Mac. WKWebView shows no dialogs of its own: without these, `confirm()` answers
//! false without asking, and what the web page asks first never happens. WebView2 draws its own. wry's delegate has
//! no way to add them, so they join its class, and the delegate is set again for WebKit to see them.

use block2::Block;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{class, ffi, msg_send, sel};
use objc2_foundation::NSString;
use tauri::{WebviewWindow, Wry};

unsafe fn ask(message: *mut NSString, cancel: bool) -> bool {
    let alert: *mut AnyObject = msg_send![class!(NSAlert), new];
    let _: () = msg_send![alert, setMessageText: message];
    let _: *mut AnyObject = msg_send![alert, addButtonWithTitle: &*NSString::from_str("OK")];
    if cancel {
        let _: *mut AnyObject = msg_send![alert, addButtonWithTitle: &*NSString::from_str("Cancel")];
    }
    const FIRST_BUTTON: isize = 1000;
    let answer: isize = msg_send![alert, runModal];
    answer == FIRST_BUTTON
}

unsafe extern "C-unwind" fn alert(_: *mut AnyObject, _: Sel, _: *mut AnyObject, message: *mut NSString, _: *mut AnyObject, done: *mut Block<dyn Fn()>) {
    ask(message, false);
    (*done).call(());
}

unsafe extern "C-unwind" fn confirm(_: *mut AnyObject, _: Sel, _: *mut AnyObject, message: *mut NSString, _: *mut AnyObject, done: *mut Block<dyn Fn(Bool)>) {
    (*done).call((Bool::new(ask(message, true)),));
}

pub fn add(window: &WebviewWindow<Wry>) {
    let _ = window.with_webview(|webview| unsafe {
        let view = webview.inner() as *mut AnyObject;
        let delegate: *mut AnyObject = msg_send![view, UIDelegate];
        let class = ffi::object_getClass(delegate) as *mut AnyClass;
        ffi::class_addMethod(
            class,
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<*const (), Imp>(alert as *const ()),
            c"v@:@@@@?".as_ptr(),
        );
        ffi::class_addMethod(
            class,
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<*const (), Imp>(confirm as *const ()),
            c"v@:@@@@?".as_ptr(),
        );
        let _: () = msg_send![view, setUIDelegate: delegate];
    });
}
