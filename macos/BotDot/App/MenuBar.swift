import SwiftUI
import AppKit
import BotDotKit

/// The menu-bar item: one small head per thing waiting for you, in its bot's colour and hat (or the
/// logo's dot when nothing does), and a menu with what waits, the Chief and your bots.
struct MenuBarLabel: View {
    @Environment(Store.self) private var store
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Image(nsImage: Self.marks(store.needs.map { store.mark($0.who ?? .chief) }, figure: store.figure, dark: scheme == .dark))
    }

    /// The marks as a small picture (the menu bar shows images, not views).
    static func marks(_ marks: [BotMark], figure: FigureDef?, dark: Bool) -> NSImage {
        let tall: CGFloat = 16, gap: CGFloat = 2
        // Each picture has room around its mark (NameFigure.image): the marks stand `gap` apart, their rooms overlapping.
        let room = NameFigure.room(figure, height: tall)
        let figures = marks.prefix(8).map { NameFigure.image(figure, mark: $0, dark: dark, height: tall) }
        let wide = (figures.first?.size.width ?? 8 + 2 * room) - 2 * room
        let size = NSSize(width: CGFloat(max(figures.count, 1)) * wide + CGFloat(max(figures.count - 1, 0)) * gap + (figures.isEmpty ? 0 : 2 * room), height: tall + (figures.isEmpty ? 0 : room))
        let dot = NSColor(Theme.dot)
        let image = NSImage(size: size, flipped: false) { _ in
            if figures.isEmpty { // nothing waits: the logo's dot
                dot.setFill()
                NSBezierPath(ovalIn: NSRect(x: 0, y: (tall - 8) / 2, width: 8, height: 8)).fill()
            }
            for (i, f) in figures.enumerated() {
                f.draw(in: NSRect(x: CGFloat(i) * (wide + gap), y: 0, width: f.size.width, height: f.size.height))
            }
            return true
        }
        image.isTemplate = false
        return image
    }
}

struct MenuBarMenu: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let needs = store.needs
        if !needs.isEmpty {
            Text("Waiting for your OK")
            ForEach(needs) { x in
                Button(x.title) { show { nav.open(x, store: store) } }
            }
            Divider()
        }
        Button("Chief of Staff") { show { nav.page = .chief } }
        ForEach(store.sidebar.pinned + store.sidebar.groups.flatMap(\.bots)) { bot in
            Button(bot.running == true ? "\(bot.name) · working" : bot.name) { show { nav.page = .bot(bot.id) } }
        }
        Divider()
        // botdot on this Mac has a newer version: its update is in the Updates window, not in Settings (#473).
        if store.updateAvailable { Button("Update botdot on this Mac…") { show {}; openWindow(id: "updates") } }
        Button("Open botdot") { show {} }
        Button("Quit botdot") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }

    /// Brings the window back (it may have been closed) and goes there.
    private func show(_ go: () -> Void) {
        go()
        NSApp.unhide(nil) // opened at login, hidden
        if !NSApp.windows.contains(where: { $0.isVisible && $0.canBecomeMain }) { openWindow(id: "main") }
        NSApp.activate()
    }
}
