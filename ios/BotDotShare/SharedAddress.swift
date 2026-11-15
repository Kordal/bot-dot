import Foundation

/// The botdot address this phone is signed in to, kept in the App Group for the share extension (#1373), which can't
/// read the app's own settings. An address only: the session stays in the Keychain group they share.
enum SharedAddress {
    private static let key = "app.botdot.share.server"
    private static var group: UserDefaults? { UserDefaults(suiteName: "group.app.botdot") }

    static func read() -> String? { group?.string(forKey: key) }

    private static let noticeKey = "app.botdot.ai-notice"

    /// The notice that what is sent goes to Anthropic was accepted on this phone, in the app or a share (AiNotice).
    static var noticeSeen: Bool {
        get { group?.bool(forKey: noticeKey) ?? false }
        set { group?.set(newValue, forKey: noticeKey) }
    }

    /// The address signed in to, or nil once none is (another address, a sign-out): a share then asks to sign in.
    static func write(_ server: String?) {
        if let server { group?.set(server, forKey: key) } else { group?.removeObject(forKey: key) }
    }
}
