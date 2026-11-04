//! botdot on this Mac: a Lima VM, made with the Lima in the app's bundle. Its Lima home is its own, so other Lima
//! instances are never touched.

use super::{install_script, run, Installed, VM};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

/// The launch agent that starts the VM at login, and its file's name.
const AGENT: &str = "dev.botdot.vm";
/// What the app's Lima may find, whatever the app was started with: no Homebrew.
const PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// The VM's share of this Mac.
#[derive(PartialEq, Debug)]
pub struct Size {
    cpus: u32,
    memory_gib: u64,
    disk_gib: u64,
}

/// Half the CPUs, a third of the memory and half the free disk, within what the spike ran on: the account alone takes
/// 5 GiB of the 8 (#880), and an install takes 18 GB of the disk, which is sparse. `None` on a Mac too small for that.
pub fn sized(cpus: u32, memory_gib: u64, free_gib: u64) -> Option<Size> {
    (memory_gib >= 12 && free_gib >= 40).then(|| Size { cpus: (cpus / 2).clamp(2, 8), memory_gib: (memory_gib / 3).clamp(8, 16), disk_gib: (free_gib / 2).clamp(60, 200) })
}

fn sysctl(name: &str) -> Option<u64> {
    String::from_utf8(Command::new("/usr/sbin/sysctl").args(["-n", name]).output().ok()?.stdout).ok()?.trim().parse().ok()
}

// The kilobytes `df -k` gives as available on the disk of this folder.
fn free_gib(folder: &Path) -> Option<u64> {
    let said = String::from_utf8(Command::new("/bin/df").arg("-k").arg(folder).output().ok()?.stdout).ok()?;
    Some(said.lines().nth(1)?.split_whitespace().nth(3)?.parse::<u64>().ok()? / (1024 * 1024))
}

/// Bots' pages are on the next port (ADR 136). Only these two reach the Mac: without the last rule, Lima forwards
/// whatever listens on the VM's localhost.
fn port_forwards(port: u16) -> String {
    let forward = |p: u16| format!("{{\"guestPort\":{p},\"hostIP\":\"127.0.0.1\"}}");
    format!(".portForwards=[{},{},{{\"guestPortRange\":[1,65535],\"ignore\":true}}]", forward(port), forward(port + 1))
}

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

// `limactl start` returns once the VM is ready, and the VM outlives it (#880). A start that failed tries again.
fn agent_plist(limactl: &Path, home: &Path) -> String {
    let (limactl, home) = (escaped(&limactl.to_string_lossy()), escaped(&home.to_string_lossy()));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{AGENT}</string>
  <key>ProgramArguments</key>
  <array><string>{limactl}</string><string>start</string><string>--tty=false</string><string>{VM}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>LIMA_HOME</key><string>{home}</string><key>PATH</key><string>{PATH}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
</dict>
</plist>
"#
    )
}

pub struct Lima {
    limactl: PathBuf,
    /// `LIMA_HOME`. Short and with no space, since Lima keeps sockets in it.
    home: PathBuf,
    agent: PathBuf,
}

impl Lima {
    pub fn of(app: &AppHandle) -> Option<Self> {
        let user = app.path().home_dir().ok()?;
        Some(Self {
            limactl: app.path().resource_dir().ok()?.join("lima/bin/limactl"),
            home: user.join(".botdot"),
            agent: user.join("Library/LaunchAgents").join(format!("{AGENT}.plist")),
        })
    }

    fn limactl(&self) -> Command {
        let mut command = Command::new(&self.limactl);
        command.env("LIMA_HOME", &self.home).env("PATH", PATH).stdin(Stdio::null());
        command
    }

    /// The VM's share of this Mac, or `None` when it is too small.
    pub fn size(&self) -> Option<Size> {
        let user = self.home.parent()?;
        sized(u32::try_from(sysctl("hw.ncpu")?).ok()?, sysctl("hw.memsize")? >> 30, free_gib(user)?)
    }

    /// The Mac needs nothing before its VM: Lima comes with the app.
    pub fn prepare(&self, _said: impl FnMut(&str)) -> Result<bool, Vec<String>> {
        Ok(true)
    }

    fn exists(&self) -> bool {
        self.home.join(VM).join("lima.yaml").exists()
    }

    fn start(&self, size: &Size, port: u16, said: &mut impl FnMut(&str)) -> Result<(), Vec<String>> {
        let mut command = self.limactl();
        command.args(["start", "--tty=false"]);
        if self.exists() {
            command.arg(VM);
        } else {
            let share = [format!("--cpus={}", size.cpus), format!("--memory={}", size.memory_gib), format!("--disk={}", size.disk_gib)];
            command.args([&format!("--name={VM}"), "--vm-type=vz", "--mount-none", "--containerd=none"]).args(share).arg("--set").arg(port_forwards(port)).arg("template:ubuntu-24.04");
        }
        run(command, said).map(|_| ())
    }

    /// The VM, its launch agent and botdot in it, from nothing or from where a setup stopped. A rerun of the installer
    /// keeps the account and its passkey.
    pub fn set_up(&self, size: &Size, port: u16, mut said: impl FnMut(&str)) -> Result<Installed, Vec<String>> {
        fs::create_dir_all(&self.home).map_err(|e| vec![e.to_string()])?;
        self.start(size, port, &mut said)?;
        self.keep_agent().map_err(|e| vec![e.to_string()])?;
        let mut command = self.limactl();
        command.args(["shell", "--workdir", "/", VM, "sudo", "sh", "-c"]).arg(install_script(port));
        run(command, &mut said)?.ok_or_else(|| vec!["The installer ended without its last line.".to_string()])
    }

    /// The launch agent, also after the app moved. An agent that is there and right stays as it is.
    pub fn keep_agent(&self) -> std::io::Result<()> {
        let plist = agent_plist(&self.limactl, &self.home);
        if fs::read_to_string(&self.agent).is_ok_and(|kept| kept == plist) {
            return Ok(());
        }
        self.stop_agent();
        fs::create_dir_all(self.agent.parent().unwrap_or(Path::new("/")))?;
        fs::write(&self.agent, plist)?;
        let domain = gui_domain()?;
        Command::new("/bin/launchctl").args(["bootstrap", &domain]).arg(&self.agent).status().map(|_| ())
    }

    // The VM goes on running without its agent (#880).
    fn stop_agent(&self) {
        if let Ok(domain) = gui_domain() {
            let _ = Command::new("/bin/launchctl").args(["bootout", &format!("{domain}/{AGENT}")]).stderr(Stdio::null()).status();
        }
    }

    /// Starts the VM when it isn't running, as the agent would, and returns once it is.
    pub fn wake(&self) -> bool {
        self.limactl().args(["start", "--tty=false", VM]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|status| status.success())
    }

    /// Asks root's step for an update, as the admin page does on a server (ADR 136).
    pub fn update(&self) -> bool {
        self.limactl().args(["shell", "--workdir", "/", VM, "sudo", "touch", "/var/lib/botdot/front-door/requests/UPDATE"]).status().is_ok_and(|status| status.success())
    }

    /// The agent, the VM and all of the Lima home.
    pub fn remove(&self) -> bool {
        self.stop_agent();
        let _ = fs::remove_file(&self.agent);
        let gone = !self.exists() || self.limactl().args(["delete", "--force", VM]).status().is_ok_and(|status| status.success());
        gone && fs::remove_dir_all(&self.home).is_ok()
    }
}

fn gui_domain() -> std::io::Result<String> {
    let id = Command::new("/usr/bin/id").arg("-u").output()?.stdout;
    Ok(format!("gui/{}", String::from_utf8_lossy(&id).trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_vm_takes_a_share_of_the_mac_and_a_small_mac_gets_none() {
        assert_eq!(sized(10, 24, 400), Some(Size { cpus: 5, memory_gib: 8, disk_gib: 200 }));
        assert_eq!(sized(4, 16, 100), Some(Size { cpus: 2, memory_gib: 8, disk_gib: 60 }));
        assert_eq!(sized(32, 128, 2000), Some(Size { cpus: 8, memory_gib: 16, disk_gib: 200 }));
        assert_eq!(sized(8, 8, 400), None, "the account alone takes 5 GiB");
        assert_eq!(sized(8, 24, 30), None);
    }

    #[test]
    fn only_the_two_ports_reach_the_mac() {
        assert_eq!(port_forwards(4700), r#".portForwards=[{"guestPort":4700,"hostIP":"127.0.0.1"},{"guestPort":4701,"hostIP":"127.0.0.1"},{"guestPortRange":[1,65535],"ignore":true}]"#);
    }

    #[test]
    fn the_agent_starts_the_apps_own_vm_at_login() {
        let plist = agent_plist(Path::new("/Applications/a&b.app/Contents/Resources/lima/bin/limactl"), Path::new("/Users/me/.botdot"));
        assert!(plist.contains("<string>/Applications/a&amp;b.app/Contents/Resources/lima/bin/limactl</string><string>start</string><string>--tty=false</string><string>botdot</string>"));
        assert!(plist.contains("<key>LIMA_HOME</key><string>/Users/me/.botdot</string>"));
        assert!(plist.contains("<key>RunAtLoad</key><true/>"));
    }
}
