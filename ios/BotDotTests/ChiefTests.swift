import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// The Chief's chat on the iPhone: each kind of message the shared ChiefDesk hands it draws, thumbs and all.
@MainActor
final class ChiefTests: XCTestCase {
    private func line(role: String, text: String, team: String? = nil, rates: Bool = false, rating: String? = nil, from: String? = nil,
                      suggests: Bool = false, declined: Bool = false, questions: [String] = [], choices: [[String]] = []) -> ChiefLine {
        ChiefLine(index: 0, role: role, text: text, error: nil, files: [], from: from, team: team, teamColor: "#1d9e75",
                  project: team == nil ? nil : "Spring beds", rates: rates, rating: rating, pending: false, time: "09:00",
                  suggests: suggests, declined: declined, questions: questions, choices: choices)
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
}
