// The commands are named here, so that only a capability can reach them: the window's page, which comes from the
// front door, has none (ADR 137).
fn main() {
    // `local`: the systems that run botdot on the computer itself, in a VM of its own on the Mac and Windows (ADR 136)
    // and with none on Linux (ADR 170).
    println!("cargo::rustc-check-cfg=cfg(local)");
    if matches!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos" | "windows" | "linux")) {
        println!("cargo::rustc-cfg=local");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["start", "connect", "run_here"])))
        .expect("the app's manifest");
}
