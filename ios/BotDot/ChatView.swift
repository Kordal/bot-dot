import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// A bot's chat, as Android's: its runs, oldest at the top, each the owner's message and the bot's reply in
/// Markdown; what waits until the bot is free; the message on its way. The system's text input (dictation, the
/// keyboard's own behaviour), files from Photos and Files, Send, and Stop while it works. A failed send keeps the
/// message: it comes back to the box, with the line above it saying why.
struct ChatView: View {
    let name: String
    @State private var model: ChatModel
    @State private var typed = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var importing = false
    @State private var picking = false
    @State private var atBottom = true
    @State private var sentAt = 0
    @State private var restored: String?
    @State private var noticeTimer: Task<Void, Never>?
    @State private var notice: String?
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var phase

    init(home: HomeStore, botId: String, name: String) {
        self.name = name
        _model = State(initialValue: ChatModel(home: home, botId: botId))
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let s = model.state {
                        Color.clear.frame(height: 1).onAppear { model.loadOlder() }
                        ForEach(s.runs.reversed(), id: \.run.id) { r in RunRow(view: r, stops: model.state?.boxStops == false, onStop: { model.stopRun(r.run.id) }) }
                        ForEach(s.started, id: \.id) { q in Mine(text: q.text, files: q.attachments, waiting: true) }
                        ForEach(s.queued, id: \.id) { q in
                            VStack(alignment: .trailing, spacing: 4) {
                                Mine(text: q.text, files: q.attachments, waiting: true)
                                if q.steering { Text(tr("Steering…")).font(.caption).foregroundStyle(.secondary) }
                                else { Button(tr("Take back")) { model.takeBack(q) }.font(.caption) }
                            }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        if let sent = s.sent { Mine(text: sent.text, files: sent.attachments, waiting: true) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    Color.clear.frame(height: 1).id("end")
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding()
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.refresh() }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    Button { withAnimation { scroll.scrollTo("end", anchor: .bottom) } } label: {
                        Image(systemName: "arrow.down").padding(10)
                    }
                    .buttonStyle(.bordered).clipShape(Circle()).padding()
                    .accessibilityLabel(tr("Latest"))
                }
            }
            .onChange(of: tail) { if atBottom { toEnd(scroll) } }
            .onChange(of: sentAt) { toEnd(scroll) } // one's own message: always to it
            .onChange(of: focused) { _, on in
                // The keyboard comes up over the end: the newest stays in sight once it is up.
                guard on, atBottom else { return }
                toEnd(scroll, after: .milliseconds(350))
            }
            .safeAreaInset(edge: .bottom) { composer }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            if let notice { Text(notice).font(.callout).padding(10).background(.thinMaterial, in: .capsule).padding(.top, 8) }
        }
        .onChange(of: model.state?.noticeCount) {
            notice = model.state?.notice
            noticeTimer?.cancel() // each notice shows its full 3 seconds
            noticeTimer = Task { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled { notice = nil } }
        }
        .onChange(of: model.state?.back) { take() }
        .onChange(of: photos) { pick(photos) }
        // A picker presented from the menu's button: one placed in a Menu doesn't open reliably.
        .photosPicker(isPresented: $picking, selection: $photos, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { for url in urls { Task { await importFile(url) } } }
        }
        .task { model.start(); take(); unsent() }
        .onDisappear { model.leave(typed); model.stop() }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let note = model.state?.note { Text(note).font(.footnote).foregroundStyle(.red) }
            if let files = model.state?.files, !files.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(files, id: \.file) { f in
                            Button { model.drop(f) } label: { Label(f.name, systemImage: "xmark.circle.fill") }
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
                    Image(systemName: model.state?.uploading == true ? "hourglass" : "paperclip").frame(width: 36, height: 36)
                }
                .accessibilityLabel(tr("Attach"))
                TextField(tr("Message"), text: $typed, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.quaternary, in: .rect(cornerRadius: 18))
                    .onChange(of: typed) { _, now in
                        if now == restored { restored = nil } else { model.edited() } // the box taking a message back is no edit
                    }
                if model.state?.boxStops == true {
                    Button { model.stopRun() } label: { Image(systemName: "stop.fill").frame(width: 36, height: 36) }
                        .accessibilityLabel(tr("Stop"))
                } else {
                    Button(action: send) { Image(systemName: "arrow.up").frame(width: 36, height: 36) }
                        .buttonStyle(.borderedProminent).clipShape(Circle())
                        .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (model.state?.files.isEmpty ?? true))
                        .accessibilityLabel(tr("Send"))
                }
            }
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    /// To the chat's end once what changed is laid out ([after]: once the keyboard is up).
    private func toEnd(_ scroll: ScrollViewProxy, after: Duration = .zero) {
        Task {
            if after > .zero { try? await Task.sleep(for: after) } else { await Task.yield() }
            withAnimation { scroll.scrollTo("end", anchor: .bottom) }
        }
    }

    /// What the chat's end shows: it changes when something is added there or the newest reply grows.
    private var tail: String {
        guard let s = model.state else { return "" }
        let r = s.runs.first
        return "\(r?.run.id ?? "")|\(r?.reply?.count ?? 0)|\(r?.draft?.count ?? 0)|\(s.started.count)|\(s.queued.count)|\(s.sent?.text ?? "")"
    }

    private func send() {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { restored = "" } // emptied by Send, not edited: a retry keeps the failed message's key
        typed = ""
        sentAt += 1
        Task { _ = await model.send(text) } // a failed one comes back through `back`
    }

    /// What was typed and not sent when the chat was last left comes back once, in front of what is in the box.
    private func unsent() {
        let left = model.takeUnsent()
        guard !left.isEmpty else { return }
        let now = OutboxKt.withFailed(failed: left, typedSince: typed)
        restored = now
        typed = now
    }

    /// A failed message waits: into the box, in front of what was typed since.
    private func take() {
        if let back = model.takeFailed(typed: typed) { restored = back; typed = back }
    }

    private func pick(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photos = []
        for item in items {
            Task {
                let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                let name = "photo.\(ext)"
                // A photo that can't be read or kept says so: the owner would send thinking it went along.
                guard let data = try? await item.loadTransferable(type: Data.self) else { return model.attachFailed(name) }
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")
                defer { try? FileManager.default.removeItem(at: url) } // uploaded or not, the copy goes
                guard (try? data.write(to: url)) != nil else { return model.attachFailed(name) }
                await model.attach(url, name: name)
            }
        }
    }

    private func importFile(_ url: URL) async {
        let name = url.lastPathComponent
        guard url.startAccessingSecurityScopedResource() else { return model.attachFailed(name) }
        defer { url.stopAccessingSecurityScopedResource() }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) } // uploaded or not, the copy goes
        let copy = folder.appendingPathComponent(name)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { return model.attachFailed(name) }
        await model.attach(copy, name: name)
    }
}

/// One run: what started it on the owner's side, and what came of it on the bot's.
struct RunRow: View {
    let view: RunView
    /** Its working line has Stop (Send stays in the box while it works). */
    let stops: Bool
    let onStop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let asked = view.asked { Mine(text: asked, files: view.askedFiles, waiting: false) }
            if let chip = view.chip { Text(chip).font(.caption).foregroundStyle(.secondary) }
            if view.working {
                if let draft = view.draft, !draft.isEmpty { MarkdownView(text: draft) }
                HStack {
                    ProgressView().controlSize(.small)
                    Text(view.line).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                    if stops { Spacer(); Button(tr("Stop"), action: onStop).font(.callout) }
                }
            } else if let reply = view.reply, !reply.isEmpty {
                MarkdownView(text: reply)
            } else if let ended = view.ended {
                Text(ended).foregroundStyle(view.problem ? .red : .secondary)
            }
            ForEach(view.files, id: \.file) { f in Label(f.name, systemImage: "doc").font(.callout) }
        }
    }
}

/// The owner's own message: on the right, in a bubble; one that waits is drawn lighter.
struct Mine: View {
    let text: String
    let files: [Attachment]
    let waiting: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if !text.isEmpty { Text(MarkdownView.inline(text)) }
            ForEach(files, id: \.file) { f in Label(f.name, systemImage: "paperclip").font(.caption) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.accentColor.opacity(waiting ? 0.25 : 0.4), in: .rect(cornerRadius: 16))
        .frame(maxWidth: .infinity, alignment: .trailing)
        .textSelection(.enabled)
    }
}
