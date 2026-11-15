import XCTest
import BotdotShared
@testable import BotDot

/// Files and the document viewer at their seams (#1368): Swift gets the shared layer's answers about whose Files open,
/// what a folder shows before it is read, how a file opens, and how the viewer draws a CSV and text.
@MainActor
final class FilesTests: XCTestCase {
    private let api = unreachableApi()

    func testFilesOpenOnlyFromAServerWithThem() {
        XCTAssertTrue(FilesExplorer.shared.opensFor(ownerId: "news", features: ["files-explorer"]))
        XCTAssertFalse(FilesExplorer.shared.opensFor(ownerId: "news", features: []))
        XCTAssertFalse(FilesExplorer.shared.opensFor(ownerId: UploadedFiles.shared.CHIEF, features: ["files-explorer"]))
        XCTAssertTrue(FilesExplorer.shared.opensFor(ownerId: UploadedFiles.shared.CHIEF, features: ["files-explorer", "chief-files"]))
    }

    func testAFolderStartsOnBotdotLoadingUnderItsOwnersName() async {
        let model = FilesModel(api: api, at: FilesPlace(owner: "news", name: "News"))
        let seen = expectation(description: "the first state")
        // Only the first state: the read that follows (refused at once, here) brings another one.
        let first = FirstOnly()
        let job = model.files.watch { s in
            MainActor.assumeIsolated {
                guard first.take() else { return }
                XCTAssertEqual(s.title, "News")
                XCTAssertEqual(s.place, "server")
                XCTAssertEqual(s.placeName, "On botdot")
                XCTAssertEqual(s.pane, .loading)
                XCTAssertFalse(s.writesHere, "nothing is uploaded before the folder is read")
                seen.fulfill()
            }
        }
        await fulfillment(of: [seen], timeout: 5)
        job.cancel(cause: nil)
    }

    func testAPathInAReplyOpensThatFileOfTheBot() {
        let o = DocumentView.shared.ofPath(botId: "news", path: "out/raw.csv", from: "News", name: "raw.csv")
        XCTAssertEqual(o.src, "/bots/news/path?path=out%2Fraw.csv")
        XCTAssertEqual(o.name, "raw.csv")
        XCTAssertEqual(o.botId, "news")
        XCTAssertEqual(o, DocumentView.shared.ofPath(botId: "news", path: "out/raw.csv", from: "News", name: "raw.csv"), "a route: the same file is equal")
    }

    func testACsvIsATableSortedByATapAndTextHasItsLines() {
        let viewer = DocumentViewer(api: api, opening: DocumentView.Opening(src: "/files/r1/a.csv", name: "a.csv", from: "", botId: nil, path: nil, slug: nil))
        let t = viewer.table(text: "name,n\nb,10\na,9\n", sortCol: 1, ascending: true, find: "")
        XCTAssertEqual(t.head, ["name", "n"])
        XCTAssertEqual(viewer.rowCells(t: t, i: 0), ["a", "9"], "numbers sort as numbers")
        XCTAssertEqual(viewer.rowNumber(t: t, i: 0), 2, "each row keeps its number in the file")
        XCTAssertEqual(viewer.tableCount(t: t), "2 rows · 2 columns")
        XCTAssertEqual(viewer.lines(text: "one\ntwo\n"), ["one", "two"])
    }

    func testACsvSwitchesBetweenItsTableAndItsTextAndMarkdownIsRenderedOrItsSource() {
        let csv = Viewed(view: FileView(name: "a.csv", size: 1, at: nil, kind: "csv", type: "", text: "a", truncated: false, downloadable: true, page: nil, parts: nil, tiles: [], plain: nil, interactive: nil), pane: .text, failed: nil)
        XCTAssertEqual(csv.mode, "table")
        XCTAssertEqual(csv.switches, ["table", "source"])
        XCTAssertTrue(csv.table(mode: "table"))
        let md = Viewed(view: FileView(name: "a.md", size: 1, at: nil, kind: "markdown", type: "", text: "# a", truncated: false, downloadable: true, page: nil, parts: nil, tiles: [], plain: nil, interactive: nil), pane: .text, failed: nil)
        XCTAssertEqual(md.switches, ["rendered", "source"], "Markdown is drawn, or its source")
        XCTAssertEqual(md.mode, "rendered")
        XCTAssertTrue(md.rendered(mode: md.mode))
        XCTAssertFalse(md.rendered(mode: "source"))
        XCTAssertFalse(md.table(mode: md.mode))
    }

    func testEachKindHasItsIcon() {
        XCTAssertEqual(FilesView.icon(.folder), "folder")
        XCTAssertEqual(FilesView.icon(.sheet), "tablecells")
        XCTAssertEqual(FilesView.icon(FilesExplorer.shared.kindOf(e: WorkspaceEntry(name: "a.png", path: "a.png", type: "file", size: nil, at: nil, kept: false, keepsName: false, items: nil))), "photo")
    }

    /// A bot's page: opened as a page (its slug), its versions said with the shared words.
    func testAPageOpensAsAPageAndItsVersionsDraw() {
        let o = DocumentView.shared.ofPage(botId: "b1", slug: "news", title: "News", from: "Scout")
        XCTAssertEqual(o.slug, "news")
        XCTAssertTrue(DocumentViewer(api: unreachableApi(), opening: o).page)
        let site = InteractiveView(current: 2, shown: 2, versions: [SiteVersion(n: 2, at: nil, bytes: 10, files: 1), SiteVersion(n: 1, at: nil, bytes: 9, files: 1)],
                                   frame: nil, expires: nil, values: nil, tiles: [])
        XCTAssertEqual(InteractivePages.shared.versionTitle(v: site.versions[0], current: site.current), "Version 2 · on the page")
    }

    /// The Pages list after a page was opened over it and closed: followed again, and read anew.
    func testThePagesListIsFollowedAgainWhenItComesBack() async throws {
        let model = PagesModel(home: HomeStore(api: unreachableApi()))
        let first = Task { await model.follow() }
        for _ in 0..<200 where model.state?.error == nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(model.state?.error, "Couldn't load the pages.", "read when it shows")
        XCTAssertTrue(model.following)
        first.cancel() // a page opened over it
        _ = await first.value
        XCTAssertFalse(model.following, "off screen: it follows nothing")
        let again = Task { await model.follow() }
        for _ in 0..<200 where !model.following { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(model.following, "back: it follows the list again")
        again.cancel()
        _ = await again.value
        XCTAssertFalse(model.following)
    }
}

/// True once, for the first call: a watch that hands over every state, checked for its first alone.
private final class FirstOnly: @unchecked Sendable {
    private var taken = false
    func take() -> Bool { if taken { return false }; taken = true; return true }

    /// Move to… and Copy to…: the shared CarryDesk reaches Swift with the item's words and the place shown first.
    func testMoveToStartsInThePlaceShownWithTheItemsWords() {
        let store = FilesStore(api: unreachableApi(), ownerId: "b1", name: "Ada", place: "", path: "")
        let e = Api.companion.JSON.decodeFromString(deserializer: WorkspaceEntry.companion.serializer(), string: #"{"name":"plan.md","path":"docs/plan.md"}"#) as! WorkspaceEntry
        let move = store.carry(move: true, e: e) { _ in }
        XCTAssertEqual(move.state.value.title, "Move plan.md")
        XCTAssertEqual(move.state.value.goWords, "Move here")
        XCTAssertNil(move.state.value.to, "nothing picked yet")
        let copy = store.carry(move: false, e: e) { _ in }
        XCTAssertEqual(copy.state.value.title, "Copy plan.md")
        store.close()
    }
}
