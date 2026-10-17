import SwiftUI
import BotDotKit

/// The top of a chat, as the web page's `.chat-head`: the figure, the name and a muted line under
/// it. A click on them opens the chat's settings. `beside` stands right of the name (a bot's small
/// plus), `actions` at the far right.
struct ChatHead<Figure: View, Beside: View, Actions: View>: View {
    let name: String
    let sub: String
    var help = "Settings"
    let open: () -> Void
    @ViewBuilder var figure: Figure
    @ViewBuilder var beside: Beside
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 12) {
                    figure
                    VStack(alignment: .leading, spacing: 0) {
                        Text(name).font(.geist(size: 15, weight: .semibold)).kerning(-0.15).lineLimit(1)
                        if !sub.isEmpty { Text(sub).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(1) }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(help)
            beside
            Spacer(minLength: 0)
            HStack(spacing: 4) { actions }
        }
        .padding(.horizontal, 30).padding(.vertical, 18)
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
    }
}

/// The web page's `.icon-btn`: a round button with one icon, grey under the pointer.
struct IconButton: View {
    let icon: String
    let help: String
    var size: CGFloat = 34
    let action: () -> Void

    var body: some View {
        Button(action: action) { Image(systemName: icon) }.buttonStyle(IconButtonStyle(size: size)).help(help).accessibilityLabel(help)
    }
}

struct IconButtonStyle: ButtonStyle {
    var size: CGFloat = 34

    func makeBody(configuration: Configuration) -> some View { Round(configuration: configuration, size: size) }

    private struct Round: View {
        let configuration: Configuration
        let size: CGFloat
        @State private var over = false

        var body: some View {
            configuration.label
                .font(.geist(size: size * 0.45))
                .foregroundStyle(over ? Theme.text : Theme.muted)
                .frame(width: size, height: size)
                .background(Circle().fill(over || configuration.isPressed ? Theme.sunk : .clear))
                .contentShape(Circle())
                .onHover { over = $0 }
        }
    }
}
