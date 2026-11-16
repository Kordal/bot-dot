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

    /// A project's Overview: its words and where an entry opens come from the shared layer.
    func testTheOverviewSaysEachEntryAndWhereItOpens() {
        let e = OverviewEntry(id: "w1", botId: "b1", chatId: nil, groupId: nil, name: "Coder", state: "failed", text: "", at: "")
        XCTAssertEqual(Overviews.shared.text(e: e), "Failed")
        XCTAssertEqual(Overviews.shared.meta(e: e), "Failed")
        XCTAssertNotNil(Overviews.shared.open(destination: "bot/b1"))
        XCTAssertEqual(OverviewState(snapshot: nil, files: nil, error: nil, filesError: nil).status, "Loading…")
    }

    /// With overview-board (ADR 245) the Overview is the board's tiles, not a page: the shared rules and the tile reach Swift.
    func testTheOverviewIsTheBoardsTilesOnABotdotWithOverviewBoard() {
        XCTAssertTrue(Overviews.shared.page(features: ["project-overview"]))
        XCTAssertFalse(Overviews.shared.page(features: ["project-overview", "overview-board"]))
        let work = OverviewEntry(id: "w1", botId: "b1", chatId: nil, groupId: nil, name: "Coder", state: "working", text: "Writing **the page**", at: "")
        let d = ProjectOverview(projectId: "p1", at: "2026-11-15T09:00:00Z", work: [work], blockers: [], replies: [])
        let s = OverviewState(snapshot: d, files: nil, error: nil, filesError: nil)
        for k in ["work", "blockers", "replies"] {
            XCTAssertNotNil(ImageRenderer(content: OverviewTile(key: k, state: s, onOpen: { _ in }).frame(width: 320)).cgImage, "\(k) draws")
        }
        XCTAssertEqual(ProjectBoard.shared.label(k: "replies"), "Latest replies")
    }

    /// A team's editor, logins and files as sources: the shared rules reach Swift (what each sends is ProjectDeskTest's).
    func testTheTeamEditorAndLoginsReachSwift() async {
        XCTAssertFalse(ManyProjects.shared.canSaveTeam(name: " ", bots: ["b1"]), "no name: Save waits")
        XCTAssertFalse(ManyProjects.shared.canSaveTeam(name: "Crew", bots: []), "no bot: Save waits")
        XCTAssertTrue(ManyProjects.shared.canSaveTeam(name: "Crew", bots: ["b1"]))
        XCTAssertEqual(ManyProjects.shared.toggle(bots: ["b1"], id: "b1"), [])
        let c = CompanySetup.shared.of(answer: kitchen)
        XCTAssertEqual(ProjectSettingWords.shared.deleteTeamQuestion(t: c.teams[0]), "Delete the team Crew? Its bots stay.")
        let model = ProjectModel(home: HomeStore(api: unreachableApi()))
        let logins = await model.addableLogins()
        XCTAssertNil(logins, "no project shown: no Vault read")
        let saved = await model.saveTeam(nil, name: "Crew", bots: [], lead: nil)
        XCTAssertFalse(saved)
    }

    /// A project loaded as botdot would send it (one team, Crew, and one own bot, Cy), on a botdot with [features].
    private func loaded(_ features: [String]) async throws -> (ProjectModel, ProjectState) {
        let home = HomeStore(api: unreachableApi())
        let store = home.store
        func bot(_ json: String) -> Bot { Api.companion.JSON.decodeFromString(deserializer: Bot.companion.serializer(), string: json) as! Bot }
        let model = ProjectModel(home: home)
        model.start()
        // The store's parts start again once it takes its botdot: what the test sets comes after.
        try await Task.sleep(for: .milliseconds(300))
        store.version.set(v: VersionInfo(app: "", version: "", revision: nil, short: nil, apiVersion: 0, features: features,
                                         frontDoor: false, docker: false, boat: false, android: nil))
        store.bots.set(v: [bot(#"{"id":"b1","name":"Ada"}"#), bot(#"{"id":"b3","name":"Cy"}"#)])
        store.company.set(v: CompanyHeld(company: CompanySetup.shared.of(answer: #"{"id":"p1","name":"Kitchen","phase":"running","teams":[{"id":"t1","name":"Crew","bots":["b1"]}],"bots":["b3"]}"#)))
        for _ in 0..<250 where model.state?.teams.isEmpty != false || model.state?.own.isEmpty != false { try await Task.sleep(for: .milliseconds(20)) }
        return (model, try XCTUnwrap(model.state))
    }

    /// With overview-board the teams are behind Team (ADR 238): the board hides a loaded project's teams and own bots
    /// (teamsOnBoard), Team stands beside the gear (teamEntry), and its page draws them with the board's own rows.
    func testWithOverviewBoardTheTeamPageListsTheTeamsAndOwnBotsTheBoardHides() async throws {
        let (model, s) = try await loaded(["company", "project-bots", "project-overview", "overview-board"])
        defer { model.stop() }
        XCTAssertTrue(s.board)
        XCTAssertFalse(s.teamsOnBoard, "the board hides its teams and own bots")
        XCTAssertTrue(s.teamEntry, "Team is beside the gear")
        var unfolded: Set<String> = ["t1"]
        let rows = TeamKeysView(model: model, state: s, figure: nil, unfolded: Binding(get: { unfolded }, set: { unfolded = $0 }),
                                routes: TeamRoutes.Routes(picking: .constant(nil), panel: .constant(nil), chat: .constant(nil), group: .constant(nil)))
        XCTAssertEqual(rows.state.teams.map { $0.team.name }, ["Crew"], "the Team page's rows are the team")
        XCTAssertEqual(rows.state.own.map { $0.bot.name }, ["Cy"], "and the own bot")
        XCTAssertNotNil(ImageRenderer(content: VStack { rows }.frame(width: 320)).cgImage)
    }

    /// Without overview-board the teams stay on the board and there is no Team entry.
    func testWithoutOverviewBoardTheTeamsStayOnTheBoard() async throws {
        let (model, s) = try await loaded(["company", "project-bots", "project-overview"])
        defer { model.stop() }
        XCTAssertFalse(s.board)
        XCTAssertTrue(s.teamsOnBoard)
        XCTAssertFalse(s.teamEntry)
    }

    /// An arranged board (#784): the shared canvas reads its tiles from the top, left to right where two start level.
    func testAnArrangedBoardReadsInItsCanvasOrder() {
        let tiles = ["days", "card:k1", "files"]
        let places: [String: [Double]] = ["card:k1": [0, 0, 392, 220], "days": [0, 236, 1200, 140], "files": [408, 0, 392, 260]]
        let layout = places.mapValues { $0.map { KotlinDouble(value: $0) } }
        XCTAssertEqual(BoardCanvas.shared.readOrder(f: [BoardCanvas.shared.FEATURE], layout: layout, tiles: tiles), ["card:k1", "files", "days"])
        XCTAssertNil(BoardCanvas.shared.readOrder(f: [], layout: layout, tiles: tiles), "without project-layout")
        XCTAssertNil(BoardCanvas.shared.readOrder(f: [BoardCanvas.shared.FEATURE], layout: nil, tiles: tiles), "never arranged")
    }
}
