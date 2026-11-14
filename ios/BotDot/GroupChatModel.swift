import Foundation
import Observation
import BotdotShared

/// A group's chat on screen: the shared GroupChat's state, and what its message box and its members panel do with
/// it. Everything it decides is the shared layer's, as Android's group chat. The box's part has the shape of a
/// chat's message box, for the shared Composer.
@MainActor
@Observable
final class GroupChatModel {
    private(set) var state: GroupChatState?
    private let chat: GroupChat
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore, groupId: String) {
        chat = home.groupChat(groupId: groupId)
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

    // The message box.
    var note: String? { state?.note }
    var files: [Attachment] { state?.files ?? [] }
    var uploading: Bool { state?.uploading ?? false }
    /// A message to a group whose members work waits its turn: Send stays.
    var boxStops: Bool { false }
    var back: FailedSend? { state?.back }
    func send(_ text: String) async -> Bool { (try? await chat.send(text: text))?.boolValue ?? false }
    func takeFailed(typed: String) -> String? {
        guard let failed = chat.takeFailed() else { return nil }
        return OutboxKt.withFailed(failed: failed, typedSince: typed)
    }
    func edited() { chat.edited() }
    func leave(_ typed: String) { chat.leave(typed: typed) }
    func takeUnsent() -> String { chat.takeUnsent() }
    func drop(_ file: Attachment) { chat.drop(file: file) }
    func attach(_ url: URL, name: String) async { try? await chat.attach(file: Files_iosKt.outgoingFile(path: url.path, name: name)) }
    func attachFailed(_ name: String) { chat.attachFailed(name: name) }
    func stopFromBox() { chat.stopAll() }

    // The chat.
    func refresh() async { try? await chat.load() }
    func loadOlder() { chat.loadOlder() }
    /// An answer button under the group's open question.
    func answer(_ choice: String) { Task { _ = try? await chat.answer(choice: choice) } }
    func takeBack(_ m: GroupMessage) { chat.takeBack(m: m) }
    func stopAll() { chat.stopAll() }
    func goOn() { chat.goOn() }

    // The members panel.
    func rename(_ typed: String) { chat.rename(typed: typed) }
    func takeOut(_ botId: String) { chat.takeOut(botId: botId) }
    func add(_ botIds: [String]) { chat.add(botIds: botIds) }
    func delete() async -> Bool { (try? await chat.delete())?.boolValue ?? false }
    func addNote(kind: String, _ typed: String) { chat.addNote(kind: kind, typed: typed) }
    func setNoteKind(_ note: GroupNote, _ kind: String) { chat.setNoteKind(note: note, kind: kind) }
    func setNoteText(_ note: GroupNote, _ typed: String) { chat.setNoteText(note: note, typed: typed) }
    func removeNote(_ note: GroupNote) { chat.removeNote(note: note) }
}
