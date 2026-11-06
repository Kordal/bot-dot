// The desktop app's start: the app itself is the library (lib.rs), which the iOS app starts too. No console on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    botdot_lib::run()
}
