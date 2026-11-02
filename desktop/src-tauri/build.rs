// The commands are named here, so that only a capability can reach them: the window's page, which comes from the
// front door, has none (ADR 137).
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["start", "connect"])))
        .expect("the app's manifest");
}
