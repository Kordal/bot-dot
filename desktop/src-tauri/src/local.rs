//! botdot on this Mac (ADR 136): a Linux VM of its own, made with the Lima in the app's bundle, which runs the real
//! installer with `BOT_DOT_REACH=local`. Its Lima home is its own, so other Lima instances are never touched.

use serde::Deserialize;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use tauri::{AppHandle, Manager};

const VM: &str = "botdot";
/// The launch agent that starts the VM at login, and its file's name.
const AGENT: &str = "dev.botdot.vm";
const FIRST_PORT: u16 = 4700;
/// The lines a failure shows.
const LAST_LINES: usize = 12;
/// What the app's Lima may find, whatever the app was started with: no Homebrew.
const PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
/// The source the installer runs from: a test build can name its branch.
const SOURCE: &str = match option_env!("BOT_DOT_SOURCE_REF") {
    Some(reference) => reference,
    None => "main",
};

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

/// What the installer's last line says (ADR 136).
#[derive(Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub origin: String,
    pub sign_up: Option<String>,
}

fn installed(line: &str) -> Option<Installed> {
    serde_json::from_str(line.strip_prefix("BOTDOT_LOCAL ")?).ok()
}

// A line of output as a person reads it: without colours, and of Lima's log only its message.
fn plain(line: &str) -> String {
    let mut text = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            chars.by_ref().find(|c| c.is_ascii_alphabetic());
        } else {
            text.push(c);
        }
    }
    let message = text.split_once(" msg=\"").and_then(|(_, rest)| rest.rsplit_once('"').map(|(message, _)| message.replace("\\\"", "\"")));
    message.unwrap_or(text).trim().to_string()
}

// The script run as root in the VM. The installer's questions are answered yes, as a person would: it has no terminal.
fn install_script(port: u16) -> String {
    format!(
        "set -e\n\
         rm -rf /var/tmp/botdot-source\n\
         git clone --quiet --depth 1 --branch {SOURCE} https://github.com/Kordal/bot-dot.git /var/tmp/botdot-source\n\
         yes y | NEEDRESTART_MODE=a DEBIAN_FRONTEND=noninteractive BOT_DOT_REACH=local BOT_DOT_PORT={port} sh /var/tmp/botdot-source/install.sh\n\
         rm -rf /var/tmp/botdot-source\n"
    )
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

/// The first of two free ports in a row on this Mac's localhost, from 4700.
pub fn free_port() -> u16 {
    let free = |port: u16| TcpListener::bind(("127.0.0.1", port)).is_ok();
    (FIRST_PORT..).step_by(10).find(|port| free(*port) && free(port + 1)).unwrap_or(FIRST_PORT)
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

// Runs a command, says each line of its output, and gives what the installer's last line said, or its last lines when
// it failed. The installer's line holds the setup key, so it is never said.
fn run(mut command: Command, said: &mut impl FnMut(&str)) -> Result<Option<Installed>, Vec<String>> {
    let mut child = command.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| vec![e.to_string()])?;
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let (lines, read) = mpsc::channel();
    let readers: Vec<_> = [out.map(|o| Box::new(o) as Box<dyn Read + Send>), err.map(|e| Box::new(e) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
        .map(|from| {
            let lines = lines.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(from).lines().map_while(Result::ok) {
                    let _ = lines.send(line);
                }
            })
        })
        .collect();
    drop(lines);
    let mut last = VecDeque::new();
    let mut result = None;
    for line in read {
        if let Some(done) = installed(&line) {
            result = Some(done);
            continue;
        }
        let line = plain(&line);
        if line.is_empty() {
            continue;
        }
        said(&line);
        last.push_back(line);
        if last.len() > LAST_LINES {
            last.pop_front();
        }
    }
    for reader in readers {
        let _ = reader.join();
    }
    let status: ExitStatus = child.wait().map_err(|e| vec![e.to_string()])?;
    if status.success() {
        Ok(result)
    } else {
        Err(last.into())
    }
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
    fn the_installers_line_says_the_address_and_the_sign_up() {
        let line = r#"BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/abc"}"#;
        assert_eq!(installed(line), Some(Installed { origin: "http://localhost:4700".into(), sign_up: Some("http://localhost:4700/sign-up/abc".into()) }));
        assert_eq!(installed(r#"BOTDOT_LOCAL {"origin":"http://localhost:4700"}"#).unwrap().sign_up, None);
        assert_eq!(installed("Installing Docker"), None);
    }

    #[test]
    fn a_line_is_shown_plain() {
        assert_eq!(plain("\u{1b}[1mbotdot installer\u{1b}[0m"), "botdot installer");
        assert_eq!(plain(r#"time="2026-11-02T20:11:52+01:00" level=info msg="[hostagent] Waiting for \"ssh\"""#), r#"[hostagent] Waiting for "ssh""#);
        assert_eq!(plain("   "), "");
    }

    #[test]
    fn only_the_two_ports_reach_the_mac() {
        assert_eq!(port_forwards(4700), r#".portForwards=[{"guestPort":4700,"hostIP":"127.0.0.1"},{"guestPort":4701,"hostIP":"127.0.0.1"},{"guestPortRange":[1,65535],"ignore":true}]"#);
    }

    #[test]
    fn the_installer_runs_with_the_local_answer_and_no_questions() {
        let script = install_script(4710);
        assert!(script.contains("yes y | "));
        assert!(script.contains("BOT_DOT_REACH=local BOT_DOT_PORT=4710 sh /var/tmp/botdot-source/install.sh"));
    }

    #[test]
    fn the_agent_starts_the_apps_own_vm_at_login() {
        let plist = agent_plist(Path::new("/Applications/a&b.app/Contents/Resources/lima/bin/limactl"), Path::new("/Users/me/.botdot"));
        assert!(plist.contains("<string>/Applications/a&amp;b.app/Contents/Resources/lima/bin/limactl</string><string>start</string><string>--tty=false</string><string>botdot</string>"));
        assert!(plist.contains("<key>LIMA_HOME</key><string>/Users/me/.botdot</string>"));
        assert!(plist.contains("<key>RunAtLoad</key><true/>"));
    }

    #[test]
    fn a_taken_port_is_passed_over() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        assert_ne!(free_port(), held.local_addr().unwrap().port());
    }

    #[test]
    fn a_failed_command_gives_its_last_lines_and_never_the_setup_key() {
        let mut said = Vec::new();
        let mut failing = Command::new("/bin/sh");
        failing.args(["-c", "echo one; echo two >&2; echo 'BOTDOT_LOCAL {\"origin\":\"http://localhost:4700\",\"signUp\":\"http://localhost:4700/sign-up/key\"}'; exit 3"]);
        let lines = run(failing, &mut |line: &str| said.push(line.to_string())).unwrap_err();
        assert!(lines.contains(&"one".to_string()) && lines.contains(&"two".to_string()));
        assert!(!said.iter().chain(&lines).any(|line| line.contains("key")));

        let mut working = Command::new("/bin/sh");
        working.args(["-c", "echo 'BOTDOT_LOCAL {\"origin\":\"http://localhost:4700\"}'"]);
        assert_eq!(run(working, &mut |_: &str| {}).unwrap().unwrap().origin, "http://localhost:4700");
    }
}
