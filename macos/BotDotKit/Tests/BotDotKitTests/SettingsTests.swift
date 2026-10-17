import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct SettingsPage {
    @Test func theDefaultModelIsChangedAndReadBack() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let model = try #require(try await store.settings().models.first).id
        let saved = try await store.saveSettings(["defaultModel": model, "defaultEffort": ""])
        #expect(saved.settings.defaultModel == model)
        #expect(try await store.settings().settings.defaultModel == model)
    }

    @Test func updateStatusSaysWhenItCantUpdateItself() async throws {
        // Run from source, botdot can't update itself: the line says it's the newest version.
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let u = try await store.updates()
        #expect(u.supported == false)
        #expect(u.available != true)
        #expect(store.updateAvailable == false)
        #expect(await store.newerMacApp(than: 1) == nil)
    }

    @Test func anAccountOnAMachineOfSeveralHasNoUpdateOfItsOwn() async throws {
        // The admin updates every account at once (#473): the server offers none, and says so. The test server
        // serves an account behind a front door, as on a machine of several (helpers.startServer).
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(!store.features.contains("updates"))
        let u = try await store.updates()
        #expect(u.supported == false)
        #expect(u.byAdmin == true)
        #expect(u.available != true)
        await #expect(throws: (any Error).self) { try await store.applyUpdate(force: true) }
    }

    @Test func backupsSave() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(try await store.backups().configured == false)
        try await store.setBackupPassphrase("a long passphrase")
        try await store.backUpNow()
        let b = try await store.backups()
        #expect(b.configured == true)
        #expect(b.last != nil)
    }

    @Test func setupTellsWhenItsNeeded() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let s = try await store.setup()
        #expect(s.done != true)
        #expect(s.needsSetup)
        try await store.updateSetup(done: true)
        #expect(try await store.setup().done == true)
    }
}
