import Foundation
import Security

/// The key this iPhone's notifications are sealed with (ADR 150): 32 random bytes the app makes once and gives its
/// botdot with the device token, kept in the Keychain group the app shares with its notification extension. It never
/// leaves the device otherwise (no backup, no iCloud Keychain), and is readable after the first unlock, so a push that
/// comes while the phone is locked still shows its text.
enum PushKey {
    static let service = "app.botdot.push"
    static let account = "seal-key"

    /// The key, or nil before the app made one.
    static func read() -> Data? {
        var query = item()
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess, let data = found as? Data, data.count == 32 else { return nil }
        return data
    }

    /// The key, made now when there is none yet. nil when the Keychain refused it.
    static func readOrMake() -> Data? {
        if let key = read() { return key }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        var add = item()
        add[kSecValueData] = Data(bytes)
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemDelete(item() as CFDictionary)
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { return nil }
        return read()
    }

    // No access group named: an item goes to the first of the target's `keychain-access-groups`, the one the app and
    // the extension share (project.yml).
    private static func item() -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }
}
