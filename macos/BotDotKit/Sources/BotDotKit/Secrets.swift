import Foundation
import Security

/// Where the app keeps its secrets: the registry token, a local botdot server's setup key, and the
/// sessions with front doors.
public protocol SecretStore: Sendable {
    func get(_ name: String) -> String?
    func set(_ name: String, _ value: String)
    func delete(_ name: String)
}

/// A private file (only this user can read it) in the install folder, next to .env, which holds
/// the same secrets for Docker. Not the Keychain: the app is signed ad hoc until it has a developer
/// account, so every update would look like another app and make macOS ask for the Mac's password.
public struct FileSecrets: SecretStore {
    let file: URL
    public init(file: URL) { self.file = file }

    private func all() -> [String: String] {
        guard let data = try? Data(contentsOf: file) else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    private func save(_ values: [String: String]) {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(values) else { return }
        FileManager.default.createFile(atPath: file.path, contents: data, attributes: [.posixPermissions: 0o600])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    public func get(_ name: String) -> String? { all()[name] }
    public func set(_ name: String, _ value: String) { var v = all(); v[name] = value; save(v) }
    public func delete(_ name: String) { var v = all(); v[name] = nil; save(v) }
}

/// The login Keychain, under the app's own service name (for when the app is signed with a
/// developer account; see FileSecrets).
public struct KeychainSecrets: SecretStore {
    let service: String
    public init(service: String = "dev.botdot.mac") { self.service = service }

    private func query(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }

    public func get(_ name: String) -> String? {
        var q = query(name)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ name: String, _ value: String) {
        let data = Data(value.utf8)
        if SecItemUpdate(query(name) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecItemNotFound {
            var q = query(name)
            q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(q as CFDictionary, nil)
        }
    }

    public func delete(_ name: String) { SecItemDelete(query(name) as CFDictionary) }
}

/// Secrets kept in memory only (tests).
public final class MemorySecrets: SecretStore, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()
    public init(_ values: [String: String] = [:]) { self.values = values }
    public func get(_ name: String) -> String? { lock.withLock { values[name] } }
    public func set(_ name: String, _ value: String) { lock.withLock { values[name] = value } }
    public func delete(_ name: String) { lock.withLock { _ = values.removeValue(forKey: name) } }
}
