import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// The iPhone draws its bots from the definition every app draws from (lib/figure.json, ADR 003), and takes the
/// definitions every renderer must take alike (test/fixtures/figure-cases.json) as the web page and Android do.
@MainActor
final class FigureTests: XCTestCase {
    /// The repository, from this file's place in it (the simulator reads the Mac's files).
    private let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func text(_ path: String) throws -> String {
        try String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)
    }

    func testTheAppCarriesTheDefinitionAndDrawsFromIt() throws {
        let bundled = try XCTUnwrap(HomeModel.bundledFigure, "lib/figure.json is in the app")
        XCTAssertEqual(bundled.box.first?.floatValue, Figures.shared.parse(text: try text("lib/figure.json"))?.box.first?.floatValue)
        for state in ["idle", "working", "waiting", "needs_you", "failed", "paused"] {
            XCTAssertTrue(painted(FigurePaint.shared.figure(def: bundled, color: "#1d9e75", state: state, outfit: nil, dark: true)), state)
        }
        XCTAssertTrue(painted(FigurePaint.shared.small(def: bundled, color: nil, outfit: FigureDef.companion.CHIEF, dark: true)), "the Chief's small mark")
    }

    func testTheDefinitionsEveryAppMustTakeAlikeAreTakenSoHere() throws {
        let definition = try text("lib/figure.json")
        let table = try text("test/fixtures/figure-cases.json")
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(table.utf8)) as? [String: Any])["cases"] as? [[String: Any]]
        let states = rawStates(table)
        XCTAssertEqual(cases?.count, states.count)
        XCTAssertGreaterThanOrEqual(states.count, 15)
        for (c, raw) in zip(cases ?? [], states) {
            let what = c["what"] as? String ?? "?"
            // The state as the table writes it (0.0, 1e0 and -0 reach the app as they stand), as one more state.
            let top = "\n  \"states\": {" // the definition's own states, not the tile's
            let changed = definition.replacingOccurrences(of: top, with: top + " \"extra\": \(raw),", options: [], range: definition.range(of: top))
            let read = Figures.shared.parse(text: changed)
            guard c["accepted"] as? Bool == true else {
                XCTAssertNil(read, what)
                continue
            }
            let def = try XCTUnwrap(read, what)
            XCTAssertEqual(def.stateName(state: "extra"), "extra", what)
            XCTAssertEqual(def.nextMove(state: "extra", seconds: 0) != nil, c["moves"] as? Bool, what)
            XCTAssertTrue(painted(FigurePaint.shared.figure(def: def, color: "#378add", state: "extra", outfit: nil, dark: true)), what)
        }
    }

    /// Each case's "state" as it is written in the table, by the braces that hold it.
    private func rawStates(_ table: String) -> [String] {
        var out: [String] = []
        var rest = table[...]
        while let key = rest.range(of: "\"state\": ") {
            var depth = 0
            var end = key.upperBound
            for i in rest[key.upperBound...].indices {
                if rest[i] == "{" { depth += 1 }
                if rest[i] == "}" { depth -= 1; if depth == 0 { end = rest.index(after: i); break } }
            }
            out.append(String(rest[key.upperBound..<end]))
            rest = rest[end...]
        }
        return out
    }

    /// Whether painting [drawing] leaves something on a transparent canvas.
    private func painted(_ drawing: FigurePaint.Drawing) -> Bool {
        let renderer = ImageRenderer(content: FigureView(drawing: drawing).frame(width: 44, height: 44))
        renderer.scale = 1
        guard let image = renderer.cgImage, let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return false }
        let alpha = image.alphaInfo
        let alphaFirst = alpha == .premultipliedFirst || alpha == .first || alpha == .noneSkipFirst
        for i in stride(from: 0, to: CFDataGetLength(data), by: 4) where bytes[i + (alphaFirst ? 0 : 3)] > 0 {
            return true
        }
        return false
    }
}
