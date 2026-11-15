import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// A bot's chat on the iPhone: its replies' Markdown is read by the shared layer as on Android and drawn, and a
/// message that failed comes back into the box in front of what was typed since.
@MainActor
final class ChatTests: XCTestCase {
    /// A reply's files: its picture drawn as itself, its other file a chip that opens it in the viewer.
    func testAReplysFilesOpenInTheViewerAndItsPicturesShow() {
        let photo = Attachment(name: "chart.png", file: "run-1/chart.png", size: 0, readable: nil)
        let report = Attachment(name: "report.pdf", file: "run-1/report.pdf", size: 0, readable: nil)
        XCTAssertEqual(ReplyFiles.shared.pictures(files: [photo, report]), [photo])
        let opening = ReplyFiles.shared.opening(f: report, from: "Scout")
        XCTAssertEqual(opening.src, "/files/run-1/report.pdf")
        let renderer = ImageRenderer(content: ReplyFilesView(files: [photo, report])
            .replyFiles(api: unreachableApi(), from: "Scout", opening: .constant(nil)).frame(width: 300))
        XCTAssertNotNil(renderer.cgImage)
    }

    func testAReplysMarkdownIsReadAsOnAndroidAndDrawn() {
        let reply = "# Good morning\n\n1. **Rail strike** called off\n- [x] done\n\n> quoted\n\n```\ncode\n```"
        let blocks = MarkdownKt.parseBlocks(src: reply)
        XCTAssertEqual(blocks.count, 5)
        let renderer = ImageRenderer(content: MarkdownView(text: reply).frame(width: 300))
        XCTAssertNotNil(renderer.cgImage, "every kind of block draws")
    }

    func testAFailedMessageComesBackInFrontOfWhatWasTypedSince() {
        XCTAssertEqual(OutboxKt.withFailed(failed: "Remind me in March", typedSince: ""), "Remind me in March")
        XCTAssertEqual(OutboxKt.withFailed(failed: "Remind me in March", typedSince: "and April"), "Remind me in March\nand April")
        XCTAssertEqual(OutboxKt.withFailed(failed: "", typedSince: "and April"), "and April")
    }

    /// "Reply to this task": the chip above the box says what the next message replies to, and draws.
    func testTheReplyChipDraws() {
        XCTAssertNotNil(ImageRenderer(content: ReplyChip(text: "Reply to: Plan my week", onClear: {}).frame(width: 360)).cgImage)
    }

    /// Quote: the same words quoted twice come twice; the box takes them as Markdown after what is typed.
    func testAQuoteGoesIntoTheBoxAfterWhatIsTyped() {
        let inbox = QuoteInbox()
        inbox.quote("Ship it")
        inbox.quote("Ship it")
        XCTAssertEqual(inbox.quoted?.count, 2)
        XCTAssertEqual(Quote.shared.add(draft: "Yes", selected: "Ship it")?.text, "Yes\n\n> Ship it\n\n")
    }

    /// A bot's chat and the Chief's offer "@" (MentionBox); the group's box offers none yet.
    func testTheBotAndChiefBoxesOfferMentions() {
        let home = HomeStore(api: unreachableApi())
        XCTAssertNotNil(ChatModel(home: home, botId: "b1").mentions)
        XCTAssertNotNil(ChiefModel(home: home).mentions)
    }

    /// The mention cursor: a cursor in the middle of the text is where the "@" is read, counted as the shared layer counts.
    func testTheMentionCursorIsWhereTheCaretIs() {
        let text = "Ask @we today 👋"
        let caret = text.index(text.startIndex, offsetBy: 7)
        XCTAssertEqual(Cursor.offset(of: TextSelection(insertionPoint: caret), in: text), 7)
        XCTAssertEqual(Cursor.offset(of: nil, in: text), text.utf16.count, "none known: the end")
        XCTAssertEqual(Cursor.offset(of: Cursor.at(15, in: text), in: text), 15)
        XCTAssertEqual(Cursor.offset(of: Cursor.at(99, in: text), in: text), text.utf16.count, "past the end: the end")
    }

    /// The plan dock: folded, open and stopped, each drawn; the fold kept in the app's defaults.
    func testThePlanDockIsDrawnFoldedOpenAndStopped() {
        let plan = Plan(steps: [Plan.Step(text: "Read", status: Plan.companion.DONE, doing: ""),
                                Plan.Step(text: "Write", status: Plan.companion.DOING, doing: "Writing"),
                                Plan.Step(text: "Send", status: Plan.companion.TODO, doing: "")])
        for (stopped, folded) in [(false, true), (false, false), (true, true)] {
            let dock = DockPlan(view: PlanView(plan: plan, stopped: stopped, id: "r1"), folded: folded)
            XCTAssertNotNil(ImageRenderer(content: ChatPlanDock(plan: dock, color: "#1d9e75").frame(width: 360)).cgImage)
        }
        let keep = PlanKeep()
        keep.write(key: "test", value: "a")
        XCTAssertEqual(keep.read(key: "test"), "a")
        UserDefaults.standard.removeObject(forKey: "plan.test")
    }

    /// Signed out (here, the account deleted): no picture of the account stays in the caches.
    func testSigningOutEmptiesTheReplyPictures() throws {
        let kept = ReplyPictures.cache.appendingPathComponent("0123456789abcdef")
        try FileManager.default.createDirectory(at: kept, withIntermediateDirectories: true)
        try Data("picture".utf8).write(to: kept.appendingPathComponent("run-1_chart.png"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let model = AppModel(directory: dir, sessions: KeychainSessions(service: "test-\(UUID().uuidString)"))
        model.accountDeleted("https://botdot.test", "Deleted")
        XCTAssertFalse(FileManager.default.fileExists(atPath: ReplyPictures.cache.path))
    }
}
