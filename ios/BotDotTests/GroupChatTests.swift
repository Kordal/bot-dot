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
                                  files: [], choices: reply.run.choices ?? [], yes: 0, canDismiss: true, dismissed: false,
                                  questions: ["When?", "Where?"], questionChoices: [["Mon", "Tue"], []])
        let figure = HomeModel.bundledFigure
        let drawn = ImageRenderer(content: GroupReplyRow(view: view, figure: figure, onAnswer: { _ in }).frame(width: 320))
        XCTAssertNotNil(drawn.cgImage, "a reply under its name, with its answer buttons and its questions, draws")
        // The small × after the answers, put away, and Undo: both draw, and the shared layer reads the flag.
        let away = GroupReplyView(id: reply.id, run: reply.run, bot: nil, name: "Coder", color: "#7f77dd", figureState: "idle", reply: reply.run.result, ended: nil, problem: false,
                                  files: [], choices: reply.run.choices ?? [], yes: 0, canDismiss: true, dismissed: true,
                                  questions: [], questionChoices: [])
        XCTAssertNotNil(ImageRenderer(content: GroupReplyRow(view: away, figure: HomeModel.bundledFigure, onAnswer: { _ in }).frame(width: 320)).cgImage, "a reply whose answers were put away draws")
        XCTAssertNotNil(ImageRenderer(content: AnswersHidden {}.frame(width: 320)).cgImage, "Answers hidden · Undo draws")
        XCTAssertNotNil(ImageRenderer(content: Choices(choices: ["Yes", "No"], yes: 0, color: "#7f77dd", canDismiss: true, onAnswer: { _ in true }).frame(width: 320)).cgImage, "answers with the × after them draw")
        XCTAssertTrue(QuickAnswers.shared.away(put: [:], key: "r1", flag: true))

        let asked = GroupMessageView(message: message.message, question: message.message.question, questionColor: "#7f77dd", questionBot: nil,
                                     byName: nil, byColor: nil, byBot: nil, byOutfit: nil, waits: "")
        let answer = ImageRenderer(content: GroupMessageRow(view: asked, figure: figure, onQuestion: { _ in }).frame(width: 320))
        XCTAssertNotNil(answer.cgImage, "a tapped answer with its question above it draws")
    }

    func testAFoldAndAPlanDraw() {
        let figure = HomeModel.bundledFigure
        let fold = GroupFoldView(messageId: "m1", heads: [GroupFoldHead(bot: nil, color: "#7f77dd"), GroupFoldHead(bot: nil, color: "#d4537e")],
                                 words: "Coder and Reviewer · 2", open: false)
        XCTAssertNotNil(ImageRenderer(content: FoldRow(fold: fold, figure: figure) {}.frame(width: 320)).cgImage)
        let plan = GroupPlanView(name: "Coder", color: "#7f77dd", stepLine: "step 2 of 3", doneLine: "1 of 3", now: "Fixing the test",
                                 steps: [Plan.Step(text: "Read the issue", status: Plan.companion.DONE, doing: ""),
                                         Plan.Step(text: "Write the fix", status: Plan.companion.DOING, doing: "Fixing the test")])
        XCTAssertNotNil(ImageRenderer(content: PlanDock(plan: plan).frame(width: 360)).cgImage)
    }

    /// The "+" in a bot's chat and Home's search reach the shared rules: the picker's hint, a hit's line and snippet.
    func testGroupMakingAndSearchReachTheSharedRules() {
        XCTAssertEqual(GroupMaker.shared.hint(n: 2, bot: "Coder"), "3 bots in the group, with Coder.")
        XCTAssertFalse(GroupMaker.shared.canMake(features: nil, otherBots: 1))
        let hit = ChatHit(runId: nil, bot: nil, fromBot: nil, chatId: "c1", index: nil, title: "Week", at: nil, snippet: "the «web» page")
        XCTAssertEqual(HomeSearch.shared.who(h: hit, chiefName: "Alfred"), "Alfred · Week")
        XCTAssertEqual(HomeSearch.shared.snippet(h: hit).map(\.hit), [false, true, false])
    }
}
