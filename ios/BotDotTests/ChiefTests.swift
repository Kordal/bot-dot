import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// The Chief's chat on the iPhone: each kind of message the shared ChiefDesk hands it draws, thumbs and all.
@MainActor
final class ChiefTests: XCTestCase {
    private func line(role: String, text: String, team: String? = nil, rates: Bool = false, rating: String? = nil, from: String? = nil) -> ChiefLine {
        ChiefLine(index: 0, role: role, text: text, error: nil, files: [], from: from, team: team, teamColor: "#1d9e75",
                  project: team == nil ? nil : "Spring beds", rates: rates, rating: rating, pending: false, time: "09:00")
    }

    func testEveryKindOfMessageDraws() {
        for l in [line(role: "user", text: "Plan my week"),
                  line(role: "chief", text: "**Done**", team: "Garden", rates: true, rating: Ratings.shared.UP),
                  line(role: "report", text: "Restarted", from: "Message from Fleet Doctor")] {
            let renderer = ImageRenderer(content: ChiefRow(line: l) { _ in }.frame(width: 360))
            XCTAssertNotNil(renderer.cgImage, l.role)
        }
    }
}
