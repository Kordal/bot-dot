import SwiftUI
import BotDotKit

/// A page of settings as the web page draws it: cards under each other, each a column of fields.
/// `inPanel`: it stands in the panel beside a chat, with the panel's narrower margins.
struct WebForm<Content: View>: View {
    var inPanel = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) { content }
                .labeledContentStyle(RowLabeledContentStyle())
                .frame(maxWidth: inPanel ? 760 : 1100, alignment: .leading)
                .padding(.horizontal, inPanel ? 20 : 40)
                .padding(.top, inPanel ? 8 : 34).padding(.bottom, inPanel ? 40 : 60)
                .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
    }
}

/// The top of a page: its name and one muted line (`.section-head`).
struct PageHead: View {
    let title: String
    var sub: String = ""
    var small = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.geist(size: small ? 22 : 26, weight: .bold)).kerning(small ? -0.66 : -0.78)
            if !sub.isEmpty { Text(sub).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(.bottom, small ? 0 : 8)
    }
}

/// One card of a settings page (`.card.settings-card`), in the place of a form's section: a heading
/// above it (`.page-sub`), its rows 12 apart, a muted line under it.
struct Card<Header: View, Content: View, Footer: View>: View {
    @ViewBuilder var content: Content
    @ViewBuilder var header: Header
    @ViewBuilder var footer: Footer
    @Environment(\.cardPadding) private var padding

    init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header, @ViewBuilder footer: () -> Footer) {
        self.content = content(); self.header = header(); self.footer = footer()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header.font(.geist(size: 13, weight: .semibold)).padding(.top, 12)
            VStack(alignment: .leading, spacing: 12) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, padding + 2).padding(.vertical, padding)
                .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line, lineWidth: 1))
            footer.font(.geist(size: 12.5)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

extension Card where Header == EmptyView, Footer == EmptyView {
    init(@ViewBuilder content: () -> Content) { self.init(content: content, header: { EmptyView() }, footer: { EmptyView() }) }
}

extension Card where Header == Text, Footer == EmptyView {
    init(_ title: String, @ViewBuilder content: () -> Content) { self.init(content: content, header: { Text(title) }, footer: { EmptyView() }) }
}

extension Card where Footer == EmptyView {
    init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header) { self.init(content: content, header: header, footer: { EmptyView() }) }
}

extension Card where Header == EmptyView {
    init(@ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) { self.init(content: content, header: { EmptyView() }, footer: footer) }
}

extension EnvironmentValues {
    /// 18 on a page, 14 in the panel beside a chat.
    @Entry var cardPadding: CGFloat = 18
}

/// A row of a card: what it is on the left, its value or its control on the right.
struct RowLabeledContentStyle: LabeledContentStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) { configuration.label }
            Spacer(minLength: 0)
            configuration.content.foregroundStyle(Theme.muted)
        }
    }
}

/// The muted second line of a row: what the row's switch or link does.
extension Text {
    func rowHint() -> some View { font(.geist(size: 12.5)).foregroundStyle(Theme.faint).fixedSize(horizontal: false, vertical: true) }
}

/// The line between two rows of a card (`.bs-row + .bs-row`).
struct RowLine: View {
    var body: some View { Rectangle().fill(Theme.line).frame(height: 1) }
}

extension View {
    /// A menu of choices drawn as the web page's select: its value in a field as wide as the card.
    func webSelect() -> some View {
        labelsHidden().pickerStyle(.menu).buttonStyle(.borderless).tint(Theme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The panel beside a chat, with that chat's settings (the web page's `.panel`): a hairline on its
/// left, on top the way back (from a bot's jobs to its settings) and the button that closes it.
struct ChatPanel<Content: View>: View {
    var back: String?
    var onBack: () -> Void = {}
    let close: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if let back {
                    Button(action: onBack) { Label(back, systemImage: "chevron.left") }.controlSize(.small)
                }
                Spacer(minLength: 0)
                IconButton(icon: "xmark", help: "Close", action: close)
            }
            .frame(minHeight: 34)
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 8)
            content.environment(\.cardPadding, 14)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 1) }
    }
}

/// The web page's `.toast`: a pill at the bottom centre, in ink, or red for what went wrong.
struct Toast: View {
    let text: String
    var failed = false
    var busy = false

    var body: some View {
        HStack(spacing: 8) {
            if busy { ProgressView().controlSize(.small).tint(Theme.inkText) }
            Text(text).font(.geist(size: 13.5)).lineLimit(3).multilineTextAlignment(.center)
        }
        .foregroundStyle(failed ? .white : Theme.inkText)
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(Capsule().fill(failed ? Theme.err : Theme.ink).shadow(color: .black.opacity(0.14), radius: 30, y: 20))
        .frame(maxWidth: 560)
        .padding(.bottom, 26)
        .transition(.opacity)
    }
}

/// A sheet drawn as the web page's dialog: its title with ✕ on top (`.modal-head`), its fields
/// (`.modal-body`), and under a rule its buttons, on the right (`.modal-foot`). Without buttons
/// there is no rule, and Esc is the ✕'s. `close`: what ✕ does when that is more than closing.
struct Dialog<Title: View, Content: View, Foot: View>: View {
    var width: CGFloat?
    var close: (() -> Void)?
    @ViewBuilder var title: Title
    @ViewBuilder var content: Content
    @ViewBuilder var foot: Foot
    @Environment(\.dismiss) private var dismiss

    init(width: CGFloat? = nil, close: (() -> Void)? = nil, @ViewBuilder title: () -> Title, @ViewBuilder content: () -> Content, @ViewBuilder foot: () -> Foot) {
        self.width = width; self.close = close; self.title = title(); self.content = content(); self.foot = foot()
    }

    private var bare: Bool { Foot.self == EmptyView.self }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                HStack(spacing: 6) { title }.font(.geist(size: 17, weight: .semibold)).kerning(-0.34).lineLimit(2)
                Spacer(minLength: 0)
                if bare { x.keyboardShortcut(.cancelAction) } else { x }
            }
            .padding(.horizontal, 24).padding(.top, 20)
            VStack(alignment: .leading, spacing: 14) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24).padding(.vertical, 16)
            if !bare {
                RowLine()
                HStack(spacing: 8) { foot }.padding(.horizontal, 24).padding(.vertical, 14)
            }
        }
        .frame(width: width)
        .background(Theme.panel)
        .webLook()
    }

    private var x: some View {
        IconButton(icon: "xmark", help: "Close") { if let close { close() } else { dismiss() } }
    }
}

extension Dialog where Title == Text {
    init(_ title: String, width: CGFloat? = nil, close: (() -> Void)? = nil, @ViewBuilder content: () -> Content, @ViewBuilder foot: () -> Foot) {
        self.init(width: width, close: close, title: { Text(title) }, content: content, foot: foot)
    }
}

extension Dialog where Title == Text, Foot == EmptyView {
    init(_ title: String, width: CGFloat? = nil, close: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.init(width: width, close: close, title: { Text(title) }, content: content, foot: { EmptyView() })
    }
}
