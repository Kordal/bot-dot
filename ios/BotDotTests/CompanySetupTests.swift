import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// A project's setup on the iPhone (#1366): the start screen before botdot answers, and the source chips and the
/// conversation's page drawing from what the shared layer holds.
@MainActor
final class CompanySetupTests: XCTestCase {
    private func home() -> HomeStore { HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: nil, quietMs: 1_000)) }

    func testTheSetupStartsWithNothingMadeAndNothingSent() async throws {
        let model = CompanySetupModel(home: home())
        model.start(fresh: true)
        defer { model.stop() }
        for _ in 0..<50 where model.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let s = try XCTUnwrap(model.state)
        XCTAssertTrue(s.sources.isEmpty)
        XCTAssertFalse(s.going)
        let made = await model.go("   ")
        XCTAssertFalse(made, "nothing typed: nothing is made")
        XCTAssertFalse(model.addLink("   "), "nothing typed: no link")
        XCTAssertTrue(model.addLink("kitchen.example"), "the rest is botdot's to read, as on Android")
    }

    private let proposed = """
    {"id":"p1","name":"Kitchen","phase":"setup","start":"A kitchen app","conversation":true,"creationSent":true,"chiefChat":"c1",
     "firstStep":"Draft the menu","creationReview":"r1","never":["Pay"],
     "proposal":[{"key":"a","name":"Ada","description":"Writes the menu","color":"#7f77dd"},{"key":"b","name":"Bo","description":"Checks prices"}]}
    """

    /// A review of the first step, as CompanySetupDesk hands it: the Chief's proposal of two bots, Approve on.
    private func review(made: [MadeBot] = []) -> SetupState {
        let c = CompanySetup.shared.of(answer: proposed)
        return SetupState(phase: .review, company: c, name: "Kitchen", error: nil, conversation: true, go: true, scratch: false,
                          sources: [], going: false, start: c.start, firstStep: c.firstStep, review: true, proposed: c.proposed() ?? [],
                          teamChat: [], canUndo: false, starter: [], never: c.never, facts: 0, approve: "Approve first step", approveOn: true,
                          creating: false, sending: false, folder: false, made: made, notice: nil, noticeId: 0)
    }

    func testASourceChipAndTheConversationDraw() async throws {
        let link = SourceDraft(id: "s1", kind: "link", name: "kitchen.example", url: "https://kitchen.example", size: 0, upload: nil, failed: false)
        XCTAssertNotNil(ImageRenderer(content: SourceChip(source: link) {}.frame(width: 320)).cgImage)
        let model = CompanySetupModel(home: home())
        model.start(fresh: true)
        defer { model.stop() }
        for _ in 0..<50 where model.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let s = try XCTUnwrap(model.state)
        let page = SetupConversation(state: s, chief: "Chief of Staff", onChief: {}, onReview: {}).frame(width: 390, height: 600)
        XCTAssertNotNil(ImageRenderer(content: page).cgImage)
    }

    func testOnlyAConversationsSetupOpensInPlaceOfThePage() {
        let talking = CompanySetup.shared.of(answer: proposed)
        let withChief = ["company", CompanySetupDesk.companion.CONVERSATION]
        XCTAssertTrue(CompanySetupDesk.companion.opensSetup(c: talking, features: withChief), "ProjectView draws its setup")
        XCTAssertFalse(CompanySetupDesk.companion.opensSetup(c: talking, features: ["company"]), "a botdot without the conversation: its page")
        let steps = CompanySetup.shared.of(answer: proposed.replacingOccurrences(of: #""conversation":true"#, with: #""conversation":false"#))
        XCTAssertFalse(CompanySetupDesk.companion.opensSetup(c: steps, features: withChief), "About and Team steps: its page")
        let running = CompanySetup.shared.of(answer: proposed.replacingOccurrences(of: #""phase":"setup""#, with: #""phase":"running""#))
        XCTAssertFalse(CompanySetupDesk.companion.opensSetup(c: running, features: withChief), "running: its page")
    }

    func testTheReviewAndCreatingDrawFromAReview() {
        let s = review()
        XCTAssertEqual(s.proposed.map(\.name), ["Ada", "Bo"], "the team's cards")
        XCTAssertEqual(s.approve, "Approve first step")
        XCTAssertEqual(s.firstStep, "Draft the menu")
        let model = CompanySetupModel(home: home())
        XCTAssertNotNil(ImageRenderer(content: SetupReview(model: model, state: s, figure: nil).frame(width: 390, height: 800)).cgImage)
        let made = [MadeBot(name: "Ada", color: "#7f77dd", lead: false), MadeBot(name: "Bo", color: nil, lead: false)]
        XCTAssertNotNil(ImageRenderer(content: SetupCreating(state: review(made: made), figure: nil).frame(width: 390, height: 600)).cgImage)
    }
}
