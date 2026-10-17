import Foundation
import Testing
@testable import BotDotKit

/// The repo's stand-in docker (test/fixtures/fake-docker.js) in a folder of its own, steered by
/// files in `out` and recording every call.
final class FakeDocker: @unchecked Sendable {
    let dir: URL
    let out: URL
    let path: String

    init() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-docker-\(UUID().uuidString)")
        out = dir.appendingPathComponent("out")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        path = dir.appendingPathComponent("docker").path
        let node = Self.node
        let script = TestServer.repo.appendingPathComponent("test/fixtures/fake-docker.js").path
        try "#!/bin/sh\nFAKE_DOCKER_OUT=\"\(out.path)\" exec \"\(node)\" \"\(script)\" \"$@\"\n".write(toFile: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
    }

    deinit { try? FileManager.default.removeItem(at: dir) }

    static let node = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/env"

    func set(_ file: String, _ text: String = "") { try? text.write(to: out.appendingPathComponent(file), atomically: true, encoding: .utf8) }
    func clear(_ file: String) { try? FileManager.default.removeItem(at: out.appendingPathComponent(file)) }

    /// Each call's arguments, in order.
    var calls: [[String]] {
        struct Call: Decodable { let args: [String] }
        let text = (try? String(contentsOf: out.appendingPathComponent("calls.jsonl"), encoding: .utf8)) ?? ""
        return text.split(separator: "\n").compactMap { try? JSONDecoder().decode(Call.self, from: Data($0.utf8)).args }
    }
}

@MainActor
@Suite struct LocalServerSetup {
    /// A LocalServer in a scratch folder; `port` is where it expects botdot to answer.
    func local(_ docker: FakeDocker?, port: Int = 1, secrets: MemorySecrets = MemorySecrets()) -> LocalServer {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-local-\(UUID().uuidString)")
        return LocalServer(config: .init(dir: dir, port: port, dockerPaths: docker.map { [$0.path] } ?? ["/nowhere/docker"], startTimeout: 5), secrets: secrets)
    }

    @Test func withoutDockerItSaysSo() async throws {
        let l = local(nil)
        #expect(await l.dockerRunning() == nil)
        await #expect(throws: LocalServer.Problem.noDocker) { try await l.install() }
        // What is missing, and where to get it.
        #expect(LocalServer.Problem.noDocker.localizedDescription.contains("Docker"))
        #expect(LocalServer.dockerDownload.absoluteString == "https://www.docker.com/products/docker-desktop/")
    }

    @Test func dockerThatIsntRunningIsToldApart() async throws {
        let docker = try FakeDocker()
        docker.set("down")
        let l = local(docker)
        #expect(await l.dockerRunning() == false)
        await #expect(throws: LocalServer.Problem.dockerStopped) { try await l.install() }
        docker.clear("down")
        #expect(await l.dockerRunning() == true)
    }

    @Test func privateImagesAskForATokenAndABadOneGetsAPlainMessage() async throws {
        let docker = try FakeDocker()
        docker.set("private")
        docker.set("good-token", "ghp_good")
        let secrets = MemorySecrets()
        let l = local(docker, secrets: secrets)
        await #expect(throws: LocalServer.Problem.needsToken) { try await l.install() }
        await #expect(throws: LocalServer.Problem.badToken) { try await l.install(token: "ghp_bad") }
        #expect(secrets.get("registry-token") == nil)
        #expect(LocalServer.Problem.badToken.localizedDescription.contains("read:packages"))
        // The good one is kept, and signs in as the images' owner.
        await #expect(throws: LocalServer.Problem.self) { try await l.install(token: "ghp_good") } // botdot itself doesn't answer here
        #expect(secrets.get("registry-token") == "ghp_good")
        #expect(docker.calls.contains(["login", "ghcr.io", "-u", "kordal", "--password-stdin"]))
        #expect(!docker.calls.flatMap { $0 }.contains("ghp_good"), "the token goes in on stdin, not the command line")
    }

    @Test func itDownloadsWritesTheInstallFolderAndStartsBotdot() async throws {
        let server = try TestServer() // stands in for botdot answering on its port
        let docker = try FakeDocker()
        let secrets = MemorySecrets()
        let l = local(docker, port: server.base.port!, secrets: secrets)
        try await l.install()
        #expect(l.step == .done)
        #expect(l.installed)

        let compose = try String(contentsOf: l.composeFile, encoding: .utf8)
        #expect(compose.contains("BOT_DOT_PLATFORM: mac"))
        #expect(compose.contains("127.0.0.1:${PORT:-4747}"))
        let env = try String(contentsOf: l.config.dir.appendingPathComponent(".env"), encoding: .utf8)
        // The setup key that makes the one account's passkey (ADR 028); no owner key any more.
        let key = try #require(l.setupKey)
        #expect(key.count == 64)
        #expect(env.contains("FRONT_DOOR_SETUP_KEY=\(key)"))
        #expect(!env.contains("BOT_DOT_OWNER_KEY"))
        let door = try FileManager.default.attributesOfItem(atPath: l.config.dir.appendingPathComponent("front-door").path)[.posixPermissions] as? Int
        #expect(door == 0o700)
        #expect(l.address == "localhost:\(server.base.port!)", "a passkey belongs to a name, not to 127.0.0.1")
        #expect(env.contains("TZ=\(TimeZone.current.identifier)"))
        #expect(env.contains("PORT=\(server.base.port!)"))
        let mode = try FileManager.default.attributesOfItem(atPath: l.config.dir.appendingPathComponent(".env").path)[.posixPermissions] as? Int
        #expect(mode == 0o600)

        let calls = docker.calls
        #expect(calls.contains(["pull", "-q", "ghcr.io/kordal/bot-dot:latest"]))
        #expect(calls.contains(["pull", "-q", "ghcr.io/kordal/bot-dot-desktop:latest"]))
        #expect(calls.contains { $0.starts(with: ["compose"]) && $0.suffix(3) == ["up", "-d", "--remove-orphans"] })
        // Started means botdot itself answers in its container, not only its front door.
        #expect(calls.contains { $0.starts(with: ["compose"]) && $0.contains("exec") && $0.contains("bot-dot") && $0.contains("http://127.0.0.1:\(server.base.port!)/api/version") })

        // Again: the same setup key while the passkey isn't made.
        try await l.install()
        #expect(l.setupKey == key)
        // Made: the key goes, from the app and from .env, and setting up again makes none (the account is there).
        l.passkeyMade()
        #expect(l.setupKey == nil)
        #expect(try !String(contentsOf: l.config.dir.appendingPathComponent(".env"), encoding: .utf8).contains("FRONT_DOOR_SETUP_KEY"))
        try await l.install()
        #expect(l.setupKey == nil)
    }

    // A local botdot server set up before the front door had an owner key: setting up again takes it out of .env
    // and makes a setup key for the account's passkey.
    @Test func anInstallFromBeforeTheFrontDoorLosesItsOwnerKey() async throws {
        let server = try TestServer()
        let docker = try FakeDocker()
        let l = local(docker, port: server.base.port!)
        try FileManager.default.createDirectory(at: l.config.dir, withIntermediateDirectories: true)
        try "TZ=Europe/Brussels\nBOT_DOT_OWNER_KEY=\(String(repeating: "a", count: 64))\n".write(to: l.config.dir.appendingPathComponent(".env"), atomically: true, encoding: .utf8)
        try await l.install()
        let env = try String(contentsOf: l.config.dir.appendingPathComponent(".env"), encoding: .utf8)
        #expect(!env.contains("BOT_DOT_OWNER_KEY"))
        #expect(env.contains("TZ=Europe/Brussels"))
        #expect(env.contains("FRONT_DOOR_SETUP_KEY=\(try #require(l.setupKey))"))
    }

    @Test func removingKeepsTheDataUnlessAskedAndSwitchingAwayLeavesItRunning() async throws {
        let server = try TestServer()
        let docker = try FakeDocker()
        let secrets = MemorySecrets()
        let l = local(docker, port: server.base.port!, secrets: secrets)
        try await l.install()
        try "a bot".write(to: l.config.dir.appendingPathComponent("data/bots.json"), atomically: true, encoding: .utf8)

        // Switching to another botdot server only disconnects: nothing is stopped.
        let before = docker.calls.count
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.disconnect()
        #expect(docker.calls.count == before)

        try await l.remove(deleteData: false)
        #expect(docker.calls.last?.contains("down") == true)
        #expect(docker.calls.last?.contains("--volumes") == false)
        #expect(!l.installed)
        #expect(FileManager.default.fileExists(atPath: l.config.dir.appendingPathComponent("data/bots.json").path))

        try await l.install()
        try await l.remove(deleteData: true)
        #expect(docker.calls.last?.contains("--volumes") == true)
        #expect(!FileManager.default.fileExists(atPath: l.config.dir.path))
        #expect(secrets.get("setup-key") == nil)
    }

    /// What an update from Settings leaves in the install folder: the botdot server's own
    /// lib/update-install.js, run there as its updater runs it, pins both images by digest in .env.
    func settingsUpdate(_ l: LocalServer, image: String, computer: String) async throws {
        let r = await LocalServer.run(FakeDocker.node, [TestServer.repo.appendingPathComponent("lib/update-install.js").path, image, computer], cwd: l.config.dir)
        try #require(r.ok, "\(r.output)")
    }

    func env(_ l: LocalServer) throws -> [String] {
        try String(contentsOf: l.config.dir.appendingPathComponent(".env"), encoding: .utf8).split(separator: "\n").map(String.init)
    }

    // Since 7 October install.sh drops the pin an update from Settings left once the newer image is
    // here, and keeps it otherwise. The Mac setup does the same, and nothing else it does moves
    // botdot back to an older image.
    @Test func anUpdateFromSettingsStaysUntilSetupDownloadsNewerImages() async throws {
        let server = try TestServer()
        let docker = try FakeDocker()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-local-\(UUID().uuidString)")
        let config = LocalServer.Config(dir: dir, port: server.base.port!, dockerPaths: [docker.path], startTimeout: 5)
        let l = LocalServer(config: config, secrets: MemorySecrets())
        try await l.install()
        #expect(try env(l).contains("BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot:latest"))

        let image = "ghcr.io/kordal/bot-dot@sha256:" + String(repeating: "a", count: 64)
        let computer = "ghcr.io/kordal/bot-dot-desktop@sha256:" + String(repeating: "b", count: 64)
        try await settingsUpdate(l, image: image, computer: computer)
        let key = try #require(l.setupKey)
        #expect(try env(l).contains("FRONT_DOOR_SETUP_KEY=\(key)"), "the update keeps the Mac's settings")

        // Starting botdot again, and the passkey made, run what the update installed.
        try await l.start()
        l.passkeyMade()
        #expect(try env(l).contains("BOT_DOT_IMAGE=\(image)"))
        #expect(try env(l).contains("BOT_DOT_COMPUTER_IMAGE=\(computer)"))

        // Setting up again downloads the newest botdot: its pin goes. The bots' computer couldn't be
        // downloaded now, so its pin stays.
        docker.set("missing", "ghcr.io/kordal/bot-dot-desktop:latest")
        try await l.install()
        #expect(try env(l).contains("BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot:latest"))
        #expect(try env(l).contains("BOT_DOT_COMPUTER_IMAGE=\(computer)"))
        docker.clear("missing")
        try await l.install()
        #expect(try env(l).contains("BOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop:latest"))
        #expect(try env(l).filter { $0.hasPrefix("BOT_DOT_IMAGE=") || $0.hasPrefix("BOT_DOT_COMPUTER_IMAGE=") }.count == 2)
    }

    // As install.sh: an image named without a registry is one built on this Mac. Nothing is
    // downloaded, and setup says so when the image isn't here.
    @Test func anImageBuiltOnThisMacIsUsedAsItIs() async throws {
        let server = try TestServer()
        let docker = try FakeDocker()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-local-\(UUID().uuidString)")
        var config = LocalServer.Config(dir: dir, port: server.base.port!, image: "bot-dot:dev", dockerPaths: [docker.path], startTimeout: 5)
        config.computerImage = "bot-dot-desktop:dev"
        let l = LocalServer(config: config, secrets: MemorySecrets())
        try await l.install()
        #expect(!docker.calls.contains { $0.first == "pull" || $0.first == "login" })
        #expect(docker.calls.contains(["image", "inspect", "bot-dot:dev"]))
        #expect(try env(l).contains("BOT_DOT_IMAGE=bot-dot:dev"))
        #expect(try env(l).contains("BOT_DOT_COMPUTER_IMAGE=bot-dot-desktop:dev"))

        docker.set("host.json", #"{"images":[]}"#)
        await #expect(throws: LocalServer.Problem.failed("The image bot-dot:dev isn't on this Mac.")) { try await l.install() }
    }

    // The Mac's compose file is the Linux one except where a Mac needs it to differ (docs/adr/0002).
    // A change to compose.yaml that compose.mac.yaml didn't get fails here.
    @Test func theMacComposeFileDiffersFromTheLinuxOneOnlyWhereAMacNeedsIt() throws {
        func lines(_ name: String) throws -> [String] {
            try String(contentsOf: TestServer.repo.appendingPathComponent(name), encoding: .utf8).split(separator: "\n")
                .map { $0.replacing(/\s+#.*$/, with: "").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.hasPrefix("#") }
        }
        let changes = try lines("compose.mac.yaml").difference(from: try lines("compose.yaml"))
        let removed = changes.compactMap { if case .remove(_, let line, _) = $0 { line } else { nil } }
        let added = changes.compactMap { if case .insert(_, let line, _) = $0 { line } else { nil } }
        // Linux's account folder, its account's rootless Docker, its share of the machine (one account has the Mac)
        // and its address on its own 127.0.0.1 go, neither service says it runs on Linux, and neither needs Docker's
        // default network (only gVisor does, for names).
        #expect(removed.sorted() == [
            "- ${BOT_DOT_FRONT_DOOR_FOLDER:-./front-door}:/run/front-door",
            "- ${DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock",
            "- ./share:/run/botdot-share:ro",
            "BOT_DOT_ACCOUNT: ${BOT_DOT_ACCOUNT:-}",
            "BOT_DOT_FRONT_DOOR_SOCKET: /run/front-door/botdot.sock",
            "BOT_DOT_PLATFORM: linux",
            "BOT_DOT_SHARE_FILE: /run/botdot-share/share.json",
            "HOST: 127.0.0.1",
            "PORT: 4747",
            "network_mode: bridge", "network_mode: bridge",
        ])
        // A front door of one account (ADR 028), published on this Mac's 127.0.0.1 only, reaching botdot on its
        // socket in a volume they share; Docker Desktop's own socket; both botdot services know it's a Mac, which is
        // how the updater in Settings picks this file.
        #expect(added.sorted() == [
            "- \"127.0.0.1:${PORT:-4747}:4700\"",
            "- ./front-door:/front-door",
            "- /var/run/docker.sock:/var/run/docker.sock",
            "- bot-dot",
            "- bot-dot-front-door:/run/front-door",
            "- bot-dot-front-door:/run/front-door",
            "BOT_DOT_ACCOUNT: owner",
            "BOT_DOT_FRONT_DOOR_SOCKET: /run/front-door/owner/botdot.sock",
            "BOT_DOT_PLATFORM: mac", "BOT_DOT_PLATFORM: mac",
            "FRONT_DOOR_DATA: /front-door",
            "FRONT_DOOR_HOST: 0.0.0.0",
            "FRONT_DOOR_ONE_ACCOUNT: owner",
            "FRONT_DOOR_ORIGIN: http://localhost:${PORT:-4747}",
            "FRONT_DOOR_PORT: 4700",
            "FRONT_DOOR_SETUP_KEY: ${FRONT_DOOR_SETUP_KEY:-}",
            "FRONT_DOOR_SOCKETS: /run/front-door",
            "HOST: 0.0.0.0",
            "PORT: ${PORT:-4747}",
            "TZ: ${TZ:-UTC}",
            "bot-dot-front-door:",
            "cap_drop: [ALL]",
            "command: [\"node\", \"front-door.js\"]",
            "depends_on:",
            "disable: true",
            "environment:",
            "front-door:",
            "healthcheck:",
            "image: ${BOT_DOT_IMAGE:-ghcr.io/kordal/bot-dot:latest}",
            "ports:",
            "restart: unless-stopped",
            "security_opt: [no-new-privileges:true]",
            "user: \"60000:60000\"",
            "volumes:",
        ])
    }

    // The app reads the Mac's compose file from the image it downloaded, as install.sh reads Linux's.
    @Test func theComposeFileComesFromTheDownloadedImage() async throws {
        let server = try TestServer()
        let docker = try FakeDocker()
        let l = local(docker, port: server.base.port!)
        try await l.install()
        #expect(docker.calls.contains(["run", "--rm", "--entrypoint", "cat", "ghcr.io/kordal/bot-dot:latest", "/opt/bot-dot/compose.mac.yaml"]))
        let repo = try String(contentsOf: TestServer.repo.appendingPathComponent("compose.mac.yaml"), encoding: .utf8)
        #expect(try String(contentsOf: l.composeFile, encoding: .utf8) == repo)
    }
}

/// Sets up botdot on this Mac for real, in Docker Desktop (OrbStack or Colima), in a scratch folder
/// on port 4799. Downloads several GB. Run it with BOTDOT_LIVE_DOCKER=1, and BOTDOT_REGISTRY_TOKEN
/// set to a read:packages GitHub token while the images are private. BOTDOT_LIVE_IMAGE and
/// BOTDOT_LIVE_COMPUTER_IMAGE name other images than the published ones (a build of this repo in a
/// registry on this Mac); BOTDOT_LIVE_KEEP=1 leaves botdot running in its folder, which it prints.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["BOTDOT_LIVE_DOCKER"] == "1"))
struct LocalServerLive {
    @Test(.timeLimit(.minutes(30))) func setsUpAndStartsBotdotInRealDocker() async throws {
        let env = ProcessInfo.processInfo.environment
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-live-\(UUID().uuidString)")
        var config = LocalServer.Config(dir: dir, port: 4799, startTimeout: 300)
        if let image = env["BOTDOT_LIVE_IMAGE"] { config.image = image }
        if let image = env["BOTDOT_LIVE_COMPUTER_IMAGE"] { config.computerImage = image }
        let l = LocalServer(config: config, secrets: MemorySecrets())
        #expect(await l.dockerRunning() == true)
        try await l.install(token: env["BOTDOT_REGISTRY_TOKEN"])
        #expect(await l.answers())
        // Its front door asks for a sign-in, and the setup key opens the page that makes the passkey (a real
        // passkey needs a person, so the test stops there).
        let store = Store()
        try await store.connect(to: l.address)
        #expect(store.signInNeeded == URL(string: "http://\(l.address)"))
        #expect(await store.signUpOpens(at: URL(string: "http://\(l.address)")!, setupKey: try #require(l.setupKey)))
        var req = URLRequest(url: URL(string: "http://\(l.address)/api/bots")!)
        req.httpShouldHandleCookies = false
        let (_, anyone) = try await URLSession(configuration: .ephemeral).data(for: req)
        #expect((anyone as? HTTPURLResponse)?.statusCode == 401, "without a session nothing reaches botdot")
        // Only the front door is published, on this Mac's 127.0.0.1 and nowhere else.
        let docker = try #require(l.dockerPath())
        let ports = await LocalServer.run(docker, ["ps", "--filter", "publish=4799", "--format", "{{.Ports}}"]).output.trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(ports == "127.0.0.1:4799->4700/tcp")
        if env["BOTDOT_LIVE_KEEP"] == "1" { print("botdot keeps running in \(dir.path)"); return }
        try await l.remove(deleteData: true)
    }
}
