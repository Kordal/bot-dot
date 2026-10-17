import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Dashboard {
    @Test func aScriptTileWaitsForYourOKThenShowsItsValueAndSwitches() async throws {
        let server = try TestServer()
        let bot = try await server.makeBot("Home")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        try await server.api("dashboard/tiles", method: "POST", body: ["kind": "value", "title": "Disk", "bot": bot, "unit": "%", "section": "Servers", "read": ["type": "script", "script": "echo 42"]], asChief: true)
        try await server.api("dashboard/tiles", method: "POST", body: ["kind": "switch", "title": "Lamp", "bot": bot,
            "read": ["type": "script", "script": "cat state 2>/dev/null || echo off"],
            "turnOn": ["type": "script", "script": "echo on > state"], "turnOff": ["type": "script", "script": "echo off > state"]], asChief: true)

        try await eventually("both to wait") { store.needs.filter { $0.kind == .tile }.count == 2 }
        #expect(store.needs.first { $0.kind == .tile }?.body.isEmpty == false) // its script shows
        for x in store.needs where x.kind == .tile { try await store.decide(x, yes: true) }
        #expect(store.needs.isEmpty)

        try await eventuallyAsync("the disk's value") {
            await store.loadDashboard()
            return store.dashboard.tiles.first { $0.title == "Disk" }?.look?.short == "42 %"
        }
        #expect(store.dashboard.sections == ["Servers"])
        let lamp = try #require(store.dashboard.tiles.first { $0.title == "Lamp" })
        #expect(lamp.look?.tap == "toggle")
        #expect(lamp.look?.dot?.filled == false)
        try await store.tap(lamp)
        #expect(store.dashboard.tiles.first { $0.title == "Lamp" }?.look?.dot?.filled == true)
    }

    @Test func tilesMoveBetweenHeadingsAndAreRemoved() async throws {
        let server = try TestServer()
        let bot = try await server.makeBot("Home")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        for t in ["Plan", "Notes"] {
            try await server.api("dashboard/tiles", method: "POST", body: ["kind": "note", "title": t, "bot": bot], asChief: true)
        }
        await store.loadDashboard()
        let plan = try #require(store.dashboard.tiles.first { $0.title == "Plan" })
        #expect(plan.look?.tap == "panel")
        try await store.moveTile(plan.id, section: "Today", parent: nil, before: nil)
        #expect(store.dashboard.tiles.first { $0.id == plan.id }?.section == "Today")
        try await store.removeTile(plan.id)
        #expect(store.dashboard.tiles.map(\.title) == ["Notes"])
    }
}
