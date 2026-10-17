import Foundation
import Testing
@testable import BotDotKit

@Suite struct SignedReleases {
    @Test func sharedFixtureRejectsTamperingRollbackAndWrongApp() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        struct Vectors: Decodable { let publicKey: String; let valid: ReleaseManifest }
        let v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/release-signing/vectors.json")))
        #expect(!ReleaseTrust.key.isEmpty)
        #expect(ReleaseTrust.key != v.publicKey)
        #expect(throws: ConnectError.self) { try v.valid.verify(app: "mac", installed: 41) }
        try v.valid.verify(app: "mac", installed: 41, key: v.publicKey)
        #expect(throws: ConnectError.self) { try v.valid.verify(app: "mac", installed: 43, key: v.publicKey) }
        #expect(throws: ConnectError.self) { try v.valid.verify(app: "android", installed: 41, key: v.publicKey) }
        var changed = v.valid
        changed.sha256 = String(repeating: "0", count: 64)
        #expect(throws: ConnectError.self) { try changed.verify(app: "mac", installed: 41, key: v.publicKey) }
        changed = v.valid
        changed.signature = Data(repeating: 0, count: 70).base64EncodedString()
        #expect(throws: ConnectError.self) { try changed.verify(app: "mac", installed: 41, key: v.publicKey) }
    }
    @Test func updateTransport() throws {
        for value in ["https://example.com", "http://127.0.0.1:4747", "http://[::1]:4747"] { #expect(ReleaseManifest.secureURL(try #require(URL(string: value)))) }
        for value in ["http://example.com", "http://127.0.0.1.evil.example", "http://10.0.0.1"] { #expect(!ReleaseManifest.secureURL(try #require(URL(string: value)))) }
    }
}
