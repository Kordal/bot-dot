import SwiftUI
import BotdotShared

/// A project's board as the owner arranged it (#784, ADR 124; Android's BoardCanvasFree), on a wide screen: each tile
/// where it stands on a canvas BoardCanvas.W wide, drawn at that size and scaled to the screen's width. A long press
/// on a tile, then a drag, moves it; from near its bottom or a side it resizes it (BoardCanvas.held). A tile in the way
/// slides down (BoardCanvas.drag), and each drop is saved whole.
struct BoardCanvasView<Tile: View>: View {
    let places: [String: BoardCanvas.R]
    let tile: (String) -> Tile
    /// The drop saved: false when botdot refused it (the tiles go back where they were).
    let onArrange: ([String: BoardCanvas.R]) async -> Bool
    @State private var width: CGFloat = 0
    /// While a tile is held: the layout as it was, the tile and its edge, and the layout as the drag has it now.
    @State private var from: [String: BoardCanvas.R]?
    @State private var held: (id: String, edge: String?)?
    @State private var moving: [String: BoardCanvas.R]?

    var body: some View {
        let shown = moving ?? places
        let canvas = CGFloat(BoardCanvas.shared.W)
        let high = CGFloat(BoardCanvas.shared.height(layout: shown))
        let s = width > 0 ? width / canvas : 1
        ZStack(alignment: .topLeading) {
            ForEach(BoardCanvas.shared.order(layout: shown), id: \.self) { id in
                if let r = shown[id] {
                    tile(id)
                        .padding(16)
                        .frame(width: CGFloat(r.w), height: CGFloat(r.h), alignment: .topLeading)
                        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
                        .clipShape(.rect(cornerRadius: 14))
                        // The held tile is outlined while the finger has it.
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(held?.id == id ? Color.primary : .clear, lineWidth: 2))
                        .offset(x: CGFloat(r.x), y: CGFloat(r.y))
                }
            }
        }
        .frame(width: canvas, height: high, alignment: .topLeading)
        .scaleEffect(s, anchor: .topLeading)
        .frame(width: width, height: high * s, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .gesture(
            LongPressGesture(minimumDuration: 0.4)
                .sequenced(before: DragGesture(minimumDistance: 0))
                .onChanged { v in
                    guard case .second(true, let drag?) = v, s > 0 else { return }
                    if held == nil {
                        let at = BoardCanvas.shared.held(layout: places, x: Double(drag.startLocation.x / s), y: Double(drag.startLocation.y / s))
                        guard let at, let id = at.first else { return }
                        from = places
                        held = (id as String, at.second as String?)
                    }
                    if let h = held, let f = from {
                        moving = BoardCanvas.shared.drag(layout: f, id: h.id, edge: h.edge,
                                                         dx: Double(drag.translation.width / s), dy: Double(drag.translation.height / s))
                    }
                }
                .onEnded { _ in
                    // The drop stays drawn until botdot's layout comes back, or goes back when it is refused.
                    if let m = moving, held != nil { Task { if !(await onArrange(m)) { moving = nil } } }
                    held = nil; from = nil
                }
        )
        .onChange(of: places) { moving = nil }
    }
}
