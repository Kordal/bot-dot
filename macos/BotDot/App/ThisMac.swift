import AppKit
import ServiceManagement
import BotDotKit

/// What this Mac does for botdot beyond the window: open at login (hidden, with only the menu-bar
/// dot), and stay awake while botdot runs here.
@MainActor
@Observable
final class ThisMac {
    private var activity: NSObjectProtocol?

    /// Keep the Mac from sleeping while botdot runs on it (off by default).
    var keepAwake = UserDefaults.standard.bool(forKey: "botdot.keepAwake") {
        didSet { UserDefaults.standard.set(keepAwake, forKey: "botdot.keepAwake"); apply() }
    }

    /// In macOS Login Items too.
    var openAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            do { if newValue { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
            catch { problem = error.localizedDescription }
            changed += 1
        }
    }
    /// Makes views read `openAtLogin` again after a change.
    private(set) var changed = 0
    var problem: String?

    /// Holds the no-sleep assertion while botdot runs here and the owner wants it.
    func apply() {
        let want = keepAwake && SavedServer.isLocal
        if want, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled], reason: "botdot runs on this Mac")
        } else if !want, let a = activity {
            ProcessInfo.processInfo.endActivity(a)
            activity = nil
        }
    }

    var holdsAwake: Bool { activity != nil }
}

/// Opened at login: no window and no Dock icon, only the menu-bar dot, until the owner opens botdot.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var atLogin = false
    /// Tells the botdot server that no chat is on screen any more (new replies, ADR 005).
    var leave: (@MainActor @Sendable () async -> Void)?

    /// Quitting while a chat is in front: say so first, so a reply right after is new. A second at most.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let leave else { return .terminateNow }
        Task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await leave() }
                group.addTask { try? await Task.sleep(for: .seconds(1)) }
                await group.next()
                group.cancelAll()
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        atLogin = event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
        if atLogin { NSApp.setActivationPolicy(.accessory) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if atLogin { NSApp.hide(nil) }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        if NSApp.activationPolicy() != .regular { NSApp.setActivationPolicy(.regular) }
    }
}
