import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// A group's chat on the iPhone: its words are the shared layer's, as on Android, and a member's reply is drawn under
/// its name with its answer buttons, a tapped answer with its question above it.
@MainActor
final class GroupChatTests: XCTestCase {
    func testAMembersLineAndWhoIsNamedAreTheSharedLayersWords() {
        XCTAssertEqual(GroupChat.companion.workingWords(name: "Coder", line: nil, opening: "Running the tests"), "Coder · Running the tests…")
        XCTAssertEqual(GroupChat.companion.workingWords(name: "Coder", line: nil, opening: nil), "Coder · Working…")
        XCTAssertEqual(GroupChat.companion.namesList(names: ["Coder", "Reviewer", "Writer"]), "Coder, Reviewer and Writer")
    }

    func testAReplyAndATappedAnswerAreDrawn() throws {
        let page = GroupChatPage.companion.of(answer: """
        {"items":[
          {"type":"reply","id":"r1","at":"2026-11-14T09:01:00Z","run":{"id":"r1","botId":"b1","status":"success","result":"Ship it **now** or wait?","choices":["Now","Wait"],"yes":0,"startedAt":"2026-11-14T09:01:00Z"}},
          {"type":"message","id":"m2","text":"Now","at":"2026-11-14T09:03:00Z","question":{"runId":"r1","botId":"b1","botName":"Coder","text":"Ship it now or wait?"}}
        ],"more":false}
        """)
        XCTAssertEqual(page.items.count, 2)
        let reply = try XCTUnwrap(page.items[0] as? GroupItemReply)
        let message = try XCTUnwrap(page.items[1] as? GroupItemMessage)
        XCTAssertEqual(message.message.question?.text, "Ship it now or wait?")

        let view = GroupReplyView(id: reply.id, run: reply.run, bot: nil, name: "Coder", color: "#7f77dd", figureState: "idle", reply: reply.run.result, ended: nil, problem: false,
                                  files: [], choices: reply.run.choices ?? [], yes: 0)
        let figure = HomeModel.bundledFigure
        let drawn = ImageRenderer(content: GroupReplyRow(view: view, figure: figure, onAnswer: { _ in }).frame(width: 320))
        XCTAssertNotNil(drawn.cgImage, "a reply under its name, with its answer buttons, draws")

        let asked = GroupMessageView(message: message.message, question: message.message.question, questionColor: "#7f77dd", questionBot: nil,
                                     byName: nil, byColor: nil, byBot: nil, byOutfit: nil, waits: "")
        let answer = ImageRenderer(content: GroupMessageRow(view: asked, figure: figure, onQuestion: { _ in }).frame(width: 320))
        XCTAssertNotNil(answer.cgImage, "a tapped answer with its question above it draws")
    }
}
