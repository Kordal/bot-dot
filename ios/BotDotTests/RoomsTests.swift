import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// Shared rooms on the iPhone draw the shared layer's list, chat and settings (RoomsDesk, RoomChatDesk,
/// RoomSettingsDesk) and hand their taps back to it.
@MainActor
final class RoomsTests: XCTestCase {
    private func home() -> HomeStore { HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: nil, quietMs: 1_000)) }

    func testABotdotWithoutAFrontDoorHasNoRooms() async throws {
        let rooms = RoomsModel(home: home())
        rooms.start()
        for _ in 0..<50 where rooms.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let state = try XCTUnwrap(rooms.state)
        XCTAssertFalse(state.on, "Home shows no Rooms row")
        XCTAssertNil(state.row)
    }

    func testALinkThatIsNotOneIsSaidWithoutAsking() async throws {
        let rooms = RoomsModel(home: home())
        let seen = await rooms.look("hello")
        XCTAssertEqual(seen?.failed, "That isn't a room's invite link.")
        XCTAssertNil(seen?.token)
    }

    func testAChatThatCannotBeReadSaysSoAndStops() async throws {
        let rooms = RoomsModel(home: home())
        let chat = RoomChatModel(rooms: rooms, id: "r1")
        chat.start()
        // Up to 10 seconds: on a busy CI simulator the failed lookup of botdot.invalid can take 5 or more.
        for _ in 0..<500 where chat.state?.error == nil { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertNotNil(chat.state?.error, "the first page could not be read")
        XCTAssertEqual(chat.state?.placeholder, "Message the room…")
        chat.stop()
        let sent = await chat.send("Hi")
        XCTAssertFalse(sent)
        XCTAssertEqual(chat.takeFailed(), "Hi", "a message that did not go comes back to the box")
    }

    func testTheWordsAreAndroids() {
        XCTAssertEqual(RoomWords.shared.rowLine(invites: 2), "2 invitations")
        XCTAssertEqual(RoomWords.shared.askTitle(delete: false, name: "Plans"), "Leave Plans?")
        XCTAssertEqual(RoomWords.shared.TITLE, "Shared rooms")
    }

    /// A room's message draws its block Markdown (a list, a quote) in its bubble.
    func testARoomMessageDrawsItsBlocks() {
        XCTAssertNotNil(ImageRenderer(content: Bubble(text: "Plan:\n\n- one\n- two\n\n> said", mine: false).frame(width: 300)).cgImage)
    }

    /// A folded category's heading draws, with its dot when one of its bots works.
    func testAFoldedCategoryHeadingDraws() {
        XCTAssertNotNil(ImageRenderer(content: CategoryHeading(category: "Work", folded: true, works: true, onTap: {}).frame(width: 300)).cgImage)
    }
}
