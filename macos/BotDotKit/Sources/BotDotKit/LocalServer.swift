#if os(macOS)
import Foundation
import Observation
import Security

/// A local botdot server: botdot running in Docker on this Mac, set up and looked after by the app
/// (docs/adr/0002). The same published images install.sh uses on Linux, with the Mac compose file.
@MainActor
@Observable
public final class LocalServer {
    public struct Config: Sendable {
        /// The install folder: compose.yaml, .env and data/.
        public var dir: URL
        public var port: Int
        public var image: String
        public var computerImage: String
        /// Where to look for the docker command, first found wins.
        public var dockerPaths: [String]
        /// How long to wait for botdot to answer after starting it.
        public var startTimeout: Double

        public init(dir: URL = Config.defaultDir, port: Int = 4747, image: String = "ghcr.io/kordal/bot-dot:latest",
                    computerImage: String = "ghcr.io/kordal/bot-dot-desktop:latest", dockerPaths: [String] = Config.defaultDockerPaths, startTimeout: Double = 180) {
            self.dir = dir
            self.port = port
            self.image = image
            self.computerImage = computerImage
            self.dockerPaths = dockerPaths
            self.startTimeout = startTimeout
        }

        public static var defaultDir: URL {
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("botdot", isDirectory: true)
        }

        /// Docker Desktop, OrbStack, Colima (Homebrew) and the usual places.
        public static var defaultDockerPaths: [String] {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            return ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "\(home)/.orbstack/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker",
                    "/Applications/OrbStack.app/Contents/MacOS/xbin/docker", "\(home)/.docker/bin/docker"]
        }
    }

    /// Why setting up can't go on, in words for the owner.
    public enum Problem: LocalizedError, Equatable {
        /// No docker command found: Docker Desktop, OrbStack or Colima isn't installed.
        case noDocker
        /// Docker is installed but not running.
        case dockerStopped
        /// botdot's images are private: a read-only GitHub token is needed.
        case needsToken
        case badToken
        case failed(String)

        public var errorDescription: String? {
            switch self {
            case .noDocker: "botdot runs in Docker, which isn't on this Mac yet."
            case .dockerStopped: "Docker isn't running. Start Docker Desktop (or OrbStack or Colima), and setup goes on by itself."
            case .needsToken: "botdot's images are private. Paste a GitHub token that can only read packages."
            case .badToken: "That token didn't work for ghcr.io. Check that it has the read:packages scope."
            case .failed(let m): m
            }
        }
    }

    /// Where to get Docker, for `Problem.noDocker`.
    public static let dockerDownload = URL(string: "https://www.docker.com/products/docker-desktop/")!

    public enum Step: Int, Comparable, Sendable {
        case docker, download, start, done
        public static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }
    }

    public let config: Config
    let secrets: SecretStore
    /// Where setup is, and what it's doing now ("Downloading botdot…").
    public private(set) var step: Step = .docker
    public private(set) var status = ""

    public init(config: Config = Config(), secrets: SecretStore? = nil) {
        self.config = config
        self.secrets = secrets ?? FileSecrets(file: config.dir.appendingPathComponent(".secrets"))
    }

    /// Where the app and a browser on this Mac reach botdot: its front door, by name, since a passkey belongs to a
    /// name and an address like 127.0.0.1 can hold none (ADR 028). Published on 127.0.0.1 only.
    public var address: String { "localhost:\(config.port)" }
    public var composeFile: URL { config.dir.appendingPathComponent("compose.yaml") }
    /// Set up on this Mac before (its install folder is there).
    public var installed: Bool { FileManager.default.fileExists(atPath: composeFile.path) }
    /// The secret that makes the passkey of the one account (FRONT_DOOR_SETUP_KEY), until it is made: only this app
    /// holds it, and no sign-up link is ever offered (ADR 028).
    public var setupKey: String? { secrets.get("setup-key") }

    /// The passkey is made: the setup key has done its work and goes.
    public func passkeyMade() {
        secrets.delete("setup-key")
        try? writeEnv()
    }

    // MARK: Docker

    public func dockerPath() -> String? {
        config.dockerPaths.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Whether Docker is installed and running (nil: not installed).
    public func dockerRunning() async -> Bool? {
        guard let docker = dockerPath() else { return nil }
        return await Self.run(docker, ["info"]).ok
    }

    // MARK: Setting up

    /// Sets up botdot on this Mac and starts it; `token` is asked for only when the images need it.
    /// Safe to run again: it updates the images and keeps the data and settings.
    public func install(token: String? = nil) async throws {
        step = .docker
        status = "Looking for Docker…"
        guard let docker = dockerPath() else { throw Problem.noDocker }
        guard await Self.run(docker, ["info"]).ok else { throw Problem.dockerStopped }

        step = .download
        try FileManager.default.createDirectory(at: config.dir.appendingPathComponent("data"), withIntermediateDirectories: true)
        // The front door's account, passkey and sessions: kept with the data, readable only by you.
        let door = config.dir.appendingPathComponent("front-door")
        if !FileManager.default.fileExists(atPath: door.path) {
            try FileManager.default.createDirectory(at: door, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            // No account there yet: a new setup key makes its passkey.
            secrets.set("setup-key", Self.randomKey())
        }

        // As install.sh: an image named without a registry ("bot-dot:dev") was built on this Mac.
        let local = Self.registry(of: config.image) == nil
        if local {
            status = "Looking for \(config.image)…"
            guard await Self.run(docker, ["image", "inspect", config.image]).ok else { throw Problem.failed("The image \(config.image) isn't on this Mac.") }
        }
        if !local { status = "Downloading botdot (about 1.5 GB the first time)…" }
        let givenToken = token?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        var pulled = local
        if !local && givenToken == nil { pulled = await Self.run(docker, ["pull", "-q", config.image]).ok }
        if !pulled {
            guard let t = givenToken ?? secrets.get("registry-token") else { throw Problem.needsToken }
            let registry = Self.registry(of: config.image) ?? "ghcr.io"
            let owner = config.image.split(separator: "/").dropFirst().first.map(String.init) ?? ""
            guard await Self.run(docker, ["login", registry, "-u", owner, "--password-stdin"], input: t).ok else {
                if givenToken != nil { throw Problem.badToken }
                throw Problem.needsToken // the saved one stopped working
            }
            secrets.set("registry-token", t)
            let r = await Self.run(docker, ["pull", "-q", config.image])
            guard r.ok else { throw Problem.failed("Couldn't download botdot: \(r.output.trimmingCharacters(in: .whitespacesAndNewlines))") }
            pulled = true
        }

        // The compose file comes from the image itself, so it always matches the version that runs.
        let compose = await Self.run(docker, ["run", "--rm", "--entrypoint", "cat", config.image, "/opt/bot-dot/compose.mac.yaml"])
        guard compose.ok, compose.output.contains("services:") else { throw Problem.failed("Couldn't read botdot's settings from its image.") }
        try Data(compose.output.utf8).write(to: composeFile)

        var computer = true
        if Self.registry(of: config.computerImage) != nil {
            status = "Downloading the bots' computer (a few GB the first time)…"
            computer = await Self.run(docker, ["pull", "-q", config.computerImage]).ok // botdot tries again when a bot needs it
        }
        try writeEnv(newest: (image: true, computer: computer))

        try await start()
    }

    /// The registry an image is downloaded from: the part before its first "/", when that is a host
    /// ("ghcr.io/kordal/bot-dot"). None for an image built on this Mac ("bot-dot:dev", "me/bot-dot").
    static func registry(of image: String) -> String? {
        let parts = image.split(separator: "/")
        guard parts.count > 1, parts[0].contains(".") else { return nil }
        return String(parts[0])
    }

    /// Starts botdot (again), and waits until it answers.
    public func start() async throws {
        step = .start
        status = "Starting botdot…"
        guard let docker = dockerPath() else { throw Problem.noDocker }
        guard await Self.run(docker, ["info"]).ok else { throw Problem.dockerStopped }
        let up = await Self.run(docker, ["compose", "--project-directory", config.dir.path, "-f", composeFile.path, "up", "-d", "--remove-orphans"], cwd: config.dir)
        guard up.ok else { throw Problem.failed("botdot didn't start: \(up.output.trimmingCharacters(in: .whitespacesAndNewlines))") }
        let until = Date().addingTimeInterval(config.startTimeout)
        while Date() < until {
            if await answers(), await botdotAnswers(docker) { step = .done; status = ""; return }
            try await Task.sleep(for: .seconds(1))
        }
        throw Problem.failed("botdot didn't start. Its log: cd \"\(config.dir.path)\" && docker compose logs")
    }

    /// botdot itself answers in its container. Its front door answers before it does, and without a session
    /// nothing reaches botdot through the door, so this asks inside, as the image's healthcheck does.
    func botdotAnswers(_ docker: String) async -> Bool {
        await Self.run(docker, ["compose", "--project-directory", config.dir.path, "-f", composeFile.path, "exec", "-T", "bot-dot",
                                "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:\(config.port)/api/version"], cwd: config.dir).ok
    }

    /// botdot on this Mac answers: its front door, which says it is botdot.
    public func answers() async -> Bool {
        guard let url = URL(string: "http://\(address)/api/version") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return false }
        return String(decoding: data, as: UTF8.self).contains("\"bot-dot\"")
    }

    /// Stops botdot and takes its containers away; `deleteData` also deletes the bots and their data.
    public func remove(deleteData: Bool) async throws {
        guard let docker = dockerPath() else { throw Problem.noDocker }
        if installed {
            var args = ["compose", "--project-directory", config.dir.path, "-f", composeFile.path, "down", "--remove-orphans"]
            if deleteData { args.append("--volumes") }
            let r = await Self.run(docker, args, cwd: config.dir)
            guard r.ok else { throw Problem.failed("Couldn't stop botdot: \(r.output.trimmingCharacters(in: .whitespacesAndNewlines))") }
        }
        if deleteData {
            secrets.delete("setup-key")
            try? FileManager.default.removeItem(at: config.dir) // the front door's account and passkey too
        } else {
            try? FileManager.default.removeItem(at: composeFile) // the data stays, for setting up again later
        }
    }

    func env(_ key: String) -> String? {
        let text = (try? String(contentsOf: config.dir.appendingPathComponent(".env"), encoding: .utf8)) ?? ""
        return text.split(separator: "\n").last { $0.hasPrefix("\(key)=") }.map { String($0.dropFirst(key.count + 1)) }?.nonEmpty
    }

    /// The settings next to compose.yaml; the lines already there stay unless set here.
    /// `newest`: which images setup has just downloaded. An update from Settings pins both by digest
    /// here, and as in install.sh such a pin goes only once the newer image is on this Mac: the tag
    /// alone would start the older one again.
    func writeEnv(_ extra: [String: String?] = [:], newest: (image: Bool, computer: Bool) = (false, false)) throws {
        let file = config.dir.appendingPathComponent(".env")
        var lines = ((try? String(contentsOf: file, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
        func set(_ key: String, _ value: String?) {
            lines.removeAll { $0.hasPrefix("\(key)=") }
            if let value { lines.append("\(key)=\(value)") }
        }
        func setImage(_ key: String, _ image: String, _ newest: Bool) {
            let tag = image.lastIndex(of: ":").flatMap { image[$0...].contains("/") ? nil : $0 }
            let pinned = lines.contains { $0.hasPrefix("\(key)=\(image[..<(tag ?? image.endIndex)])@sha256:") }
            if newest || !pinned { set(key, image) }
        }
        if !lines.contains(where: { $0.hasPrefix("TZ=") }) { set("TZ", TimeZone.current.identifier) }
        set("PORT", String(config.port))
        set("BOT_DOT_OWNER_KEY", nil) // what an install before the front door had (ADR 028)
        set("FRONT_DOOR_SETUP_KEY", setupKey)
        set("BOT_DOT_REGISTRY_TOKEN", secrets.get("registry-token"))
        setImage("BOT_DOT_IMAGE", config.image, newest.image)
        setImage("BOT_DOT_COMPUTER_IMAGE", config.computerImage, newest.computer)
        for (k, v) in extra { set(k, v) }
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    static func randomKey() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Running docker

    struct Result: Sendable { let ok: Bool; let output: String }

    /// Runs a command off the main thread; its output and errors together.
    nonisolated static func run(_ path: String, _ args: [String], input: String? = nil, cwd: URL? = nil) async -> Result {
        await withCheckedContinuation { done in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: path)
            p.arguments = args
            if let cwd { p.currentDirectoryURL = cwd }
            // Docker's helpers (compose, credential helpers) sit next to it or in the usual places.
            var env = ProcessInfo.processInfo.environment
            let dir = (path as NSString).deletingLastPathComponent
            env["PATH"] = [dir, "/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", env["PATH"] ?? ""].joined(separator: ":")
            p.environment = env
            let out = Pipe()
            p.standardOutput = out
            p.standardError = out
            let stdin = Pipe()
            p.standardInput = stdin
            let collected = OutputBuffer()
            out.fileHandleForReading.readabilityHandler = { h in collected.append(h.availableData) }
            p.terminationHandler = { proc in
                out.fileHandleForReading.readabilityHandler = nil
                collected.append(out.fileHandleForReading.readDataToEndOfFile())
                done.resume(returning: Result(ok: proc.terminationStatus == 0, output: collected.text))
            }
            do {
                try p.run()
                if let input { stdin.fileHandleForWriting.write(Data(input.utf8)) }
                try? stdin.fileHandleForWriting.close()
            } catch {
                done.resume(returning: Result(ok: false, output: error.localizedDescription))
            }
        }
    }
}

private final class OutputBuffer: @unchecked Sendable {
    private var data = Data()
    private let lock = NSLock()
    func append(_ d: Data) { lock.withLock { data.append(d) } }
    var text: String { lock.withLock { String(decoding: data, as: UTF8.self) } }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
#endif
