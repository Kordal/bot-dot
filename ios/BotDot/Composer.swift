import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// What a chat's message box works with: a bot's chat (ChatModel) or the Chief's (ChiefModel). The rules behind each
/// call are the shared layer's.
@MainActor
protocol MessageBox: AnyObject, Observable {
    /// Why the last send failed, above the box; nil for none.
    var note: String? { get }
    /// Files picked for the next message, uploaded.
    var files: [Attachment] { get }
    var uploading: Bool { get }
    /// Stop takes Send's place: this botdot takes no message while one works.
    var boxStops: Bool { get }
    /// A failed message that waits to come back into the box.
    var back: FailedSend? { get }
    func send(_ text: String) async -> Bool
    func takeFailed(typed: String) -> String?
    func edited()
    /// Left with [typed] not sent: kept for when the chat opens again (#1068).
    func leave(_ typed: String)
    /// What was typed and not sent when the chat was last left, once.
    func takeUnsent() -> String
    func drop(_ file: Attachment)
    func attach(_ url: URL, name: String) async
    /// A picked file that couldn't be read or copied: the chat says so.
    func attachFailed(_ name: String)
    func stopFromBox()
}

/// A chat's message box, as Android's: the system's text input (dictation, the keyboard's own behaviour), files from
/// Photos and Files, Send, and Stop in Send's place while a botdot that takes no message meanwhile works. A failed
/// send keeps the message: it comes back into the box, with the line above it saying why.
struct Composer<Box: MessageBox>: View {
    let box: Box
    let placeholder: String
    @FocusState.Binding var focused: Bool
    /// One's own message left: the chat goes to its end.
    let onSent: () -> Void
    @State private var typed = ""
    @State private var restored: String?
    @State private var photos: [PhotosPickerItem] = []
    @State private var importing = false
    @State private var picking = false
    /// The device's settings, for the notice before the first message (AiNotice); nil where none is given (the tests).
    @Environment(\.aiNoticeSettings) private var noticeSettings
    @State private var notice = NoticeGate()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let note = box.note { Text(note).font(.footnote).foregroundStyle(.red) }
            if !box.files.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(box.files, id: \.file) { f in
                            Button { box.drop(f) } label: { Label(f.name, systemImage: "xmark.circle.fill") }
                                .buttonStyle(.bordered).font(.caption)
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { picking = true } label: { Label(tr("Photos"), systemImage: "photo") }
                    Button { importing = true } label: { Label(tr("Files"), systemImage: "folder") }
                } label: {
                    Image(systemName: box.uploading ? "hourglass" : "paperclip").frame(width: 36, height: 36)
                }
                .accessibilityLabel(tr("Attach"))
                TextField(placeholder, text: $typed, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.quaternary, in: .rect(cornerRadius: 18))
                    .onChange(of: typed) { _, now in
                        if now == restored { restored = nil } else { box.edited() } // the box taking a message back is no edit
                    }
                if box.boxStops {
                    Button { box.stopFromBox() } label: { Image(systemName: "stop.fill").frame(width: 36, height: 36) }
                        .accessibilityLabel(tr("Stop"))
                } else {
                    Button(action: send) { Image(systemName: "arrow.up").frame(width: 36, height: 36) }
                        .buttonStyle(.borderedProminent).clipShape(Circle())
                        .disabled(notice.checking || (typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && box.files.isEmpty))
                        .accessibilityLabel(tr("Send"))
                }
            }
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
        .onChange(of: box.back) { take() }
        .onChange(of: photos) { pick(photos) }
        // A picker presented from the menu's button: one placed in a Menu doesn't open reliably.
        .photosPicker(isPresented: $picking, selection: $photos, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { for url in urls { Task { await importFile(url) } } }
        }
        .task { notice.setUp(noticeSettings); take(); unsent() }
        .onDisappear { box.leave(typed) }
        .aiNotice(notice)
    }

    /// Send: the first message on this device waits for the notice that it goes to Anthropic (AiNotice.Gate), once;
    /// swiped away, nothing goes and the words stay in the box.
    private func send() {
        notice.send(typed.trimmingCharacters(in: .whitespacesAndNewlines)) { go($0) }
    }

    private func go(_ text: String) {
        if !typed.isEmpty { restored = "" } // emptied by Send, not edited: a retry keeps the failed message's key
        typed = ""
        onSent()
        Task { _ = await box.send(text) } // a failed one comes back through `back`
    }

    /// What was typed and not sent when the chat was last left comes back once, in front of what is in the box.
    private func unsent() {
        let left = box.takeUnsent()
        guard !left.isEmpty else { return }
        let now = OutboxKt.withFailed(failed: left, typedSince: typed)
        restored = now
        typed = now
    }

    /// A failed message waits: into the box, in front of what was typed since.
    private func take() {
        if let back = box.takeFailed(typed: typed) { restored = back; typed = back }
    }

    private func pick(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photos = []
        for item in items {
            Task {
                let name = PickedFile.name(of: item.supportedContentTypes.first)
                // A photo or video that can't be read or kept says so: the owner would send thinking it went along.
                guard let picked = try? await item.loadTransferable(type: PickedFile.self) else { return box.attachFailed(name) }
                defer { try? FileManager.default.removeItem(at: picked.folder) } // uploaded or not, the copy goes
                await box.attach(picked.url, name: name)
            }
        }
    }

    private func importFile(_ url: URL) async {
        let name = url.lastPathComponent
        guard url.startAccessingSecurityScopedResource() else { return box.attachFailed(name) }
        defer { url.stopAccessingSecurityScopedResource() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) } // uploaded or not, the copy goes
        let copy = folder.appendingPathComponent(name)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { return box.attachFailed(name) }
        await box.attach(copy, name: name)
    }
}

/// A notice over a chat for three seconds ("Stopping…", a file that didn't upload); each new one its full three.
struct NoticeOverlay: ViewModifier {
    let notice: String?
    let count: Int
    @State private var shown: String?
    @State private var timer: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let shown { Text(shown).font(.callout).padding(10).background(.thinMaterial, in: .capsule).padding(.top, 8) }
            }
            .onChange(of: count) {
                shown = notice
                timer?.cancel()
                timer = Task { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled { shown = nil } }
            }
    }
}

/// A message box's Send held for the notice before the first message: the shared AiNotice.Gate decides, and this
/// draws it. Send is off while a send is checked; the sheet shows while the words are held; Continue sends them,
/// swiping it away sends nothing.
@MainActor
@Observable
final class NoticeGate {
    private var gate: AiNotice.Gate?
    private(set) var checking = false
    var showing = false
    private var accepted = false
    private var go: ((String) -> Void)?

    func setUp(_ settings: Settings?) { if gate == nil { gate = AiNotice.Gate(settings: settings) } }

    func send(_ text: String, _ go: @escaping (String) -> Void) {
        guard let gate, !checking else { return }
        checking = true
        Task {
            let now = try? await gate.send(text: text)
            checking = false
            if let now { go(now) } else if gate.asking { self.go = go; showing = true }
        }
    }

    func accept() {
        accepted = true
        showing = false
        let go = self.go
        self.go = nil
        Task { if let words = try? await gate?.accept() { go?(words) } }
    }

    /// The sheet went: swiped away, nothing goes.
    func closed() {
        if !accepted { gate?.dismiss(); go = nil }
        accepted = false
    }
}

extension View {
    /// The notice before the first message, over this box (NoticeGate).
    func aiNotice(_ notice: NoticeGate) -> some View {
        sheet(isPresented: Binding(get: { notice.showing }, set: { notice.showing = $0 }), onDismiss: notice.closed) {
            AiNoticeSheet(onContinue: notice.accept).presentationDetents([.medium])
        }
    }
}

/// The notice before the first message (App Store guideline 5.1.2(i)): the bots run on Claude by Anthropic, so what is
/// sent to them goes to Anthropic; Continue accepts it once on this device, and the message goes.
struct AiNoticeSheet: View {
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text(AiNotice.shared.text).font(.title3).multilineTextAlignment(.center)
            Button(action: onContinue) { Text(AiNotice.shared.go).frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("ai-notice-continue")
        }
        .padding(24)
    }
}

private struct AiNoticeSettingsKey: EnvironmentKey {
    static let defaultValue: Settings? = nil
}

extension EnvironmentValues {
    /// The settings the notice before the first message is kept in.
    var aiNoticeSettings: Settings? {
        get { self[AiNoticeSettingsKey.self] }
        set { self[AiNoticeSettingsKey.self] = newValue }
    }
}
