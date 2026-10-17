import SwiftUI
import BotDotKit

/// A bot's chat, as on the web: each run is one exchange, the task you gave it, then its reply.
/// While it works, what it's doing, step by step.
struct BotChatView: View {
    let bot: Bot
    @Environment(Store.self) private var store
    @State private var text = ""
    @State private var files = PendingFiles()
    @State private var details: String?
    @State private var makingGroup = false
    @Environment(\.openWindow) private var openWindow
    /// The run a search match opened: its folds stay open, and it's scrolled to.
    @State private var opened: String?
    @State private var jumped = false
    @State private var position = ScrollPosition(idType: String.self)
    /// The "New" line the chat was last scrolled to: each line once.
    @State private var shownLine: NewLine?
    /// A search match opened the chat: the line that comes with that opening isn't scrolled to.
    @State private var matched = false
    /// Which replies are new in the open chat, and so arrive (see Arrivals in BotDotKit).
    @State private var arrivals = Arrivals()
    @Environment(\.appearsActive) private var inFront
    @Environment(Navigation.self) private var nav

    var body: some View {
        Group {
            if store.botChat.botId == bot.id && store.botChat.loaded && store.botChat.runs.isEmpty && store.chatNeeds(.bot(bot.id)).isEmpty && store.waiting(in: "bot:\(bot.id)").isEmpty && store.sent(toBot: bot.id) == nil {
                empty
            } else {
                thread
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // You can give it more while it works: the tasks wait their turn.
            Composer(text: $text, placeholder: "Give \(bot.name) a task…", files: files, uploadTo: .bot(bot.id), chat: bot.id, note: outbox.note, send: send)
        }
        // A message that could not be sent is back in the box, with its files.
        .onChange(of: outbox.back, initial: true) { takeBack() }
        .onChange(of: text) { outbox.edited(text) }
        .modifier(FileDrop(files: files, target: .bot(bot.id)))
        .modifier(ChatImageGallery(files: galleryFiles))
        // While it works on its computer, a small live view in the corner.
        .overlay(alignment: .topTrailing) {
            if let live = store.botChat.live, store.botChat.runs.first(where: { $0.id == live.runId })?.computer == true {
                ScreenCorner(botId: bot.id)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ChatHead(name: bot.name, sub: bot.running == true ? "working…" : "", open: { nav.togglePanel() }) {
                BotFigureView(color: bot.color, state: bot.state ?? "idle", size: 34, outfit: bot.outfit)
            } beside: {
                // A very small plus with no words, right of the bot's name: a new group with this bot. Only
                // against a botdot server that has groups, and with another bot to add.
                if store.canMakeGroup(with: bot.id) {
                    IconButton(icon: "plus", help: GroupWords.addABot, size: 26) { makingGroup = true }
                }
            } actions: {
                if bot.computer == "linux" {
                    IconButton(icon: "display", help: "Its computer") { openWindow(id: "screen", value: bot.id) }
                }
            }
        }
        .task(id: bot.id) { store.openBot(bot.id) }
        // A new group of this bot and those picked, one to five, with the name given: it is in the list and
        // its chat opens. The bot's own chat stays as it is. A refusal is shown in the picker, in the server's words.
        .sheet(isPresented: $makingGroup) {
            BotPicker(title: "New group", bots: Groups.toJoin(bot, store.bots), max: Groups.most - 1, action: "Create", hint: { GroupWords.makeHint($0, bot.name) }, named: true) { picked, name in
                nav.page = .group(try await store.makeGroup(name: name, members: [bot.id] + picked).id)
            }
        }
        .sheet(item: Binding(get: { details.map(RunRef.init) }, set: { details = $0?.id })) { ref in
            RunDetailsView(runId: ref.id)
        }
    }

    private var galleryFiles: [FileRef] {
        guard store.botChat.botId == bot.id else { return [] }
        return store.botChat.runs.flatMap { run in
            (run.attachments ?? []) + (run.files ?? []) +
                (store.botChat.live?.runId == run.id ? store.botChat.live?.files ?? [] : [])
        }
    }

    private var empty: some View {
        VStack(spacing: 0) {
            BotFigureView(color: bot.color, state: bot.state ?? "idle", size: 56, outfit: bot.outfit)
            Text(bot.name).font(.geist(size: 20, weight: .semibold)).padding(.top, 14).padding(.bottom, 6)
            if let d = bot.description, !d.isEmpty {
                Text(d).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            }
            Button { run(nil, []) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Run its main assignment", systemImage: "play.fill")
                    if let p = bot.prompt, !p.isEmpty {
                        Text(p.count > 140 ? String(p.prefix(140)) + "…" : p).foregroundStyle(Theme.faint)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(SuggestionButtonStyle())
            .padding(.top, 20)
        }
        .frame(maxWidth: 520)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var thread: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                let runs = store.botChat.runs
                let newFirst = newLine?.first.run
                // Your message on its way, from Send until botdot answered; and what is new in the chat with this drawing.
                let sent = store.sent(toBot: bot.id)
                let _ = arrivals.draw("bot:\(bot.id)", loaded: store.botChat.botId == bot.id && store.botChat.loaded, replies: Arrivals.replyIds(runs), sent: sent?.key)
                ForEach(Array(runs.enumerated()), id: \.element.id) { i, run in
                    if i == 0 || Format.day(runs[i - 1].startedAt) != Format.day(run.startedAt) {
                        Text(Format.dayTitle(run.startedAt)).font(.geist(size: 11.5)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity)
                    }
                    RunExchange(
                        run: run,
                        newLine: run.id == newFirst ? Color(hex: bot.color) : nil,
                        live: store.botChat.live?.runId == run.id ? store.botChat.live : nil,
                        isLast: i == runs.count - 1,
                        arrived: arrivals.since(run.id),
                        showDetails: { details = run.id },
                        answer: { text, key in jumped = false; return await store.deliverToBot(text, box: false, key: key) }
                    )
                    .environment(\.foldsOpen, nav.jump?.runId == run.id || opened == run.id)
                    .id(run.id)
                }
                // Notes teammates left, waiting for its next run.
                if store.botChat.botId == bot.id && !store.botChat.notes.isEmpty {
                    NotesFold(heading: "Notes waiting:", notes: store.botChat.notes)
                }
                // A working bot is this one line, below the last message and above what waits for you: what it
                // said it is about to do, or "Working" until it says so, and Stop. While its run waits for
                // your answer on an action in a connected app, the line says "Waiting for your OK".
                let working = store.botChat.botId == bot.id ? runs.last(where: { $0.isRunning && $0.kind != "script" }) : nil
                let waiting = working.map { store.waitsForOk("bot:\(bot.id)", run: $0.id) } ?? false
                // Your message on its way stands above the line of a bot that was free, which reads "Working"
                // until botdot answers; under what waits already for a bot at work.
                if let sent, working == nil { SentBubble(message: sent, chat: bot.id, arrived: arrivals.since(Arrivals.sent(sent.key))) }
                if let line = OpeningLine.withSent(OpeningLine.status(store.openingLine(of: "bot:\(bot.id)"), working: working != nil, waiting: waiting), sent) {
                    StatusLine(text: line, color: Color(hex: bot.color), still: waiting, stop: working.map { run in { Task { await store.stopRun(run.id) } } })
                }
                // Your messages that wait until it is free, faded, each with "Take back".
                WaitingMessages(queued: store.waiting(in: "bot:\(bot.id)"), who: bot.name, chat: bot.id) { q in
                    Task { await store.takeBack(q, from: "bot:\(bot.id)") }
                }
                if let sent, working != nil { SentBubble(message: sent, chat: bot.id, arrived: arrivals.since(Arrivals.sent(sent.key))) }
                ChatNeeds(scope: .bot(bot.id))
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
        // From a search match: that run, its folds open.
        .onChange(of: store.botChat.runs.map(\.id), initial: true) { jump(); toNewLine() }
        .onChange(of: nav.jump) { jump() }
        .onChange(of: newLine) { toNewLine() }
        .onChange(of: inFront) { if !inFront { matched = false } } // a line placed on coming back is scrolled to
    }

    /// This chat's "New" line, while it has one.
    private var newLine: NewLine? {
        store.newLine?.chat == "bot:\(bot.id)" ? store.newLine : nil
    }

    /// Brings a line that was just placed to the top of the chat, once its run is there. A search match
    /// that opened the chat goes first.
    private func toNewLine() {
        guard let line = newLine, line != shownLine, nav.jump == nil,
              let run = line.first.run, store.botChat.runs.contains(where: { $0.id == run }) else { return }
        shownLine = line
        guard !matched else { return }
        Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: run, anchor: .top) }
    }

    /// Goes to the run a search match pointed at (its folds open), once it's there.
    private func jump() {
        guard let target = nav.jump?.runId, store.botChat.runs.contains(where: { $0.id == target }) else { return }
        opened = target
        matched = true
        nav.jump = nil
        Task { try? await Task.sleep(for: .milliseconds(200)); jumped = true; position.scrollTo(id: target, anchor: .center) }
    }

    private func send(_ message: String, _ attachments: [FileRef]) {
        let t = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !attachments.isEmpty else { return }
        text = ""
        jumped = false
        run(t.isEmpty ? nil : t, attachments, box: true)
    }

    /// `box`: it came from the message box, where it goes back when it could not be sent.
    private func run(_ prompt: String?, _ attachments: [FileRef], box: Bool = false) {
        Task { await store.deliverToBot(prompt, attachments: attachments, box: box) }
    }

    /// What this chat's message box is told about its sends.
    private var outbox: Outbox { store.outbox("bot:\(bot.id)") }

    private func takeBack() {
        guard let kept = outbox.take(typedSince: text) else { return }
        text = kept.text
        files.putBack(kept.attachments)
    }
}

struct RunRef: Identifiable { let id: String }

/// One run in a bot's chat: what started it, then its reply (or what it's doing now).
struct RunExchange: View {
    let run: RunSummary
    /// The "New" line belongs to this run, in this colour: its reply is the first new one.
    var newLine: Color? = nil
    let live: LiveRun?
    let isLast: Bool
    /// When its reply came into the open chat, for a reply that is new there: it arrives, once.
    var arrived: Date? = nil
    let showDetails: () -> Void
    /// Sends a quick answer or the card's answers with its key, and says whether it went.
    let answer: @MainActor (String, String) async -> Bool
    @Environment(Store.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Your own message isn't new: the line goes below it, and above anything else that started the run.
            if let newLine, !run.startedByOwnMessage { NewLineView(color: newLine) }
            // Notes other bots left for it, read at the start of this run.
            if let notes = run.inbox, !notes.isEmpty {
                NotesFold(heading: notes.count == 1 ? "Read a note from" : "Read notes from", notes: notes)
            }
            asked
            if let newLine, run.startedByOwnMessage { NewLineView(color: newLine) }
            reply.modifier(Arrives(since: arrived))
        }
    }

    @ViewBuilder
    private var asked: some View {
        switch run.asked {
        case .script:
            Chip(text: "⏰ \(run.jobWords ?? "Job") · \(Format.messageTime(run.startedAt))").frame(maxWidth: .infinity, alignment: .trailing)
        case .replies:
            EmptyView() // started by its teammates' answers
        case .firstMessage:
            EmptyView() // a new bot's first message: the owner asked nothing
        case .carriedOn:
            EmptyView() // the request stands once, above the reply of the run that stopped for the OK
        case .message(let sender):
            // Messages between bots are folded: one line that opens to what it said.
            Fold(label: { FoldLabel(prefix: "Message from", who: [sender]) }) {
                MarkdownView(run.prompt ?? "", wide: false).modifier(BotBubble(other: true))
                if let a = run.attachments, !a.isEmpty {
                    BotFiles(files: a, opensDocuments: false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        case .job(let job):
            Chip(text: "\(run.jobId == "memory-review" ? "🧹" : "⏰") \(run.jobWords ?? job)\(run.parentRunId != nil ? " · its script found something" : "") · \(Format.messageTime(run.startedAt))")
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .schedule:
            Chip(text: "⏰ Scheduled run · \(Format.messageTime(run.startedAt))").frame(maxWidth: .infinity, alignment: .trailing)
        case .usualTask:
            Chip(text: "▶ Ran its main assignment").frame(maxWidth: .infinity, alignment: .trailing)
        case .ownMessage:
            MyBubble(text: run.prompt ?? "", files: run.attachments ?? [], chat: run.botId, folds: true)
        }
    }

    @ViewBuilder
    private var reply: some View {
        if run.isRunning && run.kind != "script" {
            // No bubble while it works: the status line under the chat says it. Only what it attached so far.
            BotFiles(files: (run.files ?? []) + (live?.files ?? []).filter { !(run.files ?? []).contains($0) })
        } else if run.kind == "script" {
            // A script job's run: its output, no AI.
            let failed = run.status != "success"
            let output = (run.result ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("⚙️ Ran its script\(failed ? ": \(run.error ?? "it failed")" : "")").font(.geist(size: 12)).foregroundStyle(Theme.faint)
                    if output.isEmpty {
                        Text("No output.").foregroundStyle(Theme.muted)
                    } else {
                        Text(output).font(.geistMono(size: 12)).lineSpacing(2).lineLimit(8).textSelection(.enabled)
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
                    }
                }
                .modifier(BotBubble(problem: failed))
                RunMeta(run: run, extra: "no AI", copy: output.isEmpty ? nil : output, showDetails: showDetails)
            }
        } else {
            // A run that did not finish says who ended it, in the server's sentence; the app's own muted
            // "Stopped." only for a stopped run without one.
            let ended = run.failed ? run.ended(saysWho: store.saysWhoEnded) : nil
            let body = ended?.text ?? run.replyText
            VStack(alignment: .leading, spacing: 6) {
                if run.sender != nil && !run.failed {
                    let exchange = run.exchange
                    let messages = run.messaged.filter { $0.text?.isEmpty == false }
                    if messages.isEmpty {
                        FoldLabel(prefix: exchange.prefix, who: exchange.who).font(.geist(size: 12))
                    } else {
                        Fold(label: { FoldLabel(prefix: exchange.prefix, who: exchange.who) }) {
                            ForEach(Array(messages.enumerated()), id: \.offset) { _, t in
                                FoldLabel(prefix: "To", who: [t]).font(.geist(size: 12))
                                MarkdownView(t.text ?? "", wide: false).modifier(BotBubble())
                            }
                        }
                    }
                } else if !run.messaged.isEmpty {
                    FoldLabel(prefix: "Messaged", who: run.messaged, suffix: run.messagedHow).font(.geist(size: 12))
                }
                RunReply(run: run, ended: ended, text: body, answers: isLast, showDetails: showDetails, answer: answer)
            }
        }
    }
}

/// A reply as a bot's chat and a group's draw it, as the rows of the column it stands in: its bubble,
/// what it learned as chips, when it ended, and the answers of the one that asks (`Store.under`).
/// `ended`: how a run that did not finish is drawn, and `text` what its bubble reads. `answers`: its
/// answers are open: the newest reply of a bot's chat, the open question of a group.
struct RunReply: View {
    let run: RunSummary
    let ended: Ended?
    let text: String
    let answers: Bool
    let showDetails: () -> Void
    /// Sends a quick answer or the card's answers with its key, and says whether it went.
    let answer: @MainActor (String, String) async -> Bool
    @State private var answered = false
    @State private var keys = AnswerKeys()
    @Environment(Navigation.self) private var nav
    @Environment(Store.self) private var store

    /// The answers go once theirs went: when it did not, they stay to be tapped again, as the same message.
    private func pick(_ text: String) {
        let key = keys.of(text)
        Task { if await answer(text, key) { answered = true } }
    }

    /// What it learned opens where that is: a job its jobs, a change to its task, its rules, a skill or
    /// a connected app its settings. Memory has no screen: a chip about a note opens nothing.
    private func openLearned(_ opens: Learned.Opens) {
        guard let id = run.botId else { return }
        nav.page = opens == .jobs ? .botJobs(id) : .botSettings(id)
    }

    var body: some View {
        let under = store.under(run, answers: answers && !answered)
        VStack(alignment: .leading, spacing: 8) {
            if ended?.isProblem == false { Text(text).foregroundStyle(Theme.muted) } else { MarkdownView(text, wide: false) }
            BotFiles(files: run.files ?? [])
        }
        .modifier(BotBubble(problem: ended?.isProblem ?? false))
        // What it learned, a chip each: the server's line where it writes one, printed whole.
        if !under.chips.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(Array(under.chips.enumerated()), id: \.offset) { _, x in
                    if let opens = x.opens {
                        Button { openLearned(opens) } label: { Chip(text: x.text) }.buttonStyle(.plain)
                    } else {
                        Chip(text: x.text)
                    }
                }
            }
        }
        RunMeta(run: run, copy: text, showDetails: showDetails)
        if !under.choices.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(under.choices, id: \.self) { c in
                    Button(c) { pick(c) }.buttonStyle(.pill)
                }
            }
        }
        if !under.questions.isEmpty {
            QuestionsCard(questions: under.questions) { pick($0) }
        }
    }
}

/// Under a reply: when, how long it took, Details and copy.
struct RunMeta: View {
    let run: RunSummary
    var extra: String? = nil
    let copy: String?
    let showDetails: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Text([Format.messageTime(run.endedAt ?? run.startedAt), run.durationMs.map(Format.duration), extra].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") + " ·")
            Button("Details", action: showDetails).buttonStyle(.plain)
            if let copy { BubbleMeta(time: "", copy: copy).padding(.horizontal, -6) }
        }
        .font(.geist(size: 11.5))
        .foregroundStyle(Theme.faint)
        .padding(.horizontal, 6)
    }
}

/// A small grey pill: a job's run, a scheduled run, its usual task.
struct Chip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.geist(size: 12.5))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(Capsule().fill(Theme.sunk))
    }
}

/// "Message from Fleet Doctor" and the like: words, then bots with their small heads.
struct FoldLabel: View {
    let prefix: String
    let who: [Who]
    var suffix = ""
    var body: some View {
        HStack(spacing: 4) {
            Text(prefix)
            ForEach(Array(who.enumerated()), id: \.offset) { i, w in
                NameFigure(w, text: 13.5)
                Text((w.name ?? "a bot") + (i < who.count - 1 ? "," : ""))
            }
            if !suffix.isEmpty { Text(suffix) }
        }
        .foregroundStyle(Theme.muted)
    }
}

/// One folded line that opens to what's inside ("Message from Web Surfer ›", with its small head).
extension EnvironmentValues {
    /// Folds start open (a search match inside them).
    @Entry var foldsOpen = false
}

struct Fold<Label: View, Content: View>: View {
    @ViewBuilder let label: () -> Label
    @ViewBuilder let content: () -> Content
    @Environment(\.foldsOpen) private var startOpen
    @State private var opened: Bool?
    private var open: Bool { opened ?? startOpen }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Button { withAnimation(.snappy) { opened = !open } } label: {
                HStack(spacing: 4) {
                    label()
                    Image(systemName: "chevron.right").font(.geist(size: 9, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0))
                }
                .font(.geist(size: 13.5))
                .foregroundStyle(Theme.muted)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 8) { content() }
            }
        }
    }
}

/// Notes other bots left: one folded line ("Read notes from Web Surfer, Coder ›", each with its small head) that opens to
/// what each said.
struct NotesFold: View {
    let heading: String
    let notes: [Note]

    var body: some View {
        var seen = Set<String>()
        let who = notes.map(\.who).filter { seen.insert($0.id ?? $0.name ?? "").inserted }
        Fold(label: { FoldLabel(prefix: heading, who: who) }) {
            ForEach(Array(notes.enumerated()), id: \.offset) { _, n in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        NameFigure(n.who)
                        Text(n.from ?? "a bot")
                        if let at = n.at { Text("· \(Format.messageTime(at))") }
                    }
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted)
                    Text(linkedChatText(AttributedString(n.text ?? ""))).lineSpacing(Bubble.lineSpacing).textSelection(.enabled).modifier(BotBubble(other: true))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
