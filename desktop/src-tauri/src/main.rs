// The desktop app's start: the app itself is the library (lib.rs). No console on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    botdot_lib::run()
}
