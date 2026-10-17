import Foundation
import CryptoKit
import Security

/// The app's sessions with front doors (ADR 028, docs/api.md "The front door"): the secret of the cookie
/// `botdot_session`, one per botdot address, kept until it is signed out. Every request to that address carries it
/// (API.request), the live feed, files and a bot's screen too; a new one arrives with a sign-in's `Set-Cookie`, and
/// a cleared one with a sign-out's. When the front door answers `401` with `signIn`, the session has ended (signed
/// out everywhere, from here or elsewhere): it is forgotten, and `ended` names the address.
public final class Sessions: @unchecked Sendable {
    public static let cookie = "botdot_session"
    let keep: SecretStore
    private let lock = NSLock()
    private var onEnded: (@Sendable (String) -> Void)?

    /// `keep`: where the secrets are kept; memory unless the app hands its own file (`onThisMac`).
    public init(keep: SecretStore = MemorySecrets()) { self.keep = keep }

    /// The app's own keeping: a file only you can read, in the app's folder of Application Support. Not the
    /// Keychain, for the reason FileSecrets says.
    public static func onThisMac() -> Sessions {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("dev.botdot.mac", isDirectory: true)
        return Sessions(keep: FileSecrets(file: dir.appendingPathComponent("sessions.json")))
    }

    /// "http://localhost:4747", "https://my-vm.ts.net": what a session belongs to.
    public static func origin(of url: URL) -> String {
        let scheme = url.scheme?.lowercased() ?? "https"
        let host = url.host()?.lowercased() ?? ""
        let port = url.port.flatMap { ($0 == 443 && scheme == "https") || ($0 == 80 && scheme == "http") ? nil : $0 }
        return "\(scheme)://\(host)" + (port.map { ":\($0)" } ?? "")
    }

    public func token(for url: URL) -> String? { keep.get(Self.origin(of: url)) }

    func set(_ token: String?, for url: URL) {
        let origin = Self.origin(of: url)
        if let token { keep.set(origin, token) } else { keep.delete(origin) }
    }

    /// Called with the address whose session ended (Store shows the sign-in again).
    func whenEnded(_ f: @escaping @Sendable (String) -> Void) { lock.withLock { onEnded = f } }

    /// The session's cookie on a request to its address, and none of URLSession's own: the session is kept here.
    /// Returns the secret it sent.
    @discardableResult
    func authorize(_ req: inout URLRequest) -> String? {
        req.httpShouldHandleCookies = false
        guard let url = req.url, let token = token(for: url) else { return nil }
        req.setValue("\(Self.cookie)=\(token)", forHTTPHeaderField: "Cookie")
        return token
    }

    /// The session's cookie for what loads by itself (a bot's screen in a web view).
    public func httpCookie(for url: URL) -> HTTPCookie? {
        guard let token = token(for: url), let host = url.host() else { return nil }
        return HTTPCookie(properties: [.domain: host, .path: "/", .name: Self.cookie, .value: token, .expires: Date().addingTimeInterval(400 * 86400)])
    }

    /// What came back to a request that carried `sent`: a `Set-Cookie` of the session keeps or clears it; a `401`
    /// with `signIn` ends the session it carried (not one a sign-in brought meanwhile).
    func took(_ response: URLResponse?, body: Data?, sent: String?) {
        guard let http = response as? HTTPURLResponse, let url = http.url else { return }
        if let header = http.value(forHTTPHeaderField: "Set-Cookie"), let range = header.range(of: "\(Self.cookie)=") {
            let rest = header[range.upperBound...]
            let value = String(rest.prefix { $0 != ";" && $0 != "," })
            let cleared = value.isEmpty || rest.lowercased().replacingOccurrences(of: " ", with: "").contains("max-age=0")
            set(cleared ? nil : value, for: url)
            if cleared { ended(url) }
        }
        if http.statusCode == 401, Self.asksForSignIn(body), token(for: url) == sent {
            set(nil, for: url)
            ended(url)
        }
    }

    private func ended(_ url: URL) {
        let f = lock.withLock { onEnded }
        f?(Self.origin(of: url))
    }

    /// The front door's answer to a request without a session: `{ "error": …, "signIn": "/sign-in" }`.
    static func asksForSignIn(_ body: Data?) -> Bool {
        guard let body, let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return false }
        return json["signIn"] != nil
    }
}

/// The Mac app signs in on the front door's own page, in a browser sheet (ASWebAuthenticationSession), which
/// sends the sheet to `botdot://signed-in?code=…`. The app keeps a secret (`verifier`) and gives the page only its
/// SHA-256 (`challenge`); the code and the secret together get the app its session (`Store.signIn`), so a code
/// seen by anything else signs nobody in.
public struct Handoff: Sendable {
    public static let callbackScheme = "botdot"
    public let verifier: String

    public init() {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        verifier = Self.base64url(Data(bytes))
    }

    public var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    /// The page the sheet opens: the sign-in page, or with a local botdot server's setup key, the page that makes
    /// its one account's passkey.
    public func page(at base: URL, setupKey: String? = nil) -> URL {
        let path = setupKey.map { "sign-up/\($0)" } ?? "sign-in"
        var c = URLComponents(url: URL(string: path, relativeTo: base.appendingPathComponent("/"))!.absoluteURL, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "app", value: "mac"), URLQueryItem(name: "handoff", value: challenge)]
        return c.url!
    }

    /// The code in the address the sheet ended at.
    public static func code(in callback: URL) -> String? {
        guard callback.scheme == callbackScheme, callback.host() == "signed-in" else { return nil }
        return URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "code" }?.value
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
