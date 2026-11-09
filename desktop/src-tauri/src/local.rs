//! botdot on this computer (ADR 136): the real installer with `BOT_DOT_REACH=local`. On the Mac in a Lima VM of its own,
//! made with the Lima in the app's bundle; on Windows in a WSL2 distribution of its own, and neither touches the owner's
//! other VMs. On Linux on the computer itself, with no VM (ADR 170).

use serde::Deserialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;

#[cfg(target_os = "macos")]
mod lima;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod wsl;
#[cfg(target_os = "macos")]
pub use lima::Lima as Vm;
#[cfg(target_os = "linux")]
pub use linux::Host as Vm;
#[cfg(windows)]
pub use wsl::Wsl as Vm;

/// The VM's name: the Lima instance, or the WSL distribution.
#[cfg(any(target_os = "macos", windows))]
const VM: &str = "botdot";
const FIRST_PORT: u16 = 4700;
/// The lines a failure shows.
const LAST_LINES: usize = 12;
/// The source the installer runs from: a test build can name its branch.
const SOURCE: &str = match option_env!("BOT_DOT_SOURCE_REF") {
    Some(reference) => reference,
    None => "main",
};

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

// The script run as root, in the VM or on Linux on the computer. The installer's questions are answered yes, as a
// person would: it has no terminal. `answers`: the installer's answers besides the port, each followed by a space.
fn install_script(port: u16, answers: &str) -> String {
    format!(
        "set -e\n\
         rm -rf /var/tmp/botdot-source\n\
         git clone --quiet --depth 1 --branch {SOURCE} https://github.com/Kordal/bot-dot.git /var/tmp/botdot-source\n\
         yes y | NEEDRESTART_MODE=a DEBIAN_FRONTEND=noninteractive BOT_DOT_REACH=local {answers}BOT_DOT_PORT={port} sh /var/tmp/botdot-source/install.sh\n\
         rm -rf /var/tmp/botdot-source\n"
    )
}

/// The first of two free ports in a row on this computer's localhost, from 4700.
pub fn free_port() -> u16 {
    let free = |port: u16| TcpListener::bind(("127.0.0.1", port)).is_ok();
    (FIRST_PORT..).step_by(10).find(|port| free(*port) && free(port + 1)).unwrap_or(FIRST_PORT)
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
    fn the_installer_runs_with_the_local_answer_and_no_questions() {
        let script = install_script(4710, "");
        assert!(script.contains("yes y | "));
        assert!(script.contains("BOT_DOT_REACH=local BOT_DOT_PORT=4710 sh /var/tmp/botdot-source/install.sh"));
    }

    #[test]
    fn a_taken_port_is_passed_over() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        assert_ne!(free_port(), held.local_addr().unwrap().port());
    }

    #[cfg(unix)]
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
