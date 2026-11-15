import XCTest
import BotdotShared
@testable import BotDot

/// The Vault on the iPhone (#1369): the entries of test/fixtures/vault-search.json reach Swift in their categories as
/// on Android, nine get the search field, a folded category stays folded on this phone, and the editor's form is the
/// shared one.
@MainActor
final class VaultTests: XCTestCase {
    /// The repository, from this file's place in it (the simulator reads the Mac's files).
    private let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    private var dirs: [URL] = []

    override func tearDown() async throws {
        for d in dirs { try? FileManager.default.removeItem(at: d) }
    }

    private func items() throws -> [VaultItem] {
        let table = try Data(contentsOf: repo.appendingPathComponent("test/fixtures/vault-search.json"))
        let list = try XCTUnwrap((try JSONSerialization.jsonObject(with: table) as? [String: Any])?["items"])
        return Vault.shared.read(json: String(decoding: try JSONSerialization.data(withJSONObject: list), as: UTF8.self))
    }

    private func state(_ items: [VaultItem], folded: Set<String> = []) -> VaultState {
        VaultState(items: items, bitwarden: nil, features: ["vault-types", "vault-categories"], bots: [], folded: folded, error: nil)
    }

    func testTheEntriesAreInTheirCategoriesAsOnAndroid() throws {
        let s = state(try items(), folded: ["Servers"])
        XCTAssertEqual(s.sections(query: "").map(\.category), ["", "Servers", "Shopping"])
        XCTAssertEqual(s.sections(query: "").map(\.open), [true, false, true], "Servers is folded")
        XCTAssertEqual(s.sections(query: "").first?.items.map(\.id), ["d", "e"])
        XCTAssertFalse(s.searches, "six entries: no search field")
    }

    func testNineEntriesGetTheSearchWhichOpensWhatItFinds() throws {
        let nine = try items() + Vault.shared.read(json: #"[{"id":"x1","name":"One","site":"1.example.org"},{"id":"x2","name":"Two","site":"2.example.org"},{"id":"x3","name":"Three","site":"3.example.org"}]"#)
        let s = state(nine, folded: ["Shopping"])
        XCTAssertTrue(s.searches)
        XCTAssertEqual(s.sections(query: "albert").map { "\($0.category) \($0.open) \($0.items.map(\.id))" }, [#"Shopping true ["a"]"#])
        XCTAssertTrue(s.noMatches(query: "nothing like it"))
    }

    func testAFoldedCategoryStaysFoldedOnThisPhone() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        dirs.append(dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let settings = settingsIn(directory: dir.path)
        // A port nothing listens on: the Vault's read is refused at once, so nothing waits on a network's timeout.
        // The folded categories are this phone's (Settings), drawn without any answer from botdot.
        let api = Api(baseUrl: "https://127.0.0.1:9", session: nil, quietMs: Api.companion.QUIET_MS)
        let first = VaultModel(api: api, settings: settings)
        let started = Task { await first.start() }
        try await until { first.state != nil } // following the store before the tap
        await first.toggle("Servers")
        try await until { first.state?.folded.contains("Servers") == true }
        started.cancel()
        first.stop()
        let again = VaultModel(api: api, settings: settings)
        let next = Task { await again.start() }
        try await until { again.state?.folded.contains("Servers") == true }
        next.cancel()
        again.stop()
    }

    /// Waits for [done], failing after twenty seconds instead of hanging: long enough for a busy machine, short of a hang.
    private func until(_ done: () -> Bool) async throws {
        let end = Date().addingTimeInterval(20)
        while !done() {
            guard Date() < end else { return XCTFail("timed out") }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    func testTheEditorIsTheSharedForm() throws {
        let saved = try XCTUnwrap(try items().first { $0.id == "b" })
        let form = VaultLogin.companion.of(item: saved)
        XCTAssertEqual(form.name, saved.name)
        XCTAssertTrue(form.canSave(isNew: false), "an empty secret keeps the saved one")
        XCTAssertFalse(form.canSave(isNew: true))
        XCTAssertEqual(VaultLogin.companion.of(item: nil).typed(id: "github-app").site, "api.github.com")
        let s = state([saved])
        XCTAssertEqual(s.fields(form: form.typed(id: "other"), isNew: false).username, nil, "Other asks for the secret alone")
        XCTAssertEqual(s.typeIds(current: nil), ["login", "api-token", "other"])
        XCTAssertEqual(form.categorized(typed: String(repeating: "x", count: 50)).category.count, 40, "the server keeps 40 characters")
        XCTAssertNil(Vault.shared.secretFileError(bytes: 64 * 1024))
        XCTAssertNotNil(Vault.shared.secretFileError(bytes: 64 * 1024 + 1))
        XCTAssertEqual(Vault.shared.deleteWords(bitwarden: true), "It moves to Bitwarden's trash, where you can restore it for 30 days.")
    }
}
