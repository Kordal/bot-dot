import Foundation
import CryptoKit
import Testing
@testable import BotDotKit

/// botdot hands out the newest Mac app (mac-app/ in its image); the app finds it, downloads it,
/// checks it and unpacks it before swapping itself for it.
@MainActor
@Suite struct MacAppUpdate {
    let signingKey = P256.Signing.PrivateKey()
    var publicKey: String { signingKey.publicKey.derRepresentation.base64EncodedString() }

    /// A mac-app folder like CI's: a zipped botdot.app and app.json with its build number and sha256.
    func macAppDir(build: Int, sha: String? = nil, bundleId: String = "dev.botdot.mac", claims: Int? = nil) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-macapp-\(UUID().uuidString)")
        let app = dir.appendingPathComponent("stage/botdot.app/Contents")
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        try #"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>\#(bundleId)</string><key>CFBundleVersion</key><string>\#(build)</string></dict></plist>"#.write(to: app.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
        let zip = dir.appendingPathComponent("botdot-1.0.\(build)-mac.zip")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["-c", "-k", "--keepParent", dir.appendingPathComponent("stage/botdot.app").path, zip.path]
        try p.run()
        p.waitUntilExit()
        let digest = SHA256.hash(data: try Data(contentsOf: zip)).map { String(format: "%02x", $0) }.joined()
        let version = claims ?? build
        let hash = sha ?? digest
        let revision = String(repeating: "1", count: 40)
        let canonical = "botdot-release-v1\nmac\n\(version)\n\(revision)\n\(zip.lastPathComponent)\n\(hash)\n"
        let signature = try signingKey.signature(for: Data(canonical.utf8)).derRepresentation.base64EncodedString()
        let manifest: [String: Any] = ["app": "mac", "version": version, "revision": revision, "file": zip.lastPathComponent, "sha256": hash, "signature": signature]
        let json: [String: Any] = ["versionName": "1.0.\(build)", "versionCode": version, "file": zip.lastPathComponent, "sha256": hash, "release": manifest]
        try JSONSerialization.data(withJSONObject: json).write(to: dir.appendingPathComponent("app.json"))
        return dir
    }

    @Test func aNewerAppIsDownloadedCheckedAndUnpacked() async throws {
        let server = try TestServer(env: ["BOT_DOT_MAC_DIR": try macAppDir(build: 42).path])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(await store.newerMacApp(than: 42) == nil)
        let build = try #require(await store.newerMacApp(than: 41))
        #expect(build.versionName == "1.0.42")
        let app = try await store.downloadMacApp(build, installed: 1, key: publicKey)
        #expect(app.lastPathComponent == "botdot.app")
        #expect(try String(contentsOf: app.appendingPathComponent("Contents/Info.plist"), encoding: .utf8).contains("<string>42</string>"))
    }

    /// A build of your own has build number 0 (project.yml): whatever the image carries is older work.
    @Test func aBuildOfYourOwnIsNeverOfferedTheImagesApp() async throws {
        let server = try TestServer(env: ["BOT_DOT_MAC_DIR": try macAppDir(build: 42).path])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(await store.newerMacApp(than: 0) == nil)
        #expect(await store.newerMacApp(than: 1) != nil)
    }

    @Test func aDamagedDownloadIsRefused() async throws {
        let server = try TestServer(env: ["BOT_DOT_MAC_DIR": try macAppDir(build: 7, sha: String(repeating: "0", count: 64)).path])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let build = try #require(await store.newerMacApp(than: 1))
        await #expect(throws: ConnectError.self) { try await store.downloadMacApp(build, installed: 1, key: publicKey) }
    }

    @Test func anotherAppOrAnotherBuildIsRefused() async throws {
        for dir in [try macAppDir(build: 9, bundleId: "com.example.other"), try macAppDir(build: 3, claims: 9)] {
            let server = try TestServer(env: ["BOT_DOT_MAC_DIR": dir.path])
            let store = Store()
            try await store.connect(to: server.base.absoluteString)
            let build = try #require(await store.newerMacApp(than: 1))
            await #expect(throws: ConnectError.self) { try await store.downloadMacApp(build, installed: 1, key: publicKey) }
        }
    }
}
