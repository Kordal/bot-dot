import SwiftUI
import AppKit
import UniformTypeIdentifiers
import BotDotKit

/// The message box under a chat: a panel with a hairline, as the web page's `.composer-box`. Return sends, Shift-Return adds a
/// line. 📎 attaches files (so do dropping them on the chat and pasting). While an answer is on its
/// way, Stop. "@" at the start of a word lists bots, jobs and skills to mention (↑/↓, Return or Tab
/// picks, Esc closes; "/" right after a picked bot lists its jobs).
struct Composer: View {
    @Binding var text: String
    let placeholder: String
    var busy = false
    /// Where attached files go; nil: no files here.
    var files: PendingFiles?
    var uploadTo: UploadTarget?
    /// The Chief's id or the bot whose chat it is, for "@" mentions; nil: none here.
    var chat: String?
    /// Why the last send failed (see Outbox): one line above the box, until the owner sends or edits.
    var note: String?
    let send: (String, [FileRef]) -> Void
    var stop: () -> Void = {}
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @FocusState private var focused: Bool
    @State private var secretCheck = false
    @State private var pasteWatch: Any?
    /// Where the caret is (a mention is what's typed before it).
    @State private var selection: TextSelection?
    /// The "@" suggestions showing, the one Return picks, and the text Esc closed them for.
    @State private var rows: [Mentions.Suggestion] = []
    @State private var selected = 0
    @State private var closedFor: String?
    /// A bot just picked: the text then, and where the bot and its new space end. A "/" typed right
    /// there goes in place of the space, so the bot's jobs show.
    @State private var picked: (text: String, end: String.Index)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Above the box: the files to send, why the last send failed, and the "@" suggestions.
            if let files, !files.items.isEmpty || files.note != nil {
                FlowLayout(spacing: 6) {
                    ForEach(files.items) { f in
                        FileChip(name: f.name, size: f.size, status: f.failed ? "failed" : f.ref == nil ? "uploading…" : nil) { files.remove(f.id) }
                    }
                }
                .padding(.leading, 2)
                if let note = files.note { Text(note).font(.geist(size: 12)).foregroundStyle(Theme.muted) }
            }
            // What keeps botdot from working stands here until it is over.
            if let standing = store.standing {
                HStack(spacing: 5) {
                    Text(standing.text)
                    if standing == .signedOut { Button("Sign in") { nav.page = .setup }.buttonStyle(.textLink) }
                }
                .font(.geist(size: 12)).foregroundStyle(Theme.warnText).padding(.leading, 2)
            }
            if let note { Text(note).font(.geist(size: 12)).foregroundStyle(Theme.warnText).padding(.leading, 2) }
            if !rows.isEmpty { suggestions }
            box
        }
        .frame(maxWidth: 820)
        .padding(.horizontal, 30)
        .padding(.bottom, 22)
        .frame(maxWidth: .infinity)
        .background(Theme.bg) // the chat ends above the box
        .onChange(of: text) { suggest() }
        .onChange(of: selection) { suggest() }
        .onChange(of: store.bots) { suggest() }
        .task(id: chat) { if chat != nil { await store.loadSkillLibrary() } }
        .onAppear {
            focused = true
            // ⌘V with files or a picture (a screenshot) on the clipboard attaches them; the text
            // field would otherwise paste nothing. Plain text pastes as usual.
            pasteWatch = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                if focused, event.characters == "/", event.modifierFlags.intersection([.command, .option, .control]).isEmpty,
                   let p = picked, p.text == text, caret == p.end {
                    jobsOf(p)
                    return nil
                }
                if focused, !rows.isEmpty, event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty {
                    switch event.keyCode {
                    case Key.down: selected = (selected + 1) % rows.count; return nil
                    case Key.up: selected = (selected + rows.count - 1) % rows.count; return nil
                    case Key.returnKey, Key.enter, Key.tab: pick(rows[min(selected, rows.count - 1)]); return nil
                    case Key.escape: closedFor = text; rows = []; return nil
                    default: break
                    }
                }
                guard focused, event.modifierFlags.intersection([.command, .shift, .option, .control]) == .command,
                      event.charactersIgnoringModifiers == "v", let files, let uploadTo else { return event }
                let urls = Self.pastedFiles()
                guard !urls.isEmpty else { return event }
                files.add(urls, store: store, to: uploadTo)
                return nil
            }
        }
        .onDisappear {
            if let pasteWatch { NSEvent.removeMonitor(pasteWatch) }
            pasteWatch = nil
        }
        .confirmationDialog("This looks like it contains a password.", isPresented: $secretCheck) {
            Button("Send anyway") { deliver() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Messages are sent to the AI and saved on disk. Let the bot ask for it instead: it opens a secure box that goes straight into your Vault.")
        }
    }

    /// The keys the "@" suggestions handle (NSEvent key codes).
    private enum Key {
        static let returnKey: UInt16 = 36, enter: UInt16 = 76, tab: UInt16 = 48, escape: UInt16 = 53, down: UInt16 = 125, up: UInt16 = 126
    }

    /// Where the caret is in the text, when nothing is selected. Before the field has had the focus: the end.
    private var caret: String.Index? {
        guard let selection else { return text.endIndex }
        guard case .selection(let r) = selection.indices, r.isEmpty, r.upperBound <= text.endIndex else { return nil }
        return r.lowerBound
    }

    /// The "@" suggestions for the text typed up to the caret.
    /// The "@" suggestions, above the box (`.mention-list`).
    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                HStack(spacing: 6) {
                    if let bot = row.bot { NameFigure(Who(id: bot.id, name: bot.name, color: bot.color), text: 13.5) }
                    Text(row.label).lineLimit(1)
                }
                .font(.geist(size: 13.5))
                .padding(.horizontal, 10).padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(i == selected ? Theme.sunk : .clear))
                .contentShape(Rectangle())
                .onTapGesture { pick(row) }
                .onHover { if $0 { selected = i } }
            }
        }
        .padding(4)
        .frame(minWidth: 220, maxWidth: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.panel).shadow(color: .black.opacity(0.14), radius: 30, y: 20))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.line, lineWidth: 1))
        .padding(.leading, 12)
        }

    private var box: some View {
        let shade = Color(red: 20 / 255, green: 20 / 255, blue: 18 / 255).opacity(0.06)
        return HStack(alignment: .bottom, spacing: 8) {
            if files != nil {
                Button(action: choose) { Image(systemName: "paperclip") }
                    .buttonStyle(IconButtonStyle(size: 38)).help("Attach files (or drop them here)")
            }
            TextField(placeholder, text: $text, selection: $selection, prompt: Text(placeholder).foregroundStyle(Theme.faint), axis: .vertical)
                .textFieldStyle(.plain)
                .font(.geist(size: 14.5))
                .lineLimit(1...10)
                .focused($focused)
                .padding(.vertical, 10)
                .onKeyPress(.return, phases: .down) { press in
                    if press.modifiers.contains(.shift) || press.modifiers.contains(.option) {
                        text += "\n"
                        return .handled
                    }
                    if !busy { submit() }
                    return .handled
                }
            if busy {
                // Only against a botdot server where a message can't wait: Stop in the box (`.send-btn.stop`).
                Button(action: stop) { Image(systemName: "stop.fill") }
                    .buttonStyle(SendButtonStyle(fill: Theme.err, ink: .white))
                    .help("Stop")
            } else {
                Button(action: submit) { Image(systemName: "arrow.up").fontWeight(.semibold) }
                    .buttonStyle(SendButtonStyle(fill: Theme.ink, ink: Theme.inkText))
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (files?.ready.isEmpty ?? true))
                    .help("Send")
            }
        }
        .padding(.leading, files != nil ? 6 : 18).padding(.trailing, 6).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 26).fill(Theme.panel).shadow(color: shade, radius: 14, y: 8))
        .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(Theme.line2, lineWidth: 1))
        }

    private func suggest() {
        guard let chat, closedFor != text, let caret else { rows = []; return }
        closedFor = nil
        let next = store.mentions(in: chat).suggest(String(text[..<caret]))
        if next != rows { rows = next; selected = 0 }
    }

    private func pick(_ row: Mentions.Suggestion) {
        rows = []
        guard let caret, let done = Mentions.pick(row, in: text, at: caret) else { return }
        text = done.text
        selection = TextSelection(insertionPoint: done.cursor)
        picked = done.jobsNext ? (done.text, done.cursor) : nil
    }

    /// "/" right after a picked bot: in place of the space the pick added, so its jobs show.
    private func jobsOf(_ p: (text: String, end: String.Index)) {
        let space = text.index(before: p.end)
        text.replaceSubrange(space..<p.end, with: "/")
        selection = TextSelection(insertionPoint: text.index(after: space))
        picked = nil
    }

    private func choose() {
        guard let files, let uploadTo else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        if panel.runModal() == .OK { files.add(panel.urls, store: store, to: uploadTo) }
    }

    private func submit() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if files?.uploading == true { files?.note = "Wait a moment: the files are still uploading."; return }
        guard !t.isEmpty || !(files?.ready.isEmpty ?? true) else { return }
        if Self.looksLikeSecret(t) { secretCheck = true; return }
        deliver()
    }

    private func deliver() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        send(t, files?.take() ?? [])
    }

    /// Files on the clipboard, or a picture saved as a PNG; none for plain text.
    static func pastedFiles() -> [URL] {
        let pb = NSPasteboard.general
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty { return urls }
        // Text copied from Excel, Numbers, Word or Pages comes with a picture of it: that's text.
        if pb.availableType(from: [.string]) != nil { return [] }
        if pb.availableType(from: [.png, .tiff]) != nil, let image = NSImage(pasteboard: pb), let url = PendingFiles.png(image) { return [url] }
        return []
    }

    /// A password or PIN typed into a message, as the web checks for.
    static func looksLikeSecret(_ t: String) -> Bool {
        let patterns = [
            #"\b(password|passwd|pwd|hasło|haslo|passcode)\b\s*(is|:|=|-)?\s*\S{4,}"#,
            #"\bpass\s*[:=]\s*\S{4,}"#,
            #"\bpin\b\s*(code)?\s*(is|:|=|-)?\s*\d{4,8}\b"#,
        ]
        return patterns.contains { t.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }
}

/// Files dropped anywhere on a chat go with the next message.
struct FileDrop: ViewModifier {
    let files: PendingFiles
    let target: UploadTarget
    @Environment(Store.self) private var store
    @State private var over = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if over { RoundedRectangle(cornerRadius: 16).stroke(Theme.muted, style: StrokeStyle(lineWidth: 2, dash: [6])).padding(8).allowsHitTesting(false) }
            }
            .onDrop(of: [.fileURL, .image], isTargeted: $over) { providers in
                files.add(providers, store: store, to: target)
            }
    }
}

/// The web page's `.send-btn`: a flat circle of 38, faint while there is nothing to send.
struct SendButtonStyle: ButtonStyle {
    let fill: Color
    let ink: Color
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.geist(size: 15))
            .foregroundStyle(ink)
            .frame(width: 38, height: 38)
            .background(Circle().fill(fill))
            .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.3)
            .contentShape(Circle())
    }
}
