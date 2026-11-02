//! Toasts of the Action Center, under the app's identifier: the installer's Start menu shortcut carries it, so Windows
//! knows the app by it. A tag longer than Windows takes is shown under its hash. A click reaches the app while it runs:
//! the toast is kept until it is removed, as its handler lives with it.

use crate::feed::Notice;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use windows::core::{HSTRING, PCWSTR};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

const GROUP: &str = "botdot";
static ID: OnceLock<HSTRING> = OnceLock::new();
static SHOWN: Mutex<Option<HashMap<String, ToastNotification>>> = Mutex::new(None);

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn start(id: &str) {
    let id = HSTRING::from(id);
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(PCWSTR(id.as_ptr()));
    }
    let _ = ID.set(id);
}

fn toast(notice: &Notice) -> windows::core::Result<ToastNotification> {
    let xml = XmlDocument::new()?;
    xml.LoadXml(&HSTRING::from(format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escaped(&notice.title),
        escaped(&notice.body)
    )))?;
    let toast = ToastNotification::CreateToastNotification(&xml)?;
    toast.SetTag(&HSTRING::from(super::short_tag(&notice.tag)))?;
    toast.SetGroup(&HSTRING::from(GROUP))?;
    let target = notice.target.clone();
    toast.Activated(&TypedEventHandler::new(move |_, _| {
        super::clicked(target.clone());
        Ok(())
    }))?;
    Ok(toast)
}

pub fn show(notice: &Notice) {
    let Some(id) = ID.get() else { return };
    let Ok(toast) = toast(notice) else { return };
    if ToastNotificationManager::CreateToastNotifierWithId(id).and_then(|n| n.Show(&toast)).is_ok() {
        SHOWN.lock().unwrap().get_or_insert_with(HashMap::new).insert(notice.tag.clone(), toast);
    }
}

pub fn remove(tag: &str) {
    let Some(id) = ID.get() else { return };
    SHOWN.lock().unwrap().get_or_insert_with(HashMap::new).remove(tag);
    if let Ok(history) = ToastNotificationManager::History() {
        let _ = history.RemoveGroupedTagWithId(&HSTRING::from(super::short_tag(tag)), &HSTRING::from(GROUP), id);
    }
}
