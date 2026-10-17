import Foundation
import CryptoKit

/// What botdot needs and has (the Setup checklist): Claude, the bots' computers, the phone, the time zone.
public struct SetupState: Decodable, Sendable {
    public struct Claude: Decodable, Sendable {
        public var installed: Bool?
        public var loggedIn: Bool?
        public var email: String?
        public var fromEnv: Bool?
        /// Why the server could not check the sign-in, in its sentence (docs/api.md, "A check that could not tell").
        public var error: String?

        /// The sentence of a check that could not tell: the sign-in is not known then, and the app
        /// shows this in place of "signed in". nil when the check could tell.
        public var couldNotTell: String? {
            error.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        }
    }
    public struct Docker: Decodable, Sendable {
        public var ok: Bool?
        public var error: String?
        public var image: Bool?
    }
    public struct Access: Decodable, Sendable {
        public var host: String?
        public var tailnet: Bool?
        public var tailnetHost: String?
        public var user: String?
        public var restricted: Bool?
        public var port: Int?
        public var docker: Bool?
    }
    public struct Bitwarden: Decodable, Sendable {
        public var configured: Bool?
        public var unlocked: Bool?
    }

    public var done: Bool?
    public var timezone: String
    public var claude: Claude?
    public var running: Int?
    public var docker: Docker?
    public var access: Access?
    public var bitwarden: Bitwarden?

    /// First start, or Claude isn't signed in: the Setup page opens by itself.
    public var needsSetup: Bool { done != true || claude?.loggedIn != true }
}

/// botdot server updates: botdot on this Mac, in the app's Updates window. An account on a machine of several is
/// updated by the admin, for every account at once (ADR 028): its server says `byAdmin`, and offers no update.
public struct UpdateStatus: Decodable, Sendable {
    public struct Version: Decodable, Sendable { public var short: String?; public var revision: String? }
    public var supported: Bool?
    /// "idle", "downloading" or "restarting".
    public var state: String?
    public var available: Bool?
    public var error: String?
    public var version: Version?
    /// A self-built botdot server: it is updated from its source, as `howToUpdate` says, not from Settings.
    public var selfBuilt: Bool?
    public var howToUpdate: String?
    /// The admin updates this botdot, for every account at once, on the admin page.
    public var byAdmin: Bool?
}

/// Nightly backups, encrypted with the owner's passphrase.
public struct BackupStatus: Decodable, Sendable {
    public struct Last: Decodable, Sendable { public var name: String; public var at: String? }
    public var configured: Bool?
    public var running: Bool?
    public var error: String?
    public var last: Last?
    public var count: Int?
}

/// The Mac app build the botdot server carries, to update this Mac from.
public struct MacAppBuild: Decodable, Sendable {
    public var versionCode: Int?
    public var versionName: String?
    public var sha256: String?
    public var size: Double?
    public var release: ReleaseManifest?
}

extension Store {
    public func setup(fresh: Bool = false) async throws -> SetupState {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get(fresh ? "setup?fresh" : "setup")
    }

    public func updateSetup(done: Bool? = nil, timezone: String? = nil) async throws {
        guard let api else { return }
        var body: [String: Any] = [:]
        if let done { body["done"] = done }
        if let timezone { body["timezone"] = timezone }
        _ = try await api.sendJSON("setup", method: "PUT", body: try JSONSerialization.data(withJSONObject: body))
    }

    /// Starts signing in to Claude: the page to open, where the owner gets a code to paste back.
    public func startClaudeSignIn() async throws -> URL {
        guard let api else { throw ConnectError(message: "Not connected.") }
        struct Started: Decodable { let url: String }
        let s: Started = try await api.send("setup/claude/login")
        guard let url = URL(string: s.url) else { throw ConnectError(message: "Claude Code gave no sign-in link.") }
        return url
    }

    public func cancelClaudeSignIn() async {
        try? await api?.send("setup/claude/login", method: "DELETE")
    }

    public func finishClaudeSignIn(code: String) async throws -> SetupState.Claude {
        guard let api else { throw ConnectError(message: "Not connected.") }
        struct Body: Encodable { let code: String }
        struct Result: Decodable { let claude: SetupState.Claude }
        return try await api.send("setup/claude/code", body: Body(code: code), as: Result.self).claude
    }

    /// Signs out of Claude. Returns what the server knows of the sign-in afterwards: with
    /// `couldNotTell` it could not check, which is not "signed out".
    @discardableResult
    public func signOutOfClaude() async throws -> SetupState.Claude? {
        guard let api else { return nil }
        struct Result: Decodable { let claude: SetupState.Claude? }
        let answer = try await api.data("setup/claude", method: "DELETE")
        return (try? JSON.decoder.decode(Result.self, from: answer))?.claude
    }

    /// Saves server settings (the default and the Chief's model, reasoning and rules).
    public func saveSettings(_ values: [String: Any]) async throws -> ServerSettings {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try JSON.decoder.decode(ServerSettings.self, from: try await api.sendJSON("settings", method: "PUT", body: try JSONSerialization.data(withJSONObject: values)))
    }

    public func refreshModels() async throws -> ServerSettings {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.send("settings/refresh-models")
    }

    public func updates(check: Bool = false) async throws -> UpdateStatus {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let u: UpdateStatus = check ? try await api.send("updates/check") : try await api.get("updates")
        updateAvailable = u.available ?? false
        return u
    }

    /// Updates the botdot server; `force` goes ahead while bots are working.
    public func applyUpdate(force: Bool = false) async throws {
        guard let api else { return }
        struct Body: Encodable { let force: Bool }
        try await api.send("updates/apply", body: Body(force: force))
    }

    public func backups() async throws -> BackupStatus {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("backups")
    }

    public func setBackupPassphrase(_ passphrase: String) async throws {
        guard let api else { return }
        struct Body: Encodable { let passphrase: String }
        try await api.send("backups/passphrase", method: "PUT", body: Body(passphrase: passphrase))
    }

    public func backUpNow() async throws {
        guard let api else { return }
        try await api.send("backups/now")
    }

    public func downloadBackup(_ name: String) async throws -> Data {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.data("backups/\(name)")
    }

    /// Restores a backup file: botdot checks the passphrase and restarts with it.
    /// Gives back how many bots it had.
    public func restoreBackup(_ file: URL, passphrase: String) async throws -> Int {
        guard let api else { throw ConnectError(message: "Not connected.") }
        var req = try api.request("backups/upload", method: "POST")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (body, response) = try await api.session.upload(for: req, fromFile: file)
        api.sessions.took(response, body: body, sent: API.sent(req))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        struct Uploaded: Decodable { let file: String?; let error: String? }
        let up = try? JSON.decoder.decode(Uploaded.self, from: body)
        guard (200..<300).contains(status), let name = up?.file else { throw API.Failure(status: status, message: up?.error ?? "Upload failed") }
        struct Body: Encodable { let file: String; let passphrase: String }
        struct Restored: Decodable { let bots: Int? }
        return try await api.send("backups/restore", body: Body(file: name, passphrase: passphrase), as: Restored.self).bots ?? 0
    }

    #if os(macOS)
    /// Downloads the Mac app botdot carries, checks it against `build`'s sha256, and unpacks it:
    /// the new botdot.app, in a scratch folder, ready to swap in.
    public func downloadMacApp(_ build: MacAppBuild) async throws -> URL {
        try await downloadMacApp(build, installed: Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0, key: ReleaseTrust.key)
    }

    func downloadMacApp(_ build: MacAppBuild, installed: Int, key: String) async throws -> URL {
        guard let api else { throw ConnectError(message: "Not connected.") }
        guard ReleaseManifest.secureURL(api.base), let release = build.release else { throw ConnectError(message: "A signed release over HTTPS is required.") }
        try release.verify(app: "mac", installed: installed, key: key)
        guard release.version == build.versionCode, release.sha256 == build.sha256 else { throw ConnectError(message: "The release does not match its signed manifest.") }
        let (data, response) = try await api.session.data(for: try api.request("app/mac.zip"), delegate: RejectUpdateRedirects())
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw ConnectError(message: "botdot didn't hand out the app.") }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == build.sha256 else { throw ConnectError(message: "The download was damaged. Try again.") }
        let work = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        let tmp = work.appendingPathComponent("release.zip")
        try data.write(to: tmp, options: .atomic)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let unzip = await LocalServer.run("/usr/bin/ditto", ["-x", "-k", tmp.path, work.path])
        let app = work.appendingPathComponent("botdot.app")
        guard unzip.ok, FileManager.default.fileExists(atPath: app.path) else { throw ConnectError(message: "The download has no app in it.") }
        // It must be this app, at the build botdot announced (never an older one).
        let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")) as? [String: Any]
        guard info?["CFBundleIdentifier"] as? String == "dev.botdot.mac",
              Int(info?["CFBundleVersion"] as? String ?? "") == build.versionCode else {
            throw ConnectError(message: "The download isn't the botdot app botdot announced.")
        }
        return app
    }
    #endif

    /// The Mac app build this botdot server carries, if it's newer than `build`. A build of your own
    /// (build number 0: Xcode, `make mac-install`) is never offered it: it is newer than any release.
    public func newerMacApp(than build: Int) async -> MacAppBuild? {
        guard let api, build > 0 else { return nil }
        struct V: Decodable { let mac: MacAppBuild? }
        guard let m = (try? await api.get("version", as: V.self))?.mac, let code = m.versionCode, code > build else { return nil }
        return m
    }
}
