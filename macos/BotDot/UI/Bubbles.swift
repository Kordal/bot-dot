import SwiftUI
import AppKit
import BotDotKit

/// Your own message: black (white in dark mode), on the right.
/// Mentions of bots show as the bot's small head and its name, of jobs and skills tinted (matched against the current
/// names, so a renamed bot's old mention stays plain).
struct MyBubble: View {
    let text: String
    var files: [FileRef] = []
    /// The Chief's id or the bot whose chat it is.
    var chat: String?
    /// The copy button under it; not under a message that still waits.
    var copies = true
    /// A long one shows its first five lines until it is clicked (a bot's chat and a group's).
    var folds = false
    @State private var whole = false
    @Environment(\.searchTerms) private var terms
    @Environment(Store.self) private var store
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            VStack(alignment: .trailing, spacing: 8) {
                if !text.isEmpty || files.isEmpty {
                    drawn
                        .font(.geist(size: 14.5))
                        .lineSpacing(Bubble.lineSpacing)
                        .lineLimit(folds && !whole ? 5 : nil)
                        .textSelection(.enabled)
                        .foregroundStyle(Theme.inkText)
                        .tint(Theme.inkText) // a link, on ink
                        .onTapGesture { if folds { whole.toggle() } }
                }
                if !files.isEmpty {
                    BotFiles(files: files, opensDocuments: false)
                }
            }
            .padding(.horizontal, 17).padding(.vertical, 11)
            .background(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22).fill(Theme.ink))
            if copies, !text.isEmpty { BubbleMeta(time: "", copy: text) }
        }
        .frame(maxWidth: Bubble.widest, alignment: .trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    /// The message with its mentions drawn: a bot as its small head and name, a job or a skill tinted.
    private var drawn: Text {
        let words = { (s: AttributedString) in Text(marked(linkedChatText(s), terms)) }
        guard let chat else { return words(AttributedString(text)) }
        var out = Text("")
        var run = AttributedString()
        var at = text.startIndex
        for m in store.mentions(in: chat).find(in: text) {
            run += AttributedString(text[at..<m.range.lowerBound])
            if m.kind == .bot, let bot = m.bot {
                // The head stands in the line like a letter, a little below the baseline so it is centred on the words.
                let figure = Text(Image(nsImage: NameFigure.image(store.figure, mark: store.mark(Who(id: bot.id, name: bot.name, color: bot.color)), dark: scheme == .dark, height: NameFigure.height(14.5)))).baselineOffset(-4)
                out = Text("\(out)\(words(run))\(figure)")
                run = AttributedString(bot.name) // the picture's own room stands for the space
            } else {
                var t = AttributedString(m.text)
                t.foregroundColor = Theme.mention
                run += t
            }
            at = m.range.upperBound
        }
        run += AttributedString(text[at...])
        return Text("\(out)\(words(run))")
    }
}

/// The owner's messages that wait in a chat, oldest first, under its working line: each their bubble
/// at half strength, and under it what it waits for and "Take back", which puts it in the message box
/// again. `who`: the bot's name, or "the Chief".
struct WaitingMessages: View {
    let queued: [Queued]
    let who: String
    /// The Chief's id or the bot whose chat it is.
    var chat: String?
    let takeBack: (Queued) -> Void

    var body: some View {
        ForEach(queued) { q in
            WaitingMessage(text: q.text, files: q.attachments, chat: chat, waits: MessageWaits.waitsUntil(who)) { takeBack(q) }
        }
    }
}

/// One message of the owner's that waits, in a bot's chat, the Chief's or a group's: its bubble at
/// half strength, and under it what it waits for (`waits`) and "Take back".
struct WaitingMessage: View {
    let text: String
    var files: [FileRef] = []
    /// The Chief's id, the bot whose chat it is, or a group's key.
    var chat: String?
    let waits: String
    let takeBack: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            MyBubble(text: text, files: files, chat: chat, copies: false).opacity(0.5)
            HStack(spacing: 10) {
                Text(waits).foregroundStyle(Theme.faint)
                Button("Take back", action: takeBack).buttonStyle(.plain).foregroundStyle(Theme.muted)
            }
            .font(.geist(size: 12))
            .padding(.horizontal, 6)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// What every bubble shares with the web page's `.bubble`.
enum Bubble {
    /// 76% of the chat's column of 820.
    static let widest: CGFloat = 623
    /// The room between two lines of 14.5 at the web page's line height of 1.6.
    static let lineSpacing: CGFloat = 4.5
}

/// A bot's or the Chief's reply: white with a hairline, on the left, as wide as its words. `other`:
/// what another bot wrote, on the owner's side of the chat but not the owner's: grey, with a dashed line.
struct BotBubble: ViewModifier {
    var problem = false
    var other = false
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: other ? 22 : 6, bottomTrailingRadius: other ? 6 : 22, topTrailingRadius: 22)
        content
            .font(.geist(size: 14.5))
            .padding(.horizontal, 17).padding(.vertical, 11)
            .background(
                shape.fill(problem ? Theme.warnSoft : other ? Theme.sunk : Theme.panel)
                    .shadow(color: .black.opacity(other || problem || scheme == .dark ? 0 : 0.04), radius: 1, y: 1)
            )
            .overlay(shape.strokeBorder(problem ? Color.clear : other ? Theme.line2 : Theme.line, style: StrokeStyle(lineWidth: 1, dash: other ? [4, 3] : [])))
            .frame(maxWidth: Bubble.widest, alignment: other ? .trailing : .leading)
    }
}

/// A bot's message in the Chief's chat: "Message from Web Surfer" (with its small head), then what it
/// said, on the owner's side of the chat (`.from-bot-msg`).
struct FromBotBubble: View {
    let label: String
    let from: Who?
    let text: String
    var files: [FileRef] = []
    /// It didn't finish (a report with `error`): its text says why.
    var problem = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 5) {
                Text(label)
                NameFigure(from, text: 13.5)
                Text(from?.name ?? "a bot")
            }
            .font(.geist(size: 13.5))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 6)
            if !text.isEmpty || !files.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    if !text.isEmpty {
                        MarkdownView(text, wide: false)
                    }
                    BotFiles(files: files)
                }
                .modifier(BotBubble(problem: problem, other: true))
                if !text.isEmpty { BubbleMeta(time: "", copy: text) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Under a message: when, and a copy button.
struct BubbleMeta: View {
    let time: String
    let copy: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            if !time.isEmpty { Text(time) }
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(copy, forType: .string)
                copied = true
                Task { try? await Task.sleep(for: .seconds(1.2)); copied = false }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.plain)
            .help("Copy")
        }
        .font(.geist(size: 11.5))
        .foregroundStyle(Theme.faint)
        .padding(.horizontal, 6)
    }
}

/// Three dots bouncing while an answer is on its way.
struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    let p = ((t - Double(i) * 0.15).truncatingRemainder(dividingBy: 1.2)) / 1.2
                    Circle().fill(Theme.faint).frame(width: 6, height: 6)
                        .offset(y: reduceMotion ? 0 : (p < 0.4 ? -4 * sin(p / 0.4 * .pi) : 0))
                }
            }
        }
    }
}

/// Lays chips out in lines, wrapping like a sentence.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0; var y: CGFloat = 0 }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + size.width > maxWidth {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            let gap = rows[rows.count - 1].items.isEmpty ? 0 : spacing
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}

/// Several questions at once, under the newest reply: a box under each, and Send posts them all as one message.
struct QuestionsCard: View {
    let questions: [String]
    let send: (String) -> Void
    @State private var answers: [String]
    @FocusState private var focused: Int?

    init(questions: [String], send: @escaping (String) -> Void) {
        self.questions = questions
        self.send = send
        _answers = State(initialValue: Array(repeating: "", count: questions.count))
    }

    private var canSend: Bool { answers.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(questions.enumerated()), id: \.offset) { i, q in
                VStack(alignment: .leading, spacing: 5) {
                    Text(q).font(.geist(size: 13.5)).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                    // One line to start with; it grows as you type.
                    TextField("", text: $answers[i], axis: .vertical)
                        .lineLimit(1...8)
                        .textFieldStyle(.plain)
                        .font(.geist(size: 13.5))
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.bg).stroke(Theme.line2, lineWidth: 1))
                        .focused($focused, equals: i)
                        .onSubmit { if i + 1 < questions.count { focused = i + 1 } else if canSend { submit() } }
                }
            }
            HStack {
                Spacer()
                Button("Send", action: submit).buttonStyle(.pillPrimary).disabled(!canSend)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.panel).stroke(Theme.line, lineWidth: 1))
        .frame(maxWidth: 440, alignment: .leading)
    }

    private func submit() { send(Questions.answer(questions, answers)) }
}

/// Your message from Send until the botdot server answered (`SentMessage`): its bubble at half
/// strength, as one that waits, with its files, and nothing under it. It arrives once, on Send
/// (`arrived`); the server's version that takes its place stands where it stood.
struct SentBubble: View {
    let message: SentMessage
    /// The Chief's id or the bot whose chat it is.
    var chat: String?
    var arrived: Date? = nil

    var body: some View {
        MyBubble(text: message.text, files: message.attachments, chat: chat, copies: false).opacity(0.5)
            .modifier(Arrives(since: arrived))
    }
}

/// The arrival of a reply that is new in the open chat, as on the web page (`.arrives` in
/// public/style.css): it fades in and rises into its place, once. `since`: when it came (`Arrivals`),
/// nil for one that was there, which stands still, as does everything with reduced motion. Scrolled
/// away and back, it stands.
struct Arrives: ViewModifier {
    let since: Date?
    /// The arrival whose movement was started.
    @State private var started: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        // Before its movement starts an arriving reply is drawn where it comes from: unseen, a little below its place.
        let waits = since != started && Arrivals.moves(since: since, now: Date(), still: reduceMotion)
        content
            .opacity(waits ? 0 : 1)
            .offset(y: waits ? Arrivals.rise : 0)
            .onChange(of: since, initial: true) {
                // Whatever the moment, it is drawn in its place after this: one that comes too late to move just stands.
                guard since != started else { return }
                if Arrivals.moves(since: since, now: Date(), still: reduceMotion) {
                    withAnimation(.easeOut(duration: Arrivals.seconds)) { started = since }
                } else {
                    started = since
                }
            }
    }
}
