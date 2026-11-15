import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// A bot's chat on the iPhone: its replies' Markdown is read by the shared layer as on Android and drawn, and a
/// message that failed comes back into the box in front of what was typed since.
@MainActor
final class ChatTests: XCTestCase {
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
}
