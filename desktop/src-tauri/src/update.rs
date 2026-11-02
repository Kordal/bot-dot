// The app updates itself from GitHub Releases (#883): at start and once a day it asks the manifest the release
// workflow publishes (`plugins.updater` in tauri.conf.json), downloads a newer build, checks it against the update
// key built into the app, and asks once whether to restart into it. "Later" holds for the rest of this run.
use std::time::{Duration, SystemTime};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

const DAY: Duration = Duration::from_secs(24 * 60 * 60);
// How often the app looks at the clock: a computer that slept through a day checks soon after it wakes.
const GLANCE: Duration = Duration::from_secs(60 * 60);

/// Whether a check is due: never checked, a day since the last one, or the clock went back.
pub fn due(last: Option<SystemTime>, now: SystemTime) -> bool {
    match last {
        None => true,
        Some(last) => now.duration_since(last).map_or(true, |since| since >= DAY),
    }
}

/// Starts the checks, in a thread of their own. A build made with `cargo run` does not update.
pub fn start(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    std::thread::spawn(move || {
        let mut last = None;
        let mut declined: Option<String> = None;
        loop {
            let now = SystemTime::now();
            if due(last, now) {
                last = Some(now);
                tauri::async_runtime::block_on(check(&app, &mut declined));
            }
            std::thread::sleep(GLANCE);
        }
    });
}

async fn check(app: &AppHandle, declined: &mut Option<String>) {
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    if declined.as_deref() == Some(update.version.as_str()) {
        return;
    }
    // Downloaded and checked first, so Restart restarts at once.
    let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return };
    let restart = app
        .dialog()
        .message(format!("botdot {} is ready.", update.version))
        .title("Update")
        .buttons(MessageDialogButtons::OkCancelCustom("Restart".into(), "Later".into()))
        .blocking_show();
    if !restart {
        *declined = Some(update.version.clone());
        return;
    }
    // On Windows the installer takes over and the app ends here; on the Mac the new bundle is in place.
    match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(_) => {
            app.dialog().message("The update did not install.").title("Update").blocking_show();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_is_due_at_start_and_a_day_after_the_last() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(due(None, now));
        assert!(!due(Some(now), now));
        assert!(!due(Some(now - DAY + Duration::from_secs(1)), now));
        assert!(due(Some(now - DAY), now));
        assert!(due(Some(now + Duration::from_secs(60)), now), "a clock that went back checks");
    }
}
