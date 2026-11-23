import Foundation
import Observation
import BotdotShared

/// A bot's chat on screen: the shared BotChat's state, and what the message box does with it. Everything it decides
/// is the shared layer's, as Android's bot chat.
@MainActor
@Observable
final class ChatModel: MessageBox {
    private(set) var state: BotChatState?
    private let chat: BotChat
    private var watching: Kotlinx_coroutines_coreJob?
    let mentions: MentionBox?
    private let inbox = QuoteInbox()
    var quoted: (text: String, count: Int)? { inbox.quoted }
    /// Quote: [text] goes into the box, after what is typed.
    func quote(_ text: String) { inbox.quote(text) }
    var filled: (text: String, count: Int)? { inbox.filled }
    /// The chat opens with [text] in its box (a standup's Reply).
    func fill(_ text: String) { inbox.fill(text) }
    func takeFilled() -> String? { inbox.takeFilled() }

    init(home: HomeStore, botId: String) {
        chat = home.chat(botId: botId)
        mentions = home.mentions(chat: botId)
    }

    func start() {
        guard watching == nil else { return }
        chat.start()
        watching = chat.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        chat.stop()
    }

    func refresh() async { try? await chat.refresh() }
    func loadOlder() { chat.loadOlder() }
    func stopRun(_ runId: String? = nil) { chat.stopRun(runId: runId) }
    /// A quick answer, or several questions' answers, to the run that asked: whether they went.
    func answer(_ runId: String, _ choice: String) async -> Bool { (try? await chat.answer(runId: runId, choice: choice))?.boolValue ?? false }
    func answerQuestions(_ runId: String, _ answers: [String]) async -> Bool {
        (try? await chat.answerQuestions(runId: runId, answers: answers))?.boolValue ?? false
    }
    /// The small × under a run's quick answers, or Undo: whether it was kept (the shared layer brings the row back when not).
    func dismissChoices(_ runId: String, _ dismissed: Bool) async -> Bool {
        (try? await chat.dismissChoices(runId: runId, dismissed: dismissed)) != nil
    }
    func takeBack(_ q: Queued) { chat.takeBack(q: q) }

    // The message box (Composer).
    var note: String? { state?.note }
    var files: [Attachment] { state?.files ?? [] }
    var uploading: Bool { state?.uploading == true }
    var boxStops: Bool { state?.boxStops == true }
    var back: FailedSend? { state?.back }
    func edited() { chat.edited() }
    func drop(_ file: Attachment) { chat.drop(file: file) }
    func attachFailed(_ name: String) { chat.attachFailed(name: name) }
    func leave(_ typed: String) { chat.leave(typed: typed) }
    func takeUnsent() -> String { chat.takeUnsent() }
    func stopFromBox() { chat.stopRun(runId: nil) }
    func replies(_ runId: String) -> Bool { chat.replies(runId: runId) }
    func replyTo(_ runId: String) { chat.replyTo(runId: runId) }
    func clearReply() { chat.clearReply() }
    func foldPlan(_ folded: Bool) { chat.foldPlan(folded: folded) }
    func dismissPlan() { chat.dismissPlan() }

    /// Sends what is typed; false when it didn't go (it comes back to the box with the line saying why).
    func send(_ text: String) async -> Bool {
        (try? await chat.send(text: text))?.boolValue ?? false
    }

    /// A failed message the box takes back, in front of what was typed since ([withFailed], as on Android).
    func takeFailed(typed: String) -> String? {
        guard let failed = chat.takeFailed() else { return nil }
        return OutboxKt.withFailed(failed: failed, typedSince: typed)
    }

    /// A file picked in Photos or Files, at [url] in the app's own storage: uploaded for the next message.
    func attach(_ url: URL, name: String) async {
        try? await chat.attach(file: Files_iosKt.outgoingFile(path: url.path, name: name))
    }
}
