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
}
