import SwiftUI
import BotdotShared

/// A bot's chat, as Android's: its runs, oldest at the top, each the owner's message and the bot's reply in
/// Markdown; what waits until the bot is free; the message on its way; the message box (Composer).
struct ChatView: View {
    let name: String
    let home: HomeStore
    let botId: String
    /// A file path tapped in a reply: opened in the viewer.
    @State private var opening: DocumentView.Opening?
    @State private var model: ChatModel
    @State private var atBottom = true
    @State private var sentAt = 0
    @FocusState private var focused: Bool

    init(home: HomeStore, botId: String, name: String) {
        self.name = name
        self.home = home
        self.botId = botId
        _model = State(initialValue: ChatModel(home: home, botId: botId))
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let s = model.state {
                        Color.clear.frame(height: 1).onAppear { model.loadOlder() }
                        ForEach(s.runs.reversed(), id: \.run.id) { r in RunRow(view: r, paths: s.opensFiles, stops: model.state?.boxStops == false, onStop: { model.stopRun(r.run.id) }) }
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
            .safeAreaInset(edge: .bottom) { Composer(box: model, placeholder: tr("Message"), focused: $focused) { sentAt += 1 } }
        }
        .navigationTitle(name)
        // A file path in a reply opens in the viewer (#251), as on Android; a web address in the browser.
        .environment(\.openURL, OpenURLAction { url in
            guard let path = MarkdownKt.filePathOf(link: url.absoluteString.removingPercentEncoding ?? url.absoluteString) else { return .systemAction }
            opening = DocumentView.shared.ofPath(botId: botId, path: path, from: name, name: (path as NSString).lastPathComponent)
            return .handled
        })
        .navigationDestination(item: $opening) { ViewerView(api: home.api, opening: $0) }
        .navigationBarTitleDisplayMode(.inline)
        .modifier(NoticeOverlay(notice: model.state?.notice, count: Int(model.state?.noticeCount ?? 0)))
        .task { model.start() }
        .onDisappear { model.stop() }
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
}

/// One run: what started it on the owner's side, and what came of it on the bot's.
struct RunRow: View {
    let view: RunView
    /// File paths in its reply open in the viewer.
    var paths = false
    /** Its working line has Stop (Send stays in the box while it works). */
    let stops: Bool
    let onStop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let asked = view.asked { Mine(text: asked, files: view.askedFiles, waiting: false) }
            if let chip = view.chip { Text(chip).font(.caption).foregroundStyle(.secondary) }
            if view.working {
                if let draft = view.draft, !draft.isEmpty { MarkdownView(text: draft, paths: paths) }
                HStack {
                    ProgressView().controlSize(.small)
                    Text(view.line).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                    if stops { Spacer(); Button(tr("Stop"), action: onStop).font(.callout) }
                }
            } else if let reply = view.reply, !reply.isEmpty {
                MarkdownView(text: reply, paths: paths)
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
