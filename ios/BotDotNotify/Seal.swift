import CryptoKit
import Foundation
import UserNotifications

/// A notification as botdot sealed it for this iPhone (docs/api.md "Notifications on this device", ADR 150): base64url
/// of a version byte (1), a 12-byte nonce, the AES-256-GCM ciphertext of the JSON and its 16-byte tag, the version byte
/// as the additional data. Only this device's key opens it; the relay and Apple carry it without reading it.
///
/// The extension opens it here, in Swift, and does not link the shared data layer: a Notification Service Extension
/// runs in a few MB for each push, and what it does is iOS plumbing (CryptoKit, the Keychain) and drawing what the
/// server decided, the text and the buttons. What a tap or a button then does is the shared layer's, in the app.
enum Seal {
    static let version: UInt8 = 1

    enum Failure: Error { case notBase64, notThisVersion, notOpened }

    /// The JSON inside [sealed], opened with [key] (32 bytes).
    static func open(_ sealed: String, key: Data) throws -> Data {
        guard let bytes = base64url(sealed) else { throw Failure.notBase64 }
        guard bytes.count >= 1 + 12 + 16, bytes.first == version else { throw Failure.notThisVersion }
        let b = [UInt8](bytes)
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: b[1..<13]), ciphertext: b[13..<(b.count - 16)], tag: b[(b.count - 16)...])
            return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: b[0..<1])
        } catch {
            throw Failure.notOpened
        }
    }

    /// Bytes of base64url (or base64) text, with or without its padding.
    static func base64url(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "="))
        s += String(repeating: "=", count: (4 - s.count % 4) % 4)
        return Data(base64Encoded: s)
    }

    /// base64url of [data], without padding: how the app hands its key to its botdot.
    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: CharacterSet(charactersIn: "="))
    }
}

/// What a seal holds: `{ title, body, target, tag, buttons }`. `buttons` is what the server says this notification
/// offers, each a label in the account's language: `reply` on a chat's, `no` and `yes` on a card's.
struct PushPayload: Decodable, Equatable {
    struct Buttons: Decodable, Equatable {
        var reply: String?
        var no: String?
        var yes: String?
    }

    var title: String
    var body: String
    var target: String?
    var tag: String?
    var buttons: Buttons?

    static func of(_ json: Data) throws -> PushPayload {
        try JSONDecoder().decode(PushPayload.self, from: json)
    }

    /// The category its buttons make, named by them (so the same buttons are one category); nil without buttons.
    /// The ids are the server's: `reply`, `no`, `yes` (PushNotices in the shared layer reads them back).
    var category: UNNotificationCategory? {
        guard let b = buttons else { return nil }
        var actions: [UNNotificationAction] = []
        // Every answer waits for the phone's unlock, as on Android: a reply and an OK are the owner's.
        if let reply = b.reply, !reply.isEmpty {
            actions.append(UNTextInputNotificationAction(identifier: "reply", title: reply, options: [.authenticationRequired], textInputButtonTitle: reply, textInputPlaceholder: ""))
        } else {
            if let no = b.no, !no.isEmpty { actions.append(UNNotificationAction(identifier: "no", title: no, options: [.authenticationRequired, .destructive])) }
            if let yes = b.yes, !yes.isEmpty { actions.append(UNNotificationAction(identifier: "yes", title: yes, options: [.authenticationRequired])) }
        }
        guard !actions.isEmpty else { return nil }
        let id = "botdot." + actions.map { "\($0.identifier)=\($0.title)" }.joined(separator: "|")
        return UNNotificationCategory(identifier: id, actions: actions, intentIdentifiers: [], options: [])
    }
}

extension PushPayload {
    /// [content] with botdot's own words and what it says of itself, or nil when its seal can't be opened here. The
    /// app reads `target` and `tag` back when it is tapped or a button is.
    static func opened(_ content: UNNotificationContent, key: Data? = PushKey.read()) -> (UNMutableNotificationContent, PushPayload)? {
        guard let sealed = content.userInfo["sealed"] as? String, let key,
              let json = try? Seal.open(sealed, key: key), let payload = try? PushPayload.of(json),
              let out = content.mutableCopy() as? UNMutableNotificationContent else { return nil }
        out.title = payload.title
        out.body = payload.body
        if let target = payload.target, !target.isEmpty { out.threadIdentifier = target }
        var info = out.userInfo
        info.removeValue(forKey: "sealed")
        info["target"] = payload.target
        info["tag"] = payload.tag
        out.userInfo = info
        return (out, payload)
    }
}
