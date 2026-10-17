import Foundation
import os
import QuartzCore
import Testing
@testable import BotDotKit

/// The head, drawn from the definition the app bundles: the server's own lib/figure.json (ADR 003,
/// ADR 004). What the layers show is checked against the file itself, worked out here a second way.
@MainActor
@Suite struct Figure {
    static let text = try! Data(contentsOf: TestServer.repo.appending(path: "lib/figure.json"))
    let raw = try! JSONSerialization.jsonObject(with: Figure.text) as! [String: Any]
    let def = try! FigureDef(json: Figure.text)
    let six = ["idle", "working", "waiting", "needs_you", "failed", "paused"]

    // MARK: Helpers

    func look(side: CGFloat = 24, still: Bool = false) -> FigureLayers.Look {
        .init(main: CGColor(srgbRed: 1, green: 0, blue: 0, alpha: 1), deep: CGColor(srgbRed: 0, green: 0, blue: 1, alpha: 1), side: side, still: still)
    }
    func layers(_ state: String?, outfit: Outfit? = nil, side: CGFloat = 24, still: Bool = false, def: FigureDef? = nil) -> CALayer {
        FigureLayers.figure(def ?? self.def, state: state, outfit: outfit, look: look(side: side, still: still), clock: 1000.25)
    }
    func find(_ name: String, in layer: CALayer) -> CALayer? {
        if layer.name == name { return layer }
        for l in layer.sublayers ?? [] { if let hit = find(name, in: l) { return hit } }
        return nil
    }
    func all(_ layer: CALayer) -> [CALayer] { [layer] + (layer.sublayers ?? []).flatMap(all) }
    /// The shapes straight inside one of the three layers (not those of a layer nested in it).
    func marks(_ layer: CALayer?) -> [CAShapeLayer] { (find("in", in: layer!)?.sublayers ?? []).compactMap { $0 as? CAShapeLayer } }
    func keyframes(_ layer: CALayer?, _ keyPath: String) -> CAKeyframeAnimation? { layer?.animation(forKey: keyPath) as? CAKeyframeAnimation }
    func near(_ a: Double, _ b: Double, _ slack: Double = 1e-6) -> Bool { abs(a - b) < slack }
    func near(_ a: CGPoint, _ b: CGPoint, _ slack: Double = 1e-6) -> Bool { near(a.x, b.x, slack) && near(a.y, b.y, slack) }
    func near(_ a: CGRect, _ b: CGRect, _ slack: Double = 1e-6) -> Bool { near(a.origin, b.origin, slack) && near(a.width, b.width, slack) && near(a.height, b.height, slack) }
    func outfit(_ json: String) -> Outfit? { try? JSONDecoder().decode(Outfit.self, from: Data(json.utf8)) }
    func rgb(_ c: CGColor?) -> [Int] { (c?.components ?? []).prefix(3).map { Int(($0 * 255).rounded()) } }
    func changed(_ change: (inout [String: Any]) -> Void) -> Data {
        var d = raw
        change(&d)
        return try! JSONSerialization.data(withJSONObject: d)
    }
    /// The definition with one state changed.
    func changed(state: String, _ change: (inout [String: Any]) -> Void) -> Data {
        changed { d in
            var states = d["states"] as! [String: Any]
            var s = states[state] as! [String: Any]
            change(&s)
            states[state] = s
            d["states"] = states
        }
    }

    // The definition, read here without the app's code.
    func rawState(_ s: String) -> [String: Any] { (raw["states"] as! [String: Any])[s] as! [String: Any] }
    func rawPoint(_ v: Any?) -> CGPoint { let a = v as! [NSNumber]; return CGPoint(x: a[0].doubleValue, y: a[1].doubleValue) }
    func rawKeys(_ s: String) -> [[String: Any]] { (rawState(s)["move"] as? [String: Any])?["keys"] as? [[String: Any]] ?? [] }
    var rawHats: [String: Any] { ((raw["kit"] as! [String: Any])["hat"] as! [String: Any])["pieces"] as! [String: Any] }
    /// What a pose (or a key over it) says of a layer: `move`, `scale` as a point, `turn` as a number.
    func said(_ pose: Any?, over under: Any? = nil, _ layer: String, _ key: String) -> Any? {
        ((pose as? [String: Any])?[layer] as? [String: Any])?[key] ?? ((under as? [String: Any])?[layer] as? [String: Any])?[key]
    }
    /// ADR 003's own arithmetic: where a pose (a key over the still pose) puts a point of the pupils'
    /// layer, of the eyes' layer and of the head's layer, in the box's units.
    func placed(_ p: CGPoint, through: [String], pose: Any?, over under: Any? = nil) -> CGPoint {
        var p = p
        for layer in through {
            let move = said(pose, over: under, layer, "move").map(rawPoint) ?? .zero
            let scale = said(pose, over: under, layer, "scale").map(rawPoint) ?? CGPoint(x: 1, y: 1)
            let turn = ((said(pose, over: under, layer, "turn") as? NSNumber)?.doubleValue ?? 0) * .pi / 180
            let pivot = layer == "pupils" ? .zero : rawPoint((raw["pivot"] as! [String: Any])[layer])
            let (x, y) = ((p.x - pivot.x) * scale.x, (p.y - pivot.y) * scale.y)
            p = CGPoint(x: move.x + pivot.x + x * cos(turn) - y * sin(turn), y: move.y + pivot.y + x * sin(turn) + y * cos(turn))
        }
        return p
    }

    // MARK: The definition

    @Test func theBundledDefinitionParsesWithTheHeadTheSixStatesTheKitAndTheChiefsHat() throws {
        #expect(def.box == FigureDef.Point(x: 24, y: 24))
        #expect(def.head == FigureDef.Head(cx: 12, cy: 16.5, r: 7.5))
        #expect(def.white == 0xffffff && def.ink == 0x24231f)
        #expect(def.pivotHead == rawPoint((raw["pivot"] as! [String: Any])["head"]).fig && def.pivotEyes == rawPoint((raw["pivot"] as! [String: Any])["eyes"]).fig)
        for s in six {
            #expect(def.stateName(s) == s)
            #expect(def.face(s).eyes.count == (rawState(s)["eyes"] as! [Any]).count && def.face(s).pupils.count == (rawState(s)["pupils"] as! [Any]).count, "\(s)")
        }
        #expect(def.chief == Outfit(hat: .named("top-hat")))
        // Every kit hat can be drawn by this app, each as many shapes as the file gives it.
        #expect(rawHats.count >= 20)
        for (name, piece) in rawHats {
            #expect(def.hat(Outfit(hat: .named(name)))?.shapes.count == ((piece as! [String: Any])["shapes"] as! [Any]).count, "\(name)")
        }
        // The small mark is the part of the box the file says.
        let view = ((raw["small"] as! [String: Any])["view"] as! [NSNumber]).map(\.doubleValue)
        #expect([def.smallAt.x, def.smallAt.y, def.smallSize.x, def.smallSize.y] == view)
    }

    @Test func aDefinitionOfAnotherVersionOrABrokenOneIsRefused() {
        let refused: [(String, Data)] = [
            ("the stick figure's version", changed { $0["version"] = 1 }),
            ("a version of the future", changed { $0["version"] = 3 }),
            ("no head", changed { $0["head"] = nil }),
            ("a head without a size", changed { $0["head"] = ["cx": 12, "cy": 16.5, "r": 0] }),
            ("tones that are not colours", changed { $0["tones"] = ["white": "white", "ink": "#24231f"] }),
            ("no pivot", changed { $0["pivot"] = ["head": [12, 16.5]] }),
            ("a default that is no state", changed { $0["default"] = "dancing" }),
            ("a hat with no place", changed { $0["attach"] = ["hat": ["at": [12, 9]]] }),
            ("a face with a shape it doesn't know", changed(state: "idle") { $0["eyes"] = [["shape": "star", "fill": "white"]] }),
            ("a face in a tone it doesn't know", changed(state: "idle") { $0["pupils"] = [["shape": "circle", "cx": 1, "cy": 1, "r": 1, "fill": "ink", "stroke": "gold", "width": 1]] }),
            ("a state without a face", changed(state: "idle") { $0["pupils"] = nil }),
            ("a pose that scales the head", changed(state: "idle") { $0["pose"] = ["head": ["scale": [1, 2]]] }),
            ("a pose that turns the eyes", changed(state: "idle") { $0["pose"] = ["eyes": ["turn": 3]] }),
            ("a move that is not one", changed(state: "idle") { $0["move"] = "blink" }),
            ("an easing it doesn't know", changed(state: "idle") { var m = $0["move"] as! [String: Any]; m["easing"] = "bounce"; $0["move"] = m }),
            ("a loop that jumps", changed(state: "working") { var m = $0["move"] as! [String: Any]; m["keys"] = [["at": 0], ["at": 1, "pupils": ["move": [1.1, 0]]]]; $0["move"] = m }),
            ("keys that go back", changed(state: "working") { var m = $0["move"] as! [String: Any]; m["keys"] = [["at": 0], ["at": 0.6], ["at": 0.5], ["at": 1]]; $0["move"] = m }),
            ("a small mark with no size", changed { $0["small"] = ["view": [0, 0, 0, 24]] }),
            ("not an object", Data("[]".utf8)),
            ("not JSON", Data("not json".utf8)),
        ]
        for (what, data) in refused { #expect(throws: FigureDef.Problem.self, "\(what)") { try FigureDef(json: data) } }
        // Keys it doesn't know are ignored, and a definition without a kit still draws heads, without hats.
        let bare = try? FigureDef(json: changed { $0["sparkles"] = ["a": 1]; $0["kit"] = nil; $0["chief"] = nil })
        #expect(bare != nil && bare?.hat(Outfit(hat: .named("cap"))) == nil && bare?.chief == nil)
        // What the web page takes for no movement, or for a pose that says nothing, is taken so here.
        for none: Any in [false, 0, "", NSNull()] {
            let still = try? FigureDef(json: changed(state: "working") { $0["move"] = none })
            #expect(still != nil && still?.move("working") == nil, "\(none)")
        }
        #expect((try? FigureDef(json: changed(state: "failed") { $0["pose"] = [Any]() }))?.pose("failed") == .rest)
        // A definition that doesn't say how the small mark looks shows the whole box.
        let old = try? FigureDef(json: changed { $0["box"] = [30, 20]; $0["small"] = nil })
        #expect(old?.smallAt == FigureDef.Point(x: 0, y: 0) && old?.smallSize == FigureDef.Point(x: 30, y: 20))
    }

    /// The table the web page and Android are checked against too (test/fixtures/figure-cases.json).
    @Test func theDefinitionsEveryAppMustTakeAlikeAreTakenSoHere() throws {
        let table = try JSONSerialization.jsonObject(with: Data(contentsOf: TestServer.repo.appending(path: "test/fixtures/figure-cases.json"))) as! [String: Any]
        let cases = table["cases"] as! [[String: Any]]
        #expect(cases.count >= 15)
        for c in cases {
            let what = c["what"] as! String
            let data = changed { d in
                var states = d["states"] as! [String: Any]
                states["extra"] = c["state"]
                d["states"] = states
            }
            guard c["accepted"] as! Bool else {
                #expect(throws: FigureDef.Problem.self, "\(what)") { try FigureDef(json: data) }
                continue
            }
            let read = try? FigureDef(json: data)
            #expect(read != nil, "\(what)")
            #expect((read?.move("extra") != nil) == (c["moves"] as! Bool), "\(what)")
        }
    }

    // MARK: Faces

    @Test func eachStateShowsTheDefinitionsFaceInItsStillPose() {
        for s in six {
            let root = layers(s, side: 48, still: true)
            let pose = rawState(s)["pose"]
            let (head, eyes, pupils) = (find("l-head", in: root)!, find("l-eyes", in: root)!, find("l-pupils", in: root)!)
            // One inside the other, and the head's circle, the face, then nothing else (no hat).
            #expect(find("l-eyes", in: head) === eyes && find("l-pupils", in: eyes) === pupils)
            #expect(marks(head).count == 1 && marks(head)[0].fillColor == look().main, "\(s): the head, in the bot's colour")
            #expect(near(marks(head)[0].path!.boundingBoxOfPath, CGRect(x: 9, y: 18, width: 30, height: 30)), "\(s): the head's circle")
            #expect(marks(eyes).count == (rawState(s)["eyes"] as! [Any]).count && marks(pupils).count == (rawState(s)["pupils"] as! [Any]).count, "\(s): its face")
            #expect(find("hat", in: root) == nil)
            // Where a point of each layer lands, by the layers and by the definition's own arithmetic.
            let p = CGPoint(x: 8.8, y: 17.1)
            let at = CGPoint(x: p.x * 2, y: p.y * 2)
            for (layer, through) in [(pupils, ["pupils", "eyes", "head"]), (eyes, ["eyes", "head"]), (head, ["head"])] {
                let want = placed(p, through: through, pose: pose)
                #expect(near(find("in", in: layer)!.convert(at, to: root), CGPoint(x: want.x * 2, y: want.y * 2)), "\(s) \(through[0])")
            }
            #expect(all(root).allSatisfy { $0.animationKeys() == nil }, "\(s) stands still")
            #expect(root.opacity == Float((rawState(s)["opacity"] as? NSNumber)?.doubleValue ?? 1))
        }
        #expect(layers("paused").opacity == 0.4 && layers("paused").allowsGroupOpacity)
        // The six faces differ in what is drawn, not only in where a pupil is.
        let drawn = six.map { s in marks(find("l-eyes", in: layers(s, still: true))).map { "\($0.path!.boundingBoxOfPath) \($0.fillColor == nil) \($0.lineWidth)" }.joined(separator: "|") }
        #expect(Set(drawn).count == 6)
    }

    @Test func theFaceIsDrawnInTheDefinitionsWhiteAndInkWithRoundEnds() {
        // Idle: two white eyes, two ink pupils.
        let idle = layers("idle", side: 48, still: true)
        let eyes = marks(find("l-eyes", in: idle))
        #expect(eyes.allSatisfy { rgb($0.fillColor) == [255, 255, 255] && $0.strokeColor == nil })
        #expect(near(eyes[0].path!.boundingBoxOfPath, CGRect(x: (8.8 - 2.2) * 2, y: (17.1 - 2.2) * 2, width: 8.8, height: 8.8)))
        #expect(marks(find("l-pupils", in: idle)).allSatisfy { rgb($0.fillColor) == [0x24, 0x23, 0x1f] })
        // Failed: four ink lines, 1.5 wide in the box, twice that at twice the size.
        let crosses = marks(find("l-eyes", in: layers("failed", side: 48, still: true)))
        #expect(crosses.count == 4 && crosses.allSatisfy { $0.fillColor == nil && rgb($0.strokeColor) == [0x24, 0x23, 0x1f] && near($0.lineWidth, 3) && $0.lineCap == .round && $0.lineJoin == .round })
        // Working: its brows are lines over the eyes.
        let working = marks(find("l-eyes", in: layers("working", still: true)))
        #expect(working.filter { $0.strokeColor != nil }.count == 2 && working.filter { $0.fillColor != nil }.count == 2)
    }

    @Test func aMovementIsTheDefinitionsKeysPlayedByTheSystem() {
        for s in six {
            let root = layers(s, side: 48)
            let keys = rawKeys(s)
            guard let move = rawState(s)["move"] as? [String: Any] else {
                #expect(all(root).allSatisfy { $0.animationKeys() == nil }, "\(s) has no movement")
                continue
            }
            let pose = rawState(s)["pose"]
            let pivots = raw["pivot"] as! [String: Any]
            var moving = 0
            for layer in ["head", "eyes", "pupils"] {
                let l = find("l-\(layer)", in: root)!
                let pivot = layer == "pupils" ? .zero : rawPoint(pivots[layer])
                // Every value the keys give, against what the system was told to play: nothing for one that stays as it is.
                let moves = keys.map { said($0, over: pose, layer, "move").map(rawPoint) ?? .zero }.map { CGPoint(x: (pivot.x + $0.x) * 2, y: (pivot.y + $0.y) * 2) }
                let turns = keys.map { ((said($0, over: pose, layer, "turn") as? NSNumber)?.doubleValue ?? 0) * .pi / 180 }
                let scales = keys.map { said($0, over: pose, layer, "scale").map(rawPoint) ?? CGPoint(x: 1, y: 1) }
                var played: [CAKeyframeAnimation] = []
                func check<V: Equatable>(_ keyPath: String, _ want: [V], _ same: (V, V) -> Bool) {
                    let a = keyframes(l, keyPath)
                    if want.allSatisfy({ $0 == want[0] }) { #expect(a == nil, "\(s) \(layer) \(keyPath) stays as it is"); return }
                    let got = a?.values as? [V] ?? []
                    #expect(got.count == want.count && zip(got, want).allSatisfy(same), "\(s) \(layer) \(keyPath): \(got)")
                    if let a { played.append(a) }
                }
                check("position", moves) { self.near($0, $1) }
                check("transform.rotation.z", turns) { self.near($0, $1) }
                check("transform.scale.x", scales.map { Double($0.x) }) { self.near($0, $1) }
                check("transform.scale.y", scales.map { Double($0.y) }) { self.near($0, $1) }
                #expect(Set(l.animationKeys() ?? []).count == played.count, "\(s) \(layer): nothing else is played")
                for a in played {
                    moving += 1
                    #expect(a.keyTimes?.map(\.doubleValue) == keys.map { ($0["at"] as! NSNumber).doubleValue })
                    #expect(a.duration == (move["seconds"] as! NSNumber).doubleValue)
                    #expect(a.repeatCount == .infinity && a.isRemovedOnCompletion == false && a.calculationMode == .linear)
                    // The browser's ease-in-out, between each pair of keys.
                    #expect(a.timingFunctions?.count == keys.count - 1)
                    var c: [Float] = [0, 0]
                    a.timingFunctions?.first?.getControlPoint(at: 1, values: &c)
                    #expect(c == [0.42, 0])
                    a.timingFunctions?.first?.getControlPoint(at: 2, values: &c)
                    #expect(c == [0.58, 1])
                    // In step with the clock: it began a whole number of loops ago.
                    let loops = a.beginTime / a.duration
                    #expect(near(loops, loops.rounded()) && a.beginTime <= 1000.25 && 1000.25 - a.beginTime < a.duration)
                }
            }
            #expect(moving > 0, "\(s) moves")
            // Only the three layers move: no shape is drawn again while they do.
            #expect(all(root).filter { $0.animationKeys() != nil }.allSatisfy { ["l-head", "l-eyes", "l-pupils"].contains($0.name ?? "") })
        }
        // What moves in each state, as ADR 003 lists it.
        func playing(_ s: String) -> [String] {
            let root = layers(s)
            return ["head", "eyes", "pupils"].flatMap { layer in (find("l-\(layer)", in: root)!.animationKeys() ?? []).sorted().map { "\(layer) \($0)" } }
        }
        #expect(playing("idle") == ["eyes transform.scale.y"])            // a blink
        #expect(playing("working") == ["pupils position"])                // the pupils go from side to side
        #expect(playing("waiting") == ["pupils position"])                // a glance down
        #expect(playing("needs_you") == ["head position"])                // the head bobs
        #expect(playing("failed") == ["head transform.rotation.z"])       // the tilt sways
        #expect(playing("paused") == [] && def.move("paused") == nil)
        // A linear movement is played linear.
        let linear = try! FigureDef(json: changed(state: "working") { var m = $0["move"] as! [String: Any]; m["easing"] = "linear"; $0["move"] = m })
        var c: [Float] = [9, 9]
        keyframes(find("l-pupils", in: layers("working", def: linear)), "position")?.timingFunctions?.first?.getControlPoint(at: 1, values: &c)
        #expect(c == [0, 0])
    }

    @Test func withReduceMotionNothingMovesAndEachStateKeepsItsFace() {
        for s in six {
            let (still, moving) = (layers(s, still: true), layers(s))
            #expect(all(still).allSatisfy { $0.animationKeys() == nil }, "\(s)")
            // The same layers in the same places as the moving head has under its movement.
            for name in ["l-head", "l-eyes", "l-pupils"] {
                let (a, b) = (find(name, in: still)!, find(name, in: moving)!)
                #expect(near(a.position, b.position) && CATransform3DEqualToTransform(a.transform, b.transform), "\(s) \(name)")
                #expect(marks(a).count == marks(b).count)
            }
            #expect(still.opacity == moving.opacity)
        }
    }

    @Test func aStateTheDefinitionDoesNotKnowIsIdle() {
        #expect(def.stateName("dancing") == "idle" && def.stateName(nil) == "idle" && def.stateName("") == "idle")
        for unknown in ["dancing", nil] as [String?] {
            let (got, idle) = (layers(unknown), layers("idle"))
            #expect(marks(find("l-eyes", in: got)).map { $0.path!.boundingBoxOfPath } == marks(find("l-eyes", in: idle)).map { $0.path!.boundingBoxOfPath })
            #expect(find("l-eyes", in: got)!.animationKeys() == ["transform.scale.y"] && got.opacity == 1)
        }
    }

    // MARK: Hats

    @Test func aHatIsDrawnInTwoTonesOverTheFaceAndMovesWithTheHead() throws {
        let root = layers("failed", outfit: Outfit(hat: .named("top-hat")), side: 48)
        let head = find("l-head", in: root)!
        let hat = try #require(find("hat", in: root))
        // Inside the head's layer, after the face: it lies over the eyes and turns and bobs with the head.
        let inside = find("in", in: head)!
        #expect(hat.superlayer === inside && inside.sublayers?.last === hat)
        #expect(inside.sublayers?.map { $0.name ?? "mark" } == ["mark", "l-eyes", "hat"])
        // attach.hat: the origin of the hat's box (5, 3.5) on (12, 9), the box 2.6 times as large.
        // The top hat's crown is the rect x 3.1, y 0.2, 3.8 by 4, in the deep tone; its band is the main tone.
        let shapes = (hat.sublayers ?? []).compactMap { $0 as? CAShapeLayer }
        #expect(shapes.count == 3 && shapes[0].fillColor == look().deep && shapes[2].fillColor == look().main)
        let crown = hat.convert(shapes[0].path!.boundingBoxOfPath, to: inside)
        #expect(near(crown, CGRect(x: (12 + 2.6 * (3.1 - 5)) * 2, y: (9 + 2.6 * (0.2 - 3.5)) * 2, width: 3.8 * 2.6 * 2, height: 4 * 2.6 * 2), 1e-4))
        #expect(hat.animationKeys() == nil && all(hat).allSatisfy { $0.animationKeys() == nil })
        // A stroked hat's lines grow with it: the cowboy's brim is 1.1 wide in its box.
        let brim = (find("hat", in: layers("idle", outfit: Outfit(hat: .named("cowboy")), side: 48))!.sublayers as! [CAShapeLayer])[1]
        #expect(brim.strokeColor == look().deep && brim.fillColor == nil && near(brim.lineWidth, 1.1 * 2.6 * 2))
        // Nothing clips it: a hat may reach past the mark's own square.
        #expect(all(root).allSatisfy { !$0.masksToBounds && $0.mask == nil })
    }

    @Test func aHatTheAppCannotDrawIsSkippedAndTheHeadIsDrawn() {
        func hatless(_ o: Outfit?, _ what: String) {
            let root = layers("working", outfit: o)
            #expect(find("hat", in: root) == nil, "\(what)")
            #expect(marks(find("l-head", in: root)).count == 1 && marks(find("l-eyes", in: root)).count == 4, "\(what): the head and its face")
        }
        hatless(nil, "no outfit")
        hatless(Outfit(), "no hat, on purpose")
        hatless(Outfit(hat: .named("sombrero")), "a hat the kit lacks")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"star","fill":"main"}]}}"#), "a shape it doesn't know")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":2,"fill":"main"},{"shape":"circle","cx":5,"cy":3,"r":1,"fill":"gold"}]}}"#), "a tone it doesn't know: whole or not at all")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":2,"fill":"white"}]}}"#), "a hat is in the bot's two tones only")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":2,"fill":"main","stroke":"ink","width":1}]}}"#), "one tone known and one not")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"line","x1":1,"y1":1,"x2":2,"y2":2,"stroke":"main"}]}}"#), "a line without a width")
        hatless(outfit(#"{"hat":{"shapes":[{"shape":"path","d":[["M",1,1],["A",2,2]],"fill":"main"}]}}"#), "a path command it doesn't know")
        hatless(outfit(#"{"hat":{"lines":[]}}"#), "no shapes")
        hatless(outfit(#"{"hat":7}"#), "not a hat")
    }

    @Test func aHatTheChiefDrewIsDrawnShapeForShape() throws {
        let drawn = try #require(outfit(#"""
            {"hat":{"shapes":[
              {"shape":"rect","x":1,"y":2,"w":8,"h":2,"r":5,"fill":"deep"},
              {"shape":"circle","cx":5,"cy":1.5,"r":1,"fill":"main","stroke":"deep","width":0.8},
              {"shape":"line","x1":2,"y1":5,"x2":8,"y2":5,"stroke":"main","width":1},
              {"shape":"path","d":[["M",2,4],["L",8,4],["Q",9,5,8,6],["C",7,7,3,7,2,6],["Z"]],"fill":"main"},
              {"shape":"rect","x":4,"y":0,"w":2,"h":1,"fill":"main"}
            ]}}
            """#))
        let hat = try #require(find("hat", in: layers("idle", outfit: drawn, side: 24)))
        let shapes = hat.sublayers as! [CAShapeLayer]
        #expect(shapes.count == 5)
        // The hat's own corner (0, 0) is at (12 − 2.6 × 5, 9 − 2.6 × 3.5); its shapes are 2.6 times as large.
        #expect(near(hat.position, CGPoint(x: 12 - 13, y: 9 - 9.1)))
        func box(_ i: Int) -> CGRect { shapes[i].path!.boundingBoxOfPath }
        #expect(near(box(0), CGRect(x: 2.6, y: 5.2, width: 20.8, height: 5.2), 1e-4), "a rect, its corners rounded by at most half of each side")
        #expect(shapes[0].fillColor == look().deep && shapes[0].strokeColor == nil)
        #expect(near(box(1), CGRect(x: 10.4, y: 1.3, width: 5.2, height: 5.2), 1e-4) && shapes[1].fillColor == look().main && shapes[1].strokeColor == look().deep && near(shapes[1].lineWidth, 0.8 * 2.6))
        #expect(near(box(2), CGRect(x: 5.2, y: 13, width: 15.6, height: 0), 1e-4) && shapes[2].fillColor == nil && near(shapes[2].lineWidth, 2.6))
        #expect(near(box(3).origin, CGPoint(x: 5.2, y: 10.4), 1e-4) && near(box(3).maxY, 6.75 * 2.6, 1e-4))
        #expect(near(box(4), CGRect(x: 10.4, y: 0, width: 5.2, height: 2.6), 1e-4))
        // The same hat by name and given inline are drawn alike.
        let cap = (raw["kit"] as! [String: Any])["hat"] as! [String: Any]
        let inline = try JSONSerialization.data(withJSONObject: ["hat": (cap["pieces"] as! [String: Any])["cap"]])
        let given = try JSONDecoder().decode(Outfit.self, from: inline)
        #expect(def.hat(given) == def.hat(Outfit(hat: .named("cap"))))
        // A rectangle rounded more than half its side is rounded as far as SVG rounds it: an ellipse here.
        let pill = FigureLayers.outline(.rect(x: 0, y: 0, w: 8, h: 2, r: 5), 1)
        #expect(near(pill.boundingBoxOfPath, CGRect(x: 0, y: 0, width: 8, height: 2)) && !pill.contains(CGPoint(x: 0.3, y: 0.3)) && pill.contains(CGPoint(x: 4, y: 0.1)))
        // What shows nothing on the web page shows nothing here.
        #expect(FigureLayers.outline(.rect(x: 0, y: 0, w: 0, h: 2, r: 0), 1).isEmpty && FigureLayers.outline(.rect(x: 0, y: 0, w: 2, h: 2, r: -1), 1).isEmpty)
        #expect(FigureLayers.outline(.circle(cx: 1, cy: 1, r: 0), 1).isEmpty)
        #expect(def.hat(outfit(#"{"hat":{"shapes":[{"shape":"path","d":[["L",8,4],["Z"]],"fill":"main"}]}}"#))?.shapes.first?.kind == .path([]))
    }

    @Test func theDeepToneIsTheColourMixedTowardsTheTextColour() {
        #expect(FigureDef.deep(0x378add, dark: false) == 0x1e4c7a)
        #expect(FigureDef.deep(0x378add, dark: true) == 0x91bfec)
        #expect(FigureDef.rgb("#378add") == 0x378add && FigureDef.rgb(nil) == FigureDef.grey && FigureDef.rgb("blue") == FigureDef.grey)
    }

    // MARK: Without a definition

    @Test func withoutADefinitionEveryBotIsOneBareHead() {
        for state in six {
            let root = FigureLayers.figure(nil, state: state, outfit: Outfit(hat: .named("cap")), look: look(side: 48))
            // ADR 003's numbers: the head, two white eyes, two ink pupils, looking ahead. No state, no movement, no hat.
            let head = marks(find("l-head", in: root))
            #expect(head.count == 1 && near(head[0].path!.boundingBoxOfPath, CGRect(x: 9, y: 18, width: 30, height: 30)) && head[0].fillColor == look().main)
            let eyes = marks(find("l-eyes", in: root))
            #expect(eyes.count == 2 && near(eyes[0].path!.boundingBoxOfPath.midX, 17.6) && near(eyes[1].path!.boundingBoxOfPath.midX, 30.4))
            #expect(eyes.allSatisfy { near($0.path!.boundingBoxOfPath.width, 8.8) && near($0.path!.boundingBoxOfPath.midY, 34.2) && rgb($0.fillColor) == [255, 255, 255] })
            let pupils = marks(find("l-pupils", in: root))
            #expect(pupils.count == 2 && pupils.allSatisfy { near($0.path!.boundingBoxOfPath.width, 4.8) && rgb($0.fillColor) == [0x24, 0x23, 0x1f] })
            #expect(find("hat", in: root) == nil && root.opacity == 1, "\(state)")
            #expect(all(root).allSatisfy { $0.animationKeys() == nil && CATransform3DIsIdentity($0.transform) }, "\(state)")
        }
        #expect(FigureDef.bare.chief == nil && FigureDef.bare.move("idle") == nil && FigureDef.bare.stateName("failed") == "plain")
        // The small mark without a definition: the bare head's circle.
        let small = FigureLayers.small(nil, outfit: Outfit(hat: .named("cap")), look: look(side: 24))
        #expect(all(small).compactMap { $0 as? CAShapeLayer }.count == 1 && small.frame.size == CGSize(width: 24, height: 24))
    }

    // MARK: The small mark

    @Test func theSmallMarkIsTheHeadWithItsHatWithoutEyesAndNeverMoves() throws {
        let hatted = FigureLayers.small(def, outfit: Outfit(hat: .named("top-hat")), look: look(side: 48))
        #expect(near(hatted.frame.width, 48 * def.smallAspect) && near(hatted.frame.height, 48))
        #expect(find("l-eyes", in: hatted) == nil && find("l-pupils", in: hatted) == nil, "no eyes")
        #expect(marks(find("l-head", in: hatted)).count == 1 && marks(find("l-head", in: hatted))[0].fillColor == look().main)
        // The hat sits as on the avatar.
        let avatar = layers("idle", outfit: Outfit(hat: .named("top-hat")), side: 48, still: true)
        let (a, b) = (try #require(find("hat", in: hatted)), try #require(find("hat", in: avatar)))
        #expect(near(a.convert(CGPoint.zero, to: hatted), b.convert(CGPoint.zero, to: avatar)) && a.sublayers?.count == b.sublayers?.count)
        // No state, no fade, no movement: also with motion allowed.
        #expect(hatted.opacity == 1 && all(hatted).allSatisfy { $0.animationKeys() == nil && CATransform3DIsIdentity($0.transform) })
        // A bot without a hat: its bare head's circle.
        #expect(all(FigureLayers.small(def, look: look(side: 48))).compactMap { $0 as? CAShapeLayer }.count == 1)
        // Only the part `view` of the box fills the mark: its corner at the mark's corner.
        let told = try FigureDef(json: changed { $0["small"] = ["view": [6, 2, 12, 20]] })
        let part = FigureLayers.small(told, look: look(side: 40))
        #expect(near(part.frame.width, 24) && near(find("box", in: part)!.position, CGPoint(x: -12, y: -4)))
    }

    // MARK: From the server

    @Test func aBotsOutfitComesWithTheBot() throws {
        func bot(_ outfit: String?) throws -> Bot {
            try JSONDecoder().decode(Bot.self, from: Data(#"{"id":"b1","name":"Mail"\#(outfit.map { #","outfit":\#($0)"# } ?? "")}"#.utf8))
        }
        #expect(try bot(nil).outfit == nil)                       // an older server
        #expect(try bot("null").outfit == nil)                    // never given one
        #expect(try bot(#"{"hat":""}"#).outfit == Outfit())        // no hat, on purpose
        #expect(try bot(#"{"hat":"cap"}"#).outfit == Outfit(hat: .named("cap")))
        // A bot that still carries a held object decodes, and is drawn without it.
        let held = try bot(#"{"hat":"cap","holds":"envelope"}"#).outfit
        #expect(held == Outfit(hat: .named("cap")))
        #expect(try bot(#"{"hat":"","holds":"envelope"}"#).outfit == Outfit() && bot(#"{"holds":{"shapes":[]}}"#).outfit == Outfit())
        let root = layers("idle", outfit: held)
        #expect(all(root).compactMap(\.name).sorted() == ["box", "fig", "hat", "in", "in", "in", "l-eyes", "l-head", "l-pupils"])
        let drawn = try bot(#"{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":2,"fill":"main"}]}}"#).outfit
        #expect(def.hat(drawn)?.shapes.count == 1)
        // Something this app has never seen in its place doesn't lose the bot.
        #expect(try bot(#""fancy""#).outfit == Outfit() && bot("[1,2]").outfit == Outfit())
    }

    @Test func theServersDefinitionIsUsedInPlaceOfTheBundledCopyAndAChangedHatArrivesLive() async throws {
        let server = try TestServer()
        let dressed = try await server.api("bots", method: "POST", body: ["name": "Mail", "emoji": "🧪", "prompt": "Do the test task.", "color": "#ef9f27", "outfit": ["hat": "cap"]]) as? [String: Any]
        let mail = dressed?["id"] as? String ?? ""
        let plain = try await server.makeBot("Writer")
        let store = Store()
        store.bundledFigure = def
        #expect(store.figure == def) // before any server: the copy the app was built with

        try await store.connect(to: server.base.absoluteString)
        let fromServer = try #require(store.serverFigure)
        #expect(store.figure == fromServer && fromServer != def)
        #expect(fromServer.chief == def.chief && fromServer.stateName("waiting") == "waiting")
        #expect(store.bots.first { $0.id == mail }?.outfit == Outfit(hat: .named("cap")))
        #expect(store.bots.first { $0.id == plain }?.outfit == nil)

        // The Chief gives Writer a hat: it shows without connecting again.
        try await server.api("bots/\(plain)", method: "PUT", body: ["outfit": ["hat": "beret"]], asChief: true)
        try await eventually("Writer's hat") { store.bots.first { $0.id == plain }?.outfit == Outfit(hat: .named("beret")) }
        #expect(store.figure!.hat(store.bots.first { $0.id == plain }?.outfit) != nil)

        // Beside a name in text: a bot as it looks now, whatever colour a saved message carries; the
        // colour the server sent for a bot that is gone, grey without one; the Chief in its fixed hat.
        #expect(store.mark(Who(id: mail, name: "Mail", color: "#000000")) == BotMark(rgb: 0xef9f27, outfit: Outfit(hat: .named("cap"))))
        #expect(store.mark(Who(id: plain, name: "Writer", color: nil)).outfit == Outfit(hat: .named("beret")))
        #expect(store.mark(Who(id: "gone", name: "Gone", color: "#378add")) == BotMark(rgb: 0x378add))
        #expect(store.mark(Who(id: "gone", name: "Gone", color: nil)) == BotMark(rgb: FigureDef.grey) && store.mark(nil) == BotMark(rgb: FigureDef.grey))
        #expect(store.mark(.chief) == BotMark(rgb: 0xd85a30, outfit: Outfit(hat: .named("top-hat"))))
        #expect(store.mark(Who(id: "chief", name: nil, color: nil)) == store.mark(.chief))

        // Reading everything again doesn't fetch the same server's definition a second time.
        await store.reloadAll()
        #expect(store.figure == fromServer)
        store.disconnect()
        #expect(store.figure == def)
        // A definition this app can't use (ADR 003) leaves the copy it was built with; with no copy at all, bare heads.
        #expect(Store.usable(changed { $0["version"] = 3 }) == nil && Store.usable(Figure.text) != nil)
        store.bundledFigure = nil
        #expect(store.figure == nil)
    }

    @Test func aDefinitionThatDidNotArriveAfterAServerUpdateIsAskedForAgainOnTheNextReload() async throws {
        let server = try TestServer()
        let store = Store()
        store.bundledFigure = def
        try await store.connect(to: server.base.absoluteString)
        let fromServer = try #require(store.serverFigure)
        let asked = try #require(store.figureAsked)

        // The server was updated (the definition was asked of another version), and the one try to
        // fetch the new definition fails.
        let older = "\(server.base.absoluteString) an older version"
        store.figureAsked = older
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Fails.self]
        store.api = API(base: server.base, session: URLSession(configuration: config))
        Fails.next("/api/figure", 1)
        await store.loadFigure()
        #expect(Fails.left("/api/figure") == 0, "the fetch was tried and failed")
        #expect(store.figure == fromServer, "meanwhile the app keeps the definition it has")
        #expect(store.figureAsked == nil, "nothing counts as asked of this version")

        // The next reload asks again, and from then on no more.
        await store.reloadAll()
        let again = try #require(store.serverFigure)
        #expect(store.figureAsked == asked && again != fromServer, "read anew from the server") // a definition equals only itself
        Fails.next("/api/figure", 1)
        await store.reloadAll()
        #expect(Fails.left("/api/figure") == 1 && store.serverFigure == again, "what arrived is not fetched again")
        Fails.next("/api/figure", 0)

        // The same when the server doesn't even say which version it is.
        store.figureAsked = older
        Fails.next("/api/version", 1)
        await store.loadFigure()
        #expect(Fails.left("/api/version") == 0 && store.figureAsked == nil && store.serverFigure == again)
        await store.reloadAll()
        #expect(store.figureAsked == asked && store.serverFigure != again)
        store.disconnect()
    }
}

/// Fails the next requests for a path of the API, as a server that is restarting does; everything
/// else goes to the server.
private final class Fails: URLProtocol, @unchecked Sendable {
    private static let counts = OSAllocatedUnfairLock(initialState: [String: Int]())
    static func next(_ path: String, _ times: Int) { counts.withLock { $0[path] = times } }
    static func left(_ path: String) -> Int { counts.withLock { $0[path] ?? 0 } }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let path = request.url?.path else { return false }
        return counts.withLock { all in
            guard let n = all[path], n > 0 else { return false }
            all[path] = n - 1
            return true
        }
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)) }
    override func stopLoading() {}
}

private extension CGPoint {
    var fig: FigureDef.Point { FigureDef.Point(x: x, y: y) }
}
