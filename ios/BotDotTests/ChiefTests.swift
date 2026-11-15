import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// The Chief's chat on the iPhone: each kind of message the shared ChiefDesk hands it draws, thumbs and all.
@MainActor
final class ChiefTests: XCTestCase {
    private func line(role: String, text: String, team: String? = nil, rates: Bool = false, rating: String? = nil, from: String? = nil,
                      suggests: Bool = false, declined: Bool = false, questions: [String] = [], choices: [[String]] = [],
                      chips: [ChiefChip] = [], mail: MailView? = nil, pages: [PageRef] = []) -> ChiefLine {
        ChiefLine(index: 0, role: role, text: text, error: nil, files: [], from: from, team: team, teamColor: "#1d9e75",
                  project: team == nil ? nil : "Spring beds", rates: rates, rating: rating, pending: false, time: "09:00",
                  suggests: suggests, declined: declined, questions: questions, choices: choices, chips: chips, mail: mail, pages: pages)
    }

    func testEveryKindOfMessageDraws() {
        for l in [line(role: "user", text: "Plan my week"),
                  line(role: "chief", text: "**Done**", team: "Garden", rates: true, rating: Ratings.shared.UP),
                  line(role: "report", text: "Restarted", from: "Message from Fleet Doctor")] {
            let renderer = ImageRenderer(content: ChiefRow(line: l, onRate: { _ in }).frame(width: 360))
            XCTAssertNotNil(renderer.cgImage, l.role)
        }
    }

    func testASuggestionsButtonsAndAQuestionsCardDraw() {
        for l in [line(role: "suggestion", text: "Add a cook", from: "Suggestion from Fleet Doctor", suggests: true),
                  line(role: "suggestion", text: "Add a cook", from: "Suggestion from Fleet Doctor", declined: true),
                  line(role: "chief", text: "Two things", questions: ["When?", "Where?"], choices: [["Mon", "Tue"], []])] {
            let row = ChiefRow(line: l, onRate: { _ in }, onApprove: { true }, onDecline: {}, onAnswer: { _ in true })
            XCTAssertNotNil(ImageRenderer(content: row.frame(width: 360)).cgImage, l.role)
        }
        XCTAssertEqual(NeedsDeskKt.questionsAnswer(questions: ["When?", "Where?"], answers: ["Mon", ""]), "When?\n→ Mon\n\nWhere?\n→ –",
                       "one message for all, as Android sends it")
    }

    /// A reply's page chips (the Chief's own and its bots'): drawn, and a tap opens that bot's page in the viewer.
    func testAReplysPageChipsDrawAndOpenTheirPage() {
        let pages = [PageRef(slug: "week", title: "Week", botId: Pages.shared.CHIEF, bot: ""), PageRef(slug: "menu", title: "Menu", botId: "b1", bot: "Cook")]
        var opened: [DocumentView.Opening] = []
        let row = ChiefRow(line: line(role: "chief", text: "Done", pages: pages), onRate: { _ in }, onFile: { opened.append($0) }, chiefName: "Chief")
        XCTAssertNotNil(ImageRenderer(content: row.frame(width: 360)).cgImage)
        XCTAssertEqual(DocumentView.shared.ofPage(botId: "b1", slug: "menu", title: "Menu", from: "Cook").name, "Menu")
        XCTAssertTrue(opened.isEmpty, "nothing opens until a tap")
    }

    /// A reply with what the Chief did as chips and a mail draft's card under it: drawn, the chips that name a bot tappable.
    func testAMailDraftsCardAndTheChiefsChipsAreDrawn() {
        let chips = [ChiefChip(text: "→ Started Coder", waits: nil, after: " · View live screen", kind: "run", botId: "b1", runId: nil),
                     ChiefChip(text: "✦ Learned a skill", waits: "waits for your OK", after: "", kind: "skill", botId: nil, runId: nil)]
        XCTAssertEqual(chips.map(\.opens), [true, false], "a chip opens only a bot")
        let mail = MailView(to: "ann@example.test", subject: "Dinner", text: "Friday?", sent: false, state: "In Drafts · not sent",
                            earlier: false, actions: ["Send now", "Not now"], files: [Attachment(name: "menu.pdf", file: "r1/menu.pdf", size: 0, readable: nil)],
                            bot: "Mailer", botId: "b3", runId: nil, screen: true)
        let l = line(role: "chief", text: "Drafted it", chips: chips, mail: mail)
        XCTAssertNotNil(ImageRenderer(content: ChiefRow(line: l, onRate: { _ in }).frame(width: 360)).cgImage)
        let sent = MailView(to: "ann@example.test", subject: "Dinner", text: "Friday?", sent: true, state: "Sent 09:30",
                            earlier: false, actions: [], files: [], bot: nil, botId: nil, runId: nil, screen: false)
        XCTAssertNotNil(ImageRenderer(content: MailCardView(mail: sent).frame(width: 360)).cgImage)
    }

    /// Not now keeps the draft: its Send now comes back, as the card's buttons change from two to one.
    func testAKeptDraftsSendNowComesBackAfterNotNow() {
        let two = ["Send now", "Not now"]
        XCTAssertTrue(MailCardView.showsButtons(two, usedFor: nil))
        XCTAssertFalse(MailCardView.showsButtons(two, usedFor: two), "tapped: gone while the same buttons stand")
        XCTAssertTrue(MailCardView.showsButtons(["Send now"], usedFor: two), "kept: Send now again")
        XCTAssertFalse(MailCardView.showsButtons([], usedFor: nil), "sent: none")
    }
}
