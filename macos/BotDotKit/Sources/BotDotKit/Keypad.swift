import Foundation

/// The keypad, the home of a wide window (#494): every page at once, one under the other (#517), its
/// bots and groups as keys in rows of three, the Chief's chat or the opened key's beside them. The
/// pages are the list's order cut at its headings (SidebarSections), so the list and the keypad can
/// never disagree; the web page and Android draw the same rule. A key dragged to another place or
/// page lands where `move` says.
public enum Keypad {
    /// From this width the window shows the keypad: three keys and a chat fit. Narrower, the list.
    public static let wide = 1000.0
    /// The keys in a row.
    public static let perRow = 3

    /// One page: the pinned bots and groups, a category, or Other.
    public struct Page: Sendable, Hashable, Identifiable {
        public enum Kind: String, Sendable, Hashable { case pinned, category, other }
        /// "Pinned", the category's name, or "Other".
        public let name: String
        public let kind: Kind
        public let keys: [Key]
        public var id: String { kind == .category ? "category:\(name)" : kind.rawValue }
    }

    /// A key: a bot, or a group drawn as one key.
    public enum Key: Sendable, Hashable, Identifiable {
        case bot(Bot)
        case group(BotGroup)
        /// The key of its chat ("bot:<id>", "group:<id>").
        public var id: String {
            switch self {
            case .bot(let b): "bot:\(b.id)"
            case .group(let g): Groups.key(g.id)
            }
        }
        /// The bot's name or the group's, as the key and the Go menu say it.
        public var name: String {
            switch self {
            case .bot(let b): b.name
            case .group(let g): g.name
            }
        }
        /// A group's key: its place is counted among the groups.
        public var isGroup: Bool {
            if case .group = self { return true }
            return false
        }
    }

    /// The list's order as pages: the pinned bots then the pinned groups, the categories A to Z, each
    /// its bots by their order then its groups, and Other last. A page with no key is left out.
    public static func pages(_ s: SidebarSections) -> [Page] {
        let pinned = Page(name: "Pinned", kind: .pinned, keys: s.pinned.map(Key.bot) + s.pinnedGroupChats.map(Key.group))
        let categories = s.groups.map { c in
            Page(name: c.name.isEmpty ? "Other" : c.name, kind: c.name.isEmpty ? .other : .category, keys: c.bots.map(Key.bot) + c.groupChats.map(Key.group))
        }
        return ([pinned] + categories).filter { !$0.keys.isEmpty }
    }

    /// Every key in reading order, page after page: ⌘1–⌘9 count them so (#517).
    public static func keys(_ pages: [Page]) -> [Key] { pages.flatMap(\.keys) }

    /// Where a dragged key lands (#499): `key` dropped on the page at `to`, on its key at `at` (it
    /// takes that one's place) or on its heading (nil: last there, on its own page too). The answer
    /// is the spot the list's own drop takes (`Store.drop`, `Store.dropGroup`): among the pinned
    /// ones, or in the page's category
    /// ("" for Other), counted among its own kind with the dragged key still where it is, as the
    /// list's gap counts it. The bots stand before the groups on a page, so a bot dropped on a group
    /// is the last bot and a group dropped on a bot the first group. nil: it stays where it is, or
    /// there is no such key or page. The web page and Android have the same rule.
    public static func move(_ pages: [Page], _ key: Key, to: Int, at: Int? = nil) -> DropSpot? {
        guard pages.indices.contains(to), let from = pages.firstIndex(where: { page in page.keys.contains { $0.id == key.id } }) else { return nil }
        let target = pages[to]
        let kin = { (k: Key) in k.isGroup == key.isGroup }
        let rest = target.keys.filter { $0.id != key.id }
        let before = at.map { Array(rest.prefix(max($0, 0))) } ?? rest
        let place = before.filter(kin).count + 1
        var gap = place
        if from == to {
            let own = (target.keys.filter(kin).firstIndex { $0.id == key.id } ?? 0) + 1
            if place == own { return nil }
            if own < place { gap = place + 1 } // the gap under the key it takes the place of
        }
        return target.kind == .pinned ? .pinned(gap) : .group(target.kind == .other ? "" : target.name, gap)
    }

    /// What a key's corner says: ⌘1 to ⌘9 for the first nine keys, counted across the pages (0 first),
    /// nothing after.
    public static func label(_ index: Int) -> String? {
        (0..<9).contains(index) ? "⌘\(index + 1)" : nil
    }

    /// The keys held down with a key.
    public struct Modifiers: OptionSet, Sendable, Hashable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let command = Modifiers(rawValue: 1)
        public static let shift = Modifiers(rawValue: 2)
        public static let option = Modifiers(rawValue: 4)
        public static let control = Modifiers(rawValue: 8)
    }

    /// What a key press does on the keypad.
    public enum Action: Sendable, Hashable {
        /// Open the key at this place, counted across the pages (0 first): its chat, as a click on it.
        case open(Int)
        /// The Chief's chat again.
        case chief
        /// The cursor in the search box.
        case search
        case nothing
    }

    /// What a key press does on the Mac: ⌘1–⌘9 open the n-th key, counted across the pages, ⌘0 brings
    /// the Chief back, ⌘K finds. They are menu commands, so they work while the cursor is in a field
    /// (`fieldFocused`), and a plain digit stays in it. `keys`: how many keys the keypad has, on all
    /// its pages. ⌘] and ⌘[ move no page: every page is shown (#517).
    public static func action(key: String, modifiers: Modifiers, fieldFocused: Bool, keys: Int) -> Action {
        guard modifiers == .command else { return .nothing }
        switch key.lowercased() {
        case "0": return .chief
        case "k": return .search
        default:
            guard let n = Int(key), (1...9).contains(n), n <= keys else { return .nothing }
            return .open(n - 1)
        }
    }
}

extension Store {
    /// The keypad's pages, from the list's order.
    public var keypad: [Keypad.Page] { Keypad.pages(sidebar) }

    /// Moves a dragged key (#499) where `Keypad.move` puts it: dropped on the page at `page`, on its
    /// key at `at` or on its heading (nil). Saved through the list's own drop, so the botdot server
    /// gets the list's update and the list shows the same order.
    public func moveKey(_ key: Keypad.Key, toPage page: Int, at: Int?) async throws {
        guard let spot = Keypad.move(keypad, key, to: page, at: at) else { return }
        switch key {
        case .bot(let bot): try await drop(bot.id, at: spot)
        case .group(let group): try await dropGroup(group.id, at: spot)
        }
    }

    /// The colour of the dot on a page's heading: the first bot on it that asks the owner something,
    /// or the member that asks in a group on it. nil when nobody on it asks.
    public func asking(on page: Keypad.Page) -> String? {
        for key in page.keys {
            switch key {
            case .bot(let bot):
                let lastRun = recentRuns.first { $0.botId == bot.id }
                if asksLine(bot, lastRun: lastRun) != nil { return bot.color ?? GroupWords.gone }
            case .group(let group):
                if let a = group.asks { return GroupWords.memberColor(bots, a.botId) }
            }
        }
        return nil
    }
}
