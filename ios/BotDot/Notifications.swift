import Foundation
import UIKit
import UserNotifications
import BotdotShared

/// What iOS hands the app alone: its device token, and a notification's tap or button, also while the app is closed.
/// The app's model lives here, so a button pressed on a locked phone reaches the botdot it is signed in to.
final class AppDelegate: NSObject, UIApplicationDelegate {
    let model = AppModel()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.model = model
        UNUserNotificationCenter.current().delegate = Notifications.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Notifications.shared.registered(token: hex)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // No token (no Apple account on this build, or no network): nothing rings, and the app works as before.
        Notifications.shared.registered(token: nil)
    }
}

/// This iPhone's notifications (ADR 150, docs/api.md "Notifications on this device"): it asks for the permission once
/// its botdot sends to iPhones, registers its token and its key there, clears what was delivered when the app opens,
/// and hands a tap or a button to the shared layer (PushNotices), which says what it opens and what it sends.
@MainActor
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    weak var model: AppModel?
    /// The APNs device token in hex, once iOS gave it.
    private(set) var token: String?
    /// The botdot the token goes to: the one Home shows.
    private var api: Api?

    /// Home of a botdot appeared: from one that sends to iPhones (`apns-push`), the permission is asked (once: iOS
    /// remembers the answer) and the phone registers.
    func start(_ api: Api) async {
        self.api = api
        guard let features = try? await api.version().features, PushNotices.shared.sendsToPhones(features: features) else { return }
        guard (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        if token != nil { await send() } // another botdot, the same token
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// The token iOS gave (it may change, so it is sent on every start), or nil when it gave none.
    func registered(token: String?) {
        self.token = token
        Task { await send() }
    }

    private func send() async {
        guard let token, let api, let key = PushKey.readOrMake() else { return }
        let environment = PushNotices.shared.environment(fromXcode: Self.fromXcode)
        try? await api.addApnsDevice(token: token, key: Seal.base64url(key), environment: environment, device: UIDevice.current.model)
    }

    /// Signing out of [api]'s botdot: it sends this phone nothing more.
    func signOut(_ api: Api) async {
        if let token { try? await api.removeApnsDevice(token: token) }
        if self.api === api { self.api = nil }
    }

    /// A build from Xcode has a token of Apple's development environment; TestFlight and the App Store, production.
    static var fromXcode: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    /// The app is in front: what it delivered is seen here now. iOS can't take back a delivered notification by a push
    /// (ADR 150), so they all go when the app opens.
    func appOpened() {
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.setBadgeCount(0)
    }

    // ---------- UNUserNotificationCenterDelegate ----------

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound] // the server rings nothing for a chat on screen, so what comes now is news
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let content = response.notification.request.content
        let tapped = Tapped(
            action: response.actionIdentifier,
            target: content.userInfo["target"] as? String,
            tag: content.userInfo["tag"] as? String,
            thread: content.threadIdentifier,
            title: content.title,
            text: (response as? UNTextInputNotificationResponse)?.userText
        )
        await handle(tapped)
    }

    /// What was tapped, as plain values (a response is not Sendable).
    struct Tapped: Sendable {
        let action: String
        let target: String?
        let tag: String?
        let thread: String
        let title: String
        let text: String?
    }

    func handle(_ t: Tapped) async {
        switch t.action {
        case UNNotificationDefaultActionIdentifier:
            model?.open(PushNotices.shared.opens(target: t.target, thread: t.thread))
        case PushNotices.shared.REPLY, PushNotices.shared.YES, PushNotices.shared.NO:
            await answer(t)
        default:
            break // dismissed
        }
    }

    /// Reply, Approve or Decline, sent to the botdot this phone is set to. One that fails says so in its place.
    private func answer(_ t: Tapped) async {
        guard let tag = t.tag, let api = await model?.apiNow() else { return say(tr("Not connected to botdot"), t) }
        do {
            if t.action == PushNotices.shared.REPLY {
                let text = (t.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return }
                try await PushNotices.shared.reply(api: api, chat: tag, text: text, key: UUID().uuidString.lowercased())
            } else {
                try await PushNotices.shared.answer(api: api, tag: tag, yes: t.action == PushNotices.shared.YES)
            }
        } catch {
            say(tr("That didn't work: {why}", ["why": error.localizedDescription]), t)
        }
    }

    /// A notification of its own in the same thread: why an answer from a notification did not go.
    private func say(_ words: String, _ t: Tapped) {
        let content = UNMutableNotificationContent()
        content.title = t.title
        content.body = words
        content.threadIdentifier = t.thread
        content.userInfo = ["target": t.target ?? t.thread]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "failed:\(t.tag ?? t.thread)", content: content, trigger: nil))
    }
}
