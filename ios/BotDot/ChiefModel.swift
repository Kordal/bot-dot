import Foundation
import Observation
import BotdotShared

/// The Chief's chat on screen: the shared ChiefDesk's state, and what the message box does with it. Everything it
/// decides is the shared layer's, as Android's Chief chat.
@MainActor
@Observable
final class ChiefModel: MessageBox {
    private(set) var state: ChiefState?
    private let desk: ChiefDesk
    private var watching: Kotlinx_coroutines_coreJob?
    let mentions: MentionBox?
    private let inbox = QuoteInbox()
    var quoted: (text: String, count: Int)? { inbox.quoted }
    /// Quote: [text] goes into the box, after what is typed.
    func quote(_ text: String) { inbox.quote(text) }
    var filled: (text: String, count: Int)? { inbox.filled }
    /// A new chat that starts with [text] in its box (Storage's Ask the Chief).
    func fill(_ text: String) { inbox.fill(text) }

    /// [chatId]: the conversation a notification asked for; nil, the latest.
    init(home: HomeStore, chatId: String? = nil) {
        desk = home.chief(chatId: chatId)
        mentions = home.mentions(chat: Mentions.shared.CHIEF)
    }

    func start() {
        guard watching == nil else { return }
        desk.start()
        watching = desk.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        desk.stop()
    }

    func refresh() async { try? await desk.refresh(whole: false) }
    func loadOlder() { desk.loadOlder() }
    func reload() async { try? await desk.load() }
    func takeBack(_ q: Queued) { desk.takeBack(q: q) }
    func steer(_ q: Queued) { desk.steer(q: q) }
    func rate(_ index: Int32, _ tapped: String) { desk.rate(index: index, tapped: tapped) }
    func stopReply() { desk.stopReply() }
    /// Another conversation, or a new one (nil), made by its first message.
    func open(_ id: String?) { desk.open(id: id) }
    func approve(_ index: Int32) async -> Bool { (try? await desk.approve(index: index))?.boolValue ?? false }
    func decline() async { try? await desk.decline() }
    func mail(_ index: Int32, _ words: String) async -> Bool { (try? await desk.mail(index: index, words: words))?.boolValue ?? false }
    func chipBot(_ chip: ChiefChip) async -> ChiefDesk.ChipBot? { (try? await desk.chipBot(chip: chip)) ?? nil }
    func mailBot(_ index: Int32) async -> ChiefDesk.ChipBot? { (try? await desk.mailBot(index: index)) ?? nil }
    func mailFile(_ f: Attachment) -> DocumentView.Opening? { desk.mailFile(f: f) }
    func foldPlan(_ folded: Bool) { desk.foldPlan(folded: folded) }
    func dismissPlan() { desk.dismissPlan() }
    func answer(_ index: Int32, _ answers: [String]) async -> Bool { (try? await desk.answer(index: index, answers: answers))?.boolValue ?? false }

    // The message box (Composer).
    var note: String? { state?.note }
    var files: [Attachment] { state?.files ?? [] }
    var uploading: Bool { state?.uploading == true }
    var boxStops: Bool { state?.boxStops == true }
    var back: FailedSend? { state?.back }
    func edited() { desk.edited() }
    func drop(_ file: Attachment) { desk.drop(file: file) }
    func attachFailed(_ name: String) { desk.attachFailed(name: name) }
    func leave(_ typed: String) { desk.leave(typed: typed) }
    func takeUnsent() -> String { desk.takeUnsent() }
    func stopFromBox() { desk.stopReply() }

    func send(_ text: String) async -> Bool {
        (try? await desk.send(text: text))?.boolValue ?? false
    }

    func takeFailed(typed: String) -> String? {
        guard let failed = desk.takeFailed() else { return nil }
        return OutboxKt.withFailed(failed: failed, typedSince: typed)
    }

    func attach(_ url: URL, name: String) async {
        try? await desk.attach(file: Files_iosKt.outgoingFile(path: url.path, name: name))
    }
}
