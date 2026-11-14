import SwiftUI
import BotdotShared

/// Needs you, opened from Home's Needs you card, as the Android app's screen: a card for each thing that waits, with its
/// buttons; what was answered here stays faded; pull down to refresh. After the last card it goes back by itself.
struct NeedsYouView: View {
    let home: HomeStore
    let figure: FigureDef?
    // Made when the screen opens, not each time Home draws its link: each one follows the live feed until it closes.
    @State private var model: NeedsYouModel?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var phase
    @State private var asking: Asking?
    @State private var notice: String?

    /// A button whose question is on screen before its answer goes.
    struct Asking: Identifiable {
        let key: String
        let button: NeedsButton
        var id: String { key + "/" + button.id }
    }

    var body: some View {
        List {
            if let model, let state = model.state {
                if let line = state.approveAllLine {
                    Text(line).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
                        .listRowSeparator(.hidden)
                }
                if let done = state.allDone {
                    Text(done).foregroundStyle(.secondary).listRowSeparator(.hidden)
                }
                ForEach(state.cards, id: \.key) { card in
                    NeedsCardView(card: card, figure: figure, model: model, tap: tap)
                        .padding(.leading, card.inner ? 12 : 0)
                        .listRowSeparator(.hidden)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .refreshable { await model?.refresh() }
        .navigationTitle(tr("Needs you"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let model, let state = model.state, let label = state.approveAll {
                Button(label) { Task { await model.approveAll() } }.buttonStyle(.borderedProminent).disabled(state.approving)
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16)
                    .accessibilityIdentifier("notice")
            }
        }
        .alert(asking?.button.ask?.title ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), presenting: asking) { a in
            if let q = a.button.ask {
                Button(q.yes) { send(a.key, a.button.id) }
                if let other = q.other { Button(other) { send(a.key, a.button.id + NeedsDesk.companion.OTHER) } }
                Button(tr("Cancel"), role: .cancel) {}
            }
        } message: { a in
            Text(a.button.ask?.text ?? "")
        }
        .task {
            if model == nil {
                let made = NeedsYouModel(home: home)
                made.start()
                model = made
            }
        }
        .onDisappear { model?.stop(); model = nil }
        .onChange(of: model?.state?.leave) { _, leave in if leave == true { dismiss() } }
        .onChange(of: phase) { _, now in if now == .active { Task { await model?.back() } } }
        .task(id: model?.state?.noticeId) {
            guard let text = model?.state?.notice else { return }
            notice = text
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    /// A tap: its question first where it asks one, then its answer.
    private func tap(_ key: String, _ button: NeedsButton) {
        if button.ask != nil { asking = Asking(key: key, button: button) } else { send(key, button.id) }
    }

    private func send(_ key: String, _ button: String) {
        guard let model else { return }
        Task {
            if let url = await model.press(key, button) { openURL(url) }
        }
    }
}

/// One card: whose it is, its title and line, its blocks, the fields it is answered with, its buttons, and why its
/// last answer did not go.
struct NeedsCardView: View {
    let card: NeedsCard
    let figure: FigureDef?
    let model: NeedsYouModel
    let tap: (String, NeedsButton) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let who = card.who {
                HStack(spacing: 6) {
                    if let figure {
                        FigureView(drawing: FigurePaint.shared.small(def: figure, color: who.color, outfit: who.outfit, dark: true)).frame(width: 16, height: 16)
                    }
                    Text(who.name).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(card.title).font(.headline)
            if let meta = card.meta, !meta.isEmpty {
                Text(meta).font(.caption).foregroundStyle(.secondary)
            }
            if let busy = card.busy {
                HStack(spacing: 8) { ProgressView(); Text(busy).foregroundStyle(.secondary) }
            } else {
                ForEach(Array(card.blocks.enumerated()), id: \.offset) { _, b in NeedsBlockView(block: b) }
                if let form = card.unlock { UnlockForm(key: card.key, form: form, model: model) }
                if let form = card.login { LoginForm(key: card.key, form: form, wide: card.buttons, model: model, tap: tap) }
                if let form = card.answer { AnswerForm(key: card.key, form: form, model: model) }
                if card.login == nil, !card.buttons.isEmpty { NeedsButtons(key: card.key, buttons: card.buttons, tap: tap) }
            }
            if let failed = card.failed {
                Text(failed).font(.subheadline).foregroundStyle(.red).accessibilityIdentifier("failed")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 16))
        .opacity(card.done ? 0.4 : 1)
    }
}

/// A block of a card's body, drawn as the shared layer says.
struct NeedsBlockView: View {
    let block: NeedsBlock

    var body: some View {
        switch block.look {
        case .text: Text(block.text).font(.subheadline)
        case .muted: Text(block.text).font(.subheadline).foregroundStyle(.secondary)
        case .faint: Text(block.text).font(.caption).foregroundStyle(.tertiary)
        case .box: Boxed { Text(block.text).font(.subheadline) }
        case .code:
            Boxed { ScrollView(.horizontal) { Text(block.text).font(.footnote.monospaced()) } }
        case .wasNow:
            Boxed {
                VStack(alignment: .leading, spacing: 8) {
                    if !block.label.isEmpty { Text(block.label).font(.caption).foregroundStyle(.tertiary) }
                    if !block.was.isEmpty { Text(block.was).font(.subheadline).foregroundStyle(.secondary).strikethrough() }
                    if !block.text.isEmpty { Text(block.text).font(.subheadline) }
                }
            }
        case .facts:
            Boxed {
                Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 2) {
                    ForEach(Array(block.rows.enumerated()), id: \.offset) { _, f in
                        GridRow {
                            Text(f.label).font(.subheadline).foregroundStyle(.tertiary)
                            Text(f.value).font(.subheadline)
                        }
                    }
                }
            }
        case .warning:
            Text("⚠️ " + block.text).font(.subheadline).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: .rect(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.orange.opacity(0.6)))
        case .secret:
            HStack(spacing: 8) {
                Text(block.label).font(.caption).foregroundStyle(.secondary)
                Text(block.text).font(.subheadline.monospaced())
            }
        }
    }
}

/// A grey box for what a card will do: the task, the script, the note.
struct Boxed<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: .rect(cornerRadius: 8))
    }
}

/// A card's buttons at its right edge, the no first and the yes last; a row of its own for a wide one.
struct NeedsButtons: View {
    let key: String
    let buttons: [NeedsButton]
    let tap: (String, NeedsButton) -> Void

    var body: some View {
        let wide = buttons.filter { $0.look == .wide }
        let row = buttons.filter { $0.look != .wide }
        ForEach(wide, id: \.id) { b in
            Button { tap(key, b) } label: { Text(b.label).frame(maxWidth: .infinity) }
                .buttonStyle(.bordered).disabled(!b.enabled)
        }
        if !row.isEmpty {
            ViewThatFits {
                HStack(spacing: 8) { Spacer(minLength: 0); ForEach(row, id: \.id) { button($0) } }
                VStack(alignment: .trailing, spacing: 8) { ForEach(row, id: \.id) { button($0) } }.frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func button(_ b: NeedsButton) -> some View {
        let label = Text(b.label).lineLimit(1)
        switch b.look {
        case .primary:
            if let tint = b.tint {
                Button { tap(key, b) } label: { label }.buttonStyle(.borderedProminent).tint(ContactRow.tint(tint)).disabled(!b.enabled)
            } else {
                Button { tap(key, b) } label: { label }.buttonStyle(.borderedProminent).disabled(!b.enabled)
            }
        case .link: Button { tap(key, b) } label: { label }.buttonStyle(.borderless).disabled(!b.enabled)
        default: Button { tap(key, b) } label: { label }.buttonStyle(.bordered).disabled(!b.enabled)
        }
    }
}

/// A locked Bitwarden's master password and Unlock.
struct UnlockForm: View {
    let key: String
    let form: NeedsUnlockForm
    let model: NeedsYouModel

    var body: some View {
        // Kept by the model until it unlocks: a wrong master password stays typed.
        let master = Binding(get: { model.typed[key]?.master ?? "" }, set: { model.typed[key, default: .init()].master = $0 })
        SecureField(form.label, text: master).textContentType(.password).textFieldStyle(.roundedBorder)
        HStack {
            Spacer()
            Button(form.button) {
                let typed = master.wrappedValue
                Task { await model.unlock(key, typed) }
            }
            .buttonStyle(.borderedProminent).disabled(master.wrappedValue.isEmpty)
        }
    }
}

/// A login's card: the saved logins it may use, then a new one's fields as its type asks, Save and Decline.
struct LoginForm: View {
    let key: String
    let form: NeedsLoginForm
    let wide: [NeedsButton]
    let model: NeedsYouModel
    let tap: (String, NeedsButton) -> Void
    @State private var username: String?

    var body: some View {
        // The secret and the master password are kept by the model until the login is saved: a failed save loses neither.
        let secret = Binding(get: { model.typed[key]?.secret ?? "" }, set: { model.typed[key, default: .init()].secret = $0 })
        let master = Binding(get: { model.typed[key]?.master ?? "" }, set: { model.typed[key, default: .init()].master = $0 })
        NeedsButtons(key: key, buttons: wide, tap: tap)
        if !form.types.isEmpty {
            Picker(form.typeLabel, selection: Binding(get: { form.type }, set: { model.choose(key, $0) })) {
                ForEach(form.types, id: \.id) { Text($0.label).tag($0.id) }
            }
        }
        if let label = form.username {
            TextField(label, text: Binding(get: { username ?? form.typed }, set: { username = $0 }))
                .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
        }
        if form.multiline {
            TextEditor(text: secret).font(.footnote.monospaced()).frame(minHeight: 72)
                .overlay(alignment: .topLeading) { if secret.wrappedValue.isEmpty { Text(form.secret).foregroundStyle(.tertiary).padding(6).allowsHitTesting(false) } }
                .background(.quaternary, in: .rect(cornerRadius: 8))
                .textInputAutocapitalization(.never).autocorrectionDisabled()
        } else {
            SecureField(form.secret, text: secret).textContentType(.password).textFieldStyle(.roundedBorder)
        }
        if let label = form.master {
            SecureField(label, text: master).textContentType(.password).textFieldStyle(.roundedBorder)
        }
        HStack(spacing: 8) {
            Spacer()
            Button(form.decline) { Task { _ = await model.press(key, NeedsDesk.companion.NO) } }
                .buttonStyle(.bordered).disabled(form.busy)
            Button(form.save) {
                let (u, s, m) = (username ?? form.typed, secret.wrappedValue, master.wrappedValue)
                Task { await model.saveLogin(key, type: form.type, username: u, secret: s, master: m) }
            }
            .buttonStyle(.borderedProminent).disabled(secret.wrappedValue.isEmpty || form.busy)
        }
    }
}

/// A bot's questions with a box under each and their choices under it, or one box for the answer, and Send.
struct AnswerForm: View {
    let key: String
    let form: NeedsAnswerForm
    let model: NeedsYouModel
    @State private var answers: [String] = []

    var body: some View {
        let count = form.reply ? 1 : form.questions.count
        VStack(alignment: .leading, spacing: 12) {
            ForEach(0..<count, id: \.self) { i in
                VStack(alignment: .leading, spacing: 6) {
                    if !form.reply { Text(form.questions[i]).font(.subheadline) }
                    TextField("", text: binding(i, count), axis: .vertical).lineLimit(1...6).textFieldStyle(.roundedBorder)
                    if i < form.picks.count, !form.picks[i].isEmpty {
                        HStack(spacing: 8) {
                            ForEach(form.picks[i], id: \.self) { c in
                                if value(i).trimmingCharacters(in: .whitespaces) == c {
                                    Button(c) { set(i, count, c) }.buttonStyle(.borderedProminent)
                                } else {
                                    Button(c) { set(i, count, c) }.buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button(form.send) {
                    let sent = (0..<count).map(value)
                    Task { await model.answer(key, sent) }
                }
                .buttonStyle(.borderedProminent)
                .disabled((0..<count).allSatisfy { value($0).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            }
        }
    }

    private func value(_ i: Int) -> String { i < answers.count ? answers[i] : "" }

    private func set(_ i: Int, _ count: Int, _ text: String) {
        if answers.count < count { answers += Array(repeating: "", count: count - answers.count) }
        answers[i] = text
    }

    private func binding(_ i: Int, _ count: Int) -> Binding<String> {
        Binding(get: { value(i) }, set: { set(i, count, $0) })
    }
}
