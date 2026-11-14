import SwiftUI
import BotdotShared

/// A bot's mark, painted from what the shared layer says to paint (FigurePaint): the tile in its muted colour with its
/// icon and the ring or dot of its state, or the head with its face and hat. Android's BotFigure draws the same.
struct FigureView: View {
    let drawing: FigurePaint.Drawing

    var body: some View {
        Canvas { context, size in
            FigureView.paint(drawing, in: &context, size: size)
        }
        .accessibilityHidden(true)
    }

    /// Paints [drawing] with its view filling [size], centred, as Android's drawFigure fits it.
    static func paint(_ drawing: FigurePaint.Drawing, in context: inout GraphicsContext, size: CGSize) {
        let v = drawing.view.map { CGFloat($0.floatValue) }
        guard v.count == 4, v[2] > 0, v[3] > 0 else { return }
        let k = min(size.width / v[2], size.height / v[3])
        context.opacity = Double(drawing.opacity)
        context.drawLayer { layer in
            layer.translateBy(x: (size.width - v[2] * k) / 2 - v[0] * k, y: (size.height - v[3] * k) / 2 - v[1] * k)
            layer.scaleBy(x: k, y: k)
            var stack: [GraphicsContext] = []
            var ctx = layer
            for op in drawing.ops {
                switch onEnum(of: op) {
                case .circle(let c):
                    let rect = CGRect(x: CGFloat(c.x - c.r), y: CGFloat(c.y - c.r), width: CGFloat(2 * c.r), height: CGFloat(2 * c.r))
                    let path = Path(ellipseIn: rect)
                    if c.cut {
                        var cut = ctx
                        cut.blendMode = .destinationOut
                        cut.fill(path, with: .color(.black))
                    } else if let w = c.stroke {
                        ctx.stroke(path, with: .color(color(c.color)), lineWidth: CGFloat(w.floatValue))
                    } else {
                        ctx.fill(path, with: .color(color(c.color)))
                    }
                case .shape(let s):
                    let path = shape(s.steps)
                    if let w = s.stroke {
                        ctx.stroke(path, with: .color(color(s.color)), style: StrokeStyle(lineWidth: CGFloat(w.floatValue), lineCap: .round, lineJoin: .round))
                    } else {
                        ctx.fill(path, with: .color(color(s.color)))
                    }
                case .roundRect(let r):
                    let rect = CGRect(x: CGFloat(r.x), y: CGFloat(r.y), width: CGFloat(r.width), height: CGFloat(r.height))
                    ctx.fill(Path(roundedRect: rect, cornerRadius: CGFloat(r.radius)), with: .color(color(r.color)))
                case .arc(let a):
                    var path = Path()
                    path.addArc(center: CGPoint(x: CGFloat(a.x), y: CGFloat(a.y)), radius: CGFloat(a.r),
                                startAngle: .degrees(Double(a.start)), endAngle: .degrees(Double(a.start + a.sweep)), clockwise: false)
                    ctx.stroke(path, with: .color(color(a.color)), style: StrokeStyle(lineWidth: CGFloat(a.width), lineCap: .round))
                case .push(let m):
                    stack.append(ctx)
                    ctx.concatenate(CGAffineTransform(a: CGFloat(m.a), b: CGFloat(m.b), c: CGFloat(m.c), d: CGFloat(m.d), tx: CGFloat(m.e), ty: CGFloat(m.f)))
                case .pop:
                    if let last = stack.popLast() { ctx = last }
                }
            }
        }
    }

    private static func color(_ rgb: Int32) -> Color {
        Color(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
    }

    private static func shape(_ steps: [Step]) -> Path {
        var path = Path()
        for s in steps {
            let a = s.at
            func p(_ i: Int32) -> CGPoint { CGPoint(x: CGFloat(a.get(index: i)), y: CGFloat(a.get(index: i + 1))) }
            switch Character(UnicodeScalar(UInt8(truncatingIfNeeded: s.op))) {
            case "M": path.move(to: p(0))
            case "L": path.addLine(to: p(0))
            case "Q": path.addQuadCurve(to: p(2), control: p(0))
            case "C": path.addCurve(to: p(4), control1: p(0), control2: p(2))
            case "Z": path.closeSubpath()
            default: break
            }
        }
        return path
    }
}
