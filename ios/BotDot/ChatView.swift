import SwiftUI
import BotdotShared

/// A bot's chat, as Android's: its runs, oldest at the top, each the owner's message and the bot's reply in
/// Markdown; what waits until the bot is free; the message on its way; the message box (Composer).
struct ChatView: View {
    let name: String
    let home: HomeStore
    let botId: String
    /// A file path tapped in a reply: opened in the viewer.
    @State private var opening: DocumentView.Opening?
    @State private var model: ChatModel
    /// The "+" beside the name: a new group of this bot and others (GroupMaker), then its chat.
    @State private var makingGroup = false
    @State private var group: GroupRoute?
    /// A "Learned" chip's tap: the bot's scheduled jobs, or its settings.
    @State private var learnedJobs = false
    @State private var learnedSettings = false
    @State private var atBottom = true
    @State private var sentAt = 0
    @FocusState private var focused: Bool

    init(home: HomeStore, botId: String, name: String) {
        self.name = name
        self.home = home
        self.botId = botId
        _model = State(initialValue: ChatModel(home: home, botId: botId))
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let s = model.state {
                        Color.clear.frame(height: 1).onAppear { model.loadOlder() }
                        ForEach(s.runs.reversed(), id: \.run.id) { r in
                            RunRow(view: r, paths: s.opensFiles, stops: model.state?.boxStops == false, onStop: { model.stopRun(r.run.id) },
                                   color: s.bot?.color, onAnswer: { await model.answer(r.run.id, $0) },
                                   onAnswers: { await model.answerQuestions(r.run.id, $0) },
                                   onLearned: { chip in
                                       switch chip.opens {
                                       case .jobs: learnedJobs = true
                                       case .settings: learnedSettings = true
                                       default: break
                                       }
                                   },
                                   onPage: { page in opening = DocumentView.shared.ofPage(botId: page.botId.isEmpty ? botId : page.botId, slug: page.slug, title: page.title, from: name) })
                                .contextMenu {
                                    RunMenu(view: r, replies: model.replies(r.run.id), onReply: { model.replyTo(r.run.id); focused = true },
                                            onQuote: { model.quote($0) })
                                }
                        }
                        ForEach(s.started, id: \.id) { q in Mine(text: q.text, files: q.attachments, waiting: true) }
                        ForEach(s.queued, id: \.id) { q in
                            VStack(alignment: .trailing, spacing: 4) {
                                Mine(text: q.text, files: q.attachments, waiting: true)
                                if q.steering { Text(tr("Steering…")).font(.caption).foregroundStyle(.secondary) }
                                else { Button(tr("Take back")) { model.takeBack(q) }.font(.caption) }
                            }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        if let sent = s.sent { Mine(text: sent.text, files: sent.attachments, waiting: true) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    Color.clear.frame(height: 1).id("end")
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding()
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.refresh() }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    Button { withAnimation { scroll.scrollTo("end", anchor: .bottom) } } label: {
                        Image(systemName: "arrow.down").padding(10)
                    }
                    .buttonStyle(.bordered).clipShape(Circle()).padding()
                    .accessibilityLabel(tr("Latest"))
                }
            }
            .onChange(of: tail) { if atBottom { toEnd(scroll) } }
            .onChange(of: sentAt) { toEnd(scroll) } // one's own message: always to it
            .onChange(of: focused) { _, on in
                // The keyboard comes up over the end: the newest stays in sight once it is up.
                guard on, atBottom else { return }
                toEnd(scroll, after: .milliseconds(350))
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    if let plan = model.state?.plan {
                        ChatPlanDock(plan: plan, color: model.state?.bot?.color, onFold: model.foldPlan, onDismiss: model.dismissPlan)
                            .padding(.horizontal).padding(.top, 6)
                    }
                    if let replying = model.state?.replying { ReplyChip(text: replying, onClear: model.clearReply).padding(.horizontal) }
                    Composer(box: model, placeholder: tr("Message"), focused: $focused) { sentAt += 1 }
                }
            }
        }
        .navigationTitle(name)
        .toolbar {
            if model.state?.bot != nil, canMakeGroup {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { makingGroup = true } label: { Image(systemName: "plus") }.accessibilityLabel(tr("New group"))
                }
            }
        }
        .sheet(isPresented: $makingGroup) {
            if let bot = model.state?.bot {
                NewGroupSheet(home: home, bot: bot, others: GroupMaker.shared.others(bots: allBots, bot: bot)) {
                    group = GroupRoute(groupId: $0.id, name: $0.name)
                }
            }
        }
        .navigationDestination(item: $group) { g in GroupChatView(home: home, groupId: g.groupId, name: g.name, figure: nil) }
        .navigationDestination(isPresented: $learnedJobs) { JobsView(home: home, botId: botId, figure: nil) }
        .navigationDestination(isPresented: $learnedSettings) { BotSettingsView(home: home, botId: botId, figure: nil) }
        // A file path in a reply opens in the viewer (#251), as on Android; a web address in the browser.
        .environment(\.openURL, OpenURLAction { url in
            guard let path = MarkdownKt.filePathOf(link: url.absoluteString.removingPercentEncoding ?? url.absoluteString) else { return .systemAction }
            opening = DocumentView.shared.ofPath(botId: botId, path: path, from: name, name: (path as NSString).lastPathComponent)
            return .handled
        })
        .replyFiles(api: home.api, from: name, opening: $opening)
        .navigationDestination(item: $opening) { ViewerView(api: home.api, opening: $0) }
        .navigationBarTitleDisplayMode(.inline)
        .modifier(NoticeOverlay(notice: model.state?.notice, count: Int(model.state?.noticeCount ?? 0)))
        .task { model.start() }
        .onDisappear { model.stop() }
    }
    /// Every bot, as the store last read them.
    private var allBots: [Bot] { (home.store.bots.value.value as? [Bot]) ?? [] }

    /// A group can be made here: the botdot has groups, and there is another bot.
    private var canMakeGroup: Bool {
        GroupMaker.shared.canMake(features: home.store.version.value.value?.features, otherBots: Int32(max(allBots.count - 1, 0)))
    }

    /// To the chat's end once what changed is laid out ([after]: once the keyboard is up).
    private func toEnd(_ scroll: ScrollViewProxy, after: Duration = .zero) {
        Task {
            if after > .zero { try? await Task.sleep(for: after) } else { await Task.yield() }
            withAnimation { scroll.scrollTo("end", anchor: .bottom) }
        }
    }

    /// What the chat's end shows: it changes when something is added there or the newest reply grows.
    private var tail: String {
        guard let s = model.state else { return "" }
        let r = s.runs.first
        return "\(r?.run.id ?? "")|\(r?.reply?.count ?? 0)|\(r?.draft?.count ?? 0)|\(s.started.count)|\(s.queued.count)|\(s.sent?.text ?? "")"
    }
}

/// A run's long press (Android's RunBlock): Reply to this task, where the botdot takes replies; Quote its reply into
/// the box (Quote), and Copy it.
struct RunMenu: View {
    let view: RunView
    let replies: Bool
    let onReply: () -> Void
    var onQuote: (String) -> Void = { _ in }

    var body: some View {
        if replies { Button(action: onReply) { Label(tr("Reply to this task"), systemImage: "arrowshape.turn.up.left") } }
        if let reply = view.reply, !reply.isEmpty {
            Button { onQuote(reply) } label: { Label(tr("Quote"), systemImage: "text.quote") }
            Button { UIPasteboard.general.string = reply } label: { Label(tr("Copy"), systemImage: "doc.on.doc") }
        }
    }
}

/// Above the message box while a reply is picked: what it replies to, and ✕.
struct ReplyChip: View {
    let text: String
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(text).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            Button(action: onClear) { Image(systemName: "xmark").font(.caption) }
                .accessibilityLabel(tr("Don't reply to it"))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar, in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("reply-chip")
    }
}

/// One run: what started it on the owner's side, and what came of it on the bot's.
struct RunRow: View {
    let view: RunView
    /// File paths in its reply open in the viewer.
    var paths = false
    /** Its working line has Stop (Send stays in the box while it works). */
    let stops: Bool
    let onStop: () -> Void
    /// The bot's colour, for the choice that says yes.
    var color: String? = nil
    var onAnswer: (String) async -> Bool = { _ in false }
    var onAnswers: ([String]) async -> Bool = { _ in false }
    /// A "Learned" chip's tap, for one that opens something.
    var onLearned: (LearnedChip) -> Void = { _ in }
    /// A page chip under its reply opens that page in the viewer.
    var onPage: (PageRef) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let asked = view.asked { Mine(text: asked, files: view.askedFiles, waiting: false) }
            if let chip = view.chip { Text(chip).font(.caption).foregroundStyle(.secondary) }
            if let steps = view.steps, !view.working {
                StepLineView(run: view.run, steps: steps, stops: false, onStop: onStop)
            }
            if view.working {
                if let draft = view.draft, !draft.isEmpty { MarkdownView(text: draft, paths: paths) }
                if let steps = view.steps {
                    StepLineView(run: view.run, steps: steps, stops: stops, onStop: onStop)
                } else {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text(view.line).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        if stops { Spacer(); Button(tr("Stop"), action: onStop).font(.callout) }
                    }
                }
            } else if let reply = view.reply, !reply.isEmpty {
                MarkdownView(text: reply, paths: paths)
            } else if let ended = view.ended {
                Text(ended).foregroundStyle(view.problem ? .red : .secondary)
            }
            ReplyFilesView(files: view.files)
            ForEach(view.pages, id: \.slug) { page in PageChip(page: page) { onPage(page) } }
            ForEach(Array(view.learned.enumerated()), id: \.offset) { (_, chip: LearnedChip) in
                if chip.opens != nil {
                    Button { onLearned(chip) } label: { LearnedChipLabel(text: chip.text) }.buttonStyle(.plain)
                } else {
                    LearnedChipLabel(text: chip.text)
                }
            }
            if !view.choices.isEmpty { Choices(choices: view.choices, yes: Int(view.yes), color: color, onAnswer: onAnswer) }
            if !view.questions.isEmpty {
                QuestionsBox(questions: view.questions, choices: view.questionChoices, onSend: onAnswers)
            }
        }
    }
}

/// A reply's quick answers: a tap is the owner's answer to the run that asked; the one that says yes is filled with
/// the bot's colour. Tapped, they wait for the answer to go, and go with it.
struct Choices: View {
    let choices: [String]
    let yes: Int
    let color: String?
    let onAnswer: (String) async -> Bool
    @State private var sent = false
    @State private var busy = false

    var body: some View {
        if !sent {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(Array(choices.enumerated()), id: \.offset) { (i, c: String) in
                        if i == yes {
                            Button(c) { tap(c) }.buttonStyle(.borderedProminent).tint(ContactRow.tint(color))
                        } else {
                            Button(c) { tap(c) }.buttonStyle(.bordered)
                        }
                    }
                }
            }
            .disabled(busy)
        }
    }

    private func tap(_ c: String) {
        busy = true
        Task {
            if await onAnswer(c) { sent = true }
            busy = false
        }
    }
}

/// The owner's own message: on the right, in a bubble; one that waits is drawn lighter.
struct Mine: View {
    let text: String
    let files: [Attachment]
    let waiting: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if !text.isEmpty { Text(MarkdownView.inline(text)) }
            ForEach(files, id: \.file) { f in Label(f.name, systemImage: "paperclip").font(.caption) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.accentColor.opacity(waiting ? 0.25 : 0.4), in: .rect(cornerRadius: 16))
        .frame(maxWidth: .infinity, alignment: .trailing)
        .textSelection(.enabled)
    }
}

/// A run's step line (Android's StepLine, #625, #636): at work, what it does and its steps so far, with Stop; done,
/// its steps, skills, the bots it messaged and how long it took. A tap unfolds its steps; one opened while it worked
/// folds when it is done (RunSteps.open).
struct StepLineView: View {
    let run: Run
    let steps: StepLine
    let stops: Bool
    let onStop: () -> Void
    /// Opened, and whether the run was at work then; nil while folded.
    @State private var opened: Bool?

    private var open: Bool {
        guard let o = opened else { return false }
        return RunSteps.companion.open(opened: [run.id: KotlinBoolean(bool: o)], r: run)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Button { opened = open ? nil : run.isRunning } label: {
                    HStack(spacing: 8) {
                        if run.isRunning {
                            if steps.held { Circle().fill(.secondary.opacity(0.5)).frame(width: 8, height: 8) } else { ProgressView().controlSize(.small) }
                            Text(steps.now).font(.callout).lineLimit(1)
                            if steps.count > 0 { Text("· " + RunSteps.companion.countWords(n: steps.count)).font(.caption.monospaced()).foregroundStyle(.secondary) }
                        } else {
                            Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
                            Image(systemName: "checkmark").font(.caption).foregroundStyle(.green)
                            Text(steps.label).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(steps.label)
                .accessibilityHint(open ? tr("Hide the steps") : tr("Show the steps"))
                if run.isRunning && stops { Spacer(); Button(tr("Stop"), action: onStop).font(.callout) }
            }
            if open && !steps.timeline.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(steps.timeline.enumerated()), id: \.offset) { (_, row: RunSteps.Row) in
                        StepRow(row: row)
                    }
                }
                .padding(.leading, 16)
                .overlay(alignment: .leading) { Rectangle().fill(.quaternary).frame(width: 1) }
            }
        }
    }
}

/// One of a run's steps: when, what kind, and what it did; what it sent or changed in bold.
private struct StepRow: View {
    let row: RunSteps.Row

    var body: some View {
        let lines = row.text.split(separator: "\n", maxSplits: 1).map(String.init)
        let head = lines.first ?? ""
        let rest = lines.count > 1 ? lines[1] : nil
        let strong = row.kind == RunSteps.companion.CHANGED || (row.kind == RunSteps.companion.MESSAGE && rest != nil)
        HStack(alignment: .top, spacing: 10) {
            Text(row.at.map { StepRow.clock($0) } ?? "").font(.caption.monospaced()).foregroundStyle(.tertiary).frame(minWidth: 40, alignment: .leading)
            Image(systemName: icon).font(.caption).foregroundStyle(row.kind == "" ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.n > 1 ? "\(head) ×\(row.n)" : head).font(.subheadline).fontWeight(strong ? .semibold : .regular)
                    .foregroundStyle(strong ? .primary : .secondary)
                if let rest, !rest.isEmpty { Text(rest).font(.caption).foregroundStyle(.tertiary).lineLimit(2) }
            }
        }
    }

    private var icon: String {
        switch row.kind {
        case RunSteps.companion.MESSAGE: "bubble.left"
        case RunSteps.companion.SKILL, RunSteps.companion.CHANGED: "sparkles"
        default: "checkmark"
        }
    }

    /// A step's time as its chat writes it: the hour and minute.
    static func clock(_ at: String) -> String { String(BotChatKt.chatClock(iso: at).split(separator: ",").last ?? "").trimmingCharacters(in: .whitespaces) }
}

/// A page a reply made or changed (Android's PageChips): its title, a tap opens it in the viewer.
struct PageChip: View {
    let page: PageRef
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 10) {
                Image(systemName: "doc.richtext").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(page.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(tr("Page")).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: 320, alignment: .leading)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

/// What a run learned, under its reply: the server's words, small and muted.
struct LearnedChipLabel: View {
    let text: String

    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(.quaternary.opacity(0.5), in: .capsule)
    }
}
