import SwiftUI
import BotdotShared

/// The status keypad, as Android's: the list's own order cut into pages (Pinned, each category, Other), each bot and
/// group a key with its figure, its name, its digit and its pill (Working, Needs you, its unread replies, Done,
/// Couldn't finish, Idle or Watching), all from the shared Keypad. A bot's key opens its settings until the bot chat is
/// on the iPhone.
struct KeypadView: View {
    let home: HomeModel
    let open: (String) -> Void

    var body: some View {
        ScrollView {
            if let state = home.state {
                let pages = state.keypad
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { _, page in
                        Text(page.name).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                            ForEach(page.keys, id: \.id) { key in
                                KeyView(key: key, status: state.status(key: key), digit: Int(state.digitOf(key: key)), figure: home.figure) {
                                    if case .ofBot(let k) = onEnum(of: key) { open(k.bot.id) }
                                }
                            }
                        }
                    }
                }
                .padding(16)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding()
            }
        }
        .refreshable { await home.refresh() }
        .navigationTitle(tr("Keypad"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One key: the figure, the name, its digit in the corner, and its pill, whose colour says its kind; only Needs you is
/// loud (#724), the others keep their colour in the dot.
private struct KeyView: View {
    let key: KeypadKey
    let status: Keypad.Status
    let digit: Int
    let figure: FigureDef?
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    // A group has no figure of its own: its place stays, so every key is as tall.
                    Group {
                        if let figure, let drawing = drawing(figure) { FigureView(drawing: drawing) } else { Color.clear }
                    }
                    .frame(width: 36, height: 36)
                    Spacer(minLength: 0)
                    if digit > 0 { Text("\(digit)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                }
                Text(name).font(.subheadline.weight(.medium)).lineLimit(1).foregroundStyle(.primary)
                HStack(spacing: 6) {
                    Circle().fill(Self.color(status.kind)).frame(width: 7, height: 7)
                    let loud = Keypad.shared.loud(kind: status.kind)
                    Text(status.text).font(.caption.weight(loud ? .semibold : .regular))
                        .foregroundStyle(loud ? Self.color(status.kind) : .secondary).lineLimit(1)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("key-" + key.id)
    }

    private var name: String {
        switch onEnum(of: key) {
        case .ofBot(let k): k.bot.name
        case .ofGroup(let k): k.group.name
        }
    }

    private func drawing(_ figure: FigureDef) -> FigurePaint.Drawing? {
        switch onEnum(of: key) {
        case .ofBot(let k): FigurePaint.shared.figure(def: figure, color: k.bot.color, state: k.bot.state, outfit: k.bot.outfit, dark: true)
        case .ofGroup: nil
        }
    }

    /// The colours of Android's pill: working and done green, needs you amber, unread blue, failed red, idle grey.
    static func color(_ kind: Keypad.StatusKind) -> Color {
        switch kind {
        case .working, .done: .green
        case .needs: .orange
        case .unread: .blue
        case .failed: .red
        case .idle: .gray
        }
    }
}
