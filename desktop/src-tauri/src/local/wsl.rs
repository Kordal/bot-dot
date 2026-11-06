//! botdot on this PC: a WSL2 distribution of its own, `botdot` (Ubuntu 24.04, systemd on), which never touches the
//! owner's other distributions or `.wslconfig` (#879).

use super::{install_script, run, Installed, VM};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use tauri::AppHandle;

/// No console window for any command the app runs.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const IMAGE: &str = "Ubuntu-24.04";
/// The distribution's own `wsl.conf`: systemd on, and none of Windows' drives or programs, which the account's Linux
/// user would otherwise reach as the owner (#879).
const WSL_CONF: &str = "[boot]\nsystemd=true\n\n[automount]\nenabled=false\nmountFsTab=false\n\n[interop]\nenabled=false\nappendWindowsPath=false\n";
/// The sign-in's start of the distribution, in the user's Run key.
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "botdot-vm";

/// This PC can hold the distribution: its size is WSL's own, half the memory unless the owner's `.wslconfig` says
/// otherwise, and the account alone takes 5 GiB of it.
#[derive(PartialEq, Debug)]
pub struct Size;

pub fn sized(memory_gib: u64, free_gib: u64) -> Option<Size> {
    (memory_gib >= 16 && free_gib >= 40).then_some(Size)
}

// A distribution with no `wsl.exe` left stops in seconds; `dbus-launch` leaves a process that keeps it running, and
// returns at once (#879). The headless console shows no window at sign-in.
fn keepalive(windows: &str) -> String {
    format!(r"{windows}\System32\conhost.exe --headless wsl.exe -d {VM} --exec dbus-launch true")
}

fn has_distribution(listed: &str) -> bool {
    listed.lines().any(|line| line.trim().trim_start_matches('\u{feff}') == VM)
}

fn quiet(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).creation_flags(CREATE_NO_WINDOW);
    command
}

// wsl.exe's own messages in UTF-8, as the distribution's are.
fn wsl() -> Command {
    let mut command = quiet("wsl.exe");
    command.env("WSL_UTF8", "1");
    command
}

fn succeeds(command: &mut Command) -> bool {
    command.stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|status| status.success())
}

fn as_root(args: &[&str]) -> Command {
    let mut command = wsl();
    command.args(["-d", VM, "-u", "root", "--cd", "/", "--exec"]).args(args);
    command
}

pub struct Wsl;

impl Wsl {
    pub fn of(_app: &AppHandle) -> Option<Self> {
        Some(Self)
    }

    /// `None` on a PC with too little memory or disk.
    pub fn size(&self) -> Option<Size> {
        let script = "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory; [IO.DriveInfo]::new($env:LOCALAPPDATA).AvailableFreeSpace";
        let said = quiet("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).output().ok()?;
        let text = String::from_utf8_lossy(&said.stdout);
        let mut bytes = text.lines().filter_map(|line| line.trim().parse::<u64>().ok());
        sized(bytes.next()? >> 30, bytes.next()? >> 30)
    }

    fn has_wsl() -> bool {
        succeeds(wsl().arg("--status"))
    }

    /// WSL itself: `true` when it is there, `false` once Windows installed it and must restart. The one administrator
    /// prompt is Windows' own.
    pub fn prepare(&self, mut said: impl FnMut(&str)) -> Result<bool, Vec<String>> {
        if Self::has_wsl() {
            return Ok(true);
        }
        said("Installing WSL");
        let elevated = "$p = Start-Process -FilePath wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode";
        let mut command = quiet("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", elevated]);
        run(command, &mut said).map(|_| false)
    }

    fn exists(&self) -> bool {
        wsl().args(["--list", "--quiet"]).output().is_ok_and(|said| has_distribution(&String::from_utf8_lossy(&said.stdout)))
    }

    // Written once, then the distribution restarts to read it.
    fn configure(&self, said: &mut impl FnMut(&str)) -> Result<(), Vec<String>> {
        let kept = as_root(&["cat", "/etc/wsl.conf"]).output().map(|said| String::from_utf8_lossy(&said.stdout).into_owned()).unwrap_or_default();
        if kept == WSL_CONF {
            return Ok(());
        }
        run(as_root(&["sh", "-c", &format!("printf '%s' '{WSL_CONF}' > /etc/wsl.conf")]), said)?;
        let mut stop = wsl();
        stop.args(["--terminate", VM]);
        run(stop, said).map(|_| ())
    }

    /// The distribution, its start at sign-in and botdot in it, from nothing or from where a setup stopped. A rerun of
    /// the installer keeps the account and its passkey.
    pub fn set_up(&self, _size: &Size, port: u16, mut said: impl FnMut(&str)) -> Result<Installed, Vec<String>> {
        if !self.exists() {
            let mut install = wsl();
            install.args(["--install", IMAGE, "--name", VM, "--no-launch"]);
            run(install, &mut said)?;
        }
        self.configure(&mut said)?;
        self.keep_agent().map_err(|e| vec![e.to_string()])?;
        // WSL gives every command a terminal, even with no window, and the installer would wait there for answers: in a
        // session of its own it has none, and takes them from `yes`.
        let script = install_script(port);
        let installed = run(as_root(&["setsid", "--wait", "sh", "-c", &script]), &mut said)?;
        self.wake();
        installed.ok_or_else(|| vec!["The installer ended without its last line.".to_string()])
    }

    /// The distribution's start at sign-in, written again on each start of the app.
    pub fn keep_agent(&self) -> std::io::Result<()> {
        let windows = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string());
        let status = quiet("reg.exe").args(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &keepalive(&windows), "/f"]).stdout(Stdio::null()).status()?;
        status.success().then_some(()).ok_or_else(|| std::io::Error::other("reg add"))
    }

    /// Starts the distribution when it isn't running, as the sign-in would, and keeps it running.
    pub fn wake(&self) -> bool {
        succeeds(wsl().args(["-d", VM, "--exec", "dbus-launch", "true"]))
    }

    /// Asks root's step for an update, as the admin page does on a server (ADR 136).
    pub fn update(&self) -> bool {
        succeeds(&mut as_root(&["touch", "/var/lib/botdot/front-door/requests/UPDATE"]))
    }

    /// The start at sign-in and the distribution, with its disk.
    pub fn remove(&self) -> bool {
        let _ = succeeds(quiet("reg.exe").args(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]));
        !self.exists() || succeeds(wsl().args(["--unregister", VM]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_pc_gets_no_botdot() {
        assert_eq!(sized(32, 400), Some(Size));
        assert_eq!(sized(16, 40), Some(Size));
        assert_eq!(sized(8, 400), None, "WSL takes half the memory, and the account alone 5 GiB of it");
        assert_eq!(sized(32, 30), None);
    }

    #[test]
    fn the_sign_in_keeps_the_apps_own_distribution_running_with_no_window() {
        assert_eq!(keepalive(r"C:\Windows"), r"C:\Windows\System32\conhost.exe --headless wsl.exe -d botdot --exec dbus-launch true");
    }

    #[test]
    fn only_the_distribution_named_botdot_is_the_apps() {
        assert!(has_distribution("Ubuntu-24.04\r\nbotdot\r\n"));
        assert!(has_distribution("\u{feff}botdot\n"));
        assert!(!has_distribution("Ubuntu-24.04\nbotdot-old\n"));
    }

    #[test]
    fn the_distribution_keeps_away_from_windows() {
        assert!(WSL_CONF.contains("[boot]\nsystemd=true"));
        assert!(WSL_CONF.contains("[automount]\nenabled=false"));
        assert!(WSL_CONF.contains("[interop]\nenabled=false\nappendWindowsPath=false"));
        assert!(!WSL_CONF.contains('\''), "it goes in single quotes");
    }
}
