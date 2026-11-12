//! On iOS the sessions' cookies are kept in the Keychain (#965), on this device only and from its first unlock on, not
//! in the app's file: one item, the cookie of each address as JSON.

use security_framework::access_control::{ProtectionMode, SecAccessControl};
use security_framework::passwords::{delete_generic_password, generic_password, set_generic_password_options};
use security_framework::passwords_options::PasswordOptions;
use std::collections::BTreeMap;

const SERVICE: &str = "dev.botdot.ios.sessions";
const ACCOUNT: &str = "sessions";

/// The cookie of each address, as kept. Nothing when the item is missing or can't be read.
pub fn read() -> BTreeMap<String, String> {
    generic_password(PasswordOptions::new_generic_password(SERVICE, ACCOUNT)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Keeps these cookies in place of the ones before. None at all removes the item. The item is made again each time, not
/// updated: an update can't carry its protection.
pub fn write(cookies: &BTreeMap<String, String>) -> std::io::Result<()> {
    let failed = |e: security_framework::base::Error| std::io::Error::other(e.to_string());
    match delete_generic_password(SERVICE, ACCOUNT) {
        Err(e) if e.code() != security_framework_sys::base::errSecItemNotFound => return Err(failed(e)),
        _ if cookies.is_empty() => return Ok(()),
        _ => {}
    }
    let mut options = PasswordOptions::new_generic_password(SERVICE, ACCOUNT);
    options.set_access_control(SecAccessControl::create_with_protection(Some(ProtectionMode::AccessibleAfterFirstUnlockThisDeviceOnly), 0).map_err(failed)?);
    set_generic_password_options(&serde_json::to_vec(cookies)?, options).map_err(failed)
}
