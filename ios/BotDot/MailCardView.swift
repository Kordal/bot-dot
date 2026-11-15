import SwiftUI
import BotdotShared

/// A mail draft under the Chief's reply (MailView, Android's MailDraftCard): To and Subject, its state, the text, its
/// files and buttons, and the bot that wrote it in the footer. An earlier version folds to one line; a sent mail's text
/// to "Show the text". A button is sent as the owner's words, once; the buttons go once it went.
struct MailCardView: View {
    let mail: MailView
    var onPick: (String) async -> Bool = { _ in false }
    var onBot: () -> Void = {}
    var onScreen: () -> Void = {}
    /// Where a file the mail carries opens; nil for one named only.
    var opening: (Attachment) -> DocumentView.Opening? = { _ in nil }
    var onFile: (DocumentView.Opening) -> Void = { _ in }
    @State private var unfolded = false
    @State private var textShown: Bool?
    /// The buttons a tap went with: they go until the draft's buttons change (Not now leaves Send now), as Android's
    /// remember(actions).
    @State private var usedFor: [String]?
    @State private var busy = false

    var body: some View {
        if mail.earlier && !unfolded {
            Button(tr("Earlier version · show")) { unfolded = true }
                .font(.caption).buttonStyle(.bordered).clipShape(Capsule())
        } else {
            VStack(alignment: .leading, spacing: 8) {
                card
                if !shown && !mail.text.isEmpty {
                    Button(tr("Show the text")) { textShown = true }.font(.caption)
                }
            }
        }
    }

    private var shown: Bool { textShown ?? !mail.sent }

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow { Text(tr("To")).foregroundStyle(.secondary); Text(mail.to).lineLimit(1) }
                GridRow { Text(tr("Subject")).foregroundStyle(.secondary); Text(mail.subject).fontWeight(.semibold).lineLimit(1) }
            }
            .font(.subheadline)
            Divider()
            HStack(spacing: 8) {
                Circle().fill(mail.sent ? Color.green : Color.orange).frame(width: 8, height: 8)
                Text(mail.state).font(.caption).foregroundStyle(mail.sent ? .green : .secondary)
            }
            if shown && !mail.text.isEmpty { Text(mail.text).font(.subheadline).textSelection(.enabled) }
            if shown || mail.text.isEmpty { files }
            if Self.showsButtons(mail.actions, usedFor: usedFor) { buttons }
            if let bot = mail.bot { footer(bot) }
        }
        .padding(14)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(tr("Mail draft"))
    }

    private var files: some View {
        ForEach(mail.files, id: \.self) { f in
            if let open = opening(f) {
                Button { onFile(open) } label: { Label(f.name, systemImage: "doc").font(.callout) }
            } else {
                Label(f.name, systemImage: "doc").font(.callout)
            }
        }
    }

    private var buttons: some View {
        HStack(spacing: 8) {
            ForEach(Array(mail.actions.enumerated()), id: \.offset) { i, words in
                Button { pick(words) } label: { Text(words).frame(minHeight: 28) }
                    .modifier(MailButtonStyle(first: i == 0))
                    .disabled(busy)
            }
        }
    }

    private func footer(_ bot: String) -> some View {
        HStack(spacing: 4) {
            Button(bot, action: onBot)
            if mail.screen {
                Text("·").foregroundStyle(.tertiary)
                Button(tr("Screen"), action: onScreen)
            }
        }
        .font(.caption).foregroundStyle(.secondary).buttonStyle(.plain)
    }

    /// The card's buttons show while it has some and none of these was tapped yet.
    static func showsButtons(_ actions: [String], usedFor: [String]?) -> Bool { !actions.isEmpty && usedFor != actions }

    private func pick(_ words: String) {
        guard !busy else { return }
        busy = true
        Task {
            if await onPick(words) { usedFor = mail.actions }
            busy = false
        }
    }
}

/// Send now filled, the other outlined.
private struct MailButtonStyle: ViewModifier {
    let first: Bool
    func body(content: Content) -> some View {
        if first { content.buttonStyle(.borderedProminent) } else { content.buttonStyle(.bordered) }
    }
}

/// What the Chief did while replying, a chip each (ChiefChip): what still waits for the owner's OK in orange. A chip that
/// names a bot opens it.
struct ChiefChips: View {
    let chips: [ChiefChip]
    var onTap: (ChiefChip) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in
                if chip.opens {
                    Button { onTap(chip) } label: { words(chip) }.buttonStyle(.plain)
                } else {
                    words(chip)
                }
            }
        }
    }

    private func words(_ chip: ChiefChip) -> some View {
        var text = AttributedString(chip.text)
        if let waits = chip.waits {
            var w = AttributedString(" · " + waits)
            w.foregroundColor = .orange
            text += w
        }
        text += AttributedString(chip.after)
        return Text(text).font(.caption)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Color.secondary.opacity(0.12), in: Capsule())
    }
}
