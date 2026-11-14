import Foundation
import Observation
import BotdotShared

/// A bot's chat on screen: the shared BotChat's state, and what the message box does with it. Everything it decides
/// is the shared layer's, as Android's bot chat.
@MainActor
@Observable
final class ChatModel {
    private(set) var state: BotChatState?
    private let chat: BotChat
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore, botId: String) {
        chat = home.chat(botId: botId)
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
    func takeBack(_ q: Queued) { chat.takeBack(q: q) }
    func edited() { chat.edited() }
    /// Left with [typed] not sent: kept for when the chat opens again (#1068).
    func leave(_ typed: String) { chat.leave(typed: typed) }
    /// What was typed and not sent when the chat was last left, once.
    func takeUnsent() -> String { chat.takeUnsent() }
    func drop(_ file: Attachment) { chat.drop(file: file) }

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
