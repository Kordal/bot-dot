import SwiftUI
import BotdotShared

/// A group's chat, as Android's: the owner's messages, and every reply under its member's name, in its colour, with
/// its head beside it. A tapped answer has the question it answers above it. At the end: the replies being written,
/// the line that the group stopped with "Go on", one line per member at work with one "Stop all", the heads of who is
/// next, and the messages that wait with "Take back". The title opens the members panel: its name, members, notes.
struct GroupChatView: View {
    let name: String
    let figure: FigureDef?
    private let home: HomeStore
    @State private var model: GroupChatModel
    /// A file under a reply, opened in the viewer.
    @State private var opening: DocumentView.Opening?
    @State private var atBottom = true
    @State private var sentAt = 0
    @State private var panel = false
    @State private var notice: String?
    @State private var noticeTimer: Task<Void, Never>?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    init(home: HomeStore, groupId: String, name: String, figure: FigureDef?) {
        self.name = name
        self.figure = figure
        self.home = home
        _model = State(initialValue: GroupChatModel(home: home, groupId: groupId))
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let s = model.state {
                        Color.clear.frame(height: 1).onAppear { model.loadOlder() }
                        if s.showsEmpty {
                            Text(s.empty).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding()
                        }
                        ForEach(s.rows, id: \.id) { row in
                            if let m = row.message {
                                GroupMessageRow(view: m, figure: figure) { id in withAnimation { scroll.scrollTo(id, anchor: .center) } }.id(row.id)
                            } else if let r = row.reply {
                                GroupReplyRow(view: r, figure: figure, onAnswer: { model.answer($0) }, onAnswers: { await model.answerQuestions(r.run.id, $0) }, onDismiss: { await model.dismissChoices(r.run.id, $0) }).id(row.id)
                            } else if let f = row.fold {
                                FoldRow(fold: f, figure: figure) { withAnimation { model.toggleFold(f.messageId) } }.id(row.id)
                            }
                        }
                        tail(s)
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
            .onChange(of: tailKey) { if atBottom { toEnd(scroll) } }
            .onChange(of: sentAt) { toEnd(scroll) }
            .safeAreaInset(edge: .bottom) { box }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { panel = true } label: { Text(model.state?.group?.name ?? name).font(.headline).lineLimit(1) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tr("Its name and its members"))
            }
        }
        .sheet(isPresented: $panel) { GroupPanelView(model: model, figure: figure) }
        .overlay(alignment: .top) {
            if let notice { Text(notice).font(.callout).padding(10).background(.thinMaterial, in: .capsule).padding(.top, 8) }
        }
        .onChange(of: model.state?.noticeCount) {
            notice = model.state?.notice
            noticeTimer?.cancel()
            noticeTimer = Task { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled { notice = nil } }
        }
        .onChange(of: model.state?.gone) { _, gone in if gone == true { panel = false; dismiss() } } // deleted, here or elsewhere
        .replyFiles(api: home.api, from: name, opening: $opening)
        .navigationDestination(item: $opening) { ViewerView(api: home.api, opening: $0) }
        .task { model.start() }
        .onDisappear { model.stop() }
    }

    /// Last in the chat: what is being written, the stopped line, who works, who is next, and what waits.
    @ViewBuilder
    private func tail(_ s: GroupChatState) -> some View {
        ForEach(s.drafts, id: \.runId) { d in
            MemberSide(name: d.name, color: d.color, state: "working", outfit: d.bot?.outfit, figure: figure) { MarkdownView(text: d.text) }
        }
        if let limit = s.limit {
            HStack {
                Text(limit).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button(tr("Go on")) { model.goOn() }.buttonStyle(.bordered)
            }
        }
        if let sent = s.sent, s.turns.isEmpty {
            Mine(text: sent.text, files: sent.attachments, waiting: true)
            HStack { ProgressView().controlSize(.small); Text(OutboxKt.WORKING).font(.callout).foregroundStyle(.secondary) }
        }
        ForEach(Array(s.turns.enumerated()), id: \.element.runId) { i, t in
            HStack {
                ProgressView().controlSize(.small).tint(ContactRow.tint(t.color))
                Text(t.line).font(.callout).foregroundStyle(t.held ? .orange : .secondary).lineLimit(2)
                if i == s.turns.count - 1 { Spacer(); Button(tr("Stop all")) { model.stopAll() }.font(.callout) }
            }
        }
        if !s.next.isEmpty, let figure {
            HStack(spacing: 8) {
                ForEach(s.next, id: \.id) { b in
                    FigureView(drawing: FigurePaint.shared.small(def: figure, color: b.color, outfit: b.outfit, dark: true)).frame(width: 16, height: 16)
                }
            }
            .accessibilityElement().accessibilityLabel(s.nextWords)
        }
        ForEach(s.waiting, id: \.message.id) { w in
            VStack(alignment: .trailing, spacing: 4) {
                Mine(text: w.message.text, files: w.message.attachments, waiting: true)
                Text(w.words).font(.caption).foregroundStyle(.secondary)
                Button(tr("Take back")) { model.takeBack(w.message) }.font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        if let sent = s.sent, !s.turns.isEmpty { Mine(text: sent.text, files: sent.attachments, waiting: true) }
    }

    /// The group's message box: the shared Composer, as a bot's chat and the Chief's have it, with files.
    private var box: some View {
        VStack(spacing: 0) {
            if let plan = model.state?.plan { PlanDock(plan: plan).padding(.horizontal).padding(.top, 6) }
            Composer(box: model, placeholder: tr("Message {name}…", ["name": model.state?.group?.name ?? name]), focused: $focused) { sentAt += 1 }
        }
    }

    private var tailKey: String {
        guard let s = model.state else { return "" }
        return "\(s.rows.last?.id ?? "")|\(s.drafts.map { $0.text.count })|\(s.turns.count)|\(s.waiting.count)|\(s.sent?.text ?? "")"
    }

    private func toEnd(_ scroll: ScrollViewProxy) {
        Task { await Task.yield(); withAnimation { scroll.scrollTo("end", anchor: .bottom) } }
    }

}

/// A member's side of the chat: its head, its name above in its colour, and what it wrote.
struct MemberSide<Content: View>: View {
    let name: String
    let color: String?
    let state: String
    let outfit: Kotlinx_serialization_jsonJsonElement?
    let figure: FigureDef?
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let figure {
                FigureView(drawing: FigurePaint.shared.figure(def: figure, color: color, state: state, outfit: outfit, dark: true))
                    .frame(width: 28, height: 28).padding(.top, 16)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.caption.weight(.semibold)).foregroundStyle(ContactRow.tint(color))
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A member's reply: under its name, with its answer buttons while it is the group's open question.
struct GroupReplyRow: View {
    let view: GroupReplyView
    let figure: FigureDef?
    let onAnswer: (String) -> Void
    /// Its several questions answered at once; whether they went.
    var onAnswers: ([String]) async -> Bool = { _ in false }
    /// The small × after its answers, and Undo: whether it was kept on the server.
    var onDismiss: (Bool) async -> Bool = { _ in false }
    @State private var undo = false // "Answers hidden · Undo" stands where the row was

    var body: some View {
        MemberSide(name: view.name, color: view.color, state: view.figureState, outfit: view.bot?.outfit, figure: figure) {
            if let reply = view.reply, !reply.isEmpty {
                MarkdownView(text: reply)
            } else if let ended = view.ended {
                Text(ended).foregroundStyle(view.problem ? .red : .secondary)
            }
            ReplyFilesView(files: view.files)
            if !view.choices.isEmpty {
                if view.dismissed {
                    if undo { AnswersHidden { undo = false; Task { _ = await onDismiss(false) } } }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Array(view.choices.enumerated()), id: \.offset) { i, c in
                                if i == Int(view.yes) {
                                    Button(c) { onAnswer(c) }.buttonStyle(.borderedProminent).tint(ContactRow.tint(view.color))
                                } else {
                                    Button(c) { onAnswer(c) }.buttonStyle(.bordered)
                                }
                            }
                            if view.canDismiss { DismissX { undo = true; Task { if !(await onDismiss(true)) { undo = false } } } }
                        }
                    }
                }
            }
            if !view.questions.isEmpty {
                QuestionsBox(questions: view.questions, choices: view.questionChoices, onSend: onAnswers)
            }
        }
        .undoEnds($undo)
    }
}

/// The owner's message, or the Project Manager's on the members' side; a tapped answer has its question above it,
/// which a tap goes to ([onQuestion] with the reply's id).
struct GroupMessageRow: View {
    let view: GroupMessageView
    let figure: FigureDef?
    let onQuestion: (String) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if let q = view.question {
                Button { onQuestion(q.runId) } label: {
                    HStack(spacing: 6) {
                        if let figure {
                            FigureView(drawing: FigurePaint.shared.small(def: figure, color: view.questionColor, outfit: view.questionBot?.outfit, dark: true)).frame(width: 20, height: 20)
                        }
                        Text(q.text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(.quaternary, in: .capsule)
                }
                .buttonStyle(.plain)
            }
            if let by = view.byName {
                MemberSide(name: by, color: view.byColor, state: "idle", outfit: view.byOutfit, figure: figure) {
                    MarkdownView(text: view.message.text)
                }
            } else {
                Mine(text: view.message.text, files: view.message.attachments, waiting: false)
            }
            if !view.waits.isEmpty { Text(view.waits).font(.caption).foregroundStyle(.tertiary) }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// A group's chat, opened from its row on Home.
struct GroupRoute: Hashable {
    let groupId: String
    let name: String
}

/// The row a team's answer folds its members' replies under (ADR 201): their heads, their names and how many; a tap
/// opens or closes them.
struct FoldRow: View {
    let fold: GroupFoldView
    let figure: FigureDef?
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 4) {
                Image(systemName: fold.open ? "chevron.down" : "chevron.right").font(.caption2)
                ForEach(Array(fold.heads.enumerated()), id: \.offset) { (_, h: GroupFoldHead) in
                    Group {
                        if let figure { FigureView(drawing: FigurePaint.shared.small(def: figure, color: h.color, outfit: h.bot?.outfit, dark: true)) }
                        else { Circle().fill(ContactRow.tint(h.color)) }
                    }
                    .frame(width: 14, height: 14)
                }
                Text(fold.words).font(.caption)
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.leading, 34)
        .accessibilityIdentifier("fold-\(fold.messageId)")
    }
}

/// The plan of a member at work, above the message box (Android's PlanDock): folded to its step and what it does now,
/// a tap shows every step with what is done.
struct PlanDock: View {
    let plan: GroupPlanView
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Circle().fill(ContactRow.tint(plan.color)).frame(width: 8, height: 8)
                    Text(tr("Plan")).font(.subheadline.weight(.semibold))
                    Text(open ? plan.doneLine : plan.stepLine).font(.caption.monospaced()).foregroundStyle(.secondary)
                    if !open { Text(plan.now).font(.subheadline).lineLimit(1) }
                    Spacer(minLength: 0)
                    Image(systemName: open ? "chevron.down" : "chevron.up").font(.caption).foregroundStyle(.secondary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plan-dock")
            if open {
                ForEach(Array(plan.steps.enumerated()), id: \.offset) { (_, step: Plan.Step) in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: step.status == Plan.companion.DONE ? "checkmark.circle.fill" : step.status == Plan.companion.DOING ? "circle.dotted" : "circle")
                            .foregroundStyle(step.status == Plan.companion.DONE ? ContactRow.tint(plan.color) : .secondary)
                        Text(step.status == Plan.companion.DOING && !step.doing.isEmpty ? step.doing : step.text)
                            .font(.subheadline)
                            .foregroundStyle(step.status == Plan.companion.DONE ? .secondary : .primary)
                    }
                }
            }
        }
        .padding(12)
        .background(.bar, in: .rect(cornerRadius: 14))
    }
}
