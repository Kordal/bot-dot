import SwiftUI
import BotdotShared

/// The Chief of Staff's chat, as Android's: its latest conversation, another from the list or a new one (the toolbar's
/// menu). Each message with the team and project it
/// is about above it; the Chief's replies in Markdown, 👍 and 👎 under the ones it wrote unasked; what it is doing
/// while it replies, with Stop; what waits for its reply to end; the message box (Composer).
struct ChiefView: View {
    let home: HomeStore
    /// The conversation a notification asked for; nil, the latest.
    var chatId: String? = nil
    /// Made once the screen is there: SwiftUI makes a destination's view more than once.
    @State private var model: ChiefModel?

    var body: some View {
        Group {
            if let model { ChiefChat(model: model) } else { Color.clear }
        }
        .task {
            if model == nil { model = ChiefModel(home: home, chatId: chatId) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }
}

private struct ChiefChat: View {
    let model: ChiefModel
    @State private var atBottom = true
    @State private var sentAt = 0
    @FocusState private var focused: Bool

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let s = model.state, s.loaded {
                        Color.clear.frame(height: 1).onAppear { model.loadOlder() }
                        ForEach(s.messages, id: \.index) { m in
                            ChiefRow(line: m, onRate: { model.rate(m.index, $0) },
                                     onApprove: { await model.approve(m.index) }, onDecline: { await model.decline() },
                                     onAnswer: { await model.answer(m.index, $0) })
                                // Its conversation in its identity: another conversation's row at the same place starts
                                // anew (its card's Send and Approve), not with this one's taps.
                                .id("\(s.chatId ?? "new")-\(m.index)")
                        }
                        if s.busy {
                            HStack {
                                ProgressView().controlSize(.small)
                                Text(s.line).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                                if !s.boxStops { Spacer(); Button(tr("Stop")) { model.stopReply() }.font(.callout) }
                            }
                        }
                        ForEach(s.queued, id: \.id) { q in
                            VStack(alignment: .trailing, spacing: 4) {
                                Mine(text: q.text, files: q.attachments, waiting: true)
                                if q.steering { Text(tr("Steering…")).font(.caption).foregroundStyle(.secondary) }
                                else {
                                    HStack {
                                        if s.steers { Button(tr("Steer")) { model.steer(q) }.font(.caption) }
                                        Button(tr("Take back")) { model.takeBack(q) }.font(.caption)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        if let sent = s.sent { Mine(text: sent.text, files: sent.attachments, waiting: true) }
                    } else if let failed = model.state?.failed {
                        VStack(spacing: 12) {
                            Text(failed).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Button(tr("Try again")) { Task { await model.reload() } }
                        }
                        .frame(maxWidth: .infinity)
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
            .onChange(of: sentAt) { toEnd(scroll) }
            .onChange(of: focused) { _, on in
                guard on, atBottom else { return }
                toEnd(scroll, after: .milliseconds(350))
            }
            .safeAreaInset(edge: .bottom) {
                // Not before the chat is read: a message would start a new conversation instead of the latest.
                if model.state?.loaded == true { Composer(box: model, placeholder: tr("Message the Chief…"), focused: $focused) { sentAt += 1 } }
            }
        }
        .navigationTitle(model.state?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { chats } }
        .modifier(NoticeOverlay(notice: model.state?.notice, count: Int(model.state?.noticeCount ?? 0)))
    }

    /// The Chief's conversations, newest first, and New chat (made by its first message).
    private var chats: some View {
        Menu {
            Button { model.open(nil) } label: { Label(tr("New chat"), systemImage: "square.and.pencil") }
            if let list = model.state?.chats, !list.isEmpty {
                Section {
                    ForEach(list, id: \.id) { (c: ChiefChatSummary) in
                        Button { model.open(c.id) } label: {
                            if c.id == model.state?.chatId { Label(c.title, systemImage: "checkmark") }
                            else if c.unread > 0 { Text("\(c.title) · \(c.unread)") }
                            else { Text(c.title) }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "bubble.left.and.bubble.right")
        }
        .accessibilityLabel(tr("Chats"))
        .accessibilityIdentifier("chief-chats")
    }

    private func toEnd(_ scroll: ScrollViewProxy, after: Duration = .zero) {
        Task {
            if after > .zero { try? await Task.sleep(for: after) } else { await Task.yield() }
            withAnimation { scroll.scrollTo("end", anchor: .bottom) }
        }
    }

    /// What the chat's end shows: it changes when something is added there or the newest reply grows.
    private var tail: String {
        guard let s = model.state else { return "" }
        let m = s.messages.last
        return "\(s.messages.count)|\(m?.text.count ?? 0)|\(s.line)|\(s.queued.count)|\(s.sent?.text ?? "")"
    }
}

/// One message of the Chief's chat: the owner's on the right; the Chief's, a bot's suggestion or report on the left,
/// with what it is about above it.
struct ChiefRow: View {
    let line: ChiefLine
    let onRate: (String) -> Void
    var onApprove: () async -> Bool = { false }
    var onDecline: () async -> Void = {}
    var onAnswer: ([String]) async -> Bool = { _ in false }

    var body: some View {
        VStack(alignment: line.role == "user" ? .trailing : .leading, spacing: 6) {
            if let team = line.team, !line.pending {
                AboutLine(team: team, color: line.teamColor, project: line.project)
                    .frame(maxWidth: .infinity, alignment: line.role == "user" ? .trailing : .leading)
            }
            if line.role == "user" {
                Mine(text: line.text, files: line.files, waiting: false)
            } else {
                if let from = line.from { Text(from).font(.footnote).foregroundStyle(.secondary) }
                if !line.text.isEmpty { MarkdownView(text: line.text) }
                if let error = line.error { Text(error).foregroundStyle(.red) }
                ForEach(line.files, id: \.file) { f in Label(f.name, systemImage: "doc").font(.callout) }
                if line.suggests { SuggestionButtons(onApprove: onApprove, onDecline: onDecline) }
                if line.declined { Text(tr("You declined it")).font(.footnote).foregroundStyle(.secondary) }
                if !line.questions.isEmpty { QuestionsBox(questions: line.questions, choices: line.choices, onSend: onAnswer) }
                if !line.time.isEmpty || line.rates {
                    HStack(spacing: 12) {
                        if !line.time.isEmpty { Text(line.time).font(.caption2).foregroundStyle(.tertiary) }
                        if line.rates { Thumbs(rating: line.rating, onTap: onRate) }
                    }
                }
            }
        }
    }
}

/// What a message is about (ADR 223): the project, then the team in its colour.
struct AboutLine: View {
    let team: String
    let color: String?
    let project: String?

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 4).fill(ContactRow.tint(color)).frame(width: 14, height: 14)
            if let project {
                Text(project).foregroundStyle(.secondary).lineLimit(1)
                Text("›").foregroundStyle(.tertiary)
            }
            Text(team).fontWeight(.semibold).foregroundStyle(ContactRow.tint(color)).lineLimit(1)
        }
        .font(.caption)
    }
}

/// 👍 and 👎 under a message the Chief wrote unasked: the one tapped filled in the Chief's colour.
struct Thumbs: View {
    let rating: String?
    let onTap: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach([(Ratings.shared.UP, "hand.thumbsup", tr("More like this")), (Ratings.shared.DOWN, "hand.thumbsdown", tr("Less like this"))], id: \.0) { value, icon, label in
                let on = rating == value
                Button { onTap(value) } label: {
                    Image(systemName: on ? "\(icon).fill" : icon)
                        .foregroundStyle(on ? ContactRow.tint(ChiefColorKt.CHIEF_COLOR) : Color.secondary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// A bot's suggestion that waits: nothing happens until Approve (or an answer in the owner's own words); Decline drops it.
struct SuggestionButtons: View {
    let onApprove: () async -> Bool
    let onDecline: () async -> Void
    @State private var busy = false

    var body: some View {
        HStack(spacing: 8) {
            Button(tr("Decline")) { act { await onDecline() } }.buttonStyle(.bordered)
            Button(tr("Approve")) { act { _ = await onApprove() } }.buttonStyle(.borderedProminent)
        }
        .disabled(busy)
    }

    private func act(_ go: @escaping () async -> Void) {
        busy = true
        Task { await go(); busy = false }
    }
}

/// Several questions of the Chief's at once: a box under each, its choices under it to fill it, and one Send for all.
/// Sent, it goes; refused, what was typed stays for Send again.
struct QuestionsBox: View {
    let questions: [String]
    let choices: [[String]]
    let onSend: ([String]) async -> Bool
    @State private var answers: [String] = []
    @State private var sending = false
    @State private var sent = false

    var body: some View {
        if !sent {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(questions.enumerated()), id: \.offset) { (i, q: String) in question(i, q) }
                HStack {
                    Spacer()
                    Button(tr("Send"), action: send).buttonStyle(.borderedProminent)
                        .disabled(sending || !answers.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
                }
            }
            .padding(14)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 14))
            .onAppear { if answers.count != questions.count { answers = Array(repeating: "", count: questions.count) } }
        }
    }

    private func question(_ i: Int, _ q: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(q).font(.subheadline)
            TextField("", text: binding(i), axis: .vertical).lineLimit(1...6).textFieldStyle(.roundedBorder)
            if i < choices.count, !choices[i].isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(choices[i], id: \.self) { (c: String) in
                            Button(c) { answers[i] = c }
                                .buttonStyle(.bordered).tint(answer(i) == c ? .accentColor : .secondary)
                        }
                    }
                }
            }
        }
    }

    private func answer(_ i: Int) -> String { i < answers.count ? answers[i].trimmingCharacters(in: .whitespaces) : "" }

    private func binding(_ i: Int) -> Binding<String> {
        Binding(get: { i < answers.count ? answers[i] : "" }, set: { v in if i < answers.count { answers[i] = v } })
    }

    private func send() {
        sending = true
        let all = answers
        Task {
            if await onSend(all) { sent = true }
            sending = false
        }
    }
}
