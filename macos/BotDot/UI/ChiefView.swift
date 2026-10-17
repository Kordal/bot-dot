import SwiftUI
import BotDotKit

/// A chat with the Chief of Staff, as on the web: your messages, its replies with what it did, and
/// while it works, what it's doing.
struct ChiefView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var text = ""
    @State private var files = PendingFiles()
    /// The message scrolled to (from a search match).
    @State private var jumped = false
    @State private var position = ScrollPosition(idType: Int.self)
    /// The "New" line the chat was last scrolled to: each line once.
    @State private var shownLine: NewLine?
    /// A search match opened the chat: the line that comes with that opening isn't scrolled to.
    @State private var matched = false
    /// Which replies are new in the open chat, and so arrive (see Arrivals in BotDotKit).
    @State private var arrivals = Arrivals()
    @Environment(\.appearsActive) private var inFront

    static let suggestions = [
        "What bots do I have, and what is each one good at?",
        "Create a bot that checks the news on a topic every morning and sends me the highlights.",
        "Make a bot with its own computer that can use websites for me.",
        "Make a research bot that finds fresh game design ideas on the web.",
    ]

    var body: some View {
        Group {
            if store.chief.chatId == nil && store.chief.messages.isEmpty && store.chatNeeds(.chief).isEmpty && store.sentToChief == nil {
                empty
            } else {
                thread
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Send stays while the Chief replies, where botdot lets the message wait: Stop is then on the working line.
            Composer(text: $text, placeholder: "Message the Chief…", busy: MessageWaits.boxStops(busy: store.chief.busy, sendStays: store.sendStays), files: files, uploadTo: .chief, chat: Who.chief.id, note: outbox.note, send: { send($0, $1) }, stop: { Task { await store.stopChief() } })
        }
        // A message that could not be sent is back in the box, with its files.
        .onChange(of: outbox.back, initial: true) { takeBack() }
        .onChange(of: text) { outbox.edited(text) }
        .modifier(FileDrop(files: files, target: .chief))
        .modifier(ChatImageGallery(files: store.chief.messages.flatMap { ($0.attachments ?? []) + ($0.files ?? []) }))
        .safeAreaInset(edge: .top, spacing: 0) {
            ChatHead(name: "Chief of Staff", sub: subtitle, help: "Its settings", open: { nav.togglePanel() }) {
                BotFigureView(color: Who.chief.color, state: store.chiefBusy ? "working" : "idle", size: 34, outfit: store.figure?.chief)
            } beside: {
                EmptyView()
            } actions: {
                // The Chief's previous chats (on the web page they are in its settings).
                Menu {
                    if store.chiefChats.isEmpty {
                        Text("No previous chats")
                    }
                    ForEach(store.chiefChats) { chat in
                        Button {
                            store.openChief(chatId: chat.id)
                        } label: {
                            Text(chat.title ?? "Chat")
                            Text(Format.shortTime(chat.updatedAt))
                        }
                    }
                } label: {
                    Image(systemName: "clock")
                }
                .menuStyle(.button).buttonStyle(IconButtonStyle()).menuIndicator(.hidden).fixedSize()
                .help("Previous chats")
                IconButton(icon: "square.and.pencil", help: "New chat") { nav.newChiefChat(store) }
            }
        }
        .onAppear {
            // Messenger feel: open the latest conversation unless a new one was asked for.
            // The one with new replies first: the Chief's row shows the dots of all its chats.
            if store.chief.chatId == nil && store.chief.messages.isEmpty, let latest = store.chiefChatWithNewReplies ?? store.chiefChats.first?.id {
                store.openChief(chatId: latest)
            }
        }
    }

    private var subtitle: String {
        let working = store.bots.filter { $0.running == true }.count
        let n = store.bots.count
        return "\(n) \(n == 1 ? "bot" : "bots")\(working > 0 ? " · \(working) working" : "")"
    }

    private var empty: some View {
        VStack(spacing: 0) {
            BotFigureView(color: Who.chief.color, state: store.chiefBusy ? "working" : "idle", size: 56, outfit: store.figure?.chief)
            Text("What should the team work on?")
                .font(.geist(size: 20, weight: .semibold))
                .padding(.top, 14).padding(.bottom, 6)
            Text("Ask for anything. I'll hand it to the right bot, or build a new one.")
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            // Two columns of cards, each row as tall as its longer one (`.suggestions`).
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(Array(stride(from: 0, to: Self.suggestions.count, by: 2)), id: \.self) { i in
                    GridRow {
                        ForEach(Self.suggestions[i..<min(i + 2, Self.suggestions.count)], id: \.self) { s in
                            Button { send(s, []) } label: {
                                Text(s).multilineTextAlignment(.leading).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            }
                            .buttonStyle(SuggestionButtonStyle())
                        }
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 22)
        }
        .frame(maxWidth: 520)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var thread: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                let messages = store.chief.messages
                let newFirst = newLine?.first.message
                // Your message on its way, from Send until botdot answered; and what is new in the chat with this drawing.
                let sent = store.sentToChief
                let _ = arrivals.draw(store.chief.chatId, loaded: store.chief.isLoaded, replies: Arrivals.replyIds(messages, offset: store.chief.offset), sent: sent?.key)
                ForEach(Array(messages.enumerated()), id: \.offset) { i, m in
                    VStack(alignment: .leading, spacing: 14) {
                        if i == newFirst { NewLineView(color: Theme.chief) }
                        ChiefMessageView(message: m, isLast: i == messages.count - 1, activity: store.chief.activity, lineSaysIt: store.sendStays, answer: { send($0, [], box: false, key: $1) },
                                         rate: Ratings.shows(m, rates: store.rates) ? { tapped in Task { await store.rate(i, tapped) } } : nil)
                            .modifier(Arrives(since: arrivals.since("\(store.chief.offset + i)")))
                    }
                    .id(i)
                }
                // Last in the chat: the Chief's working line while it replies, then your messages that wait
                // for the reply to end. Where Send stays, the line is all there is of its working state
                // (what it is doing in the server's words, its opening line first, else "Thinking"), with
                // Stop at its end; against a botdot server from before, the line is its opening line and
                // the reply's bubble says the rest. Your message on its way stands above the line, which
                // reads "Working" until botdot answers (also the first of a new chat); under what waits
                // already while the Chief replies.
                let said = store.chief.chatId.flatMap { store.openingLine(of: "chief:\($0)") }
                if let sent, !store.chief.busy { SentBubble(message: sent, chat: Who.chief.id, arrived: arrivals.since(Arrivals.sent(sent.key))) }
                if store.sendStays {
                    if let line = OpeningLine.withSent(OpeningLine.chiefLine(said, doing: store.chief.doing, busy: store.chief.busy), sent) {
                        StatusLine(text: line, color: Theme.chief, stop: store.chief.busy ? { Task { await store.stopChief() } } : nil)
                    }
                } else if let line = OpeningLine.withSent(said, sent) {
                    StatusLine(text: line, color: Theme.chief)
                }
                if let id = store.chief.chatId {
                    WaitingMessages(queued: store.waiting(in: "chief:\(id)"), who: "the Chief", chat: Who.chief.id) { q in
                        Task { await store.takeBack(q, from: "chief:\(id)") }
                    }
                }
                if let sent, store.chief.busy { SentBubble(message: sent, chat: Who.chief.id, arrived: arrivals.since(Arrivals.sent(sent.key))) }
                ChatNeeds(scope: .chief)
            }
            .scrollTargetLayout()
            .frame(maxWidth: 820)
            .padding(.horizontal, 30)
            .padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        // A chat stays at its newest message, except after going to a search match.
        .defaultScrollAnchor(jumped ? nil : .bottom)
        .scrollPosition($position)
        // From a search match: that message.
        .onChange(of: store.chief.messages.count, initial: true) { jump(); toNewLine() }
        .onChange(of: nav.jump) { jump() }
        .onChange(of: store.chief.chatId) { if nav.jump == nil { jumped = false; matched = false } }
        .onChange(of: newLine) { toNewLine() }
        .onChange(of: inFront) { if !inFront { matched = false } } // a line placed on coming back is scrolled to
    }

    /// The open chat's "New" line, while it has one.
    private var newLine: NewLine? {
        guard let id = store.chief.chatId, store.newLine?.chat == "chief:\(id)" else { return nil }
        return store.newLine
    }

    /// Brings a line that was just placed to the top of the chat, once its message is there. A search
    /// match that opened the chat goes first.
    private func toNewLine() {
        guard let line = newLine, line != shownLine, nav.jump == nil,
              let place = line.first.message, place < store.chief.messages.count else { return }
        shownLine = line
        guard !matched else { return }
        Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: place, anchor: .top) }
    }

    /// Goes to the message a search match pointed at, once it's there.
    private func jump() {
        guard let hit = nav.jump, hit.chatId == store.chief.chatId, let i = hit.index, i < store.chief.messages.count else { return }
        nav.jump = nil
        matched = true
        Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: i, anchor: .center) }
    }

    /// `box`: it goes back into the message box when it could not be sent. A quick answer or a card
    /// of questions (`box` false) stays on screen instead, and gives its own `key`.
    private func send(_ message: String, _ attachments: [FileRef], box: Bool = true, key: String? = nil) {
        let t = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !attachments.isEmpty else { return }
        if box { text = "" }
        jumped = false
        Task { await store.deliverToChief(t, attachments: attachments, box: box, key: key) }
    }

    /// What the message box is told about its sends: one outbox for all the Chief's chats.
    private var outbox: Outbox { store.outbox("chief") }

    private func takeBack() {
        guard let kept = outbox.take(typedSince: text) else { return }
        text = kept.text
        files.putBack(kept.attachments)
    }
}

/// The web page's `.suggestion`: a card with a hairline, its words muted until the pointer is on it.
struct SuggestionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Card(configuration: configuration) }

    private struct Card: View {
        let configuration: Configuration
        @State private var over = false

        var body: some View {
            configuration.label
                .font(.geist(size: 13))
                .lineSpacing(3)
                .foregroundStyle(over ? Theme.text : Theme.muted)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(over ? Theme.line2 : Theme.line, lineWidth: 1))
                .contentShape(Rectangle())
                .onHover { over = $0 }
        }
    }
}

/// One message in a Chief chat.
struct ChiefMessageView: View {
    let message: ChiefMessage
    let isLast: Bool
    let activity: String?
    /// The working line under the chat says what a reply still being written is doing (a botdot server
    /// with `message-waits`): only what it did so far stands here.
    var lineSaysIt = false
    /// Sends a quick answer or the card's answers, with its key: the same when it is sent again.
    let answer: (String, String) -> Void
    @Environment(Store.self) private var store
    @State private var keys = AnswerKeys()
    /// A click on 👍 or 👎: only for an unasked message, from a server that rates.
    var rate: ((String) -> Void)? = nil

    var body: some View {
        switch message.role {
        case "user":
            MyBubble(text: message.text ?? "", files: message.attachments ?? [], chat: Who.chief.id)
        case "report", "suggestion":
            FromBotBubble(label: message.role == "report" ? "Message from" : "Suggestion from", from: message.from, text: message.text ?? "", files: message.files ?? [], problem: message.failed)
        default:
            chief
        }
    }

    private var chief: some View {
        let drawn = message.reply
        return VStack(alignment: .leading, spacing: 6) {
            if message.pending == true {
                if !lineSaysIt {
                    HStack(spacing: 8) {
                        TypingDots()
                        Text(activity ?? "Thinking…").foregroundStyle(Theme.muted)
                    }
                    .modifier(BotBubble())
                }
            } else if !drawn.isEmpty {
                // Nothing to show is no bubble: the app writes no "Done." of its own. The files of the
                // bot's result it is about stand in the bubble, under the text and above the problem.
                VStack(alignment: .leading, spacing: 8) {
                    if let text = drawn.text { MarkdownView(text, wide: false) }
                    BotFiles(files: drawn.files)
                    if let problem = drawn.problem {
                        if drawn.text == nil {
                            MarkdownView(problem, wide: false)
                        } else {
                            // A reply that failed after writing: its problem, in a block of its own under the text.
                            MarkdownView(problem, wide: false).foregroundStyle(Theme.warnText)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.warnSoft))
                        }
                    }
                }
                .modifier(BotBubble(problem: drawn.text == nil && drawn.problem != nil))
            }
            if let actions = message.actions, !actions.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(actions.enumerated()), id: \.offset) { _, a in
                        ActionChip(action: a)
                    }
                }
            }
            if message.pending != true, let t = drawn.text ?? drawn.problem {
                HStack(spacing: 2) {
                    BubbleMeta(time: Format.messageTime(message.endedAt ?? message.at), copy: t)
                    if let rate { RateButtons(rating: message.rating, rate: rate) }
                }
            }
            // Not while the Chief replies: an answer then would wait behind what it is already doing.
            if isLast, message.pending != true, !store.chief.busy, let choices = message.choices, !choices.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(choices, id: \.self) { c in
                        Button(c) { answer(c, keys.of(c)) }.buttonStyle(.pill)
                    }
                }
            }
            if isLast, message.pending != true, !store.chief.busy, let questions = message.questions, !questions.isEmpty {
                QuestionsCard(questions: questions) { answer($0, keys.of($0)) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 👍 and 👎 after the time and Copy of an unasked Chief message: outline, the chosen one filled in
/// the Chief's colour (as the web page's public/ratings.js).
struct RateButtons: View {
    let rating: String?
    let rate: (String) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Ratings.values, id: \.self) { v in
                let on = rating == v
                let label = Ratings.label[v] ?? ""
                Button { rate(v) } label: {
                    Image(systemName: "hand.thumbs\(v)\(on ? ".fill" : "")")
                        .foregroundStyle(on ? Theme.chief : Theme.faint)
                }
                .buttonStyle(.plain)
                .help(label)
                .accessibilityLabel(label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .font(.geist(size: 11.5))
    }
}

/// What the Chief did, like "✨ Created News".
struct ActionChip: View {
    let action: ChiefAction
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.openWindow) private var openWindow

    /// The bot it's about (from the run, for older chats that only kept that).
    private var bot: Bot? {
        let id = action.botId ?? store.recentRuns.first { $0.id == action.runId }?.botId
        return store.bots.first { $0.id == id }
    }

    var body: some View {
        let screen = action.kind == "run" && bot?.computer == "linux"
        // It opens what it's about: the bot's chat (and its screen, for a run on its computer).
        Button {
            if action.kind == "skill" { nav.page = .skills; return }
            guard let bot else { return }
            nav.page = .bot(bot.id)
            if screen { openWindow(id: "screen", value: bot.id) }
        } label: {
            Text("\(action.label)\(screen ? " · View live screen" : "")")
                .font(.geist(size: 12.5))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Capsule().fill(Theme.sunk))
        }
        .buttonStyle(.plain)
    }
}
