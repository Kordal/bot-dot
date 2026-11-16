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
    /// The "@" of this box (MentionBox): nil where the chat offers no mentions.
    var mentions: MentionBox? { get }
    /// Text quoted from the chat for the box, once (Quote); counted, so the same words quoted again come again.
    var quoted: (text: String, count: Int)? { get }
    /// Words a new chat starts with (Storage's Ask the Chief), put in the box as they are, once.
    var filled: (text: String, count: Int)? { get }
}

extension MessageBox {
    var mentions: MentionBox? { nil }
    var quoted: (text: String, count: Int)? { nil }
    var filled: (text: String, count: Int)? { nil }
}

/// The message box's cursor as the shared layer counts it (UTF-16, as Kotlin's strings), and back.
enum Cursor {
    /// The cursor's place in [text]: the end of a selection; the text's end when none is known.
    static func offset(of selection: TextSelection?, in text: String) -> Int {
        guard let selection, case .selection(let range) = selection.indices, range.upperBound <= text.endIndex else { return text.utf16.count }
        return text.utf16.distance(from: text.startIndex, to: range.upperBound)
    }

    /// [draft] with the quote of [words] after it (Quote), and the cursor at its end; nil when there is nothing to quote.
    static func quoting(_ words: String, into draft: String) -> (String, TextSelection)? {
        guard let added = Quote.shared.add(draft: draft, selected: words) else { return nil }
        return (added.text, at(added.text.utf16.count, in: added.text))
    }

    /// A cursor at [offset] (UTF-16) in [text].
    static func at(_ offset: Int, in text: String) -> TextSelection {
        let i = text.utf16.index(text.startIndex, offsetBy: min(max(offset, 0), text.utf16.count))
        return TextSelection(insertionPoint: i)
    }
}

/// What a chat quotes into its box: the words, and a count that tells a new quote of the same words.
@MainActor
@Observable
final class QuoteInbox {
    private(set) var quoted: (text: String, count: Int)?
    func quote(_ text: String) { quoted = (text, (quoted?.count ?? 0) + 1) }
    private(set) var filled: (text: String, count: Int)?
    func fill(_ text: String) { filled = (text, (filled?.count ?? 0) + 1) }
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
    /// Where the cursor is: the "@" suggestions are for the word before it.
    @State private var selection: TextSelection?
    @State private var restored: String?
    @State private var photos: [PhotosPickerItem] = []
    @State private var importing = false
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let note = box.note { Text(note).font(.footnote).foregroundStyle(.red) }
            suggestions
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
                TextField(placeholder, text: $typed, selection: $selection, axis: .vertical)
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
                        .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && box.files.isEmpty)
                        .accessibilityLabel(tr("Send"))
                }
            }
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
        .onChange(of: box.back) { take() }
        .onChange(of: box.quoted?.count) { quote() }
        .onChange(of: box.filled?.count) { fill() }
        .task { try? await box.mentions?.load() }
        .onChange(of: photos) { pick(photos) }
        // A picker presented from the menu's button: one placed in a Menu doesn't open reliably.
        .photosPicker(isPresented: $picking, selection: $photos, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { for url in urls { Task { await importFile(url) } } }
        }
        .task { take(); unsent(); fill() }
        .onDisappear { box.leave(typed) }
    }

    /// The "@" suggestions for what is typed (MentionBox): a tap puts the mention in place of the "@…".
    @ViewBuilder
    private var suggestions: some View {
        let cursor = Cursor.offset(of: selection, in: typed)
        let rows = box.mentions?.suggest(text: typed, cursor: Int32(cursor)) ?? []
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Button {
                        guard let picked = box.mentions?.pick(text: typed, cursor: Int32(cursor), row: row) else { return }
                        typed = picked.text
                        selection = Cursor.at(Int(picked.cursor), in: picked.text)
                    } label: {
                        HStack(spacing: 8) {
                            Text(row.text).font(.subheadline.monospaced())
                            Text(row.label).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .background(.quaternary, in: .rect(cornerRadius: 12))
            .accessibilityIdentifier("mention-suggestions")
        }
    }

    /// A quote from the chat: after what is typed, as Markdown, the cursor in the box (Quote).
    /// Words the chat starts with, in place of what is typed, the cursor at their end.
    private func fill() {
        guard let words = box.filled?.text, !words.isEmpty else { return }
        typed = words
        selection = Cursor.at(words.utf16.count, in: words)
    }

    private func quote() {
        guard let words = box.quoted?.text, let quoted = Cursor.quoting(words, into: typed) else { return }
        typed = quoted.0
        selection = quoted.1 // the cursor after the quote: an "@" before it is no longer being typed
        focused = true
    }

    private func send() {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
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
