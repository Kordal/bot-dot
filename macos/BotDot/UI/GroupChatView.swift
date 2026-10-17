import SwiftUI
import BotDotKit

/// A group in the list: one row, as a bot's. Its picture is its members' heads, its line who works
/// in it, who asks, or its newest reply with the bot's name before it, and its dots its new replies;
/// while a member asks the owner something, the mark in their place.
struct GroupRow: View {
    let group: BotGroup
    @Environment(Store.self) private var store

    var body: some View {
        let line = GroupWords.line(group, store.bots, store.turnLines)
        ContactRow(
            figure: GroupPicture(group: group),
            name: group.name,
            time: Format.shortTime(group.last?.at),
            preview: line.preview,
            working: line.working,
            unread: group.unread,
            color: Color(hex: line.color),
            asks: line.asks
        )
    }
}

/// A group's picture: the heads of its first three members, in the room of one bot's.
struct GroupPicture: View {
    let group: BotGroup
    var size: CGFloat = 42
    @Environment(Store.self) private var store

    var body: some View {
        let heads = Array(Groups.members(group, store.bots).prefix(3))
        // The web page's `.group-pic`: heads of 27 in a square of 42, overlapping.
        let k = size / 42
        let small = 27 * k
        let far = size - small
        let spots: [CGPoint] = heads.count > 2 ? [CGPoint(x: 0, y: 0), CGPoint(x: far, y: 4 * k), CGPoint(x: 8 * k, y: far)] : [CGPoint(x: 0, y: 0), CGPoint(x: far, y: far)]
        ZStack(alignment: .topLeading) {
            if heads.isEmpty { Circle().fill(Color(hex: GroupWords.gone)).opacity(0.35).frame(width: size * 0.7, height: size * 0.7).frame(width: size, height: size) }
            ForEach(Array(heads.enumerated()), id: \.element.id) { i, bot in
                let alone = heads.count == 1
                BotFigureView(color: bot.color, state: group.working.contains(bot.id) ? "working" : "idle", size: small, outfit: bot.outfit)
                    .offset(x: alone ? far / 2 : spots[i].x, y: alone ? far / 2 : spots[i].y)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(GroupWords.names(heads.map(\.name)))
    }
}

/// A group's chat: the owner writes once, and every reply stands under its bot's name. A member
/// that passes shows nothing. At its end: the line that stopped at the limit with "Go on", one line
/// per member at work with "Stop all" after the last, the heads of who is next, the owner's
/// messages that still wait, each with "Take back", and the cards that were asked in the group.
struct GroupChatView: View {
    let group: BotGroup
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var text = ""
    @State private var files = PendingFiles()
    @State private var details: String?
    @State private var jumped = false
    @State private var position = ScrollPosition(idType: String.self)
    /// The "New" line the chat was last scrolled to: each line once.
    @State private var shownLine: NewLine?
    /// When the owner's message on its way was first drawn, so it arrives (see Arrivals in BotDotKit).
    @State private var arrivals = Arrivals()

    private var key: String { Groups.key(group.id) }
    /// What the store holds is this group's chat (it holds one at a time).
    private var chat: GroupChatState { store.groupChat.groupId == group.id ? store.groupChat : GroupChatState(groupId: group.id) }
    private var members: [Bot] { Groups.members(group, store.bots) }

    var body: some View {
        Group {
            if chat.loaded && chat.rows.isEmpty && chat.working.isEmpty && store.chatNeeds(.group(group.id)).isEmpty && store.sent(toGroup: group.id) == nil { empty } else { thread }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // The owner can write while members work: the server gives the turns.
            Composer(text: $text, placeholder: "Message \(group.name)…", files: files, uploadTo: .group(group.id), chat: key, note: outbox.note, send: send)
        }
        // A message that could not be sent, or was taken back, is in the box again, with its files.
        .onChange(of: outbox.back, initial: true) { takeBack() }
        .onChange(of: text) { outbox.edited(text) }
        .modifier(FileDrop(files: files, target: .group(group.id)))
        .modifier(ChatImageGallery(files: galleryFiles))
        // The group's header. Its panel opens from here: its name, its members and deleting it.
        .safeAreaInset(edge: .top, spacing: 0) {
            ChatHead(name: group.name, sub: GroupWords.names(members.map(\.name)), help: "Its name and its members", open: { nav.togglePanel() }) {
                GroupPicture(group: group, size: 34)
            } beside: {
                EmptyView()
            } actions: {
                EmptyView()
            }
        }
        .task(id: group.id) { store.openGroup(group.id) }
        .sheet(item: Binding(get: { details.map(RunRef.init) }, set: { details = $0?.id })) { ref in
            RunDetailsView(runId: ref.id)
        }
    }

    private var galleryFiles: [FileRef] {
        chat.rows.flatMap { item -> [FileRef] in
            switch item {
            case .message(let m): m.attachments
            case .reply(_, _, let run): run.files ?? []
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 0) {
            GroupPicture(group: group, size: 56)
            Text(group.name).font(.geist(size: 20, weight: .semibold)).padding(.top, 14).padding(.bottom, 6)
            Text(GroupWords.empty(members.map(\.name))).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: 520)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var thread: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                let rows = chat.rows
                // A message none of whose turns has started stands at the end, with "Take back".
                let waiting = chat.messages.filter { GroupWords.waitsWhole($0, store.bots, signedOut: store.claude.signedOut) }
                let newFirst = newLine?.first.run
                // Your message on its way, from Send until botdot answered: it arrives once, on Send.
                let sent = store.sent(toGroup: group.id)
                let _ = arrivals.draw(key, loaded: chat.loaded, replies: Arrivals.replyIds(rows), sent: sent?.key)
                // Scrolled up to the oldest message held: the page before it.
                if chat.more { Color.clear.frame(height: 1).onAppear { Task { await store.loadOlderGroupChat() } } }
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, item in
                    VStack(alignment: .leading, spacing: 14) {
                        if i == 0 || Format.day(rows[i - 1].at) != Format.day(item.at) {
                            Text(Format.dayTitle(item.at)).font(.geist(size: 11.5)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity)
                        }
                        switch item {
                        case .message(let m):
                            if !waiting.contains(where: { $0.id == m.id }) { message(m) }
                        case .reply(let id, _, let run):
                            if id == newFirst { NewLineView(color: Color(hex: GroupWords.memberColor(store.bots, run.botId, run.botColor))) }
                            GroupReply(run: run, asks: chat.asks?.runId == id, showDetails: { details = run.id }) { text, key in
                                jumped = false
                                return await store.deliverToGroup(text, box: false, key: key)
                            }
                            .modifier(Arrives(since: arrivals.since(id))) // a reply that is new in the open chat arrives, once
                        }
                    }
                    .id(item.id)
                }
                // Your message on its way stands above "Working" while no member works yet; under what waits
                // already while one does.
                if let sent, chat.working.isEmpty {
                    SentBubble(message: sent, chat: key, arrived: arrivals.since(Arrivals.sent(sent.key)))
                    if let line = OpeningLine.withSent(nil, sent) { StatusLine(text: line, color: Theme.faint) }
                }
                // The line that stopped at the limit of replies, in the server's sentence.
                if let limit = chat.limit {
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        Text(limit.text).font(.geist(size: 13)).foregroundStyle(Theme.muted)
                        Button("Go on") { Task { await store.goOn(group.id) } }.buttonStyle(.plain).font(.geist(size: 12)).foregroundStyle(Theme.faint)
                    }
                    .padding(.leading, 2)
                }
                // Each member at work: its name and what it is doing. One Stop ends them all.
                ForEach(Array(chat.working.enumerated()), id: \.element.runId) { i, w in
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        StatusLine(text: store.words(of: w), color: Color(hex: GroupWords.memberColor(store.bots, w.botId)), still: true)
                        if i == chat.working.count - 1 {
                            Button("Stop all") { Task { await store.stopGroup(group.id) } }.buttonStyle(.plain).font(.geist(size: 12)).foregroundStyle(Theme.faint)
                        }
                    }
                }
                // Who is next, while the bots hand the work on: their heads, in their order.
                let next = Groups.members(store.groupChat.groupId == group.id ? store.groupNext : [], store.bots)
                if !next.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(next) { bot in BotFigureView(color: bot.color, state: "idle", size: 22, outfit: bot.outfit) }
                    }
                    .opacity(0.6)
                    .padding(.leading, 2)
                    .accessibilityElement()
                    .accessibilityLabel(GroupWords.next(next.map(\.name)))
                }
                // The owner's messages that wait until a member is free, faded, each with "Take back".
                ForEach(waiting) { m in
                    WaitingMessage(text: m.text, files: m.attachments, chat: key, waits: GroupWords.waitsLine(m, store.bots)) {
                        Task { await store.takeBack(m, fromGroup: group.id) }
                    }
                }
                if let sent, !chat.working.isEmpty { SentBubble(message: sent, chat: key, arrived: arrivals.since(Arrivals.sent(sent.key))) }
                // The cards asked in the group, each with its bot's name: they stand here, and in no bot's own chat.
                ChatNeeds(scope: .group(group.id))
            }
            .scrollTargetLayout()
            .frame(maxWidth: 820)
            .padding(.horizontal, 30)
            .padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        // A chat stays at its newest message, except after going to its "New" line.
        .defaultScrollAnchor(jumped ? nil : .bottom)
        .scrollPosition($position)
        .onChange(of: chat.rows.map(\.id), initial: true) { jump(); toNewLine() }
        .onChange(of: nav.jump) { jump() }
        .onChange(of: newLine) { toNewLine() }
    }

    /// The owner's message, and under it for whom it still waits when some of its turns have started.
    @ViewBuilder
    private func message(_ m: GroupMessage) -> some View {
        let waits = GroupWords.waitsLine(m, store.bots)
        VStack(alignment: .trailing, spacing: 4) {
            MyBubble(text: m.text, files: m.attachments, chat: key, folds: true)
            if !waits.isEmpty { Text(waits).font(.geist(size: 12)).foregroundStyle(Theme.faint).padding(.horizontal, 6) }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    /// This chat's "New" line, while it has one.
    private var newLine: NewLine? { store.newLine?.chat == key ? store.newLine : nil }

    /// Goes to the reply a search match pointed at, once it's there. A chat that doesn't hold it reads
    /// further back; a reply older than that opens by itself.
    private func jump() {
        guard let target = nav.jump?.runId, nav.jump?.group?.id == group.id, chat.loaded else { return }
        if chat.rows.contains(where: { $0.id == target }) {
            nav.jump = nil
            Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: target, anchor: .center) }
        } else if !store.reachGroupReply(target) {
            nav.jump = nil
            details = target
        }
    }

    /// Brings a line that was just placed to the top of the chat, once its reply is there.
    private func toNewLine() {
        guard nav.jump?.group?.id != group.id, let line = newLine, line != shownLine, let first = line.first.run, chat.rows.contains(where: { $0.id == first }) else { return }
        shownLine = line
        Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: first, anchor: .top) }
    }

    private func send(_ message: String, _ attachments: [FileRef]) {
        let t = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !attachments.isEmpty else { return }
        text = ""
        jumped = false
        Task { await store.deliverToGroup(t, attachments: attachments) }
    }

    /// What this chat's message box is told about its sends.
    private var outbox: Outbox { store.outbox(key) }

    private func takeBack() {
        guard let kept = outbox.take(typedSince: text) else { return }
        text = kept.text
        files.putBack(kept.attachments)
    }
}

/// A member's reply in a group: its head and its name in its colour, then what it said, with its
/// chips, as a reply in a bot's chat (`RunReply`). The answer buttons stand under the reply that asks
/// the owner something (`asks`), and answer in the group.
private struct GroupReply: View {
    let run: RunSummary
    let asks: Bool
    let showDetails: () -> Void
    /// Sends a quick answer or the card's answers with its key, and says whether it went.
    let answer: @MainActor (String, String) async -> Bool
    @Environment(Store.self) private var store

    var body: some View {
        // No bubble while it works: its working line at the end of the chat says it.
        if !run.isRunning {
            let bot = store.bots.first { $0.id == run.botId }
            let color = GroupWords.memberColor(store.bots, run.botId, run.botColor)
            // A turn that did not finish says who ended it, in the server's sentence.
            let ended = run.failed ? run.ended(saysWho: store.saysWhoEnded) : nil
            let body = ended?.text ?? run.replyText
            // Its head beside the reply, its name above it in its colour (`.g-row`).
            HStack(alignment: .top, spacing: 10) {
                BotFigureView(color: color, state: "idle", size: 30, outfit: bot?.outfit).padding(.top, 18)
                VStack(alignment: .leading, spacing: 3) {
                    Text(GroupWords.memberName(store.bots, run.botId, run.botName)).font(.geist(size: 12, weight: .semibold)).foregroundStyle(Color(hex: color)).padding(.horizontal, 6)
                    RunReply(run: run, ended: ended, text: body, answers: asks, showDetails: showDetails, answer: answer)
                }
            }
        }
    }
}
