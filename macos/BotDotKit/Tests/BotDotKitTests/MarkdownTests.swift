import Foundation
import Testing
@testable import BotDotKit

/// A long reply is scannable: a reply is read into the blocks the web page and the Android app read
/// it into, by the rules they share (test/fixtures/markdown-cases.json; `mdBlocks` in public/app.js,
/// `parseBlocks` in the Android app's Markdown.kt), and its titles and lists are spaced as theirs.
@Suite struct MarkdownBlocks {
    struct Case { let name: String; let source: String; let blocks: [MarkdownBlock] }

    /// The cases of the shared fixture: each a text and its blocks.
    static func cases() throws -> [Case] {
        let file = TestServer.repo.appendingPathComponent("test/fixtures/markdown-cases.json")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        return try (json?["cases"] as? [[String: Any]] ?? []).map { c in
            Case(name: c["name"] as? String ?? "", source: c["source"] as? String ?? "", blocks: try (c["blocks"] as? [[String: Any]] ?? []).map(block))
        }
    }

    static func block(_ b: [String: Any]) throws -> MarkdownBlock {
        let text = b["text"] as? String ?? ""
        switch b["type"] as? String {
        case "heading": return .heading(level: b["level"] as? Int ?? 0, text: text)
        case "para": return .paragraph(text)
        case "item": return .item(text: text, number: b["number"] as? Int, depth: b["depth"] as? Int ?? 0)
        case "quote": return .quote(text)
        case "rule": return .rule
        case "code": return .code(text)
        case "table": return .table(b["rows"] as? [[String]] ?? [])
        default: throw NSError(domain: "MarkdownBlocks", code: 1, userInfo: [NSLocalizedDescriptionKey: "The fixture has a block the app does not know: \(b)"])
        }
    }

    @Test func everyCaseOfTheSharedFixtureIsReadIntoItsBlocks() throws {
        let cases = try Self.cases()
        #expect(cases.count >= 30)
        for c in cases {
            #expect(MarkdownBlock.parse(c.source) == c.blocks, "\(c.name)")
        }
    }

    @Test func headingsParagraphsAndLists() {
        #expect(MarkdownBlock.parse("# Title\nOne line\nand the next\n\n- a\n  - b\n2. two") == [
            .heading(level: 1, text: "Title"),
            .paragraph("One line\nand the next"),
            .item(text: "a", number: nil, depth: 0),
            .item(text: "b", number: nil, depth: 1),
            .item(text: "two", number: 2, depth: 0),
        ])
    }

    @Test func aBoldLineIsATitleAndRightUnderAListItemItStaysInTheItem() {
        #expect(MarkdownBlock.parse("**Host (pve)**\n- a") == [.heading(level: 3, text: "Host (pve)"), .item(text: "a", number: nil, depth: 0)])
        #expect(MarkdownBlock.parse("- b\n**Under b**\n- c") == [.item(text: "b\n**Under b**", number: nil, depth: 0), .item(text: "c", number: nil, depth: 0)])
        // After a blank line and not indented, it is a title again, and the list is over.
        #expect(MarkdownBlock.parse("- a\n\n**Next**\n- b") == [.item(text: "a", number: nil, depth: 0), .heading(level: 3, text: "Next"), .item(text: "b", number: nil, depth: 0)])
    }

    @Test func aNumberedListThatStartsAgainIsANewList() {
        func numbers(_ source: String) -> [Int?] {
            MarkdownBlock.parse(source).compactMap { if case .item(_, let n, _) = $0 { n } else { nil } }
        }
        // One list counts up from its first number, whatever is written.
        #expect(numbers("1. a\n1. b\n1. c") == [1, 2, 3])
        #expect(numbers("3. a\n4. b\n9. c") == [3, 4, 5])
        // A text, a title or a bullet between them: the next number is the one written.
        #expect(MarkdownBlock.parse("1. a\n2. b\n\nAfter.\n\n1. c").last == .item(text: "c", number: 1, depth: 0))
        #expect(numbers("1. a\n2. b\n## T\n1. c") == [1, 2, 1])
        #expect(numbers("1. a\n- b\n5. c") == [1, nil, 5])
        // A sub-list counts for itself, and starts again under the next item.
        #expect(numbers("1. a\n   1. x\n   1. y\n2. b\n   1. z") == [1, 1, 2, 2, 1])
    }

    @Test func codeIsKeptAsWritten() {
        #expect(MarkdownBlock.parse("```swift\nlet x = 1\n  # not a heading\n```") == [.code("let x = 1\n  # not a heading")])
    }

    @Test func tablesLeaveOutTheSeparatorRow() {
        #expect(MarkdownBlock.parse("| A | B |\n|---|:-:|\n| 1 | 2 |") == [.table([["A", "B"], ["1", "2"]])])
    }

    @Test func quotesAndRules() {
        #expect(MarkdownBlock.parse("> said\n---\nafter") == [.quote("said"), .rule, .paragraph("after")])
    }

    @Test func aReplyFromWindowsIsReadAsAnyOther() {
        #expect(MarkdownBlock.parse("# T\r\n- a\r\n- b\r") == [.heading(level: 1, text: "T"), .item(text: "a", number: nil, depth: 0), .item(text: "b", number: nil, depth: 0)])
    }

    @Test func aSubItemsTextStartsRightOfItsParentsText() {
        // Where an item's text starts: its indent, then the room of its marker.
        func textStart(_ depth: Int, _ numbered: Bool) -> Double { MarkdownBlock.itemIndent(depth) + MarkdownBlock.markerWidth(numbered: numbered) }
        for depth in 1...3 { for parent in [true, false] { for child in [true, false] {
            #expect(textStart(depth, child) > textStart(depth - 1, parent), "depth \(depth)")
        } } }
        #expect(MarkdownBlock.itemIndent(0) == 0)
    }

    @Test func aTitleIsLargerThanTheTextAndStandsOffFromWhatIsAboveIt() {
        // The web page's sizes (1.35, 1.2, 1.08 and 1 of the text), on the Mac's 14.5 points.
        #expect((1...6).map(MarkdownBlock.headingSize) == [19.5, 17.5, 15.5, 14.5, 14.5, 14.5])
        let title = MarkdownBlock.heading(level: 2, text: "Title"), text = MarkdownBlock.paragraph("Text")
        let item = MarkdownBlock.item(text: "a", number: nil, depth: 0), sub = MarkdownBlock.item(text: "b", number: nil, depth: 1)
        #expect(MarkdownBlock.gapAbove(nil, title) == 0)
        #expect(MarkdownBlock.gapAbove(text, title) == 16)
        #expect(MarkdownBlock.gapAbove(item, title) == 16)
        #expect(MarkdownBlock.gapAbove(item, sub) == 3)
        #expect(MarkdownBlock.gapAbove(title, text) == 7)
        #expect(MarkdownBlock.gapAbove(text, item) == 7)
        #expect(MarkdownBlock.gapAbove(item, text) == 7)
        #expect(MarkdownBlock.gapAbove(text, .rule) == 7)
    }
}
