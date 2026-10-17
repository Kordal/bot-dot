import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct SidebarOrder {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    func names(_ bots: [Bot]) -> [String] { bots.map(\.name) }

    @Test func pinnedBotsComeFirstThenGroupsAToZThenOther() async throws {
        let server = try TestServer()
        _ = try await server.makeBot("Zed", group: "Work")
        _ = try await server.makeBot("Alpha", group: "Home")
        _ = try await server.makeBot("Loose")
        let pinned = try await server.makeBot("Star")
        try await server.api("bots/\(pinned)", method: "PUT", body: ["pinned": 1])
        let store = try await connected(server)

        let s = store.sidebar
        #expect(names(s.pinned) == ["Star"])
        #expect(s.groups.map(\.name) == ["Home", "Work", ""])
        #expect(s.groups.map { names($0.bots) } == [["Alpha"], ["Zed"], ["Loose"]])
    }

    @Test func withoutGroupsTheBotsAreOneListInTheOrderTheyCame() async throws {
        let server = try TestServer()
        _ = try await server.makeBot("B")
        _ = try await server.makeBot("A")
        let store = try await connected(server)
        #expect(store.sidebar.groups.map(\.name) == [""])
        #expect(names(store.sidebar.groups[0].bots) == ["B", "A"]) // a new bot goes last in its group
    }

    @Test func pinningPutsABotRightBelowTheChiefAndTheOthersMakeRoom() async throws {
        let server = try TestServer()
        let a = try await server.makeBot("A")
        let b = try await server.makeBot("B")
        let store = try await connected(server)
        try await store.pin(a, at: 1)
        try await store.pin(b, at: 1)
        try await eventually("the order") { self.names(store.sidebar.pinned) == ["B", "A"] }
        try await store.pin(b, at: 0) // unpin: back to its group
        try await eventually("B unpinned") { self.names(store.sidebar.pinned) == ["A"] }
        #expect(names(store.sidebar.groups[0].bots) == ["B"])
    }

    @Test func movingABotToAPlaceInAnotherGroup() async throws {
        let server = try TestServer()
        _ = try await server.makeBot("Mail", group: "Work")
        _ = try await server.makeBot("News", group: "Work")
        let cook = try await server.makeBot("Cook", group: "Home")
        let store = try await connected(server)
        try await store.move(cook, toGroup: "Work", at: 2)
        #expect(store.sidebar.groups.map(\.name) == ["Work"])
        #expect(names(store.sidebar.groups[0].bots) == ["Mail", "Cook", "News"])
    }

    @Test func renamingAndRemovingAGroup() async throws {
        let server = try TestServer()
        _ = try await server.makeBot("Mail", group: "Work")
        _ = try await server.makeBot("Loose")
        let store = try await connected(server)
        try await store.renameGroup("Work", to: "Office")
        #expect(store.sidebar.groups.map(\.name) == ["Office", ""])
        try await store.renameGroup("Office", to: "") // remove: its bots move to Other
        #expect(store.sidebar.groups.map(\.name) == [""])
        #expect(names(store.sidebar.groups[0].bots) == ["Loose", "Mail"])
    }

    @Test func runningCountShowsHowManyRunsGoOn() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Slow")
        try server.hold()
        let store = try await connected(server)
        #expect(store.runningCount == 0)
        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "go"])
        try await eventually("one running") { store.runningCount == 1 }
        try server.unhold()
        try await eventually("none running") { store.runningCount == 0 }
    }
}

@MainActor
@Suite struct SidebarDrops {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    func names(_ bots: [Bot]) -> [String] { bots.map(\.name) }

    @Test func droppingABotLowerInItsOwnGroupLeavesItsPlaceFirst() async throws {
        let server = try TestServer()
        let a = try await server.makeBot("A")
        _ = try await server.makeBot("B")
        _ = try await server.makeBot("C")
        let store = try await connected(server)
        // Dropped below B: the gap at place 3 of [A, B, C].
        try await store.drop(a, at: .group("", 3))
        #expect(names(store.sidebar.groups[0].bots) == ["B", "A", "C"])
    }

    @Test func droppingAPinnedBotIntoAGroupUnpinsIt() async throws {
        let server = try TestServer()
        let star = try await server.makeBot("Star")
        _ = try await server.makeBot("Mail", group: "Work")
        try await server.api("bots/\(star)", method: "PUT", body: ["pinned": 1])
        let store = try await connected(server)
        try await store.drop(star, at: .group("Work", 1))
        #expect(store.sidebar.pinned.isEmpty)
        #expect(names(store.sidebar.groups.first { $0.name == "Work" }!.bots) == ["Star", "Mail"])
    }

    @Test func aDropWhereTheBotAlreadyIsChangesNothing() async throws {
        let server = try TestServer()
        let a = try await server.makeBot("A")
        _ = try await server.makeBot("B")
        let store = try await connected(server)
        #expect(store.dropKeepsPlace(a, at: .group("", 1)))
        #expect(store.dropKeepsPlace(a, at: .group("", 2)))
        #expect(!store.dropKeepsPlace(a, at: .group("", 3)))
        #expect(!store.dropKeepsPlace(a, at: .pinned(1)))
    }
}

/// The list's width, which the owner drags (#385): the web page's limits (public/app.js, sideWidth).
@Suite struct SidebarWidthLimits {
    @Test func theListIsNeverNarrowerThan72OrWiderThan480() {
        #expect(SidebarWidth.fitting(20, window: 1400) == 72)
        #expect(SidebarWidth.fitting(120, window: 1400) == 120)
        #expect(SidebarWidth.fitting(333.4, window: 1400) == 333)
        #expect(SidebarWidth.fitting(900, window: 1400) == 480)
        #expect(SidebarWidth.standard == 300)
    }

    @Test func theChatKeeps420() {
        #expect(SidebarWidth.fitting(480, window: 800) == 380)
        #expect(SidebarWidth.fitting(300, window: 760) == 300, "the smallest window still holds the list as it comes")
        #expect(SidebarWidth.fitting(300, window: 460) == 72, "never under 72, whatever the window")
    }

    @Test func aNarrowListShowsNamesOnlyAndTheNarrowestFiguresOnly() {
        #expect(SidebarWidth.layout(300) == .full)
        #expect(SidebarWidth.layout(240) == .full)
        #expect(SidebarWidth.layout(239) == .names)
        #expect(SidebarWidth.layout(140) == .names)
        #expect(SidebarWidth.layout(139) == .figures)
        #expect(SidebarWidth.layout(72) == .figures)
    }

    @Test func aWindowNotMeasuredYetLimitsNothing() {
        #expect(SidebarWidth.fitting(460, window: nil) == 460)
    }

    @Test func aWidthThatIsNoNumberIsTheStandardOne() {
        #expect(SidebarWidth.fitting(.nan, window: 1400) == 300)
        #expect(SidebarWidth.fitting(.infinity, window: 1400) == 480)
    }
}
