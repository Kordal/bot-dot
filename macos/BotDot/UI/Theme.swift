import SwiftUI
import AppKit
import BotDotKit

/// botdot's "Mono" look (public/style.css): pure white or black, greys in between. It follows the
/// system's light or dark setting.
enum Theme {
    static let bg = dynamic(0xffffff, 0x000000)
    static let panel = dynamic(0xffffff, 0x0d0d0d)
    static let sunk = dynamic(0xf2f2f2, 0x1a1a1a)
    static let line = dynamic(0xebebeb, 0x1f1f1f)
    static let line2 = dynamic(0xdedede, 0x2b2b2b)
    static let text = dynamic(0x000000, 0xffffff)
    static let muted = dynamic(0x525252, 0xa3a3a3)
    static let faint = dynamic(0x6e6e6e, 0x838383)
    /// Your own bubbles and primary buttons.
    static let ink = dynamic(0x000000, 0xffffff)
    static let inkText = dynamic(0xffffff, 0x000000)
    static let warnSoft = dynamic(0xfbf1dc, 0x2c2413)
    /// Fine, failed and "look at this", and the soft fill behind them (`--ok`, `--err`, `--warn`). `ok` and `warn`
    /// colour dots and switches; words take `okText` and `warnText` (`--ok-text`, `--warn-text`), which pass 4.5:1.
    static let ok = dynamic(0x1d9a68, 0x45c78e)
    static let okText = dynamic(0x167a52, 0x45c78e)
    static let okSoft = dynamic(0xe4f5ec, 0x16281f)
    static let err = dynamic(0xca3636, 0xef6a6a)
    static let errSoft = dynamic(0xfbeaea, 0x2d1717)
    static let warn = dynamic(0xb27a12, 0xe2a846)
    static let warnText = dynamic(0x8a5d0a, 0xe2a846)
    /// The accents, one value in light and dark (`--dot`, `--mention`, `--warn-line`): the logo's dot, jobs and
    /// skills mentioned in your bubbles, and the border of a warning on a card.
    static let dot = Color(hex: "#d85a30")
    static let mention = Color(hex: "#378add")
    static let warnLine = Color(hex: "#ef9f27")
    /// The Chief's own colour, as the server gives it: its figure, its lines and its tiles.
    static let chief = Color(hex: Who.chief.color)

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            NSColor(rgb: appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light)
        })
    }
}

extension NSColor {
    /// 0x378add → the colour.
    convenience init(rgb: UInt32) {
        self.init(srgbRed: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
    }
}

extension Color {
    /// "#378add" → the colour; anything else → the grey bots get by default.
    init(hex: String?) {
        let s = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        self = Color(nsColor: NSColor(rgb: s.count == 6 ? UInt32(s, radix: 16) ?? 0x888780 : 0x888780))
    }
}

extension Font {
    /// The web page's font (`--font`), from the app's own files (Resources/Fonts).
    static func geist(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Geist", fixedSize: size).weight(weight)
    }

    /// `--mono`.
    static func geistMono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Geist Mono", fixedSize: size).weight(weight)
    }
}

/// The web page's `.btn`: a pill with a hairline, or ink-filled when it is the primary one.
/// `.controlSize(.small)` gives `.btn.sm`; a destructive button's words are red (`.btn.danger`).
struct PillButtonStyle: ButtonStyle {
    var primary = false

    func makeBody(configuration: Configuration) -> some View { Pill(configuration: configuration, primary: primary) }

    private struct Pill: View {
        let configuration: Configuration
        let primary: Bool
        @Environment(\.controlSize) private var size
        @Environment(\.isEnabled) private var enabled
        @State private var over = false

        var body: some View {
            let small = size == .small || size == .mini
            let large = size == .large || size == .extraLarge
            configuration.label
                .font(.geist(size: small ? 12.5 : 13.5, weight: .medium))
                .lineLimit(1)
                .foregroundStyle(primary ? Theme.inkText : configuration.role == .destructive ? Theme.err : Theme.text)
                .padding(.horizontal, small ? 11 : large ? 18 : 14)
                .padding(.vertical, small ? 4 : large ? 10 : 7)
                .background(Capsule().fill(primary ? Theme.ink : over || configuration.isPressed ? Theme.sunk : Theme.panel))
                .overlay(Capsule().strokeBorder(primary ? Theme.ink : Theme.line2, lineWidth: 1))
                .opacity(!enabled ? 0.45 : primary && (over || configuration.isPressed) ? 0.88 : 1)
                .contentShape(Capsule())
                .onHover { over = $0 }
        }
    }
}

/// The web page's `.link-btn`: words in the colour around them, underlined under the pointer.
struct TextLinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Words(configuration: configuration) }

    private struct Words: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var enabled
        @State private var over = false

        var body: some View {
            configuration.label
                .underline(over && enabled)
                .opacity(enabled ? 1 : 0.45)
                .contentShape(Rectangle())
                .onHover { over = $0 }
        }
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var pill: PillButtonStyle { PillButtonStyle() }
    static var pillPrimary: PillButtonStyle { PillButtonStyle(primary: true) }
}

extension ButtonStyle where Self == TextLinkButtonStyle {
    static var textLink: TextLinkButtonStyle { TextLinkButtonStyle() }
}

/// The web page's `.switch`: 34 by 20, green when on.
struct WebSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View { Switch(configuration: configuration) }

    private struct Switch: View {
        let configuration: Configuration
        @Environment(\.labelsVisibility) private var labels
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            HStack(spacing: 10) {
                if labels != .hidden {
                    VStack(alignment: .leading, spacing: 2) { configuration.label }
                    Spacer(minLength: 0)
                }
                Capsule().fill(configuration.isOn ? Theme.ok : Theme.line2)
                    .frame(width: 34, height: 20)
                    .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                        Circle().fill(.white).shadow(color: .black.opacity(0.25), radius: 1, y: 1).frame(width: 16, height: 16).padding(2)
                    }
                    .animation(.easeInOut(duration: 0.15), value: configuration.isOn)
                    .opacity(enabled ? 1 : 0.45)
                    .contentShape(Capsule())
                    .onTapGesture { configuration.isOn.toggle() }
                    .accessibilityAddTraits(.isButton)
            }
        }
    }
}

extension ToggleStyle where Self == WebSwitchStyle {
    static var webSwitch: WebSwitchStyle { WebSwitchStyle() }
}

/// The web page's text field: `--bg` with a hairline, radius 12, and a grey ring while it is typed in.
private struct WebField: ViewModifier {
    @FocusState private var typing: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .focused($typing)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.bg))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line2, lineWidth: 1))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.text.opacity(typing ? 0.25 : 0), lineWidth: 2).padding(-2))
    }
}

extension View {
    func webField() -> some View { modifier(WebField()) }

    /// A text field of a settings card: its name above it (`label.field`).
    func field(_ label: String, hint: String? = nil) -> some View { LabeledField(label, hint: hint) { self.labelsHidden() } }

    /// A menu of choices of a settings card: its name above it, its value in a field.
    func selectField(_ label: String) -> some View { LabeledField(label) { self.webSelect() } }

    /// What every window of the app starts from: the web page's font, its buttons and switches,
    /// and ink where macOS would put its accent colour.
    func webLook() -> some View {
        font(.geist(size: 13)).buttonStyle(.pill).toggleStyle(.webSwitch).tint(Theme.ink)
    }
}
