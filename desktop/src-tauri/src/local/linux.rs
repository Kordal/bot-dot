//! botdot on this Linux computer itself, with no VM (ADR 170): the real installer with `BOT_DOT_REACH=local` and
//! `BOT_DOT_LOCAL_HOST=1`, as root through polkit's own password prompt (`pkexec`). The installer's systemd units start
//! botdot with the computer, so the app keeps nothing running itself. The accounts' Linux users are kept from the home
//! network by the installer's guard, and the bots' computers run under gVisor, as on a server.

use super::{install_script, run, Installed};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::AppHandle;

/// polkit's own `sudo`, which asks for the password in a window of the desktop's.
const PKEXEC: &str = "/usr/bin/pkexec";
/// Where the installer keeps botdot (its `BOT_DOT_DIR`).
const DIR: &str = "/var/lib/botdot";
/// A unit only a local install on the computer itself writes, and that anyone may see.
const INSTALLED: &str = "/etc/systemd/system/botdot-egress.service";

/// This computer can hold botdot beside its owner's own work.
#[derive(PartialEq, Debug)]
pub struct Size;

/// The account alone takes 5 GiB, beside the desktop's own, and an install 18 GB of the disk.
pub fn sized(memory_gib: u64, free_gib: u64) -> Option<Size> {
    (memory_gib >= 12 && free_gib >= 40).then_some(Size)
}

// `MemTotal` of /proc/meminfo, in GiB.
fn memory_gib(meminfo: &str) -> Option<u64> {
    let kib: u64 = meminfo.lines().find_map(|line| line.strip_prefix("MemTotal:"))?.split_whitespace().next()?.parse().ok()?;
    // Rounded: the kernel keeps some of a 16 GB computer's memory for itself.
    Some((kib + 512 * 1024) >> 20)
}

// The kilobytes `df -k` gives as available on the disk of this folder.
fn free_gib(folder: &Path) -> Option<u64> {
    let said = String::from_utf8(Command::new("df").arg("-k").arg(folder).output().ok()?.stdout).ok()?;
    Some(said.lines().nth(1)?.split_whitespace().nth(3)?.parse::<u64>().ok()? / (1024 * 1024))
}

// The installer clones its source with git and fetches with curl: a desktop may have neither yet. It knows apt and dnf
// alone (#1202), and says so itself on any other system.
const PREREQUISITES: &str = "if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then\n\
     if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates\n\
     elif command -v dnf >/dev/null 2>&1; then dnf install -y -q git curl\n\
     else echo 'Install git and curl, then try again.' >&2; exit 1; fi\n\
     fi\n";

fn host_script(port: u16) -> String {
    format!("set -e\n{PREREQUISITES}{}", install_script(port, "BOT_DOT_LOCAL_HOST=1 "))
}

fn as_root(script: &str) -> Command {
    let mut command = Command::new(PKEXEC);
    command.args(["/bin/sh", "-c", script]).stdin(Stdio::null());
    command
}

fn succeeds(mut command: Command) -> bool {
    command.stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|status| status.success())
}

pub struct Host;

impl Host {
    /// A computer with polkit and systemd, which the installer's units need. Without either the button isn't shown.
    pub fn of(_app: &AppHandle) -> Option<Self> {
        (Path::new(PKEXEC).exists() && Path::new("/run/systemd/system").is_dir()).then_some(Self)
    }

    /// `None` on a computer with too little memory or disk.
    pub fn size(&self) -> Option<Size> {
        let folder = Path::new(DIR).ancestors().find(|folder| folder.exists())?;
        sized(memory_gib(&std::fs::read_to_string("/proc/meminfo").ok()?)?, free_gib(folder)?)
    }

    /// Nothing comes before the install: it brings what it needs.
    pub fn prepare(&self, _said: impl FnMut(&str)) -> Result<bool, Vec<String>> {
        Ok(true)
    }

    /// botdot on this computer, from nothing or from where a setup stopped, after the owner's password. A rerun of the
    /// installer keeps the account and its passkey.
    pub fn set_up(&self, _size: &Size, port: u16, mut said: impl FnMut(&str)) -> Result<Installed, Vec<String>> {
        run(as_root(&host_script(port)), &mut said)?.ok_or_else(|| vec!["The installer ended without its last line.".to_string()])
    }

    /// systemd starts botdot with the computer: the app keeps nothing of its own.
    pub fn keep_agent(&self) -> std::io::Result<()> {
        Ok(())
    }

    /// systemd starts it: once installed, the app gives its front door the time a start takes.
    pub fn wake(&self) -> bool {
        Path::new(INSTALLED).exists()
    }

    /// Asks root's step for an update, as the admin page does on a server (ADR 136).
    pub fn update(&self) -> bool {
        succeeds(as_root(&format!("touch {DIR}/front-door/requests/UPDATE")))
    }

    /// The installer's own uninstall, answered yes: everything it made goes, and Docker stays.
    pub fn remove(&self) -> bool {
        succeeds(as_root(&format!("[ ! -f {DIR}/bin/install.sh ] || BOT_DOT_YES=1 sh {DIR}/bin/install.sh --uninstall")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_computer_gets_no_botdot() {
        assert_eq!(sized(16, 400), Some(Size));
        assert_eq!(sized(12, 40), Some(Size));
        assert_eq!(sized(8, 400), None, "the account alone takes 5 GiB, beside the desktop");
        assert_eq!(sized(32, 30), None);
    }

    #[test]
    fn the_memory_is_what_the_kernel_says_rounded() {
        assert_eq!(memory_gib("MemTotal:       16127772 kB\nMemFree:  1 kB\n"), Some(15));
        assert_eq!(memory_gib("MemFree:  1 kB\nMemTotal:       16301368 kB\n"), Some(16));
        assert_eq!(memory_gib("MemFree:  1 kB\n"), None);
    }

    #[test]
    fn the_installer_runs_on_the_computer_itself_with_what_it_needs() {
        let script = host_script(4700);
        assert!(script.starts_with("set -e\n"));
        assert!(script.contains("BOT_DOT_REACH=local BOT_DOT_LOCAL_HOST=1 BOT_DOT_PORT=4700 sh /var/tmp/botdot-source/install.sh"));
        assert!(script.find("apt-get install").unwrap() < script.find("git clone").unwrap(), "git and curl first");
        assert!(script.contains("dnf install -y -q git curl"));
    }
}
