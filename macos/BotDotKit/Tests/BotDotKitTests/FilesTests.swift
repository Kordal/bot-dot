import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Files {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    func tempFile(_ name: String, _ contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data(contents.utf8).write(to: url)
        return url
    }

    @Test func aFileAttachedToATaskGoesWithIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Reader")
        let store = try await connected(server)
        store.openBot(id)
        let file = try await store.upload(try tempFile("notes.csv", "a,b\n1,2\n"), to: .bot(id))
        #expect(file.name == "notes.csv")
        try await store.sendToBot("read this", attachments: [file])
        try await eventually("the run") { store.botChat.runs.last?.status == "success" }
        #expect(store.botChat.runs.last?.attachments?.map(\.name) == ["notes.csv"])
    }

    @Test func tooBigAFileIsRefusedBeforeItsSent() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-big.bin")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let h = try FileHandle(forWritingTo: url)
        try h.truncate(atOffset: 26 * 1024 * 1024)
        try h.close()
        let error = await #expect(throws: API.Failure.self) { try await store.upload(url, to: .chief) }
        #expect(error?.message == "\(url.lastPathComponent) is over 25 MB.")
    }

    @Test func aFileTheBotGivesShowsWhileItWorksAndStaysWithItsReply() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Paper")
        try server.hold()
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("make the paper", attachments: [])
        try await eventually("it to work") { store.botChat.live != nil }
        try await server.botAttaches(id, name: "paper.pdf", contents: Data("%PDF-1.7 news".utf8))
        try await eventually("the file, live") { store.botChat.live?.files.map(\.name) == ["paper.pdf"] }
        try server.unhold()
        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }
        let file = try #require(store.botChat.runs.last?.files?.first)
        #expect(file.name == "paper.pdf")
        let data = try await store.download(file)
        #expect(String(decoding: data, as: UTF8.self) == "%PDF-1.7 news")
    }

    @Test func aMessageToTheChiefCanCarryFiles() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        store.openChief(chatId: nil)
        let file = try await store.upload(try tempFile("plan.md", "# Plan"), to: .chief)
        try await store.sendToChief("", attachments: [file])
        try await eventually("the reply") { !store.chief.busy }
        #expect(store.chief.messages.first?.attachments?.map(\.name) == ["plan.md"])
    }
}
