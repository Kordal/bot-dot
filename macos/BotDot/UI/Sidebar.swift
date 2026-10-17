import SwiftUI
import BotDotKit

/// The bots, like a messenger's contacts: the Chief of Staff on top, pinned bots right below it in
/// your order, then your groups A–Z and the bots without one ("Other"). Drag a bot to pin it,
/// reorder it or move it to another group; fold a group by clicking its heading.
struct Sidebar: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @AppStorage("botdot.groups.folded") private var foldedJSON = "[]"
    @State private var editing: GroupRef?
    @State private var hits: [SearchHit] = []
    /// The words the shown matches are for ("No matches" only once looked for).
    @State private var searched = ""
    @FocusState private var searching: Bool
    /// The category heading under the pointer: its "⋯" shows only there.
    @State private var overHeading: String?
    /// What a list this wide shows (MainView): all of a row, its figure and name, or its figure alone.
    @Environment(\.listLayout) private var layout
    @AppStorage("botdot.sidebar.width") private var keptWidth = SidebarWidth.standard
    private var figures: Bool { layout == .figures }

    var body: some View {
        @Bindable var nav = nav
        let q = nav.query.trimmingCharacters(in: .whitespaces).lowercased()
        let s = filtered(store.sidebar, q)
        let named = s.groups.contains { !$0.name.isEmpty }
        VStack(spacing: 0) {
            // The window has no title bar: the logo stands under its three buttons.
            HStack {
                if figures { Spacer(minLength: 0) }
                Brand(busy: store.chiefBusy || store.bots.contains { $0.running == true })
                Spacer(minLength: 0)
                // What keeps botdot from working, beside the logo; a list of figures has room for a dot.
                if let standing = store.standing {
                    if figures {
                        Circle().fill(Theme.warn).frame(width: 8, height: 8).help(standing.short).accessibilityLabel(standing.short)
                    } else {
                        Text(standing.short).font(.geist(size: 12)).foregroundStyle(Theme.warnText).lineLimit(1)
                    }
                }
            }
            .padding(.leading, figures ? 4 : 24).padding(.trailing, figures ? 4 : 18).padding(.top, 40).padding(.bottom, 14)
            // A list of figures has no search: it is back in a wider list.
            if !figures {
                TextField("Search", text: $nav.query, prompt: Text("Search").foregroundStyle(Theme.faint))
                    .textFieldStyle(.plain)
                    .font(.geist(size: 13.5))
                    .focused($searching)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.sunk))
                    .padding(.horizontal, layout == .names ? 10 : 16).padding(.bottom, 10)
            }
            list(s, q, named: named)
            Rectangle().fill(Theme.line).frame(height: 1)
            HStack {
                if figures { Spacer(minLength: 0) }
                SettingsButton()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, figures ? 0 : 10).padding(.vertical, 8)
        }
        .background(Theme.panel)
        .onChange(of: nav.searchFocus) { _, on in if on { search(); nav.searchFocus = false } }
        .task(id: q) {
            // A moment after you stop typing, as on the web.
            guard q.count >= 2 else { hits = []; searched = q; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let found = try? await store.search(q) else { return }
            hits = found
            searched = q
        }
        .sheet(item: $editing) { ref in GroupSheet(group: ref.id) }
    }

    /// "Find a Bot or Message" in the menu: the cursor goes to the search field; a list that shows figures only,
    /// which has none, gets its standard width first.
    private func search() {
        guard figures else { searching = true; return }
        keptWidth = SidebarWidth.standard
        Task { searching = true } // once the field is there
    }

    /// The rows, drawn as the web page's: flat, the one that is open and the one under the pointer
    /// on grey. A List, so a dragged bot can be dropped between two rows.
    private func list(_ s: SidebarSections, _ q: String, named: Bool) -> some View {
        List {
            // The Chief and the pinned bots are one run of rows, so a bot dropped right below the Chief
            // is pinned first. The list itself draws the gap and says where it lands (index = the
            // place among these rows, the dragged bot still counted where it is).
            ForEach(top(s, q)) { item in
                switch item {
                case .dashboard: DashboardStrip().help("Board").sideRow(active: nav.page == .dashboard, radius: 12, padding: EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)) { nav.page = .dashboard }
                case .chief: ChiefRow().sideRow(active: nav.chat == .chief) { nav.pick(.chief, store: store) }
                case .bot(let bot): row(bot)
                }
            }
            .dropDestination(for: String.self) { ids, index in
                // The strip, when it's there, is the first row: the places after it count from the Chief.
                drop(ids, .pinned(max(index - (q.isEmpty ? 1 : 0), 1)), group: .pinned(1))
            }
            // The pinned groups, after the pinned bots (see GroupChatView.swift).
            ForEach(s.pinnedGroupChats) { g in groupRow(g) }
                .dropDestination(for: String.self) { ids, index in drop(ids, .pinned(s.pinned.count + 1), group: .pinned(index + 1)) }
            if !top(s, q).isEmpty || !s.pinnedGroupChats.isEmpty {
                Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 6).sideLine(inset: figures ? 14 : 20)
            }
            ForEach(s.groups) { group in
                // A list of figures has no room for a category's name: a line stands where it begins.
                if named && figures { Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 6).sideLine(inset: 14) }
                else if named { header(group).padding(.top, 10).padding(.bottom, 2).padding(.leading, 0).sideLine() }
                if !named || !folded.contains(group.name) || !q.isEmpty {
                    ForEach(group.bots) { bot in row(bot) }
                        .dropDestination(for: String.self) { ids, index in drop(ids, .group(group.name, index + 1), group: .group(group.name, 1)) }
                    // A category's groups, after its bots.
                    ForEach(group.groupChats) { g in groupRow(g) }
                        .dropDestination(for: String.self) { ids, index in drop(ids, .group(group.name, group.bots.count + 1), group: .group(group.name, index + 1)) }
                }
            }
            // Messages that match, in every chat.
            if !hits.isEmpty && !figures {
                Text("MESSAGES").font(.geist(size: 12, weight: .semibold)).kerning(0.48).foregroundStyle(Theme.faint)
                    .padding(.top, 8).padding(.bottom, 2).sideLine()
                ForEach(Array(hits.enumerated()), id: \.offset) { _, h in
                    HitRow(hit: h).sideRow(active: false) { nav.open(h, store: store) }
                }
            }
            if !q.isEmpty && searched == q && s.pinned.isEmpty && s.pinnedGroupChats.isEmpty && s.groups.isEmpty && hits.isEmpty && !"chief of staff".contains(q) {
                Text("No matches").font(.geist(size: 13)).foregroundStyle(Theme.faint).sideLine()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
    }

    private func groupRow(_ g: BotGroup) -> some View {
        GroupRow(group: g).sideRow(active: nav.chat == .group(g.id)) { nav.pick(.group(g.id), store: store) }
            .draggable(Self.groupDragPrefix + g.id)
    }

    private func row(_ bot: Bot) -> some View {
        let lastRun = store.recentRuns.first { $0.botId == bot.id }
        return BotRow(bot: bot, lastRun: lastRun, line: store.openingLine(of: "bot:\(bot.id)"), asks: store.asksLine(bot, lastRun: lastRun))
            .sideRow(active: nav.chat == .bot(bot.id)) { nav.pick(.bot(bot.id), store: store) }
            .draggable(Self.dragPrefix + bot.id)
    }

    /// Dragged bots carry this before their id, so text dragged in from elsewhere is left alone.
    static let dragPrefix = "botdot-bot:"
    /// And a dragged group this: its places are counted among the groups.
    static let groupDragPrefix = "botdot-group:"

    enum TopRow: Identifiable {
        case dashboard
        case chief
        case bot(Bot)
        var id: String {
            switch self {
            case .bot(let b): b.id
            case .chief: "chief"
            case .dashboard: "dashboard"
            }
        }
    }

    private func top(_ s: SidebarSections, _ q: String) -> [TopRow] {
        // The Board's strip on top (not while searching).
        (q.isEmpty ? [.dashboard] : [])
            + (q.isEmpty || "chief of staff".contains(q) ? [.chief] : []) + s.pinned.map(TopRow.bot)
    }

    /// While searching: the bots and groups that have the words (the keypad's search finds the same).
    private func filtered(_ s: SidebarSections, _ q: String) -> SidebarSections { s.matching(q, bots: store.bots) }

    /// Drops a dragged bot there: pins, reorders or moves it (the web's dropAt).
    /// What was dropped goes where the gap was: a bot at `spot`, a group at `group` (its place among
    /// the groups there: first, when it was dropped among bots).
    private func drop(_ items: [String], _ spot: DropSpot, group: DropSpot) {
        if let id = items.first(where: { $0.hasPrefix(Self.groupDragPrefix) })?.dropFirst(Self.groupDragPrefix.count) {
            Task {
                do { try await store.dropGroup(String(id), at: group) } catch { store.problem = error.localizedDescription }
            }
            return
        }
        guard let id = items.first(where: { $0.hasPrefix(Self.dragPrefix) })?.dropFirst(Self.dragPrefix.count) else { return }
        Task {
            do { try await store.drop(String(id), at: spot) } catch { store.problem = error.localizedDescription }
        }
    }

    private func header(_ group: SidebarSections.Group) -> some View {
        let isFolded = folded.contains(group.name)
        let busy = group.bots.contains { $0.running == true }
        return HStack(spacing: 4) {
            Button {
                var f = folded
                if f.contains(group.name) { f.remove(group.name) } else { f.insert(group.name) }
                foldedJSON = (try? String(data: JSONEncoder().encode(Array(f)), encoding: .utf8)) ?? "[]"
            } label: {
                HStack(spacing: 6) {
                    Text("▾").font(.geist(size: 10)).rotationEffect(.degrees(isFolded ? -90 : 0))
                    Text((group.name.isEmpty ? "Other" : group.name).uppercased()).kerning(0.46).lineLimit(1)
                    Text("\(group.bots.count + group.groupChats.count)").fontWeight(.regular).foregroundStyle(Theme.faint)
                    if isFolded && busy { BusyDot() }
                    Spacer(minLength: 0)
                }
                .font(.geist(size: 11.5, weight: .semibold))
                .foregroundStyle(overHeading == group.name ? Theme.text : Theme.muted)
                .padding(4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(isFolded ? "Show these bots" : "Hide these bots")
            if !group.name.isEmpty {
                Button { editing = GroupRef(id: group.name) } label: { Image(systemName: "ellipsis").frame(width: 24, height: 24).contentShape(Rectangle()) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.muted)
                    .opacity(overHeading == group.name ? 1 : 0)
                    .help("Rename or remove this category")
            }
        }
        .onHover { overHeading = $0 ? group.name : (overHeading == group.name ? nil : overHeading) }
        // Dropped on a heading: first in that group.
        .dropDestination(for: String.self) { ids, _ in
            drop(ids, .group(group.name, 1), group: .group(group.name, 1))
            return true
        }
    }

    private var folded: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: Data(foldedJSON.utf8))) ?? [])
    }

}

struct GroupRef: Identifiable { let id: String }

/// A group's ⋯: rename it, or remove it (its bots move to Other), as on the web.
struct GroupSheet: View {
    let group: String
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var confirmRemove = false

    var body: some View {
        let members = store.bots.filter { $0.group == group }
        Dialog("Category: \(group)", width: 380) {
            TextField("Name", text: $name).webField().onSubmit(rename)
            FlowLayout(spacing: 8) {
                ForEach(members) { b in
                    HStack(spacing: 4) { NameFigure(Who(b)); Text(b.name) }
                }
            }
            .font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
        } foot: {
            Button("Remove category", role: .destructive) { confirmRemove = true }
            Spacer()
            Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Rename", action: rename).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear { name = group }
        .confirmationDialog("Remove the category \"\(group)\"? Its \(members.count) bot\(members.count == 1 ? "" : "s") move to Other; nothing else changes.", isPresented: $confirmRemove) {
            Button("Remove category", role: .destructive) { save("") }
        }
    }

    private func rename() {
        let to = name.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        if to.isEmpty || to == group { dismiss() } else { save(to) }
    }

    private func save(_ to: String) {
        Task {
            do { try await store.renameGroup(group, to: to); dismiss() } catch { store.problem = error.localizedDescription }
        }
    }
}

/// ⚙ at the bottom of the sidebar: how many runs go on, or a dot when an update waits.
struct SettingsButton: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var over = false

    var body: some View {
        Button { nav.page = .settings } label: {
            Image(systemName: "gearshape")
                .font(.geist(size: 16))
                .frame(width: 38, height: 34)
                .background(RoundedRectangle(cornerRadius: 12).fill(over || nav.page == .settings ? Theme.sunk : .clear))
                .contentShape(Rectangle())
                .overlay(alignment: .topTrailing) {
                    if store.runningCount > 0 {
                        Text("\(store.runningCount)")
                            .font(.geist(size: 10.5, weight: .semibold))
                            .foregroundStyle(Theme.inkText)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(Theme.ink))
                            .offset(x: 6, y: -4)
                    }
                }
        }
        .buttonStyle(.plain)
        .foregroundStyle(over || nav.page == .settings ? Theme.text : Theme.muted)
        .onHover { over = $0 }
        .help("Settings")
    }
}

struct ChiefRow: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav

    var body: some View {
        let chat = store.chiefChats.first
        let preview = Format.plain(chat?.preview)
        ContactRow(
            figure: BotFigureView(color: Who.chief.color, state: store.chiefBusy ? "working" : "idle", outfit: store.figure?.chief),
            name: "Chief of Staff",
            time: Format.shortTime(chat?.updatedAt),
            preview: preview.isEmpty ? "Your team of bots. Ask for anything." : preview,
            working: false,
            unread: store.chiefUnread,
            color: Theme.chief
        )
    }
}

struct BotRow: View {
    let bot: Bot
    let lastRun: RunSummary?
    /// What it said it is about to do, while it works.
    var line: String? = nil
    /// What it asks the owner ("Asks: …"), until the owner writes to it: the row's line, with the mark.
    var asks: String? = nil

    var body: some View {
        ContactRow(
            figure: BotFigureView(color: bot.color, state: bot.state ?? "idle", outfit: bot.outfit),
            name: bot.name,
            time: Format.shortTime(lastRun?.startedAt),
            preview: asks ?? preview,
            working: bot.running == true,
            unread: bot.unread ?? 0,
            color: Color(hex: bot.color),
            asks: asks != nil
        )
    }

    private var preview: String { Self.line(bot, lastRun: lastRun, opening: line) }

    /// What a bot's row says, and its key on the keypad, when it asks nothing: its opening line while
    /// it works, else its last result, else its description.
    static func line(_ bot: Bot, lastRun: RunSummary?, opening line: String?) -> String {
        let working = OpeningLine.preview(line) ?? "Working…" // its opening line, when it said one
        if bot.running == true { return working }
        if let r = lastRun {
            if r.status == "success" { return Format.plain(r.result) }
            if r.status == "running" { return working }
            return "Couldn't finish"
        }
        let d = bot.description ?? ""
        return d.isEmpty ? "No messages yet" : d
    }
}

struct ContactRow<Figure: View>: View {
    let figure: Figure
    let name: String
    let time: String
    let preview: String
    let working: Bool
    /// New replies, and the colour their dots take: the bot's.
    var unread = 0
    var color = Theme.faint
    /// It asks the owner something: the mark in place of the dots, and its line stands out.
    var asks = false

    @Environment(\.listLayout) private var layout

    var body: some View {
        if layout == .figures {
            // The figure alone: what is new stands at its corner, and its name is said under the pointer.
            figure
                .overlay(alignment: .topTrailing) { mark.offset(x: 9, y: -5) }
                .help(name)
        } else {
            HStack(spacing: layout == .names ? 10 : 12) {
                figure
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(name).font(.geist(size: 14, weight: .semibold)).kerning(-0.14).lineLimit(1)
                        Spacer(minLength: 0)
                        if layout == .full { Text(time).font(.geist(size: 11.5)).foregroundStyle(Theme.faint) }
                        mark
                    }
                    if layout == .full {
                        Text(preview)
                            .font(.geist(size: 12.5, weight: asks ? .medium : .regular))
                            .foregroundStyle(working || asks ? Theme.text : Theme.muted)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var mark: some View {
        if asks { AsksMark(color: color) } else { UnreadDots(count: unread, color: color) }
    }
}

/// What the list shows of each row, from its width (SidebarWidth.layout).
extension EnvironmentValues {
    @Entry var listLayout = SidebarWidth.Layout.full
}

/// A row of the list as the web page's `.contact`: grey and rounded while it is the open one or under
/// the pointer, and a click opens it.
private struct SideRow: ViewModifier {
    let active: Bool
    let radius: CGFloat
    let padding: EdgeInsets
    let pick: () -> Void
    @State private var over = false
    @Environment(\.listLayout) private var layout

    func body(content: Content) -> some View {
        // A list of figures: the figure in the middle, with less around it.
        let figures = layout == .figures
        content
            .padding(figures ? EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0) : padding)
            .frame(maxWidth: .infinity, alignment: figures ? .center : .leading)
            .background(RoundedRectangle(cornerRadius: radius).fill(active || over ? Theme.sunk : .clear))
            .contentShape(Rectangle())
            .onHover { over = $0 }
            .onTapGesture(perform: pick)
            .sideLine(inset: figures ? 6 : 10)
    }
}

extension View {
    func sideRow(active: Bool, radius: CGFloat = 14, padding: EdgeInsets = EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10), pick: @escaping () -> Void) -> some View {
        modifier(SideRow(active: active, radius: radius, padding: padding, pick: pick))
    }

    /// A line of the list that is no row to click: no separator, no background of the list's own.
    func sideLine(inset: CGFloat = 20) -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: inset, bottom: 0, trailing: inset))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

/// The dot of a folded category with a bot at work: green, pulsing (`.group-toggle .dot`).
struct BusyDot: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            Circle().fill(Theme.ok).frame(width: 8, height: 8)
                .opacity(reduceMotion ? 1 : 0.625 + 0.375 * cos(t / 1.4 * 2 * .pi))
        }
    }
}

/// New replies in the list: one dot per reply, at most three, in the bot's colour. No number.
struct UnreadDots: View {
    let count: Int
    let color: Color

    var body: some View {
        let shown = Unread.dots(count)
        if shown > 0 {
            HStack(spacing: 3) {
                ForEach(0..<shown, id: \.self) { _ in Circle().fill(color).frame(width: 7, height: 7) }
            }
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1.5 } // centred on the time's letters
            .accessibilityElement()
            .accessibilityLabel(shown == 1 ? "New reply" : "New replies")
        }
    }
}

/// The mark of a bot that asks the owner something: round, in the bot's colour, holding "?".
struct AsksMark: View {
    let color: Color

    var body: some View {
        Text("?")
            .font(.geist(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 18, height: 18)
            .background(Circle().fill(color))
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 5 } // centred on the time's letters
            .accessibilityElement()
            .accessibilityLabel("Asks you")
    }
}

/// The line above the first new reply of the chat that was opened: thin, in the bot's colour, with
/// the word "New" in the middle.
struct NewLineView: View {
    let color: Color

    var body: some View {
        HStack(spacing: 10) {
            rule
            Text("New").font(.geist(size: 11.5, weight: .semibold)).foregroundStyle(color)
            rule
        }
        .padding(.top, 6)
        .accessibilityElement()
        .accessibilityLabel("New")
    }

    private var rule: some View { Rectangle().fill(color.opacity(0.45)).frame(height: 1) }
}

/// The line under a chat while something works there: a dot in the bot's colour that pulses, the line,
/// and the app's ellipsis. The line is the caller's: a bot's working line or its opening line, the
/// Chief's line while it replies, a member's line in a group, or "Working" while a message is on its
/// way. With reduced motion the dot is still. In a bot's chat it is all a working bot shows, and Stop
/// follows the line. `still`: the line gets no ellipsis ("Waiting for your OK": nothing moves until
/// the owner answers).
struct StatusLine: View {
    let text: String
    let color: Color
    var still = false
    var stop: (() -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let line = still ? text : "\(text)…"
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                TimelineView(.animation(paused: reduceMotion || still)) { context in
                    // As the web page's: down to a quarter and back, every 1.2 seconds. Still and at
                    // half strength while nothing moves (`.status-line.still`).
                    let t = context.date.timeIntervalSinceReferenceDate
                    Circle().fill(color).frame(width: 7, height: 7)
                        .opacity(still ? 0.5 : reduceMotion ? 1 : 0.625 + 0.375 * cos(t / 1.2 * 2 * .pi))
                }
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 } // centred on the small letters
                Text(line).font(.geist(size: 13)).foregroundStyle(Theme.muted)
            }
            .accessibilityElement()
            .accessibilityLabel(line)
            if let stop {
                Button("Stop", action: stop).buttonStyle(.plain).font(.geist(size: 12)).foregroundStyle(Theme.faint)
            }
        }
        .padding(.leading, 2)
    }
}

/// One match: whose chat, when, and the words around it, the matched ones in bold.
struct HitRow: View {
    let hit: SearchHit

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if let title = hit.title, hit.chatId != nil {
                    NameFigure(.chief); Text("Chief of Staff · \(title)").lineLimit(1)
                } else if let group = hit.group {
                    NameFigure(hit.bot); Text("\(hit.bot?.name ?? "") · \(group.name ?? "")").lineLimit(1)
                } else if let from = hit.fromBot {
                    NameFigure(from); Text(from.name ?? ""); Text("→")
                    NameFigure(hit.bot); Text(hit.bot?.name ?? "")
                } else {
                    NameFigure(hit.bot); Text(hit.bot?.name ?? "")
                }
                Spacer(minLength: 0)
                Text(Format.shortTime(hit.at)).font(.geist(size: 11.5)).foregroundStyle(Theme.faint)
            }
            .font(.geist(size: 13, weight: .semibold))
            Text(Self.marked(hit.snippet ?? "")).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(2)
        }
    }

    /// «word» → the word in bold.
    static func marked(_ s: String) -> AttributedString {
        var out = AttributedString()
        for (i, part) in s.components(separatedBy: CharacterSet(charactersIn: "«»")).enumerated() {
            var a = AttributedString(part)
            if i % 2 == 1 { a.font = .geist(size: 12.5, weight: .bold); a.foregroundColor = Theme.text }
            out += a
        }
        return out
    }
}
