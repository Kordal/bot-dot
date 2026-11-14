import Foundation
import Security
import BotdotShared

/// The front door's session for each botdot address (Session.Keep): in the Keychain, readable only while the phone is
/// unlocked and never leaving this device (no backup, no iCloud Keychain). One item per address, so several addresses
/// keep a session each, as on Android.
final class KeychainSessions: NSObject, SessionKeep {
    let service: String

    init(service: String = "app.botdot.session") {
        self.service = service
    }

    func read(server: String) -> String? {
        var query = item(server)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(server: String, token: String?) {
        SecItemDelete(item(server) as CFDictionary)
        guard let token else { return }
        var add = item(server)
        add[kSecValueData] = Data(token.utf8)
        add[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    private func item(_ server: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: server]
    }
}

/// The sign-in waiting for the browser (BrowserSignIn.Keep): its secret, until the sheet comes back.
final class WaitingSignIn: NSObject, BrowserSignInKeep {
    private let key = "app.botdot.sign-in"

    func read() -> String? { UserDefaults.standard.string(forKey: key) }

    func write(value: String?) { UserDefaults.standard.set(value, forKey: key) }
}
