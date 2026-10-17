import Foundation
import Testing
@testable import BotDotKit

/// A reply arrives, visibly, as the Android app's ArrivalsTest: which replies of an open chat count
/// as new, and so move once. A reply is told by its id (the run's; the message's place in a Chief
/// chat). Nothing is new when the chat opens, when its lists are read again, or when older messages
/// are loaded. The owner's own message moves once, on Send, and not again when the server's version
/// takes its place. With reduced motion nothing moves.
@MainActor
@Suite struct RepliesArrive {
    final class Clock { var now = Date(timeIntervalSince1970: 1_000) }
    let clock = Clock()
    func arrivals() -> Arrivals { let clock = clock; return Arrivals { clock.now } }
    func at(_ seconds: Double) -> Date { Date(timeIntervalSince1970: seconds) }
    let none: Set<String> = []

    // MARK: which replies are new

    @Test func openingAChatMarksNoneOfItsReplies() {
        let a = arrivals()
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3"]) == none)
        #expect(a.since("r3") == nil)
    }

    @Test func aReplyWhoseIdIsNewInTheOpenChatArrivesOnce() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"])
        clock.now = at(5_000)
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3"]) == ["r3"])
        #expect(a.since("r3") == at(5_000)) // when it came, for the movement
        #expect(a.since("r2") == nil) // the ones before it stand still
        // Drawn again, as it is on every change of the screen: it is not new a second time.
        clock.now = at(5_100)
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3"]) == none)
        #expect(a.since("r3") == at(5_000)) // its one movement is not started again
    }

    @Test func aRefreshOfTheListsMarksNoneAgain() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"])
        a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3"])
        // The newest runs are read again and put in place of those the chat had: the same ids.
        for _ in 0..<3 { #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3"]) == none) }
    }

    @Test func olderMessagesLoadedAboveDoNotArrive() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r5", "r6"])
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3", "r4", "r5", "r6"]) == none)
        // And a reply that then comes at the end still does.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]) == ["r7"])
    }

    @Test func nothingIsNewWhileTheChatIsStillBeingRead() {
        let a = arrivals()
        #expect(a.draw("bot:doctor", loaded: false, replies: []) == none)
        // What the first read brings is what was there when the chat opened.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"]) == none)
    }

    @Test func theFirstReplyOfAChatThatOpenedEmptyArrives() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: [])
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1"]) == ["r1"])
    }

    @Test func severalRepliesThatCameTogetherAllArrive() {
        let a = arrivals()
        a.draw("chief:c1", loaded: true, replies: ["1"])
        #expect(a.draw("chief:c1", loaded: true, replies: ["1", "2", "3"]) == ["2", "3"])
    }

    @Test func aChatReadFromScratchMarksNone() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"])
        // More came than one look brings, and the chat started over: none of what it drew is among them.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r20", "r21", "r22"]) == none)
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r20", "r21", "r22", "r23"]) == ["r23"])
    }

    @Test func aReplyThatLeftAndCameBackDoesNotArriveAgain() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r1"])
        a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"])
        a.draw("bot:doctor", loaded: true, replies: ["r1"])
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"]) == none)
    }

    // MARK: the owner's own message

    @Test func theOwnersMessageArrivesOnSendAndNotAgainWhenTheServersTakesItsPlace() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: ["r1"])
        clock.now = at(2_000)
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1"], sent: "k1") == [Arrivals.sent("k1")])
        #expect(a.since(Arrivals.sent("k1")) == at(2_000))
        // Still on its way: the same message, not new again.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1"], sent: "k1") == none)
        // The server answered: its run r2 is in the chat, at work, and the local message is gone. Nothing
        // arrives: the run's own row is the message that already stood there.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1"]) == none)
        // The run ended: its reply arrives.
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1", "r2"]) == ["r2"])
    }

    @Test func aMessageThatWasOnItsWayWhenTheChatOpenedStandsStill() {
        let a = arrivals()
        #expect(a.draw("bot:doctor", loaded: true, replies: ["r1"], sent: "k1") == none)
        #expect(a.since(Arrivals.sent("k1")) == nil)
    }

    @Test func aFailedMessageSentAgainArrivesAgain() {
        let a = arrivals()
        a.draw("bot:doctor", loaded: true, replies: [])
        a.draw("bot:doctor", loaded: true, replies: [], sent: "k1")
        a.draw("bot:doctor", loaded: true, replies: []) // it did not go, and is back in the message box
        clock.now = at(9_000)
        // Sent again as it is: it has the same key, and comes into the chat once more.
        #expect(a.draw("bot:doctor", loaded: true, replies: [], sent: "k1") == [Arrivals.sent("k1")])
        #expect(a.since(Arrivals.sent("k1")) == at(9_000))
    }

    // MARK: the Chief's chats, which share one screen

    @Test func aNewChiefChatThatGotItsIdIsTheSameChat() {
        let a = arrivals()
        a.draw(nil, loaded: true, replies: []) // a new chat: it has no id until the first message
        #expect(a.draw(nil, loaded: true, replies: [], sent: "k1") == [Arrivals.sent("k1")])
        // The chat was made and is read: the message keeps its one movement, and nothing is new.
        #expect(a.draw("c1", loaded: false, replies: [], sent: "k1") == none)
        #expect(a.since(Arrivals.sent("k1")) == at(1_000))
        #expect(a.draw("c1", loaded: true, replies: []) == none)
        // The Chief's reply, the chat's second message, arrives.
        #expect(a.draw("c1", loaded: true, replies: ["1"]) == ["1"])
    }

    @Test func anotherChatOnTheSameScreenOpensWithNothingNew() {
        let a = arrivals()
        a.draw("c1", loaded: true, replies: ["1", "3"])
        // A new chat. Then an older chat, read from the server.
        #expect(a.draw(nil, loaded: true, replies: []) == none)
        #expect(a.draw("c2", loaded: false, replies: []) == none)
        #expect(a.draw("c2", loaded: true, replies: ["1", "3", "5"]) == none)
        #expect(a.draw("c2", loaded: true, replies: ["1", "3", "5", "7"]) == ["7"])
    }

    // MARK: reduced motion, and one movement only

    @Test func nothingMovesWithReducedMotion() {
        #expect(Arrivals.moves(since: at(1_000), now: at(1_000), still: false))
        #expect(!Arrivals.moves(since: at(1_000), now: at(1_000), still: true))
    }

    @Test func aReplyMovesOnlyWhileItsMovementLasts() {
        #expect(Arrivals.seconds == 0.26) // the web page's 260 ms
        #expect(!Arrivals.moves(since: nil, now: at(1_000), still: false)) // it was there already
        let came = Date(timeIntervalSinceReferenceDate: 0)
        #expect(Arrivals.moves(since: came, now: came.addingTimeInterval(Arrivals.seconds - 0.001), still: false))
        // Scrolled away and back later, or drawn again: it stands.
        #expect(!Arrivals.moves(since: came, now: came.addingTimeInterval(Arrivals.seconds), still: false))
    }

    // MARK: what a reply is, in each chat

    func runs(_ json: String) throws -> [RunSummary] { try JSON.decoder.decode([RunSummary].self, from: Data(json.utf8)) }

    @Test func aBotsRepliesAreItsRunsThatEnded() throws {
        // Oldest first, as the chat holds them. The run at work has no reply yet: its working line stands for it.
        let chat = try runs(#"[{"id":"r1","status":"success"},{"id":"r2","status":"error"},{"id":"r3","status":"running"},{"id":"r4","status":"queued"}]"#)
        #expect(Arrivals.replyIds(chat) == ["r1", "r2"])
        // Its reply came.
        #expect(Arrivals.replyIds(try runs(#"[{"id":"r1","status":"success"},{"id":"r2","status":"error"},{"id":"r3","status":"success"}]"#)) == ["r1", "r2", "r3"])
    }

    @Test func aChiefChatsRepliesAreByTheirPlaceAndNeverTheOwnersOrOneStillWritten() {
        let messages = [
            ChiefMessage(role: "user", text: "hi"),
            ChiefMessage(role: "chief", text: "Hello."),
            ChiefMessage(role: "report", text: "Done."),
            ChiefMessage(role: "user", text: "and now?"),
            ChiefMessage(role: "chief", pending: true),
        ]
        #expect(Arrivals.replyIds(messages, offset: 10) == ["11", "12"])
        #expect(Arrivals.replyIds(Array(messages.dropLast()) + [ChiefMessage(role: "chief", text: "Now this.")], offset: 10) == ["11", "12", "14"])
        #expect(Arrivals.replyIds([], offset: 0) == [])
    }
}
