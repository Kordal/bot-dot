import Foundation

/// The bots in the sidebar's order: pinned ones right below the Chief in your order, then the groups
/// A–Z, then the bots without a group ("Other", name ""). Within a group, the order you gave them,
/// A–Z for those never placed (public/app.js drawContacts).
public struct SidebarSections: Sendable {
    public struct Group: Sendable, Identifiable {
        /// "" for the bots without a group.
        public let name: String
        public let bots: [Bot]
        public var id: String { name }
        public init(name: String, bots: [Bot]) {
            self.name = name
            self.bots = bots
        }
        /// The groups of this category, after its bots (see Groups.swift).
        public var groupChats: [BotGroup] = []
    }

    public let pinned: [Bot]
    public let groups: [Group]
    /// The pinned groups, after the pinned bots (see Groups.swift).
    public var pinnedGroupChats: [BotGroup] = []

    public init(pinned: [Bot], groups: [Group]) {
        self.pinned = pinned
        self.groups = groups
    }

    init(_ bots: [Bot]) {
        pinned = bots.filter { ($0.pinned ?? 0) > 0 }.sorted { ($0.pinned ?? 0) < ($1.pinned ?? 0) }
        let rest = bots.filter { ($0.pinned ?? 0) <= 0 }
        let names = Set(rest.compactMap { $0.group }.filter { !$0.isEmpty })
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        groups = (names + [""]).compactMap { name in
            let members = rest.filter { ($0.group ?? "") == name }.sorted(by: Self.byPlace)
            return members.isEmpty ? nil : Group(name: name, bots: members)
        }
    }

    static func byPlace(_ a: Bot, _ b: Bot) -> Bool {
        let oa = (a.order ?? 0) > 0 ? a.order! : Int.max, ob = (b.order ?? 0) > 0 ? b.order! : Int.max
        return oa != ob ? oa < ob : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    /// What the search box finds, for the list and the keypad alike: the bots whose name, description
    /// or category has the words, and the groups whose name, category or members' names have them.
    /// No words: all of it.
    public func matching(_ query: String, bots: [Bot]) -> SidebarSections {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return self }
        let match = { (b: Bot) in "\(b.name) \(b.description ?? "") \(b.group ?? "")".lowercased().contains(q) }
        let chat = { (g: BotGroup) in GroupWords.searchText(g, bots).contains(q) }
        var out = SidebarSections(pinned: pinned.filter(match), groups: groups.compactMap { g in
            var kept = Group(name: g.name, bots: g.bots.filter(match))
            kept.groupChats = g.groupChats.filter(chat)
            return kept.bots.isEmpty && kept.groupChats.isEmpty ? nil : kept
        })
        out.pinnedGroupChats = pinnedGroupChats.filter(chat)
        return out
    }
}

/// How wide the list of bots is: the owner drags its right edge (MainView). The web page's limits
/// (public/app.js, sideWidth): 72 to 480, and the chat keeps 420.
public enum SidebarWidth {
    public static let standard = 300.0
    public static let least = 72.0
    public static let most = 480.0
    public static let chat = 420.0

    /// A width the list may have in a window this wide; nil for a window not measured yet.
    public static func fitting(_ width: Double, window: Double?) -> Double {
        guard !width.isNaN else { return standard }
        return max(least, min(width, most, (window ?? .infinity) - chat)).rounded()
    }

    /// What a list this wide shows of each row, as the web page's (style.css, @container side).
    public enum Layout: Sendable, Equatable {
        /// The figure, the name, the time and the newest line.
        case full
        /// Under 240: the figure and the name.
        case names
        /// Under 140: the figure alone, with the dots of a new reply at its corner.
        case figures
    }

    public static func layout(_ width: Double) -> Layout {
        width < 140 ? .figures : width < 240 ? .names : .full
    }
}

/// Where a dragged bot would land: among the pinned bots, or at a place in a group ("" = Other), 1
/// being first. The place counts the dragged bot where it still is (the gap above or below a row).
public enum DropSpot: Equatable, Sendable {
    case pinned(Int)
    case group(String, Int)
}

extension Store {
    public var sidebar: SidebarSections { SidebarSections(bots).with(groups) }

    /// How many runs go on now (the dot on Settings).
    public var runningCount: Int { recentRuns.filter(\.isRunning).count }

    private var pinnedIds: [String] { sidebar.pinned.map(\.id) }
    private func members(_ group: String) -> [String] { sidebar.groups.first { $0.name == group }?.bots.map(\.id) ?? [] }
    /// A bot's place: among the pinned bots, or in its group (1 = first).
    private func place(of botId: String) -> DropSpot? {
        guard let bot = bots.first(where: { $0.id == botId }) else { return nil }
        if let i = pinnedIds.firstIndex(of: botId) { return .pinned(i + 1) }
        let g = bot.group ?? ""
        return members(g).firstIndex(of: botId).map { .group(g, $0 + 1) }
    }

    /// Dropping it there would leave it where it is (the gap right above or below itself).
    public func dropKeepsPlace(_ botId: String, at spot: DropSpot) -> Bool {
        switch (place(of: botId), spot) {
        case (.pinned(let now)?, .pinned(let at)): return at == now || at == now + 1
        case (.group(let g, let now)?, .group(let to, let at)): return g == to && (at == now || at == now + 1)
        default: return false
        }
    }

    /// Drops a bot where the gap was: pins, reorders or moves it there (public/app.js dropAt).
    public func drop(_ botId: String, at spot: DropSpot) async throws {
        guard !dropKeepsPlace(botId, at: spot), let now = place(of: botId) else { return }
        switch spot {
        case .pinned(let at):
            // It leaves its own place first.
            if case .pinned(let own) = now, own < at { try await pin(botId, at: at - 1) } else { try await pin(botId, at: at) }
        case .group(let g, let at):
            if case .group(let from, let own) = now, from == g, own < at { try await move(botId, toGroup: g, at: at - 1) } else { try await move(botId, toGroup: g, at: at) }
        }
    }

    /// Pins a bot at a place right below the Chief (1 = first; 0 = unpin: last in its group), the
    /// others making room.
    public func pin(_ botId: String, at place: Int) async throws {
        guard let api, bots.contains(where: { $0.id == botId }) else { return }
        defer { Task { try? await loadBots() } } // the server's order, whatever happens
        // Right away; the save follows.
        var pinned = pinnedIds.filter { $0 != botId }
        let group = bots.first { $0.id == botId }?.group ?? ""
        var inGroup = members(group).filter { $0 != botId }
        if place > 0 { pinned.insert(botId, at: min(place, pinned.count + 1) - 1) } else { inGroup.append(botId) }
        arrange(pinned: pinned, group: group, members: inGroup)
        struct Pin: Encodable { let pinned: Int }
        try await api.send("bots/\(botId)", method: "PUT", body: Pin(pinned: place))
        try await loadBots()
    }

    /// Puts a bot at a place in a group ("" = Other; 1 = first), from another group or from the
    /// pinned ones.
    public func move(_ botId: String, toGroup group: String, at place: Int) async throws {
        guard let api, let bot = bots.first(where: { $0.id == botId }) else { return }
        defer { Task { try? await loadBots() } }
        let wasPinned = (bot.pinned ?? 0) > 0
        let from = bot.group ?? ""
        var inGroup = members(group).filter { $0 != botId }
        inGroup.insert(botId, at: min(place, inGroup.count + 1) - 1)
        if let i = bots.firstIndex(where: { $0.id == botId }) { bots[i].group = group }
        arrange(pinned: pinnedIds.filter { $0 != botId }, group: group, members: inGroup)
        if from != group { arrange(pinned: nil, group: from, members: members(from).filter { $0 != botId }) }
        struct Move: Encodable { let group: String; let order: Int; let pinned: Int? }
        try await api.send("bots/\(botId)", method: "PUT", body: Move(group: group, order: place, pinned: wasPinned ? 0 : nil))
        try await loadBots()
    }

    /// Numbers the pinned bots and a group's bots in this order, as the server will (1, 2, 3…).
    private func arrange(pinned: [String]?, group: String, members: [String]) {
        for i in bots.indices {
            if let pinned {
                bots[i].pinned = pinned.firstIndex(of: bots[i].id).map { $0 + 1 } ?? 0
            }
            if let n = members.firstIndex(of: bots[i].id) {
                bots[i].group = group
                bots[i].order = n + 1
            }
        }
    }

    /// Renames a group, or removes it (`to` ""): its bots move with it, to Other when removed.
    public func renameGroup(_ from: String, to: String) async throws {
        guard let api else { return }
        struct Rename: Encodable { let from: String; let to: String }
        try await api.send("groups/rename", body: Rename(from: from, to: to))
        try await loadBots()
    }

    /// Whether a newer botdot server is waiting (the dot on Settings).
    func loadUpdateStatus() async {
        guard let api else { return }
        struct Updates: Decodable { let available: Bool? }
        if let u: Updates = try? await api.get("updates") { updateAvailable = u.available ?? false }
    }
}
