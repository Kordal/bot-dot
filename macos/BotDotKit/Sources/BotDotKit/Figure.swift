import Foundation

// A bot's mark, from the one definition the botdot server hands out (GET /api/figure, lib/figure.json;
// docs/adr/003-one-figure-definition-for-all-apps.md): a head in the bot's colour, the face of its
// state and its hat. The app bundles that file and prefers the server's copy. This file holds no face
// or kit data of its own beyond one built-in bare head: it reads the definition and says what a
// state's face is, where the three layers (head, eyes, pupils) are in its pose and at each key of its
// movement, and which hat an outfit puts on. FigureLayers.swift turns that into Core Animation layers.
// public/figure.js is the reference: the two must draw what it draws.

/// Any JSON: a figure definition, or a hat the Chief drew, as it came.
public indirect enum JSONTree: Decodable, Hashable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONTree]), object([String: JSONTree])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONTree].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONTree].self)) }
    }

    subscript(key: String) -> JSONTree? { if case .object(let o) = self { o[key] } else { nil } }
    var number: Double? { if case .number(let n) = self, n.isFinite { n } else { nil } }
    var text: String? { if case .string(let s) = self { s } else { nil } }
    var list: [JSONTree]? { if case .array(let a) = self { a } else { nil } }
    var fields: [String: JSONTree]? { if case .object(let o) = self { o } else { nil } }
    /// `[x, y]`.
    var point: FigureDef.Point? {
        guard let a = list, a.count == 2, let x = a[0].number, let y = a[1].number else { return nil }
        return FigureDef.Point(x: x, y: y)
    }
}

/// A bot's outfit (docs/adr/004-pieces-as-restricted-shape-lists.md): its hat. A bot that was never
/// given one has no outfit at all (`nil`); either way it is a head without a hat. Anything else an
/// outfit carries (an older server's held object) is ignored.
public struct Outfit: Decodable, Hashable, Sendable {
    /// The name of a hat in the definition's kit, or a hat drawn by the Chief, given inline as `{ shapes }`.
    public enum Hat: Hashable, Sendable {
        case named(String)
        case drawn(JSONTree)
    }

    public var hat: Hat?

    public init(hat: Hat? = nil) { self.hat = hat }

    /// Anything that isn't a name or an object is no hat; an outfit that isn't an object wears nothing.
    init(_ tree: JSONTree?) {
        switch tree?["hat"] {
        case .string(let s)?: hat = s.isEmpty ? nil : .named(s)
        case .object(let o)?: hat = .drawn(.object(o))
        default: hat = nil
        }
    }

    public init(from decoder: Decoder) throws {
        self.init(try? JSONTree(from: decoder))
    }
}

public struct FigureDef: Sendable, Equatable {
    /// The format this renderer knows.
    public static let version = 2
    /// The colour of a bot that has none (0xRRGGBB).
    public static let grey: UInt32 = 0x888780

    public struct Problem: LocalizedError, Sendable {
        public let message: String
        public var errorDescription: String? { "Figure definition: \(message)" }
    }

    public struct Point: Hashable, Sendable {
        public var x, y: Double
        public init(x: Double, y: Double) { self.x = x; self.y = y }
    }

    /// The head's circle, in the bot's colour.
    public struct Head: Hashable, Sendable {
        public let cx, cy, r: Double
    }

    /// Where the three layers are at one moment: the head moved and turned (degrees, clockwise on
    /// screen) about `pivotHead`, the eyes moved and scaled about `pivotEyes`, the pupils moved.
    public struct Pose: Hashable, Sendable {
        public var headMove = Point(x: 0, y: 0)
        public var headTurn = 0.0
        public var eyesMove = Point(x: 0, y: 0)
        public var eyesScale = Point(x: 1, y: 1)
        public var pupilsMove = Point(x: 0, y: 0)
        /// What a pose leaves out.
        public static let rest = Pose()
    }

    /// One moment of a movement: where the layers are at time `at` (0 to 1), the state's still pose
    /// with what the key says in place of it.
    public struct Key: Hashable, Sendable {
        public let at: Double
        public let pose: Pose
    }

    /// A state's movement: one loop of `seconds`, with the one easing between each pair of keys.
    public struct Move: Hashable, Sendable {
        public let seconds: Double
        /// `ease-in-out` (the cubic bezier 0.42, 0, 0.58, 1); otherwise linear.
        public let eased: Bool
        public let keys: [Key]
    }

    /// The face of a state: what doesn't look around (whites, brows, crosses, closed lids) and what does.
    public struct Face: Hashable, Sendable {
        public let eyes: [Shape]
        public let pupils: [Shape]
    }

    struct State: Hashable, Sendable {
        let face: Face
        let pose: Pose
        let opacity: Double
        let move: Move?
    }

    /// The bot's colour, that colour mixed towards the text colour (ADR 004), and the white of an eye
    /// and the ink of a pupil, which the definition gives.
    public enum Tone: Hashable, Sendable { case main, deep, white, ink }

    /// One step of an outline: M, L, Q, C or Z with its numbers.
    public struct Step: Hashable, Sendable {
        public let op: Character
        public let at: [Double]
    }

    /// One shape of a face (in the box's units) or of a hat (in the hat's box): filled, stroked or
    /// both, each in one of the tones.
    public struct Shape: Hashable, Sendable {
        public enum Kind: Hashable, Sendable {
            case circle(cx: Double, cy: Double, r: Double)
            case rect(x: Double, y: Double, w: Double, h: Double, r: Double)
            case line(x1: Double, y1: Double, x2: Double, y2: Double)
            case path([Step])
        }
        public let kind: Kind
        public let fill: Tone?
        public let stroke: Tone?
        public let width: Double
    }

    /// A hat ready to draw: its shapes in the hat's own box, which is drawn `scale` times as large
    /// with its corner (0, 0) at `at`. A point `q` of it lands at `at + scale × q`, and its strokes
    /// are `scale` times as wide.
    public struct Hat: Hashable, Sendable {
        public let at: Point
        public let scale: Double
        public let shapes: [Shape]
    }

    /// Where a hat goes, and the kit's hats this app can draw whole.
    struct Hats: Hashable, Sendable {
        let at: Point
        let scale: Double
        let pieces: [String: [Shape]]
    }

    public let box: Point
    public let head: Head
    /// The white of an eye and the ink of a pupil (0xRRGGBB): the same on a light and a dark background.
    public let white, ink: UInt32
    /// The points the head turns about and the eyes close about.
    public let pivotHead, pivotEyes: Point
    /// The Chief of Staff's fixed outfit.
    public let chief: Outfit?
    /// The part of the box that fills the small mark (`smallAt`, then `smallSize`): the definition's,
    /// or the whole box for one that doesn't say.
    public let smallAt, smallSize: Point
    let states: [String: State]
    let fallback: String
    let hats: Hats?
    /// Two definitions are the same when they were read in the same go: enough to know when to draw again.
    private let stamp = UUID()

    public static func == (a: FigureDef, b: FigureDef) -> Bool { a.stamp == b.stamp }

    /// How wide the small mark is for its height.
    public var smallAspect: Double { smallSize.x / smallSize.y }

    /// No definition can be used: one bare head looking ahead, with no states, no movement and no
    /// hat. Its numbers are those ADR 003 fixes for every app.
    public static let bare: FigureDef = try! FigureDef(json: Data("""
        {"version":2,"box":[24,24],"head":{"cx":12,"cy":16.5,"r":7.5},"tones":{"white":"#ffffff","ink":"#24231f"},
        "pivot":{"head":[12,16.5],"eyes":[12,17.1]},"default":"plain","states":{"plain":{
        "eyes":[{"shape":"circle","cx":8.8,"cy":17.1,"r":2.2,"fill":"white"},{"shape":"circle","cx":15.2,"cy":17.1,"r":2.2,"fill":"white"}],
        "pupils":[{"shape":"circle","cx":8.8,"cy":17.1,"r":1.2,"fill":"ink"},{"shape":"circle","cx":15.2,"cy":17.1,"r":1.2,"fill":"ink"}]}}}
        """.utf8))

    // MARK: Reading a definition

    /// Reads a definition. Throws when it is not one this app can draw from (another version of the
    /// format, a face with a shape or tone it doesn't know, or broken): the app then keeps the copy
    /// it has. Keys it doesn't know are ignored.
    public init(json data: Data) throws {
        func fail(_ why: String) -> Problem { Problem(message: why) }
        guard let d = try? JSONDecoder().decode(JSONTree.self, from: data), d.fields != nil else { throw fail("not an object") }
        guard d["version"]?.number == Double(Self.version) else { throw fail("version \(d["version"].map { "\($0)" } ?? "none") is not one this app knows") }
        guard let box = d["box"]?.point, box.x > 0, box.y > 0 else { throw fail("box must be [width, height]") }
        guard let cx = d["head"]?["cx"]?.number, let cy = d["head"]?["cy"]?.number, let r = d["head"]?["r"]?.number, r > 0 else { throw fail("head must be { cx, cy, r }") }
        guard let white = Self.hex(d["tones"]?["white"]?.text), let ink = Self.hex(d["tones"]?["ink"]?.text) else { throw fail("tones must give white and ink as #rrggbb") }
        guard let pivotHead = d["pivot"]?["head"]?.point, let pivotEyes = d["pivot"]?["eyes"]?.point else { throw fail("pivot must give head and eyes as [x, y]") }

        // A pose, or a key over one: what it says of a layer replaces that value of `under`.
        func pose(_ p: JSONTree?, over under: Pose, _ what: String) throws -> Pose {
            guard let p else { return under }
            if let list = p.list, list.isEmpty { return under } // an empty list says nothing of any layer, as on the web page
            guard p.fields != nil else { throw fail("\(what) is not a pose") }
            var out = under
            for (layer, may) in Self.says {
                guard let v = p[layer] else { continue }
                guard v.fields != nil else { throw fail("\(what): \(layer) says move, turn or scale") }
                for k in ["move", "turn", "scale"] {
                    guard let given = v[k] else { continue }
                    guard may.contains(k) else { throw fail("\(what): \(layer) has no \(k)") }
                    if k == "turn" {
                        guard let n = given.number else { throw fail("\(what): \(layer)'s turn must be a number") }
                        out.headTurn = n
                        continue
                    }
                    guard let at = given.point else { throw fail("\(what): \(layer)'s \(k) must be [x, y]") }
                    switch (layer, k) {
                    case ("head", _): out.headMove = at
                    case ("eyes", "move"): out.eyesMove = at
                    case ("eyes", _): out.eyesScale = at
                    default: out.pupilsMove = at
                    }
                }
            }
            return out
        }

        var states: [String: State] = [:]
        for (name, s) in d["states"]?.fields ?? [:] {
            guard Self.isName(name) else { throw fail("\"\(name)\" can't be a state's name") }
            guard let eyes = s["eyes"]?.list, let pupils = s["pupils"]?.list else { throw fail("\(name) has no face") }
            guard let fixed = Self.shapes(eyes, Self.faceTones), let looking = Self.shapes(pupils, Self.faceTones) else { throw fail("\(name): its face has a shape this app can't draw") }
            let still = try pose(s["pose"], over: .rest, name)
            var opacity = 1.0
            if let o = s["opacity"] {
                guard let n = o.number, (0...1).contains(n) else { throw fail("\(name): opacity is 0 to 1") }
                opacity = n
            }
            var move: Move?
            // No movement: none given, or what the web page takes for none.
            if let m = s["move"], ![.null, .bool(false), .number(0), .string("")].contains(m) {
                guard let seconds = m["seconds"]?.number, seconds > 0 else { throw fail("\(name): seconds must be more than 0") }
                let eased: Bool
                switch m["easing"]?.text {
                case "ease-in-out": eased = true
                case "linear": eased = false
                default: throw fail("\(name): the easing is linear or ease-in-out")
                }
                guard let list = m["keys"]?.list, list.count >= 2 else { throw fail("\(name): a movement has two keys or more") }
                var keys: [Key] = []
                for (i, k) in list.enumerated() {
                    guard let at = k["at"]?.number, i > 0 ? at > keys[i - 1].at : at == 0 else { throw fail("\(name): keys start at 0 and go up") }
                    keys.append(Key(at: at, pose: try pose(k, over: still, "\(name), key \(i)")))
                }
                guard keys[keys.count - 1].at == 1 else { throw fail("\(name): the last key is at 1") }
                // What the two keys say, not only where they put the layers: the web page refuses the same.
                func said(_ k: JSONTree) -> [[String: JSONTree]] { Self.says.map { k[$0.layer]?.fields ?? [:] } }
                guard said(list[0]) == said(list[list.count - 1]) else { throw fail("\(name): the last key must equal the first, or the loop jumps") }
                move = Move(seconds: seconds, eased: eased, keys: keys)
            }
            states[name] = State(face: Face(eyes: fixed, pupils: looking), pose: still, opacity: opacity, move: move)
        }
        guard let fallback = d["default"]?.text, states[fallback] != nil else { throw fail("default must name one of the states") }

        // Where the hat goes, and the kit. A kit that is missing or wrong leaves hats out; the head is still drawn.
        var hats: Hats?
        if let a = d["attach"]?["hat"] {
            guard let at = a["at"]?.point, let scale = a["scale"]?.number, scale > 0 else { throw fail("attach.hat must be { at, scale }") }
            if let kit = d["kit"]?["hat"], let origin = kit["origin"]?.point {
                // The origin of the hat's box goes on `at`: its corner is `scale` origins up and to the left of it.
                hats = Hats(at: Point(x: at.x - scale * origin.x, y: at.y - scale * origin.y), scale: scale,
                            pieces: (kit["pieces"]?.fields ?? [:]).compactMapValues { Self.shapes(of: $0) })
            }
        }

        var view = [0, 0, box.x, box.y]
        if let s = d["small"] {
            let given = (s["view"]?.list ?? []).compactMap(\.number)
            guard s["view"]?.list?.count == 4, given.count == 4, given[2] > 0, given[3] > 0 else { throw fail("small: view must be [x, y, width, height]") }
            view = given
        }

        self.box = box
        self.head = Head(cx: cx, cy: cy, r: r)
        self.white = white
        self.ink = ink
        self.pivotHead = pivotHead
        self.pivotEyes = pivotEyes
        self.states = states
        self.fallback = fallback
        self.hats = hats
        self.chief = d["chief"]?["outfit"].flatMap { $0.fields == nil ? nil : Outfit($0) }
        self.smallAt = Point(x: view[0], y: view[1])
        self.smallSize = Point(x: view[2], y: view[3])
    }

    /// The layers, outermost first, and what a pose may say of each.
    private static let says: [(layer: String, may: [String])] = [("head", ["move", "turn"]), ("eyes", ["move", "scale"]), ("pupils", ["move"])]

    private static func isName(_ s: String) -> Bool {
        s.range(of: "^[a-z][a-z0-9_]*$", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// "#rrggbb" → 0xRRGGBB; anything else is no colour.
    private static func hex(_ s: String?) -> UInt32? {
        guard let s, s.range(of: "^#[0-9a-f]{6}$", options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        return UInt32(s.dropFirst(), radix: 16)
    }

    // MARK: States and poses

    /// The state to draw: the one asked for, or the default for one this definition doesn't know.
    public func stateName(_ state: String?) -> String {
        if let state, states[state] != nil { state } else { fallback }
    }

    /// A state's movement, when it has one. A state without one needs no animation at all.
    public func move(_ state: String?) -> Move? { states[stateName(state)]?.move }

    public func opacity(_ state: String?) -> Double { states[stateName(state)]?.opacity ?? 1 }

    public func face(_ state: String?) -> Face { states[stateName(state)]?.face ?? Face(eyes: [], pupils: []) }

    /// Where the layers are in a state: its still pose (what reduced motion shows), or at key number
    /// `key` of its movement.
    public func pose(_ state: String?, key: Int? = nil) -> Pose {
        guard let s = states[stateName(state)] else { return .rest }
        if let key, let keys = s.move?.keys, keys.indices.contains(key) { return keys[key].pose }
        return s.pose
    }

    // MARK: Hats

    /// The hat of an outfit, placed on the head, when this app can draw it. A hat is drawn whole or
    /// not at all: a name the kit lacks, or a shape or tone this app doesn't know, gives no hat, and
    /// the head is drawn without one. The limits of a hat are checked on the server (lib/pieces.js),
    /// not here.
    public func hat(_ outfit: Outfit?) -> Hat? {
        guard let hats, let wanted = outfit?.hat else { return nil }
        let shapes: [Shape]? = switch wanted {
        case .named(let name): hats.pieces[name]
        case .drawn(let piece): Self.shapes(of: piece)
        }
        return shapes.map { Hat(at: hats.at, scale: hats.scale, shapes: $0) }
    }

    /// A hat is in two tones of the bot's colour; a face also has the white of an eye and the ink of a pupil.
    private static let hatTones: [String: Tone] = ["main": .main, "deep": .deep]
    private static let faceTones: [String: Tone] = ["main": .main, "deep": .deep, "white": .white, "ink": .ink]
    /// What a path may be made of, and how many numbers each command takes.
    private static let commands: [String: Int] = ["M": 2, "L": 2, "Q": 4, "C": 6, "Z": 0]

    /// A hat's shapes, or nil when it has one this app can't draw.
    static func shapes(of piece: JSONTree) -> [Shape]? {
        piece["shapes"]?.list.flatMap { shapes($0, hatTones) }
    }

    /// A list of shapes, or nil when one of them is not a shape this app can draw in these tones.
    private static func shapes(_ list: [JSONTree], _ tones: [String: Tone]) -> [Shape]? {
        var out: [Shape] = []
        for s in list {
            guard let shape = shape(s, tones) else { return nil }
            out.append(shape)
        }
        return out
    }

    /// One shape: filled, stroked or both, each in one of `tones`. A fill or stroke that is not one
    /// of them stops the shape's piece, like a shape that is not one.
    private static func shape(_ s: JSONTree, _ tones: [String: Tone]) -> Shape? {
        func tone(_ key: String) -> Tone?? {
            guard let given = s[key] else { return .some(nil) }
            guard let t = given.text.flatMap({ tones[$0] }) else { return nil }
            return t
        }
        guard let fill = tone("fill"), let stroke = tone("stroke"), fill != nil || stroke != nil else { return nil }
        var width = 0.0
        if stroke != nil {
            guard let w = s["width"]?.number else { return nil }
            width = w
        }
        func n(_ key: String) -> Double? { s[key]?.number }
        let kind: Shape.Kind
        switch s["shape"]?.text {
        case "rect":
            guard let x = n("x"), let y = n("y"), let w = n("w"), let h = n("h") else { return nil }
            var r = 0.0
            if let given = s["r"] {
                guard let v = given.number else { return nil }
                r = v
            }
            kind = .rect(x: x, y: y, w: w, h: h, r: r)
        case "circle":
            guard let cx = n("cx"), let cy = n("cy"), let r = n("r") else { return nil }
            kind = .circle(cx: cx, cy: cy, r: r)
        case "line":
            guard let x1 = n("x1"), let y1 = n("y1"), let x2 = n("x2"), let y2 = n("y2") else { return nil }
            kind = .line(x1: x1, y1: y1, x2: x2, y2: y2)
        case "path":
            guard let d = s["d"]?.list else { return nil }
            var steps: [Step] = []
            for c in d {
                guard let parts = c.list, let op = parts.first?.text, commands[op] == parts.count - 1 else { return nil }
                var at: [Double] = []
                for p in parts.dropFirst() {
                    guard let v = p.number else { return nil }
                    at.append(v)
                }
                steps.append(Step(op: Character(op), at: at))
            }
            // One that doesn't start with a move shows nothing on the web page, and nothing here.
            kind = .path(steps.first?.op == "M" ? steps : [])
        default:
            return nil
        }
        return Shape(kind: kind, fill: fill, stroke: stroke, width: width)
    }

    // MARK: The two tones

    /// The deep tone of a colour (0xRRGGBB): mixed 45% towards black on a light background and towards
    /// white on a dark one, channel by channel in sRGB.
    public static func deep(_ rgb: UInt32, dark: Bool) -> UInt32 {
        let ink = dark ? 255.0 : 0.0
        func mix(_ shift: UInt32) -> UInt32 {
            UInt32(min(255, max(0, (Double((rgb >> shift) & 0xff) * 0.55 + ink * 0.45).rounded()))) << shift
        }
        return mix(16) | mix(8) | mix(0)
    }

    /// "#378add" → 0x378add; anything else → the grey bots get by default.
    public static func rgb(_ hex: String?) -> UInt32 {
        let s = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        return s.count == 6 ? UInt32(s, radix: 16) ?? grey : grey
    }
}
