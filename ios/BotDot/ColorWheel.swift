import SwiftUI
import BotdotShared

extension EnvironmentValues {
    /// A colour swatch on a tile's face: opens its tile's pop-up with the wheel alone (the tile's key, the block's).
    @Entry var openTileColor: ((String, String) -> Void)? = nil
}

/// A colour block on a tile's face: its colour, a tap opens the wheel.
struct ColorSwatch: View {
    let b: Block
    let key: String
    @Environment(\.openTileColor) private var open

    var body: some View {
        let hex = BoardKit.shared.textOf(v: b.value)
        Button { if let k = b.key { open?(key, k) } } label: {
            Circle().fill(hex.map { Board.tint($0, Color.secondary.opacity(0.3)) } ?? Color.secondary.opacity(0.3)).frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(b.label ?? tr("Colour"))
    }
}

/// The colour wheel (Android's ColorWheel; BoardKit.wheelHex): hue around it, red at the right going clockwise, white
/// in the middle. While it is dragged the colour goes now and then, the tile not drawn again, so the mark stays under
/// the finger; letting go sends the last one.
struct ColorWheelBlock: View {
    let b: Block
    let key: String
    let model: BoardModel
    @State private var hex: String?
    @State private var sent = Date.distantPast
    private let size: CGFloat = 220
    private static let hues: [Color] = [
        Color(red: 1, green: 0, blue: 0), Color(red: 1, green: 1, blue: 0), Color(red: 0, green: 1, blue: 0),
        Color(red: 0, green: 1, blue: 1), Color(red: 0, green: 0, blue: 1), Color(red: 1, green: 0, blue: 1), Color(red: 1, green: 0, blue: 0),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = b.label { Text(label).font(.subheadline) }
            ZStack(alignment: .topLeading) {
                Circle().fill(AngularGradient(colors: Self.hues, center: .center))
                Circle().fill(RadialGradient(colors: [.white, .white.opacity(0)], center: .center, startRadius: 0, endRadius: size / 2))
                if let at = BoardKit.shared.wheelAt(hex: hex), let x = at.first?.doubleValue, let y = at.second?.doubleValue {
                    Circle().fill(Board.tint(hex, .white)).overlay(Circle().stroke(.white, lineWidth: 3))
                        .frame(width: 22, height: 22)
                        .position(x: x * size, y: y * size)
                }
            }
            .frame(width: size, height: size)
            .contentShape(Circle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { pick($0.location, done: false) }
                .onEnded { pick($0.location, done: true) })
            .frame(maxWidth: .infinity)
            .accessibilityLabel(b.label ?? tr("Colour"))
        }
        .onAppear { hex = BoardKit.shared.textOf(v: b.value) }
        .onChange(of: BoardKit.shared.textOf(v: b.value)) { _, now in hex = now }
    }

    private func pick(_ at: CGPoint, done: Bool) {
        let picked = BoardKit.shared.wheelHex(x: Double(at.x / size), y: Double(at.y / size))
        hex = picked
        guard let block = b.key, done || Date().timeIntervalSince(sent) > 0.35 else { return }
        sent = Date()
        Task { await model.setColor(key, block, picked, done: done) }
    }
}
