//! The User Notifications framework. It works only in a bundle that is installed (`botdot.app`), never under `cargo run`,
//! where asking for its centre ends the process: there the app shows nothing. The tag is the request's identifier, and
//! the target its thread, which a click hands back.

use crate::feed::Notice;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use std::ptr::NonNull;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotificationSettings, UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use std::sync::atomic::{AtomicBool, Ordering};

static IN_A_BUNDLE: AtomicBool = AtomicBool::new(false);

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BotdotNotificationClicks"]
    struct Clicks;

    unsafe impl NSObjectProtocol for Clicks {}

    unsafe impl UNUserNotificationCenterDelegate for Clicks {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, done: &block2::DynBlock<dyn Fn()>) {
            let target = response.notification().request().content().threadIdentifier().to_string();
            super::clicked(target);
            done.call(());
        }
    }
);

fn center() -> Option<Retained<UNUserNotificationCenter>> {
    IN_A_BUNDLE.load(Ordering::Relaxed).then(UNUserNotificationCenter::currentNotificationCenter)
}

pub fn start(_: &str) {
    let bundled = NSBundle::mainBundle().bundlePath().to_string().ends_with(".app");
    IN_A_BUNDLE.store(bundled, Ordering::Relaxed);
    let Some(center) = center() else { return };
    let clicks: Retained<Clicks> = unsafe { msg_send![super(Clicks::alloc().set_ivars(())), init] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*clicks)));
    std::mem::forget(clicks); // the centre holds its delegate weakly, and the app needs it as long as it runs
    // Asked once: the Mac shows its question the first time, and answers at once after that.
    let asked = block2::RcBlock::new(|granted: Bool, error: *mut NSError| {
        if !granted.as_bool() {
            let why = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_default();
            eprintln!("[notifications] not allowed {why}");
        }
        check();
    });
    center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &asked);
}

pub fn check() {
    let Some(center) = center() else { return };
    let found = block2::RcBlock::new(|settings: NonNull<UNNotificationSettings>| {
        super::turned_off(unsafe { settings.as_ref() }.authorizationStatus() == UNAuthorizationStatus::Denied);
    });
    center.getNotificationSettingsWithCompletionHandler(&found);
}

pub fn settings(id: &str) -> Option<String> {
    Some(format!("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={id}"))
}

pub fn show(notice: &Notice) {
    let Some(center) = center() else { return };
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&notice.title));
    content.setBody(&NSString::from_str(&notice.body));
    content.setThreadIdentifier(&NSString::from_str(&notice.target));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&notice.tag), &content, None);
    center.addNotificationRequest_withCompletionHandler(&request, None);
}

pub fn remove(tag: &str) {
    let Some(center) = center() else { return };
    center.removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&[NSString::from_str(tag)]));
}
