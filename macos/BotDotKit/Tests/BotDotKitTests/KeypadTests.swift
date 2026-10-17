import Foundation
import Testing
@testable import BotDotKit

/// The keypad, the home of a wide window (#494, #497): the list's order as pages of keys, and what a
/// key press does. The pages' cases are the spec's, the same on the web page and Android.
@Suite struct KeypadPages {
    static func bots(_ text: String) -> [Bot] { (try? JSONDecoder().decode([Bot].self, from: Data(text.utf8))) ?? [] }
    static func groups(_ text: String) -> [BotGroup] { BotGroup.list(Data(text.utf8)) }
    static func pages(_ bots: String, _ groups: String = "[]") -> [Keypad.Page] {
        Keypad.pages(SidebarSections(Self.bots(bots)).with(Self.groups(groups)))
    }
    /// A page as "name: key, key": bots by name, groups by name in brackets.
    static func drawn(_ pages: [Keypad.Page]) -> [String] {
        pages.map { page in
            "\(page.name): " + page.keys.map { key -> String in
                switch key {
                case .bot(let b): b.name
                case .group(let g): "[\(g.name)]"
                }
            }.joined(separator: ", ")
        }
    }

    @Test func withoutCategoriesEveryBotIsOnOnePageOther() {
        let pages = Self.pages(#"[{"id":"a","name":"Alpha","order":2},{"id":"b","name":"Beta","order":1}]"#)
        #expect(Self.drawn(pages) == ["Other: Beta, Alpha"], "in the order the list has them")
        #expect(pages.map(\.kind) == [.other])
    }

    @Test func pinnedBotsThenPinnedGroupsAreTheFirstPage() {
        let pages = Self.pages(
            #"[{"id":"n","name":"News","pinned":2},{"id":"f","name":"Fleet","pinned":1},{"id":"c","name":"Cook","group":"Home"}]"#,
            #"[{"id":"g2","name":"Late","members":["n","f"],"pinned":2},{"id":"g1","name":"Top","members":["n","f"],"pinned":1}]"#)
        #expect(Self.drawn(pages) == ["Pinned: Fleet, News, [Top], [Late]", "Home: Cook"])
        #expect(pages.map(\.kind) == [.pinned, .category])
    }

    @Test func categoriesAreInOrderAToZAndOtherIsLast() {
        let pages = Self.pages(#"[{"id":"l","name":"Loose"},{"id":"z","name":"Zed","group":"Work"},{"id":"m","name":"Money","group":"money"},{"id":"a","name":"Alpha","group":"Home"}]"#)
        #expect(Self.drawn(pages) == ["Home: Alpha", "money: Money", "Work: Zed", "Other: Loose"])
        #expect(pages.map(\.kind) == [.category, .category, .category, .other])
    }

    @Test func aBotNeverPlacedComesAfterThePlacedOnesAToZ() {
        let pages = Self.pages(#"[{"id":"z","name":"Zed","group":"Work","order":0},{"id":"a","name":"alpha","group":"Work"},{"id":"m","name":"Mail","group":"Work","order":2},{"id":"s","name":"Sorter","group":"Work","order":1}]"#)
        #expect(Self.drawn(pages) == ["Work: Sorter, Mail, alpha, Zed"])
    }

    @Test func aCategorysGroupsStandAfterItsBots() {
        let pages = Self.pages(
            #"[{"id":"c","name":"Coder","group":"Dev","order":1},{"id":"r","name":"Reviewer","group":"Dev","order":2},{"id":"l","name":"Loose"}]"#,
            #"[{"id":"g2","name":"Pair","members":["c","r"],"category":"Dev","order":2},{"id":"g1","name":"Team","members":["c","r"],"category":"Dev","order":1},{"id":"g3","name":"All","members":["c","l"]}]"#)
        #expect(Self.drawn(pages) == ["Dev: Coder, Reviewer, [Team], [Pair]", "Other: Loose, [All]"])
    }

    @Test func emptyPagesAreLeftOut() {
        // Nothing pinned: no Pinned page; every bot in a category: no Other.
        let pages = Self.pages(#"[{"id":"c","name":"Cook","group":"Home"}]"#)
        #expect(Self.drawn(pages) == ["Home: Cook"])
        // A category that holds only a group is a page.
        let onlyGroup = Self.pages(#"[{"id":"c","name":"Cook","pinned":1},{"id":"d","name":"Dish","pinned":2}]"#, #"[{"id":"g","name":"Kitchen","members":["c","d"],"category":"Home"}]"#)
        #expect(Self.drawn(onlyGroup) == ["Pinned: Cook, Dish", "Home: [Kitchen]"])
        #expect(Keypad.pages(SidebarSections(pinned: [], groups: [])).isEmpty, "no bots: no pages")
    }

    @Test func aPageWithMoreThanNineKeysHoldsThemAllAndOnlyTheFirstNineHaveADigit() {
        let many = (1...11).map { #"{"id":"b\#($0)","name":"Bot \#($0)","group":"Big","order":\#($0)}"# }.joined(separator: ",")
        let pages = Self.pages("[\(many)]")
        #expect(pages.count == 1)
        #expect(pages[0].keys.count == 11)
        #expect(Self.drawn(pages)[0].hasSuffix("Bot 10, Bot 11"))
        #expect((0..<11).map(Keypad.label) == ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9", nil, nil])
    }

    @Test func againstAServerWithoutGroupsThePagesHoldBotsOnly() {
        let pages = Self.pages(#"[{"id":"f","name":"Fleet","pinned":1},{"id":"c","name":"Cook","group":"Home"},{"id":"l","name":"Loose"}]"#)
        #expect(Self.drawn(pages) == ["Pinned: Fleet", "Home: Cook", "Other: Loose"])
    }

    @Test func aPageHasTheNameOfItsCategoryAndKeepsItsPlaceByIt() {
        let pages = Self.pages(#"[{"id":"f","name":"Fleet","pinned":1},{"id":"c","name":"Cook","group":"Home"},{"id":"l","name":"Loose"}]"#)
        #expect(pages.map(\.id) == ["pinned", "category:Home", "other"])
        #expect(pages[1].keys.map(\.id) == ["bot:c"])
        #expect(Keypad.Key.group(Self.groups(#"[{"id":"g1","name":"Dev"}]"#)[0]).id == "group:g1", "a group's key is its chat's key")
    }
}

/// What a key press on the Mac does (#497): ⌘1–⌘9 open the first nine keys, counted across the
/// pages (#517), ⌘0 brings the Chief back, ⌘K finds. Anything else does nothing.
@Suite struct KeypadKeys {
    static func press(_ key: String, _ modifiers: Keypad.Modifiers = .command, field: Bool = false, keys: Int = 9) -> Keypad.Action {
        Keypad.action(key: key, modifiers: modifiers, fieldFocused: field, keys: keys)
    }

    @Test func commandAndADigitOpensThatKey() {
        #expect((1...9).map { Self.press("\($0)") } == (0..<9).map { Keypad.Action.open($0) })
        #expect(Self.press("3", field: true) == .open(2), "a menu command, also while the cursor is in a message box")
    }

    @Test func aDigitPastTheKeysDoesNothing() {
        #expect(Self.press("4", keys: 3) == .nothing)
        #expect(Self.press("3", keys: 3) == .open(2))
        #expect(Self.press("1", keys: 0) == .nothing)
    }

    @Test func theDigitsCountTheKeysAcrossThePages() {
        // Every page is shown at once (#517): the second key is the first of the second page.
        let pages = KeypadPages.pages(#"[{"id":"f","name":"Fleet","pinned":1},{"id":"c","name":"Cook","group":"Home"},{"id":"d","name":"Dish","group":"Home"},{"id":"l","name":"Loose"}]"#)
        let keys = Keypad.keys(pages)
        #expect(keys.map(\.name) == ["Fleet", "Cook", "Dish", "Loose"])
        #expect(Self.press("2", keys: keys.count) == .open(1))
        #expect(Self.press("4", keys: keys.count) == .open(3))
        #expect(Self.press("5", keys: keys.count) == .nothing)
    }

    @Test func commandBracketsMoveNoPage() {
        // Every page is shown, so there is none to move to (#517).
        #expect(Self.press("]") == .nothing)
        #expect(Self.press("[") == .nothing)
    }

    @Test func commandZeroBringsTheChiefBackAndCommandKFinds() {
        #expect(Self.press("0") == .chief)
        #expect(Self.press("k") == .search)
        #expect(Self.press("K") == .search)
        #expect(Self.press("0", field: true) == .chief)
    }

    @Test func aPlainDigitDoesNothing() {
        #expect(Self.press("1", []) == .nothing)
        #expect(Self.press("1", [], field: true) == .nothing, "it stays in the message")
        #expect(Self.press("]", []) == .nothing)
    }

    @Test func aDigitWithAnotherModifierDoesNothing() {
        // ⇧⌘1–4 are Activity, Skills, Connectors and Vault.
        #expect(Self.press("1", [.command, .shift]) == .nothing)
        #expect(Self.press("1", [.command, .option]) == .nothing)
        #expect(Self.press("1", .control) == .nothing)
        #expect(Self.press("x") == .nothing)
    }
}

/// A page's heading carries a dot in the colour of a bot on it that asks the owner something.
@MainActor
@Suite struct KeypadAsks {
    func store(_ bots: String, groups: String = "[]") throws -> Store {
        let store = Store()
        store.features = [Feature.asksYou.rawValue, Feature.groups.rawValue]
        store.bots = try JSONDecoder().decode([Bot].self, from: Data(bots.utf8))
        store.groups = BotGroup.list(Data(groups.utf8))
        return store
    }

    @Test func aPageWithABotThatAsksHasItsColour() throws {
        let store = try store(##"[{"id":"a","name":"Calm","color":"#16a34a","group":"Home"},{"id":"b","name":"Mail","color":"#378add","group":"Home","asks":{"text":"Send it?"}},{"id":"c","name":"Cook","group":"Work"}]"##)
        let pages = store.keypad
        #expect(pages.map(\.name) == ["Home", "Work"])
        #expect(store.asking(on: pages[0]) == "#378add")
        #expect(store.asking(on: pages[1]) == nil)
    }

    @Test func aPageWithAGroupWhoseMemberAsksHasThatMembersColour() throws {
        let store = try store(##"[{"id":"c","name":"Coder","color":"#3b82f6"},{"id":"r","name":"Reviewer","color":"#16a34a"}]"##,
                              groups: ##"[{"id":"g1","name":"Dev","members":["c","r"],"asks":{"botId":"r","botName":"Reviewer","text":"Which one?"}}]"##)
        #expect(store.asking(on: store.keypad[0]) == "#16a34a")
    }

    @Test func againstAServerThatDoesNotSayWhoAsksNoHeadingHasADot() throws {
        let store = try store(##"[{"id":"b","name":"Mail","color":"#378add","asks":{"text":"Send it?"}}]"##)
        store.features = []
        #expect(store.asking(on: store.keypad[0]) == nil)
    }
}

/// Search on the keypad finds what the list's search finds (#494, story 33).
@Suite struct KeypadSearch {
    @Test func theMatchesAreTheBotsWhoseNameDescriptionOrCategoryHasTheWordsAndTheGroupsWithThem() {
        let bots = KeypadPages.bots(#"[{"id":"m","name":"Mail","group":"Work","pinned":1},{"id":"n","name":"News","description":"Reads the mail feeds"},{"id":"c","name":"Cook","group":"Home"},{"id":"x","name":"Ledger","group":"Mailroom"}]"#)
        let groups = KeypadPages.groups(#"[{"id":"g1","name":"Desk","members":["m","c"],"category":"Home"},{"id":"g2","name":"Kitchen","members":["c"],"category":"Home"}]"#)
        let s = SidebarSections(bots).with(groups).matching("mail", bots: bots)
        #expect(KeypadPages.drawn(Keypad.pages(s)) == ["Pinned: Mail", "Home: [Desk]", "Mailroom: Ledger", "Other: News"])
        let all = SidebarSections(bots).with(groups)
        #expect(all.matching("", bots: bots).groups.map(\.name) == all.groups.map(\.name), "no words: everything")
    }
}

/// Where a dragged key lands (#499), the same cases as the web page's and Android's. The answer is
/// the spot the list's own drop takes (`Store.drop`, `Store.dropGroup`): counted among its own kind,
/// with the dragged key still where it is, as the list's gap counts it.
@Suite struct KeypadMoves {
    /// Pinned: News, Lights, [Evening]; Home: Garden, Mail, Cook, [Kitchen], [Porch]; Other: Notes.
    static let pages = KeypadPages.pages(
        #"[{"id":"news","name":"News","pinned":1,"group":"Work"},{"id":"lights","name":"Lights","pinned":2},{"id":"garden","name":"Garden","group":"Home","order":1},{"id":"mail","name":"Mail","group":"Home","order":2},{"id":"cook","name":"Cook","group":"Home","order":3},{"id":"notes","name":"Notes"}]"#,
        #"[{"id":"evening","name":"Evening","members":["news","lights"],"pinned":1},{"id":"kitchen","name":"Kitchen","members":["cook","mail"],"category":"Home","order":1},{"id":"porch","name":"Porch","members":["garden","mail"],"category":"Home","order":2}]"#)

    /// Drags the key named `name` and drops it on the page `to`: on its key at `at`, or on its heading (nil).
    static func move(_ name: String, _ to: Int, _ at: Int? = nil) -> DropSpot? {
        let key = pages.flatMap(\.keys).first { $0.name == name }!
        return Keypad.move(pages, key, to: to, at: at)
    }

    @Test func thePagesTheMovesStartFrom() {
        #expect(KeypadPages.drawn(Self.pages) == ["Pinned: News, Lights, [Evening]", "Home: Garden, Mail, Cook, [Kitchen], [Porch]", "Other: Notes"])
    }

    @Test func aKeyDroppedOnAnotherKeyOfItsPageTakesItsPlaceAmongItsOwnKind() {
        #expect(Self.move("Cook", 1, 0) == .group("Home", 1), "onto the first: first")
        #expect(Self.move("Garden", 1, 2) == .group("Home", 4), "onto the third: the gap under it, which the drop makes third")
        #expect(Self.move("Garden", 1, 1) == .group("Home", 3))
        #expect(Self.move("Porch", 1, 3) == .group("Home", 1), "a group onto the first group: the first group")
        #expect(Self.move("Lights", 0, 0) == .pinned(1))
        #expect(Self.move("News", 0, 1) == .pinned(3))
    }

    @Test func botsStayBeforeGroupsOnAPage() {
        #expect(Self.move("Garden", 1, 4) == .group("Home", 4), "a bot onto a group: the last bot")
        #expect(Self.move("Porch", 1, 0) == .group("Home", 1), "a group onto a bot: the first group")
        #expect(Self.move("News", 0, 2) == .pinned(3))
    }

    @Test func aKeyDroppedWhereItIsOrOnItsOwnPagesHeadingWhenLastThereAlreadyDoesNotMove() {
        #expect(Self.move("Mail", 1, 1) == nil)
        #expect(Self.move("Kitchen", 1, 3) == nil)
        #expect(Self.move("Lights", 0, 1) == nil)
        #expect(Self.move("Cook", 1) == nil, "the last bot of its page")
        #expect(Self.move("Porch", 1) == nil, "the last group of its page")
        #expect(Self.move("Evening", 0) == nil)
        #expect(Self.move("Lights", 0, 2) == nil)
    }

    @Test func onItsOwnPagesHeadingAKeyGoesLastThereAmongItsKind() {
        // Every page is shown with its heading (#517): the gap under the last of its kind.
        #expect(Self.move("Mail", 1) == .group("Home", 4))
        #expect(Self.move("Kitchen", 1) == .group("Home", 3))
        #expect(Self.move("News", 0) == .pinned(3))
    }

    @Test func onAnotherPagesHeadingAKeyGoesLastThere() {
        #expect(Self.move("Mail", 0) == .pinned(3), "onto Pinned: pinned last")
        #expect(Self.move("Kitchen", 0) == .pinned(2), "a group: last of the pinned groups")
        #expect(Self.move("Notes", 1) == .group("Home", 4))
        #expect(Self.move("Evening", 1) == .group("Home", 3), "a pinned group to a category")
        #expect(Self.move("Lights", 2) == .group("", 2), "a pinned bot onto Other")
        #expect(Self.move("Cook", 2) == .group("", 2))
    }

    @Test func aKeyDroppedOnAKeyOfAnotherPageTakesItsPlaceThere() {
        #expect(Self.move("Notes", 1, 1) == .group("Home", 2))
        #expect(Self.move("Mail", 0, 0) == .pinned(1))
        #expect(Self.move("Mail", 2, 1) == .group("", 2), "onto the last place, after the last page's keys: last on the last page")
    }

    @Test func aKeyOnNoPageOrAPageThatIsNotThereMovesNothing() {
        let ghost = Keypad.Key.bot(KeypadPages.bots(#"[{"id":"ghost","name":"Ghost","group":"Home"}]"#)[0])
        #expect(Keypad.move(Self.pages, ghost, to: 1) == nil)
        #expect(Keypad.move(Self.pages, Self.pages[1].keys[0], to: 7) == nil)
    }
}

/// A key moved on the keypad is saved through the list's own drop, so the botdot server gets the
/// list's update and the list shows the same order and categories (#499).
@MainActor
@Suite struct KeypadDrops {
    func names(_ bots: [Bot]) -> [String] { bots.map(\.name) }

    @Test func aKeyMovedOnTheKeypadIsWhereTheListShowsIt() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let star = try await server.makeBot("Star")
        try await server.api("bots/\(star)", method: "PUT", body: ["pinned": 1])
        _ = try await server.makeBot("Alpha", group: "Home")
        _ = try await server.makeBot("Beta", group: "Home")
        _ = try await server.makeBot("Gamma", group: "Home")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        defer { store.disconnect() }
        func page(_ name: String) -> Int { store.keypad.firstIndex { $0.name == name }! }
        func key(_ name: String) -> Keypad.Key { store.keypad.flatMap(\.keys).first { $0.name == name }! }
        func home() -> [String] { names(store.sidebar.groups.first { $0.name == "Home" }?.bots ?? []) }
        #expect(KeypadPages.drawn(store.keypad) == ["Pinned: Star", "Home: Alpha, Beta, Gamma"])

        // Alpha onto Gamma's key: third in Home, in the list too.
        try await store.moveKey(key("Alpha"), toPage: page("Home"), at: 2)
        try await eventually("Alpha third") { home() == ["Beta", "Gamma", "Alpha"] }
        // Gamma onto the Pinned heading: pinned last.
        try await store.moveKey(key("Gamma"), toPage: page("Pinned"), at: nil)
        try await eventually("Gamma pinned") { self.names(store.sidebar.pinned) == ["Star", "Gamma"] && home() == ["Beta", "Alpha"] }
        // Star onto the Home heading: out of the pinned ones, last in Home.
        try await store.moveKey(key("Star"), toPage: page("Home"), at: nil)
        try await eventually("Star in Home") { self.names(store.sidebar.pinned) == ["Gamma"] && home() == ["Beta", "Alpha", "Star"] }
        #expect(KeypadPages.drawn(store.keypad) == ["Pinned: Gamma", "Home: Beta, Alpha, Star"])
        // Beta onto its own page's heading: last there (#517).
        try await store.moveKey(key("Beta"), toPage: page("Home"), at: nil)
        try await eventually("Beta last in Home") { home() == ["Alpha", "Star", "Beta"] }
        // Onto it again: it is last already, nothing changes.
        try await store.moveKey(key("Beta"), toPage: page("Home"), at: nil)
        #expect(home() == ["Alpha", "Star", "Beta"])
    }
}
