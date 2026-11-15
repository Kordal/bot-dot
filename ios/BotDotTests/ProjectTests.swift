import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// Projects on the iPhone (#1366): Swift reaches the shared ProjectDesk's rules and gets the Android app's answers, and
/// a project's board draws from what botdot sends.
@MainActor
final class ProjectTests: XCTestCase {
    private let kitchen = """
    {"id":"p1","name":"Kitchen","phase":"running","teams":[{"id":"t1","name":"Crew","bots":["b1"]}],
     "objectives":[{"id":"o1","name":"Quotes","target":3,"current":1,"color":"#34c759"}],
     "cards":[{"id":"k1","ask":"Quotes","state":"ready","body":{"show":"table","rows":[{"label":"Oakline","value":"6 Jan"}]}},
              {"id":"k3","ask":"Budget","state":"asking","questions":[{"q":"Which?","choices":["All","Kitchen"]}]},
              {"id":"k2","ask":"Tiles","state":"building","steps":2}]}
    """

    func testANewBotsWordsNameTheProjectAndTheTeam() {
        let c = CompanySetup.shared.of(answer: kitchen)
        XCTAssertEqual(ProjectRules.shared.doNewBotWords(c: c), "A new bot for Kitchen: ")
        XCTAssertEqual(ProjectRules.shared.doNewBotWords(c: c, t: c.teams[0]), "A new bot for the Crew team in Kitchen: ")
    }

    func testTheCardsRowIsTwoToALineAWideOneAlone() {
        let c = CompanySetup.shared.of(answer: kitchen)
        let slots = ProjectCards.shared.slots(cards: c.cards, open: nil, closing: [], removing: [])
        // the table alone, the questions alone, then the building card with New card
        XCTAssertEqual(ProjectCards.shared.lines(slots: slots).map { $0.count }, [1, 1, 2])
    }

    func testABoardsCardsAndGoalsDraw() {
        let c = CompanySetup.shared.of(answer: kitchen)
        for card in c.cards {
            let view = BoardCard(card: card, fresh: false, onChange: {}, onRefresh: {}, onRemove: {}).frame(width: 320)
            XCTAssertNotNil(ImageRenderer(content: view).cgImage, "card \(card.id) draws")
        }
        XCTAssertNotNil(ImageRenderer(content: Goals(goals: c.objectives).frame(width: 320)).cgImage)
        XCTAssertNotNil(ImageRenderer(content: QuestionsCard(card: c.cards[1], figure: nil, onClose: {}, onAnswer: { _ in true }).frame(width: 320)).cgImage)
    }
    /// A project's settings: the shared words and rules reach Swift (what each sends is the shared ProjectDeskTest's).
    func testTheSettingsWordsAndRulesReachSwift() async {
        XCTAssertEqual(ProjectSettingWords.shared.rhythms.map { $0.label }, ["Off", "Daily", "Twice a week", "Weekly"])
        XCTAssertTrue(ProjectSettingWords.shared.isTime(t: "07:45"))
        XCTAssertFalse(ProjectSettingWords.shared.isTime(t: "7:45"))
        let c = CompanySetup.shared.of(answer: kitchen)
        XCTAssertEqual(ProjectSettingWords.shared.deleteQuestion(c: c), "Delete the project Kitchen? Its bots stay.")
        let model = ProjectModel(home: HomeStore(api: unreachableApi()))
        let deleted = await model.delete(dropFolder: false)
        XCTAssertFalse(deleted, "no project shown: nothing deleted")
        let saved = await model.setStandupTime("25:00")
        XCTAssertFalse(saved)
    }
}
