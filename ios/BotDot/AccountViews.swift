import PhotosUI
import SwiftUI
import BotdotShared

/// "Delete account", from Home's ⋯ menu where the front door offers it, as the Android app's Settings: the confirmation
/// with the account's name typed, botdot.app's page that says how, or why the admin's account can't be.
struct AccountDeletionView: View {
    let offer: AccountDeletion.Offer
    let api: Api
    /// Deleted: what the phone says, before the sign-in follows.
    let deleted: (String) -> Void
    @State private var typed = ""
    @State private var deleting = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            Form {
                switch onEnum(of: offer) {
                case .delete(let d):
                    Section {
                        Text(d.warning)
                        Text(AccountDeletion.shared.backups).foregroundStyle(.secondary)
                    }
                    Section {
                        TextField(AccountDeletion.shared.typeToConfirm(account: d.account), text: $typed)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .accessibilityIdentifier("delete-name")
                        if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("error") }
                        Button(tr("Delete account"), role: .destructive) { delete(d.account) }
                            .disabled(deleting || !AccountDeletion.shared.matches(typed: typed, account: d.account))
                    }
                case .page(let p):
                    Section {
                        Text(p.text)
                        Button(tr("Delete account…"), role: .destructive) { if let url = URL(string: p.url) { openURL(url) } }
                    }
                case .adminNote(let note):
                    Section { Text(note.text) }
                }
            }
            .navigationTitle(tr("Delete your account?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() }.disabled(deleting) } }
            .interactiveDismissDisabled(deleting)
        }
    }

    private func delete(_ account: String) {
        deleting = true
        error = nil
        Task {
            let answer = try? await FrontDoorDesk(api: api).delete(account: account, typed: typed)
            deleting = false
            guard let answer else { error = tr("Couldn't delete the account"); return }
            if answer.done { dismiss(); deleted(answer.words) } else { error = answer.words }
        }
    }
}

/// Feedback, from Home's ⋯ menu where the front door takes it: Bug or Feature request and the text, for the admin of this
/// machine, and up to three screenshots where it takes them. A failed send keeps everything and says why.
struct FeedbackView: View {
    let api: Api
    let shotsOn: Bool
    let sent: () -> Void
    @State private var kind = Feedback.Kind.bug
    @State private var text = ""
    @State private var error: String?
    @State private var sending = false
    @State private var picks: [PhotosPickerItem] = []
    @State private var shots: [Data] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(Feedback.shared.intro(shotsOn: shotsOn)).foregroundStyle(.secondary)
                    Picker("", selection: $kind) {
                        ForEach([Feedback.Kind.bug, Feedback.Kind.feature], id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField(Feedback.shared.PLACEHOLDER, text: $text, axis: .vertical)
                        .lineLimit(5...12)
                        .onChange(of: text) { error = nil }
                        .accessibilityIdentifier("feedback-text")
                }
                if shotsOn {
                    Section {
                        if !shots.isEmpty {
                            ScrollView(.horizontal) {
                                HStack(spacing: 8) {
                                    ForEach(Array(shots.enumerated()), id: \.offset) { i, data in
                                        if let image = UIImage(data: data) {
                                            Image(uiImage: image).resizable().scaledToFill().frame(width: 72, height: 56).clipShape(.rect(cornerRadius: 6))
                                                .overlay(alignment: .topTrailing) {
                                                    Button { shots.remove(at: i); picks = [] } label: { Image(systemName: "xmark.circle.fill") }
                                                        .accessibilityLabel(tr("Remove screenshot {n}", ["n": String(i + 1)]))
                                                        .disabled(sending)
                                                }
                                                .accessibilityLabel(tr("Screenshot {n}", ["n": String(i + 1)]))
                                        }
                                    }
                                }
                            }
                        }
                        PhotosPicker(tr("Add screenshot"), selection: $picks, maxSelectionCount: Int(Feedback.shared.SHOTS_MAX) - shots.count, matching: .screenshots)
                            .disabled(sending || shots.count >= Int(Feedback.shared.SHOTS_MAX))
                    }
                }
                if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("error") }
            }
            .navigationTitle(Feedback.shared.TITLE)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() }.disabled(sending) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Send")) { send() }.disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onChange(of: picks) { _, items in Task { await read(items) } }
        }
    }

    /// The picked screenshots, each checked by the shared layer's rule (a PNG, JPEG or WebP picture, at most 5 MB).
    private func read(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        var refused: [String] = []
        for (i, item) in items.enumerated() {
            if shots.count >= Int(Feedback.shared.SHOTS_MAX) { refused.append(Feedback.shared.TOO_MANY); break }
            let data = try? await item.loadTransferable(type: Data.self)
            let name = tr("Screenshot {n}", ["n": String(shots.count + i + 1)])
            if let no = Feedback.shared.refusal(name: name, bytes: data.map(bytes)) { refused.append(no) } else if let data { shots.append(data) }
        }
        picks = []
        error = refused.isEmpty ? nil : refused.joined(separator: " ")
    }

    private func send() {
        sending = true
        let all = shots.map(bytes)
        Task {
            let failed: String?
            do { failed = try await FrontDoorDesk(api: api).sendFeedback(kind: kind, text: text, shots: all) } catch { failed = error.localizedDescription }
            sending = false
            if let failed { error = failed } else { dismiss(); sent() }
        }
    }

    private func bytes(_ data: Data) -> KotlinByteArray { bytesOf(data: data) }
}

/// What's new after an update: the notes this person has not seen, newest first; the newest few in full, the rest as
/// titles that open. Closing it, any way, marks them seen.
struct WhatsNewView: View {
    let entries: [WhatsNew.Entry]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let line = WhatsNew.shared.countLine(entries: entries) { Text(line).font(.subheadline).foregroundStyle(.secondary) }
                ForEach(Array(entries.enumerated()), id: \.offset) { i, e in
                    if WhatsNew.shared.openAtFirst(index: Int32(i)) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(e.title).font(.headline)
                            ForEach(e.points, id: \.self) { Text("• " + $0) }
                        }
                    } else {
                        DisclosureGroup(e.title) { ForEach(e.points, id: \.self) { Text("• " + $0) } }
                    }
                }
            }
            .navigationTitle(WhatsNew.shared.TITLE)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button(WhatsNew.shared.GOT_IT) { dismiss() }.accessibilityIdentifier("got-it") }
        }
        .presentationDetents([.medium, .large])
    }
}

/// An account the admin paused: the front door's one sentence and its one way out. "Use another account" signs this
/// phone out, and the sign-in follows. botdot is asked again every minute, so a resumed account opens by itself.
struct PausedView: View {
    let model: AppModel
    let server: String
    @State private var watch: PausedWatch?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("botdot").font(.largeTitle.bold())
            Text(tr("Your account is paused by the admin.")).foregroundStyle(.secondary).accessibilityIdentifier("paused")
            if let error = model.error { Text(error).foregroundStyle(.red).accessibilityIdentifier("error") }
            Button {
                Task { await model.signOut(server) }
            } label: {
                Text(tr("Use another account")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.busy)
        }
        .padding(24)
        .frame(maxHeight: .infinity)
        .task {
            let w = PausedWatch(session: model.session)
            watch = w
            _ = w.poll(api: model.api(server))
        }
        .onDisappear { watch?.close(); watch = nil }
    }
}
