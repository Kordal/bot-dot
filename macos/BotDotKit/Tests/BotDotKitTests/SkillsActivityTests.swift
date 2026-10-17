import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct SkillsAndActivity {
    @Test func aSkillIsWrittenGivenToABotChangedAndDeleted() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Writer")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        try await store.saveSkill(original: nil, name: "weekly-report", description: "Use when writing the weekly report", instructions: "# Weekly\n1. Wins first", bots: [id])
        var lists = try await store.skillLists()
        #expect(lists.library.map(\.name) == ["weekly-report"])
        #expect(lists.library.first?.usedBy == [id])
        #expect(lists.library.first?.originText(store.bots) == "Written here")
        #expect(try await store.skill("weekly-report").instructions?.contains("Wins first") == true)
        try await store.saveSkill(original: "weekly-report", name: "weekly-report", description: "Use for the weekly report", instructions: "# Weekly", bots: [])
        lists = try await store.skillLists()
        #expect(lists.library.first?.usedBy?.isEmpty == true)
        try await store.deleteSkill("weekly-report")
        #expect(try await store.skillLists().library.isEmpty)
    }

    @Test func activityListsEveryRunNewestFirst() async throws {
        let server = try TestServer()
        let a = try await server.makeBot("A")
        let b = try await server.makeBot("B")
        try await server.runToEnd(a, "one")
        try await server.runToEnd(b, "two")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(try await store.runs().map(\.prompt) == ["two", "one"])
        #expect(try await store.runs(bot: a).map(\.prompt) == ["one"])
    }

    @Test func anImportPreviewReadsAsTheServerSendsIt() throws {
        // The shape the server's import preview answers with (fetching from GitHub isn't done in tests).
        let json = ##"{"id":"c3","name":"pdf","exists":false,"description":"PDFs","allowedTools":[],"instructions":"# PDF","files":[{"path":"SKILL.md","size":8072},{"path":"scripts/a.py","size":10}],"folder":"skills/pdf","totalBytes":8082,"fileCount":2,"scripts":["scripts/a.py"],"url":"https://github.com/x/y"}"##
        let p = try JSON.decoder.decode(SkillPreview.self, from: Data(json.utf8))
        #expect(p.files.map(\.path) == ["SKILL.md", "scripts/a.py"])
        #expect(p.scripts == ["scripts/a.py"])
    }
}
