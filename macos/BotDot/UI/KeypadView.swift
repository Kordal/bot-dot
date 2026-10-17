import SwiftUI
import BotDotKit

/// The keypad, the home of a wide window (#494): the Board's values and Needs you on top, then every
/// page one under the other in one scrolling view (#517), its heading (name, count, dot) over its bots
/// and groups as keys in rows of three, ⌘1 to ⌘9 on the first nine counted across the pages. A key
/// opens its chat in the column on the right (MainView) and stays lit; the last place, after the last
/// page, asks the Chief for a bot. While there are words in the search box, the keys that have them
/// and the messages that do, as the list's search finds them. A key dragged onto another key takes
/// that one's place, on any page; dragged onto a page's heading it goes last there (#499).
struct KeypadView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var hits: [SearchHit] = []
    /// The words the shown matches are for ("No matches" only once looked for).
    @State private var searched = ""
    @FocusState private var searching: Bool
    /// What a dragged key is over: another key, the last place, or a page's heading.
    private enum Aim: Hashable { case key(String), ask, heading(Int) }
    @State private var aimed: Aim?

    var body: some View {
        @Bindable var nav = nav
        let q = nav.query.trimmingCharacters(in: .whitespaces).lowercased()
        VStack(alignment: .leading, spacing: 22) {
            top($nav.query)
            if q.isEmpty {
                let pages = store.keypad
                DashboardStrip()
                    .contentShape(Rectangle())
                    .onTapGesture { nav.page = .dashboard }
                    .help("Board")
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        ForEach(Array(pages.enumerated()), id: \.element.id) { i, page in
                            VStack(alignment: .leading, spacing: 10) {
                                pageHeading(page, aimed: aimed == .heading(i))
                                    .dropDestination(for: String.self) { items, _ in drop(items, page: i, at: nil) } isTargeted: { aim(.heading(i), $0) }
                                keys(page.keys, numbered: true, page: i, first: firstKey(pages, i), last: i == pages.count - 1)
                            }
                        }
                        if pages.isEmpty { keys([], numbered: true) }
                    }
                    .padding(.bottom, 12)
                }
                Text("⌘1–⌘9 open · ⌘0 Chief · ⌘K find")
                    .font(.geistMono(size: 11)).foregroundStyle(Theme.faint)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                results(Keypad.pages(store.sidebar.matching(q, bots: store.bots)), q)
            }
        }
        .padding(.horizontal, 28).padding(.top, 40).padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg)
        .onChange(of: nav.searchFocus, initial: true) { _, on in if on { searching = true; nav.searchFocus = false } }
        .task(id: q) {
            // A moment after you stop typing, as the list's search.
            guard q.count >= 2 else { hits = []; searched = q; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let found = try? await store.search(q) else { return }
            hits = found
            searched = q
        }
    }

    /// The logo, what keeps botdot from working, the way back to the Chief, Needs you, search and Settings.
    private func top(_ query: Binding<String>) -> some View {
        HStack(spacing: 14) {
            Brand(busy: store.chiefBusy || store.bots.contains { $0.running == true })
            if let standing = store.standing {
                Text(standing.short).font(.geist(size: 12)).foregroundStyle(Theme.warnText).lineLimit(1)
            }
            Spacer(minLength: 12)
            if nav.chat != .chief {
                Button { nav.showChief(store) } label: {
                    HStack(spacing: 6) { NameFigure(.chief, text: 13); Text("Chief of Staff").lineLimit(1) }
                        .font(.geist(size: 13)).foregroundStyle(Theme.muted)
                }
                .buttonStyle(.plain)
                .help("Back to the Chief of Staff (⌘0)")
            }
            let needs = store.needs
            if !needs.isEmpty {
                Button { nav.page = .needs } label: {
                    HStack(spacing: 8) {
                        Text("\(needs.count) need\(needs.count == 1 ? "s" : "") you").font(.geist(size: 13)).foregroundStyle(Theme.text).lineLimit(1)
                        NeedsFigures(who: needs.map(\.who))
                    }
                }
                .buttonStyle(.plain)
                .help("Needs you")
            }
            TextField("Search", text: query, prompt: Text("Search").foregroundStyle(Theme.faint))
                .textFieldStyle(.plain)
                .font(.geist(size: 13.5))
                .focused($searching)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.sunk))
                .frame(minWidth: 110, maxWidth: 200) // the room left in the narrowest keypad
            SettingsButton()
        }
    }

    /// A page's heading: its name, how many keys it has, and a dot where a bot on it asks.
    /// `aimed`: a dragged key is over it, and would go last on this page.
    private func pageHeading(_ page: Keypad.Page, aimed: Bool) -> some View {
        HStack(spacing: 6) {
            Text(page.name.uppercased()).kerning(1.1)
            Text("\(page.keys.count)").fontWeight(.regular).foregroundStyle(Theme.faint)
            if let color = store.asking(on: page) {
                Circle().fill(Color(hex: color)).frame(width: 6, height: 6).accessibilityLabel("Asks you")
            }
        }
        .font(.geistMono(size: 11, weight: .medium))
        .foregroundStyle(aimed ? Theme.text : Theme.faint)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(aimed ? Theme.text : Theme.line).frame(height: aimed ? 2 : 1) }
        .contentShape(Rectangle())
    }

    /// How many keys stand on the pages before the page at `i`: the number of its first key.
    private func firstKey(_ pages: [Keypad.Page], _ i: Int) -> Int {
        pages.prefix(i).reduce(0) { $0 + $1.keys.count }
    }

    /// Keys in rows of three; the last page's keys end with the place that asks the Chief for a bot.
    /// `page`: the keypad's page they are on, whose keys can be dragged (not the search's matches);
    /// `first`: the number of its first key, counted across the pages; `last`: it is the last page.
    private func keys(_ keys: [Keypad.Key], numbered: Bool, page: Int? = nil, first: Int = 0, last: Bool = true) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: Keypad.perRow), spacing: 12) {
            ForEach(Array(keys.enumerated()), id: \.element.id) { i, key in
                if let page {
                    KeyView(key: key, label: numbered ? Keypad.label(first + i) : nil, aimed: aimed == .key(key.id))
                        .draggable(Self.dragPrefix + key.id)
                        .dropDestination(for: String.self) { items, _ in drop(items, page: page, at: i) } isTargeted: { aim(.key(key.id), $0) }
                } else {
                    KeyView(key: key, label: numbered ? Keypad.label(first + i) : nil)
                }
            }
            if numbered && last {
                if let page {
                    AskChiefKey(aimed: aimed == .ask)
                        .dropDestination(for: String.self) { items, _ in drop(items, page: page, at: keys.count) } isTargeted: { aim(.ask, $0) }
                } else {
                    AskChiefKey()
                }
            }
        }
    }

    /// Dragged keys carry this before their key's id, so text dragged in from elsewhere and the
    /// list's rows are left alone.
    static let dragPrefix = "botdot-key:"

    /// A key let go on another key (`at` on the page `page`, any page), on the last place (the last
    /// page's end), or on a page's heading (nil): it moves there as the list's drop moves a row
    /// (`Store.moveKey`).
    private func drop(_ items: [String], page: Int, at: Int?) -> Bool {
        aimed = nil
        guard let id = items.first(where: { $0.hasPrefix(Self.dragPrefix) })?.dropFirst(Self.dragPrefix.count),
              let key = store.keypad.flatMap(\.keys).first(where: { $0.id == String(id) }) else { return false }
        Task {
            do { try await store.moveKey(key, toPage: page, at: at) } catch { store.problem = error.localizedDescription }
        }
        return true
    }

    /// Marks the place a dragged key is over, while it is.
    private func aim(_ place: Aim, _ on: Bool) {
        if on { aimed = place } else if aimed == place { aimed = nil }
    }

    /// The matches: the keys that have the words, page by page, then the messages.
    private func results(_ pages: [Keypad.Page], _ q: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(pages) { page in
                    VStack(alignment: .leading, spacing: 10) {
                        heading(page.name)
                        keys(page.keys, numbered: false)
                    }
                }
                if !hits.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        heading("Messages")
                        ForEach(Array(hits.enumerated()), id: \.offset) { _, h in
                            HitRow(hit: h)
                                .padding(10)
                                .contentShape(Rectangle())
                                .onTapGesture { nav.open(h, store: store) }
                        }
                    }
                }
                if searched == q && pages.isEmpty && hits.isEmpty {
                    Text("No matches").font(.geist(size: 13)).foregroundStyle(Theme.faint)
                }
            }
            .padding(.bottom, 12)
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text.uppercased()).font(.geistMono(size: 11, weight: .medium)).kerning(1.1).foregroundStyle(Theme.faint)
    }
}

/// One key: the bot's head or the group's picture, its name, and the line its row in the list says;
/// its new replies or the mark of a question, and its ⌘digit, in the corner. Lit while its chat is
/// the open one; a click opens it, as a click on its row. `aimed`: a dragged key is over it.
private struct KeyView: View {
    let key: Keypad.Key
    let label: String?
    var aimed = false
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var over = false

    private struct Look {
        var line: String
        var working: Bool
        var asks: Bool
        var unread: Int
        var color: Color
    }

    var body: some View {
        let look = self.look
        let lit = nav.chat == chat
        HStack(spacing: 12) {
            picture
            VStack(alignment: .leading, spacing: 2) {
                Text(key.name).font(.geist(size: 14, weight: .semibold)).kerning(-0.14).lineLimit(1)
                Text(look.line)
                    .font(.geist(size: 12.5, weight: look.asks ? .medium : .regular))
                    .foregroundStyle(look.working || look.asks ? Theme.text : Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 88, maxHeight: 88, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(lit || over ? Theme.sunk : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(aimed ? Theme.text : lit || isGroup ? Theme.line2 : Theme.line, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 6) {
                if look.asks { AsksMark(color: look.color) } else { UnreadDots(count: look.unread, color: look.color) }
                if let label { Text(label).font(.geistMono(size: 11, weight: .medium)).foregroundStyle(Theme.faint) }
            }
            .padding(.top, 10).padding(.trailing, 12)
        }
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .onHover { over = $0 }
        .onTapGesture { nav.open(key, store: store) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    /// The chat this key opens.
    private var chat: Navigation.Page {
        switch key {
        case .bot(let b): .bot(b.id)
        case .group(let g): .group(g.id)
        }
    }

    private var isGroup: Bool {
        if case .group = key { return true }
        return false
    }

    @ViewBuilder
    private var picture: some View {
        switch key {
        case .bot(let bot): BotFigureView(color: bot.color, state: bot.state ?? "idle", size: 44, outfit: bot.outfit)
        case .group(let group): GroupPicture(group: group, size: 44)
        }
    }

    /// What its row in the list says (BotRow, GroupRow).
    private var look: Look {
        switch key {
        case .bot(let bot):
            let lastRun = store.recentRuns.first { $0.botId == bot.id }
            let asks = store.asksLine(bot, lastRun: lastRun)
            let line = asks ?? BotRow.line(bot, lastRun: lastRun, opening: store.openingLine(of: "bot:\(bot.id)"))
            return Look(line: line, working: bot.running == true, asks: asks != nil, unread: bot.unread ?? 0, color: Color(hex: bot.color))
        case .group(let group):
            let l = GroupWords.line(group, store.bots, store.turnLines)
            return Look(line: l.preview, working: l.working, asks: l.asks, unread: group.unread, color: Color(hex: l.color))
        }
    }
}

/// The last place, after the last page's keys: a bot is made by asking the Chief, not in a form.
/// `aimed`: a dragged key is over it, and would go last on the last page.
private struct AskChiefKey: View {
    var aimed = false
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav

    var body: some View {
        Button { nav.showChief(store) } label: {
            Text("Ask the Chief for a bot")
                .font(.geist(size: 13))
                .foregroundStyle(Theme.faint)
                .frame(maxWidth: .infinity, minHeight: 88, maxHeight: 88)
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(aimed ? Theme.text : Theme.line2, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}
