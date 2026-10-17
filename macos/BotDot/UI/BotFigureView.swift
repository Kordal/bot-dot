import SwiftUI
import AppKit
import BotDotKit

/// A bot: a head in its colour with the face of its state and its hat (in two tones of the colour),
/// as on the web (.fig in style.css). The head, the faces, their movements and the hats come from the
/// figure definition (BotDotKit's Figure.swift): a state it doesn't know is drawn as its default, and
/// a hat it can't draw is left out. Without a definition every bot is one bare head. With Reduce
/// Motion it keeps the state's still face. Nothing is behind the head and nothing is clipped: a hat
/// reaches a little past the mark's own square.
///
/// The movement is Core Animation, like the web's CSS: the system draws it, so the app itself does no
/// work per frame, however many heads are on screen.
struct BotFigureView: View {
    /// "#378add".
    var color: String?
    var state: String = "idle"
    var size: CGFloat = 42
    var outfit: Outfit?

    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        FigureLayer(shown: .init(def: store.figure, state: state, outfit: outfit, rgb: FigureDef.rgb(color), dark: scheme == .dark, size: size, still: reduceMotion || Self.heldStill))
            .frame(width: size, height: size)
            .accessibilityElement()
            .accessibilityLabel(Text(label))
    }

    /// A Debug build started with BOTDOT_STILL draws as with Reduce Motion, to try it without changing
    /// the Mac's settings.
    private static let heldStill: Bool = {
        #if DEBUG
        ProcessInfo.processInfo.environment["BOTDOT_STILL"] != nil
        #else
        false
        #endif
    }()

    private var label: String {
        // A state the definition doesn't know is spoken as the one it is drawn as.
        switch store.figure?.stateName(state) ?? state {
        case "working": "Working"
        case "waiting": "Waiting for teammates"
        case "needs_you": "Needs you"
        case "failed": "Couldn't finish"
        case "paused": "Paused"
        default: "Idle"
        }
    }
}

/// The head's layers (BotDotKit's FigureLayers), built again only when what they show changes.
private struct FigureLayer: NSViewRepresentable {
    struct Shown: Equatable {
        var def: FigureDef?
        var state: String
        var outfit: Outfit?
        var rgb: UInt32
        var dark: Bool
        var size: CGFloat
        var still: Bool
    }

    let shown: Shown

    final class Host: NSView {
        var shown: Shown? { didSet { if shown != oldValue { draw() } } }
        private var scale: CGFloat = 0

        override var isFlipped: Bool { true } // y grows downwards, as in the figure definition
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        // Another screen may have other pixels per point: the shapes are drawn again for it.
        override func viewDidChangeBackingProperties() {
            super.viewDidChangeBackingProperties()
            if (window?.backingScaleFactor ?? scale) != scale { draw() }
        }

        // Back in a window (a list shown again): the movements start again, in step with the clock.
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window != nil { draw() }
        }

        private func draw() {
            guard let shown, let root = layer else { return }
            scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
            let deep = FigureDef.deep(shown.rgb, dark: shown.dark)
            let figure = FigureLayers.figure(
                shown.def, state: shown.state, outfit: shown.outfit,
                look: .init(main: NSColor(rgb: shown.rgb).cgColor, deep: NSColor(rgb: deep).cgColor, side: shown.size, scale: scale, still: shown.still)
            )
            CATransaction.begin()
            CATransaction.setDisableActions(true) // a new face is there at once: only the definition's movements move
            root.sublayers?.forEach { $0.removeFromSuperlayer() }
            root.addSublayer(figure)
            CATransaction.commit()
        }
    }

    func makeNSView(context: Context) -> Host {
        let v = Host()
        v.wantsLayer = true
        v.layer?.isGeometryFlipped = true
        return v
    }

    func updateNSView(_ v: Host, context: Context) {
        v.shown = shown
    }
}

/// Someone's small mark next to their name in text: the head in its colour with its hat, without
/// eyes, still (the definition's `small`, like .fig-small on the web page). A bot is marked as it looks
/// now, the Chief of Staff in coral and its fixed hat (Store.mark).
struct NameFigure: View {
    var who: Who?
    /// The size of the letters it stands beside: the mark is 1.5 times as tall, as on the web page.
    var text: CGFloat

    // Not every window has the store: without it the mark is a bare head in the colour it was given.
    @Environment(Store.self) private var store: Store?
    @Environment(\.colorScheme) private var scheme

    init(_ who: Who?, text: CGFloat = 12.5) {
        self.who = who
        self.text = text
    }

    var body: some View {
        let mark = store?.mark(who) ?? BotMark(rgb: FigureDef.rgb(who?.id == Who.chief.id ? Who.chief.color : who?.color))
        let (def, height) = (store?.figure, Self.height(text))
        // The picture has room around the mark for a hat that reaches past it; the mark itself takes its place in the line.
        Image(nsImage: Self.image(def, mark: mark, dark: scheme == .dark, height: height))
            .padding(.horizontal, -Self.room(def, height: height))
            .padding(.top, -Self.room(def, height: height))
            .accessibilityHidden(true)
    }

    static func height(_ text: CGFloat) -> CGFloat { (text * 1.5).rounded() }

    private struct Drawn: Hashable {
        let mark: BotMark
        let dark: Bool
        let height: CGFloat
    }

    /// The pictures made so far, for the definition they were made from: a mark at a height is drawn once.
    private static var made: (def: FigureDef?, images: [Drawn: NSImage]) = (nil, [:])

    /// How far a hat may reach past the mark's own box, in points: a hat's box reaches a unit past it
    /// and a stroke on its edge half its width more (ADR 003, ADR 004), three units in all. Whole points.
    static func room(_ def: FigureDef?, height: CGFloat) -> CGFloat {
        (3 * height / (def ?? .bare).smallSize.y).rounded(.up)
    }

    /// The small mark as a picture, so it can also stand in a line of text and in the menu bar. It is
    /// drawn when first shown, at the screen's own pixels. Nothing clips the mark (ADR 003), and a
    /// picture can't draw past its own edges, so it is `room` larger than the mark on the left, on
    /// the right and above it (below the head there is no hat): `height` tall is the mark inside it.
    static func image(_ def: FigureDef?, mark: BotMark, dark: Bool, height: CGFloat) -> NSImage {
        if made.def != def { made = (def, [:]) }
        let key = Drawn(mark: mark, dark: dark, height: height)
        if let image = made.images[key] { return image }
        let d = def ?? .bare
        let room = room(def, height: height)
        let (main, deep) = (NSColor(rgb: mark.rgb).cgColor, NSColor(rgb: FigureDef.deep(mark.rgb, dark: dark)).cgColor)
        let image = NSImage(size: NSSize(width: (height * d.smallAspect).rounded(.up) + 2 * room, height: height + room), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            // y grows downwards in the figure definition, as in this flipped picture.
            context.translateBy(x: room, y: room)
            FigureLayers.small(def, outfit: mark.outfit, look: .init(main: main, deep: deep, side: height)).render(in: context)
            return true
        }
        made.images[key] = image
        return image
    }
}
