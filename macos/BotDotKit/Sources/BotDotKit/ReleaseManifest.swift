import Foundation
import CryptoKit

enum ReleaseTrust {
    // P-256 SPKI DER, base64. Production release key, pinned 2026-10-17.
    static let key = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdDU16CG2HWzALPBB5pDx5BQHKTrcfdHF4t90R++nTnsMvIQKGQq/o26wIF0w0o6OEt4RoPi+Sf2rJsZmz3vvng=="
}

public struct ReleaseManifest: Decodable, Sendable {
    public var app: String
    public var version: Int
    public var revision: String
    public var file: String
    public var sha256: String
    public var signature: String

    func verify(app expected: String, installed: Int, key: String = ReleaseTrust.key) throws {
        let matches = { (value: String, pattern: String) in value.range(of: pattern, options: .regularExpression) != nil }
        guard app == expected, version > 0, version <= 9_007_199_254_740_991,
              matches(revision, "^[0-9a-f]{40}$"), matches(file, "^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$"),
              matches(sha256, "^[0-9a-f]{64}$") else { throw ConnectError(message: "Invalid release manifest.") }
        guard version >= installed else { throw ConnectError(message: "An older release cannot be installed.") }
        guard let der = Data(base64Encoded: key), !der.isEmpty,
              let publicKey = try? P256.Signing.PublicKey(derRepresentation: der),
              let sig = Data(base64Encoded: signature), let signature = try? P256.Signing.ECDSASignature(derRepresentation: sig),
              publicKey.isValidSignature(signature, for: Data("botdot-release-v1\n\(app)\n\(version)\n\(revision)\n\(file)\n\(sha256)\n".utf8))
        else { throw ConnectError(message: "The release signature is invalid or no release key is pinned.") }
    }

    static func secureURL(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return false }
        if url.scheme == "https" { return true }
        let parts = host.split(separator: ".")
        let v4 = parts.count == 4 && parts.first == "127" && parts.allSatisfy { UInt8($0) != nil }
        return url.scheme == "http" && (host == "localhost" || host == "::1" || host == "[::1]" || v4)
    }
}

// A signed archive may come only from the selected server, without a downgrade redirect.
final class RejectUpdateRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
