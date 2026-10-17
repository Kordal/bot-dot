import Foundation
import QuartzCore

/// A bot's mark as Core Animation layers (docs/adr/003-one-figure-definition-for-all-apps.md): three
/// layers, one inside the other, as the web page nests three <g> (public/figure.js): the head
/// (everything), the eyes (the face) and the pupils (what looks around). Each has no size of its own
/// and sits at its pivot, with its content laid out around that point, so its position is
/// `pivot + move` and its turn and scale are about the pivot. A value that changes over a movement's
/// keys gets a keyframe animation with the definition's key times and easing, so the system plays the
/// movement and the app does no work per frame. The geometry is y-down, as in the definition: the view
/// that shows it flips its layer. Nothing is clipped: a hat may reach past the mark's own square.
///
/// Layers are named like the web page's classes (`l-head`, `l-eyes`, `l-pupils`, `hat`), for the tests.
public enum FigureLayers {
    /// How a mark is drawn: its two tones, how large, and whether it stands still (Reduce Motion).
    public struct Look {
        public var main: CGColor
        public var deep: CGColor
        /// The side of the square the box is drawn in, in points (for the small mark: its height).
        public var side: CGFloat
        /// Pixels per point of the screen it is on.
        public var scale: CGFloat
        public var still: Bool

        public init(main: CGColor, deep: CGColor, side: CGFloat, scale: CGFloat = 2, still: Bool = false) {
            self.main = main
            self.deep = deep
            self.side = side
            self.scale = scale
            self.still = still
        }
    }

    /// CSS `ease-in-out`.
    static let easeInOut: [Float] = [0.42, 0, 0.58, 1]

    /// The head in a state, with the hat of `outfit`. Without a definition it is the one built-in bare
    /// head. `clock` keeps a movement where it was when a head is drawn again, and all heads in step.
    public static func figure(_ def: FigureDef?, state: String?, outfit: Outfit? = nil, look: Look, clock: CFTimeInterval = CACurrentMediaTime()) -> CALayer {
        let d = def ?? .bare
        return build(d, state: state, face: true, outfit: outfit, look: look, clock: clock, at: .init(x: 0, y: 0), view: d.box, size: CGSize(width: look.side, height: look.side))
    }

    /// The small mark beside a bot's name in text, and for each thing that waits in "Needs you": the
    /// head and its hat, without eyes. It never moves and has no state. Only the part `small.view` of
    /// the box is shown: `look.side` is its height, and its width follows.
    public static func small(_ def: FigureDef?, outfit: Outfit? = nil, look: Look) -> CALayer {
        let d = def ?? .bare
        return build(d, state: nil, face: false, outfit: outfit, look: look, clock: 0, at: d.smallAt, view: d.smallSize, size: CGSize(width: look.side * d.smallAspect, height: look.side))
    }

    /// The mark with the part of its box that starts at `at` and is `view` large scaled to fill `size`.
    private static func build(_ def: FigureDef, state: String?, face: Bool, outfit: Outfit?, look: Look, clock: CFTimeInterval, at: FigureDef.Point, view: FigureDef.Point, size: CGSize) -> CALayer {
        let root = CALayer()
        root.name = "fig"
        root.frame = CGRect(origin: .zero, size: size)
        let k = min(size.width / view.x, size.height / view.y)
        let name = def.stateName(state)
        // A faded mark fades as one, hat included, not shape by shape.
        root.opacity = face ? Float(def.opacity(name)) : 1
        root.allowsGroupOpacity = true

        let still = face ? def.pose(name) : .rest
        let move = face && !look.still ? def.move(name) : nil
        let keys = move.map { m in m.keys.map(\.pose) } ?? []
        // A value that changes over the keys, played for ever; nothing for one that stays as it is.
        func play<Value: Equatable>(_ layer: CALayer, _ keyPath: String, _ value: (FigureDef.Pose) -> Value) {
            guard let move else { return }
            let values = keys.map(value)
            guard values.contains(where: { $0 != values[0] }) else { return }
            let a = CAKeyframeAnimation(keyPath: keyPath)
            a.values = values
            a.keyTimes = move.keys.map { NSNumber(value: $0.at) }
            let timing = move.eased ? CAMediaTimingFunction(controlPoints: easeInOut[0], easeInOut[1], easeInOut[2], easeInOut[3]) : CAMediaTimingFunction(name: .linear)
            a.timingFunctions = Array(repeating: timing, count: values.count - 1)
            a.calculationMode = .linear
            a.duration = move.seconds
            a.repeatCount = .infinity
            a.isRemovedOnCompletion = false
            // Started at a whole number of loops on the clock, so it is where the clock says, not at its beginning.
            a.beginTime = clock - clock.truncatingRemainder(dividingBy: move.seconds)
            layer.add(a, forKey: keyPath)
        }
        /// One of the three layers, in `parent`: at its pivot, moved, turned and scaled as the pose
        /// says, with every value that changes played. What is put in the layer it gives back is laid
        /// out in the box's units, `k` points to a unit.
        func layer(_ name: String, in parent: CALayer, pivot: FigureDef.Point, move: @escaping (FigureDef.Pose) -> FigureDef.Point, turn: ((FigureDef.Pose) -> Double)? = nil, scale: ((FigureDef.Pose) -> FigureDef.Point)? = nil) -> CALayer {
            func place(_ pose: FigureDef.Pose) -> CGPoint { CGPoint(x: (pivot.x + move(pose).x) * k, y: (pivot.y + move(pose).y) * k) }
            let l = joint(name, at: place(still))
            play(l, "position", place)
            if let turn {
                l.setValue(turn(still) * .pi / 180, forKeyPath: "transform.rotation.z")
                play(l, "transform.rotation.z") { turn($0) * .pi / 180 }
            }
            if let scale {
                l.setValue(scale(still).x, forKeyPath: "transform.scale.x")
                l.setValue(scale(still).y, forKeyPath: "transform.scale.y")
                play(l, "transform.scale.x") { scale($0).x }
                play(l, "transform.scale.y") { scale($0).y }
            }
            parent.addSublayer(l)
            let inside = joint("in", at: CGPoint(x: -pivot.x * k, y: -pivot.y * k))
            l.addSublayer(inside)
            return inside
        }
        func color(_ t: FigureDef.Tone?) -> CGColor? {
            switch t {
            case .main: look.main
            case .deep: look.deep
            case .white: cg(def.white)
            case .ink: cg(def.ink)
            case nil: nil
            }
        }
        /// Shapes drawn `by` times as large as the box's units.
        func draw(_ shapes: [FigureDef.Shape], in parent: CALayer, by: Double = 1) {
            for s in shapes {
                parent.addSublayer(mark(outline(s.kind, k * by), fill: color(s.fill), stroke: color(s.stroke), width: s.width * k * by, look))
            }
        }

        // The part `view` of the box, in the middle of the mark.
        let box = joint("box", at: CGPoint(x: (size.width - view.x * k) / 2 - at.x * k, y: (size.height - view.y * k) / 2 - at.y * k))
        root.addSublayer(box)
        let head = layer("l-head", in: box, pivot: def.pivotHead, move: \.headMove, turn: \.headTurn)
        let circle = CGMutablePath()
        circle.addEllipse(in: disc(def.head.cx, def.head.cy, def.head.r, k))
        head.addSublayer(mark(circle, fill: look.main, stroke: nil, width: 0, look))
        if face {
            let shown = def.face(name)
            let eyes = layer("l-eyes", in: head, pivot: def.pivotEyes, move: \.eyesMove, scale: \.eyesScale)
            draw(shown.eyes, in: eyes)
            draw(shown.pupils, in: layer("l-pupils", in: eyes, pivot: .init(x: 0, y: 0), move: \.pupilsMove))
        }
        // The hat is drawn last, over the head and the face.
        if let hat = def.hat(outfit) {
            let worn = joint("hat", at: CGPoint(x: hat.at.x * k, y: hat.at.y * k))
            draw(hat.shapes, in: worn, by: hat.scale)
            head.addSublayer(worn)
        }
        return root
    }

    private static func cg(_ rgb: UInt32) -> CGColor {
        CGColor(srgbRed: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
    }

    /// A layer with no size of its own: a point that what hangs from it moves and turns about.
    private static func joint(_ name: String, at: CGPoint) -> CALayer {
        let l = CALayer()
        l.name = name
        l.bounds = .zero
        l.position = at
        return l
    }

    /// The square around a circle, `k` points to a unit.
    private static func disc(_ cx: Double, _ cy: Double, _ r: Double, _ k: CGFloat) -> CGRect {
        CGRect(x: (cx - r) * k, y: (cy - r) * k, width: 2 * r * k, height: 2 * r * k)
    }

    /// One thing to see: an outline filled, stroked (round caps and joins) or both.
    private static func mark(_ path: CGPath, fill: CGColor?, stroke: CGColor?, width: CGFloat, _ look: Look) -> CAShapeLayer {
        let l = CAShapeLayer()
        l.bounds = .zero
        l.position = .zero
        l.path = path
        l.fillColor = fill
        l.strokeColor = stroke
        l.lineWidth = width
        l.lineCap = .round
        l.lineJoin = .round
        l.contentsScale = look.scale
        return l
    }

    /// A shape as an outline, `k` points to a unit.
    static func outline(_ kind: FigureDef.Shape.Kind, _ k: CGFloat) -> CGPath {
        let path = CGMutablePath()
        func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * k, y: y * k) }
        switch kind {
        case .circle(let cx, let cy, let r):
            if r > 0 { path.addEllipse(in: disc(cx, cy, r, k)) }
        case .line(let x1, let y1, let x2, let y2):
            path.move(to: p(x1, y1))
            path.addLine(to: p(x2, y2))
        case .rect(let x, let y, let w, let h, let radius):
            guard w > 0, h > 0, radius >= 0 else { break } // nothing to see, as on the web page
            // Rounded as SVG's rx does: by at most half of each side.
            let (rx, ry) = (min(radius, w / 2), min(radius, h / 2))
            let (x2, y2) = (x + w, y + h)
            guard rx > 0 else {
                path.addLines(between: [p(x, y), p(x2, y), p(x2, y2), p(x, y2)])
                path.closeSubpath()
                break
            }
            let (cx, cy) = (rx * 0.5522847498, ry * 0.5522847498) // how far a cubic's control points lie along a quarter circle
            path.move(to: p(x + rx, y))
            path.addLine(to: p(x2 - rx, y))
            path.addCurve(to: p(x2, y + ry), control1: p(x2 - rx + cx, y), control2: p(x2, y + ry - cy))
            path.addLine(to: p(x2, y2 - ry))
            path.addCurve(to: p(x2 - rx, y2), control1: p(x2, y2 - ry + cy), control2: p(x2 - rx + cx, y2))
            path.addLine(to: p(x + rx, y2))
            path.addCurve(to: p(x, y2 - ry), control1: p(x + rx - cx, y2), control2: p(x, y2 - ry + cy))
            path.addLine(to: p(x, y + ry))
            path.addCurve(to: p(x + rx, y), control1: p(x, y + ry - cy), control2: p(x + rx - cx, y))
            path.closeSubpath()
        case .path(let steps):
            for s in steps {
                let a = s.at
                switch (s.op, a.count) {
                case ("M", 2): path.move(to: p(a[0], a[1]))
                case ("L", 2): path.addLine(to: p(a[0], a[1]))
                case ("Q", 4): path.addQuadCurve(to: p(a[2], a[3]), control: p(a[0], a[1]))
                case ("C", 6): path.addCurve(to: p(a[4], a[5]), control1: p(a[0], a[1]), control2: p(a[2], a[3]))
                case ("Z", 0): path.closeSubpath()
                default: break // FigureDef reads no other step
                }
            }
        }
        return path
    }
}
