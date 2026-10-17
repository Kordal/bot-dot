import Foundation

/// A value a block or control carries: text, a number, true / false, or nothing.
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string((try? c.decode(String.self)) ?? "") }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        }
    }
    public var any: Any {
        switch self {
        case .string(let s): s
        case .number(let n): n
        case .bool(let b): b
        case .null: NSNull()
        }
    }
    public var text: String {
        switch self {
        case .string(let s): s
        case .number(let n): n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b): String(b)
        case .null: ""
        }
    }
}

/// A tile's dot: filled (on), a ring (off), or unknown.
public struct TileDot: Codable, Hashable, Sendable {
    public var filled: Bool?
    public var color: String?
    public var big: Bool?
    public var label: String?
}

/// One piece of a tile, as the server fills it in (docs/api.md, "The dashboard"): the apps draw it as
/// it comes.
public indirect enum TileBlock: Decodable, Hashable, Sendable {
    case text(text: String, size: String?, muted: Bool, markdown: Bool, lines: Int?)
    case value(text: String, unit: String?, color: String?)
    case dot(TileDot)
    case list(items: [String], max: Int)
    case progress(ratio: Double?, text: String?, color: String?)
    case gauge(ratio: Double?, text: String?, color: String?)
    case chart(points: [Double], color: String?, text: String?)
    case image(src: String, height: String?, fit: String?)
    case chat(label: String?)
    case toggle(key: String, on: Bool?, label: String?)
    case button(key: String, label: String)
    case slider(key: String, value: Double?, min: Double, max: Double, step: Double, unit: String?, percent: Bool, label: String?)
    case color(key: String, value: String?, label: String?)
    case choice(key: String, options: [Option], value: JSONValue?, label: String?)
    case row([TileBlock])
    case column([TileBlock])
    case unknown

    public struct Option: Decodable, Hashable, Sendable {
        public let label: String
        public let value: JSONValue
    }

    enum Keys: String, CodingKey {
        case type, text, size, muted, markdown, lines, unit, color, filled, big, label, items, max, ratio, points, src, height, fit, key, on, value, min, step, percent, options, blocks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        func s(_ k: Keys) -> String? { try? c.decodeIfPresent(String.self, forKey: k) }
        func d(_ k: Keys) -> Double? { try? c.decodeIfPresent(Double.self, forKey: k) }
        func b(_ k: Keys) -> Bool? { try? c.decodeIfPresent(Bool.self, forKey: k) }
        let key = s(.key) ?? ""
        switch s(.type) ?? "" {
        case "text": self = .text(text: s(.text) ?? "", size: s(.size), muted: b(.muted) ?? false, markdown: b(.markdown) ?? false, lines: (try? c.decodeIfPresent(Int.self, forKey: .lines)) ?? nil)
        case "value": self = .value(text: s(.text) ?? "", unit: s(.unit), color: s(.color))
        case "dot": self = .dot(TileDot(filled: b(.filled), color: s(.color), big: b(.big), label: s(.label)))
        case "list": self = .list(items: (try? c.decodeIfPresent([String].self, forKey: .items)) ?? [], max: (try? c.decodeIfPresent(Int.self, forKey: .max)) ?? 8)
        case "progress": self = .progress(ratio: d(.ratio), text: s(.text), color: s(.color))
        case "gauge": self = .gauge(ratio: d(.ratio), text: s(.text), color: s(.color))
        case "chart": self = .chart(points: (try? c.decodeIfPresent([Double].self, forKey: .points)) ?? [], color: s(.color), text: s(.text))
        case "image": self = .image(src: s(.src) ?? "", height: s(.height), fit: s(.fit))
        case "chat": self = .chat(label: s(.label))
        case "switch": self = .toggle(key: key, on: b(.on), label: s(.label))
        case "button": self = .button(key: key, label: s(.label) ?? "")
        case "slider": self = .slider(key: key, value: d(.value), min: d(.min) ?? 0, max: d(.max) ?? 100, step: d(.step) ?? 1, unit: s(.unit), percent: b(.percent) ?? false, label: s(.label))
        case "color": self = .color(key: key, value: s(.value), label: s(.label))
        case "choice": self = .choice(key: key, options: (try? c.decodeIfPresent([Option].self, forKey: .options)) ?? [], value: try? c.decodeIfPresent(JSONValue.self, forKey: .value), label: s(.label))
        case "row": self = .row((try? c.decodeIfPresent([TileBlock].self, forKey: .blocks)) ?? [])
        case "column": self = .column((try? c.decodeIfPresent([TileBlock].self, forKey: .blocks)) ?? [])
        default: self = .unknown
        }
    }
}

/// What to draw for a tile, already worked out by the server.
public struct TileLook: Decodable, Hashable, Sendable {
    public var dot: TileDot?
    public var face: [TileBlock]
    public var panel: [TileBlock]?
    /// toggle, act, refresh, panel, chat, group or none.
    public var tap: String
    /// A few words for the strip at the top of the sidebar.
    public var short: String?
}

/// A tile on the dashboard.
public struct Tile: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var kind: String
    public var title: String
    public var section: String?
    /// The group tile it's in.
    public var parent: String?
    /// small, wide, big or row.
    public var size: String?
    public var color: String?
    public var bot: String?
    public var approved: Bool?
    /// A tap starts a run of its bot.
    public var asks: Bool?
    public var error: String?
    public var changedBy: String?
    /// Who carries on after the yes on a tile that waits (docs/api.md "What follows a yes").
    public var then: Then?
    /// A change that waits beside the approved tile, and what the buttons of a tile that waits read,
    /// in the server's words (docs/api.md "A change that waits" and "Decline"). See Changes.swift.
    public var change: TileChange?
    public var no: CardText?
    public var yes: CardText?
    public var look: TileLook?
    // Its sources, for a tile waiting for your OK (its scripts are shown on the card).
    public var read: Source?
    public var `do`: Source?
    public var turnOn: Source?
    public var turnOff: Source?

    /// Its named reads and named actions, each a source as the four above.
    public var reads: [String: Source]?
    public var actions: [String: Source]?
    /// Every script it would run, as the server lists them (`needs-text`): those of its named reads
    /// and named actions too.
    public var scripts: [String]?

    public struct Source: Decodable, Hashable, Sendable {
        public var type: String?
        public var script: String?
    }

    /// The scripts it would run: the server's list, or from a server without one those of its
    /// sources, the named ones by their names.
    public var itsScripts: [String] {
        if let scripts, !scripts.isEmpty { return scripts }
        func named(_ sources: [String: Source]?) -> [Source?] { (sources ?? [:]).sorted { $0.key < $1.key }.map(\.value) }
        return ([read, `do`, turnOn, turnOff] + named(reads) + named(actions)).compactMap { $0?.type == "script" ? $0?.script : nil }
    }

    /// What a tile that asks its bot says after a tap, as the web page and the Android app:
    /// `queued`, the bot was busy and the request waits its turn.
    public static func asked(_ bot: String?, queued: Bool) -> String {
        queued ? "\(bot ?? "Its bot") will do it when it is free" : "Asked \(bot ?? "its bot")"
    }
}

/// A tile a bot suggested.
public struct TileSuggestion: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var bot: String?
    public var reason: String?
    /// Who carries on after a yes (`proposal-carries-on`).
    public var then: Then?
    public var tile: Suggested
    public struct Suggested: Decodable, Hashable, Sendable {
        public var kind: String?
        public var title: String
        public var wide: Bool?
        public var scripts: [String]?
    }
}

public struct DashboardState: Decodable, Sendable {
    public var sections: [String] = []
    public var tiles: [Tile] = []
    /// Tiles whose script waits for the owner's OK.
    public var pending: [Tile] = []
    public var suggestions: [TileSuggestion] = []
    public init() {}
}

extension Store {
    /// Reads cached state, or refreshes stale values and pictures with an owner POST.
    public func loadDashboard(quiet: Bool = false) async {
        guard let api else { return }
        let result: DashboardState? = quiet
            ? try? await api.get("dashboard?quiet")
            : try? await api.send("dashboard/refresh")
        guard let d = result else { return }
        dashboard = d
    }

    /// Does a tile's thing: switches it (toggle), does its action (act) or reads it again (refresh).
    /// True when the tile asks its bot and the bot was busy: the request waits its turn (`queued`).
    @discardableResult
    public func tap(_ tile: Tile) async throws -> Bool {
        guard let api else { return false }
        var body: [String: Any] = [:]
        if tile.look?.tap == "toggle" {
            let on = tile.look?.dot?.filled != true
            body["on"] = on
            // Right away; the answer follows.
            replace(tile.id) { $0.look?.dot?.filled = on }
        }
        let data = try JSONSerialization.data(withJSONObject: body)
        let answer = try await api.sendJSON("dashboard/tiles/\(tile.id)/tap", body: data)
        let t = try JSON.decoder.decode(Tile.self, from: answer)
        replace(tile.id) { $0 = t }
        return Self.waitsItsTurn(answer)
    }

    private struct Waits: Decodable { let queued: CardFlag? }
    private static func waitsItsTurn(_ answer: Data) -> Bool { (try? JSON.decoder.decode(Waits.self, from: answer))?.queued?.value == true }

    /// Uses a control on a tile (a switch, button, slider, colour or choice).
    /// True when it waits its turn, as `tap`.
    @discardableResult
    public func act(_ tile: Tile, key: String, value: JSONValue) async throws -> Bool {
        guard let api else { return false }
        let data = try JSONSerialization.data(withJSONObject: ["block": key, "value": value.any])
        let answer = try await api.sendJSON("dashboard/tiles/\(tile.id)/act", body: data)
        let t = try JSON.decoder.decode(Tile.self, from: answer)
        replace(tile.id) { $0 = t }
        return Self.waitsItsTurn(answer)
    }

    /// Moves a tile under a heading or into a group, before another tile (nil: at the end there).
    public func moveTile(_ id: String, section: String?, parent: String?, before: String?) async throws {
        guard let api else { return }
        var body: [String: Any] = [:]
        if let section { body["section"] = section }
        body["parent"] = parent ?? NSNull()
        body["before"] = before ?? NSNull()
        let data = try JSONSerialization.data(withJSONObject: body)
        _ = try await api.sendJSON("dashboard/tiles/\(id)/move", body: data)
        await loadDashboard(quiet: true)
    }

    /// Removes a tile; a group's tiles stay, loose, unless `all`.
    public func removeTile(_ id: String, all: Bool = false) async throws {
        guard let api else { return }
        try await api.send("dashboard/tiles/\(id)\(all ? "?all" : "")", method: "DELETE")
        await loadDashboard(quiet: true)
    }

    /// Adds a suggested tile (your OK, script included), or drops it for good. Returns what the
    /// server says a yes started (`carriesOn`), from one that says it (`proposal-carries-on`).
    @discardableResult
    public func answer(_ s: TileSuggestion, add: Bool) async throws -> Answered {
        guard let api else { return Answered() }
        let data = try JSONSerialization.data(withJSONObject: ["add": add])
        let said = Answered.of(try await api.sendJSON("dashboard/suggestions/\(s.id)", body: data))
        await loadDashboard(quiet: true)
        return Answered(carriesOn: add && has(.proposalCarriesOn) ? said.carriesOn : nil)
    }

    /// Where a tile's picture is.
    public func imageURL(_ src: String) -> URL? {
        guard let api else { return nil }
        return URL(string: "api" + src, relativeTo: api.base.appendingPathComponent("/"))?.absoluteURL
    }

    /// An image tile's picture, asked with this app's session (behind a front door nothing loads without it).
    public func tileImage(_ src: String) async -> Data? {
        guard let api, let url = imageURL(src), let req = try? api.request(url: url) else { return nil }
        guard let (data, status) = try? await api.load(req), status == 200 else { return nil }
        return data
    }

    func replace(_ id: String, _ change: (inout Tile) -> Void) {
        if let i = dashboard.tiles.firstIndex(where: { $0.id == id }) { change(&dashboard.tiles[i]) }
    }
}
