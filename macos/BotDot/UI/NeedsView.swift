import SwiftUI
import BotDotKit

/// What was decided on a card, shown faded until you leave (the page, or that chat).
@MainActor
@Observable
final class Decided {
    struct Entry: Hashable { let title: String; let label: String; let chat: ChatScope? }
    var entries: [String: Entry] = [:]
    func clear(except chat: ChatScope?) { entries = entries.filter { $0.value.chat == chat && chat != nil } }
}

/// The banner over every page: one small head per thing waiting, nothing to count, and Review.
struct NeedsBanner: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav

    var body: some View {
        let items = store.needs
        if !items.isEmpty && nav.page != .needs {
            HStack(spacing: 10) {
                NeedsFigures(who: items.map(\.who))
                Text("Waiting for your OK").font(.geist(size: 13.5))
                Button("Review") {
                    if items.count == 1 { nav.open(items[0], store: store) } else { nav.page = .needs }
                }
                .buttonStyle(.pillPrimary)
                .controlSize(.small)
            }
            .padding(.vertical, 9).padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .background(Theme.warnSoft)
        }
    }
}

/// Small heads in a row, one per thing waiting, that hop one after another (still with Reduce Motion):
/// each its bot's, or the Chief of Staff's for a thing that is about no bot.
struct NeedsFigures: View {
    let who: [Who?]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var up = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(who.enumerated()), id: \.offset) { i, w in
                NameFigure(w ?? .chief, text: 15.5)
                    .offset(y: up && !reduceMotion ? -3 : 0)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever().delay(Double(i) * 0.15), value: up)
            }
        }
        .onAppear { up = true }
        .accessibilityHidden(true)
    }
}

/// The Needs you page: every card, decided ones faded until you leave.
struct NeedsPage: View {
    @Environment(Store.self) private var store
    @State private var decided = Decided()

    var body: some View {
        let open = store.needs
        // What one click may approve: what a card shows in words. A script, and a guarded memory change
        // (one to what you said, and a forget), is answered on its own card.
        let all = ApproveAll(open.filter { decided.entries[$0.key] == nil })
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Needs you").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                    Spacer()
                    if let label = all.label {
                        Button(label) {
                            Task { for x in all.items { await decide(x, yes: true) } }
                        }
                        .buttonStyle(.pillPrimary)
                    }
                }
                // What the button above leaves for its own card, in one line.
                if let line = all.line {
                    Text(line).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .trailing)
                }
                if open.isEmpty && decided.entries.isEmpty { Text("All done.").foregroundStyle(Theme.muted) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                    ForEach(open.filter { decided.entries[$0.key] == nil }) { x in NeedCard(item: x, showWho: true, decided: decided, chat: nil).id("open:\(x.key)") }
                    // Their own ids: the same key as a waiting card would show that card again.
                    ForEach(decided.entries.sorted { $0.key < $1.key }, id: \.key) { key, d in
                        DecidedCard(entry: d).id("done:\(key)")
                    }
                }
            }
            .frame(maxWidth: 1100)
            .padding(.horizontal, 40).padding(.vertical, 34)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Needs you")
    }

    private func decide(_ x: NeedItem, yes: Bool) async {
        do {
            let said = try await store.decide(x, yes: yes)
            decided.entries[x.key] = .init(title: x.title, label: x.decided(yes: yes, started: said.carriesOn, said: said.text), chat: nil)
        } catch { store.problem = error.localizedDescription }
    }
}

struct DecidedCard: View {
    let entry: Decided.Entry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.title).font(.geist(size: 15, weight: .semibold))
            Text(entry.label).foregroundStyle(Theme.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
        .opacity(0.4)
    }
}

/// The cards at the end of a chat, and what you decided there.
struct ChatNeeds: View {
    let scope: ChatScope
    @Environment(Store.self) private var store
    @State private var decided = Decided()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(decided.entries.values.filter { $0.chat == scope }.sorted { $0.title < $1.title }, id: \.self) { d in
                Text("\(d.title) · \(d.label)").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            }
            ForEach(store.chatNeeds(scope)) { x in
                NeedCard(item: x, showWho: scope.namesWho, decided: decided, chat: scope).frame(maxWidth: 520, alignment: .leading)
            }
        }
    }
}

/// One thing waiting for your OK: whose it is, what, and its buttons. Click it to see all of it.
struct NeedCard: View {
    let item: NeedItem
    let showWho: Bool
    let decided: Decided
    let chat: ChatScope?
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var open = false
    @State private var confirmRemove = false
    @State private var confirmAlways = false
    @State private var confirmAction = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showWho, let who = item.who {
                // A card asked in a group says so after its bot's name ("Coder in Dev"), except in that group's chat.
                HStack(spacing: 5) { NameFigure(who); Text(item.asker(in: chat) ?? "") }
                    .font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            }
            Text(item.title).font(.geist(size: 15, weight: .semibold)).lineLimit(open ? nil : 2)
            if !item.meta.isEmpty {
                Text(item.meta).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(open ? nil : 1)
            }
            // What the yes approves, as rows: an action in a connected app. A closed card draws the first of
            // them, each on one line; an opened one every row and every value in full.
            if !item.rows.isEmpty { NeedFacts(rows: item.shownRows(open: open), whole: open) }
            // What a changed bot changes: what is switched on as rows, each changed text with what goes
            // struck above what comes. A text says which one it is when the change has more than one part.
            ForEach(Array(ChangedPart.groups(item.parts).enumerated()), id: \.offset) { _, group in
                if let text = group.first, text.was != nil {
                    ChangedText(part: text, named: item.parts.count > 1, open: open)
                } else {
                    NeedFacts(rows: group.map { Ask.Fact(label: $0.label, value: $0.now) }, whole: open)
                }
            }
            // A change to an approved job or tile: its proposer's sentence, then what goes above what comes.
            if let change = item.change { ChangeBody(card: change, open: open) }
            ForEach(Array(item.body.enumerated()), id: \.offset) { i, text in
                if open || i == 0 {
                    let code = item.kind == .job && item.job?.kind == "script" && i == 0
                    Text(text)
                        .font(code ? .geistMono(size: 12.5) : .geist(size: 13))
                        .strikethrough(item.kind == .memory && item.memory?.action == "edit" && i == 0 && item.body.count > 1)
                        .lineLimit(open ? nil : 3)
                        .textSelection(.enabled)
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
                }
            }
            // A tool from a link: its warning between the body and the facts, set apart in amber. A closed
            // card keeps two lines of it in sight; the facts show when the card is opened, as on the web page.
            if let warning = item.warning {
                Text("⚠️ \(warning)")
                    .font(.geist(size: 13))
                    .lineLimit(open ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk).stroke(Theme.warnLine))
            }
            if open, !item.facts.isEmpty { NeedFacts(rows: item.facts) }
            if open, let why = item.why { Text(why).font(.geist(size: 12.5)).foregroundStyle(Theme.muted) }
            if let note = item.note { Text(note).font(.geist(size: 12.5)).foregroundStyle(Theme.muted) }
            // Under a change: the approved one runs on while the card waits.
            if let line = item.change?.line { Text(line).font(.geist(size: 12.5)).foregroundStyle(Theme.muted) }
            // Who carries on after the yes, in the server's sentence: one line, also on a closed card. In
            // the Chief chat it speaks of, the sentence for that chat.
            if let then = item.then?.line(chiefChat: chat == .chief ? store.chief.chatId : nil) {
                Text(then).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Spacer()
                if item.kind == .plan { Button("Open chat") { if let c = item.planChat { nav.openChief(c, store: store) } }.buttonStyle(.textLink) }
                // A no in the server's words says what it does ("Decline and remove", "Keep as it is"): nothing is asked first.
                if let no = item.no { Button(no) { if item.kind == .job && !item.noSaid { confirmRemove = true } else { decide(false) } } }
                // "Always allow this action" grants the action with any arguments: it asks first.
                if item.always { Button(item.ask?.kind == "connector-action" ? "Always allow this action" : "Always approve") { if !showsAll() { return } else if item.ask?.kind == "connector-action" { confirmAction = true } else if item.runsScript { confirmAlways = true } else { decide(true, always: true) } } }
                if let yes = item.yes {
                    Button(yes) {
                        switch item.kind {
                        case .login, .pay, .bitwarden: nav.open(item, store: store)
                        default: if showsAll() { decide(true) }
                        }
                    }
                    .buttonStyle(.pillPrimary)
                }
            }
            .controlSize(.small)
            .disabled(working)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
        .contentShape(Rectangle())
        .onTapGesture { open.toggle() }
        .help("Click to see it all")
        .confirmationDialog("Remove this job?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { decide(false) }
        }
        .confirmationDialog(ConnectorCard.alwaysQuestion, isPresented: $confirmAction) {
            Button(ConnectorCard.alwaysYes) { decide(true, always: true) }
        }
        .confirmationDialog("Always approve \"\(item.job?.name ?? "")\" from \(item.who?.name ?? "")?", isPresented: $confirmAlways) {
            Button("Always approve") { decide(true, always: true) }
        } message: {
            let bot = item.who?.name ?? "the bot"
            Text("It's a script: it runs as commands on this computer with your permissions, without AI and without the bot's tool limits. If a web page or email ever tricks \(bot) into changing it, the new version would run on its schedule without you seeing it first.\n\nYou can take this back in \(bot)'s settings.")
        }
    }

    /// Whether the card draws all a yes approves. A closed card with more rows than it draws does not:
    /// the click on its yes opens it, and the yes is given by the next click (`NeedItem.yesAnswers`).
    private func showsAll() -> Bool {
        if item.yesAnswers(open: open) { return true }
        open = true
        return false
    }

    private func decide(_ yes: Bool, always: Bool = false) {
        working = true
        Task {
            do {
                let said = try await store.decide(item, yes: yes, always: always)
                decided.entries[item.key] = .init(title: item.title, label: item.decided(yes: yes, always: always, started: said.carriesOn, said: said.text), chat: chat)
            } catch { store.problem = error.localizedDescription }
            working = false
        }
    }
}

/// A tool's facts (its version, where it comes from, its size): rows of a faint label and its value, as
/// two columns that stay as narrow as their text on a wide card. A long value (an address, a checksum,
/// a file's name) wraps inside the card; nothing scrolls sideways. Every row the server sent is drawn,
/// also labels this app never saw. The rows of an action in a connected app and of a changed bot are
/// drawn by it too. `whole`: every value in full; without it each row keeps to one line, for a closed card.
struct NeedFacts: View {
    let rows: [Ask.Fact]
    var whole = true

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 2) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    Text(row.label).foregroundStyle(Theme.faint).lineLimit(whole ? nil : 1)
                    Text(row.value)
                        .lineLimit(whole ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
        }
        .font(.geist(size: 13))
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
    }
}

/// One changed text of a bot change (its main assignment, its rules): what goes, struck, above what
/// comes. Closed, the card shows the start of both. `named`: the change has more parts, so the text
/// says which one it is; alone, the card's title says it.
struct ChangedText: View {
    let part: ChangedPart
    let named: Bool
    let open: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if named { Text(part.label).font(.geist(size: 12.5)).foregroundStyle(Theme.faint) }
            if let was = part.was, !was.isEmpty {
                Text(was).strikethrough().foregroundStyle(Theme.muted).lineLimit(open ? nil : 2)
            }
            if !part.now.isEmpty { Text(part.now).lineLimit(open ? nil : 3) }
        }
        .font(.geist(size: 13))
        .textSelection(.enabled)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
    }
}

/// What a change to an approved job or tile changes (`ChangeCard`): its proposer's sentence first, as
/// text; then the approved scripts above the new ones, the text that goes struck above the one that
/// comes, and what else changes, a line each. Closed, a card with a sentence shows the sentence alone.
struct ChangeBody: View {
    let card: ChangeCard
    let open: Bool

    var body: some View {
        if let summary = card.summary {
            Text(summary).font(.geist(size: 13.5)).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            if !open { faint(ChangeCard.seeFull) }
        }
        if card.showsFull(open: open) {
            if let label = card.wasLabel { faint(label) }
            ForEach(Array(card.scriptsWas.enumerated()), id: \.offset) { _, script in box(script, code: true) }
            if let label = card.nowLabel { faint(label) }
            ForEach(Array(card.scripts.enumerated()), id: \.offset) { _, script in box(script, code: true) }
            if let was = card.textWas {
                ChangedText(part: ChangedPart(label: "", was: was, now: card.text), named: false, open: open)
            } else if !card.text.isEmpty, open || card.scripts.isEmpty {
                box(card.text, code: false)
            }
            ForEach(card.also, id: \.self) { faint($0) }
        }
    }

    private func faint(_ text: String) -> some View {
        Text(text).font(.geist(size: 12.5)).foregroundStyle(Theme.faint)
    }

    private func box(_ text: String, code: Bool) -> some View {
        Text(text)
            .font(code ? .geistMono(size: 12.5) : .geist(size: 13))
            .lineLimit(open ? nil : 3)
            .textSelection(.enabled)
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
    }
}

// MARK: - Logins, payments and Bitwarden

/// A bot needs a login: let it use one already saved, or save a new one. The password goes straight
/// into the vault (or Bitwarden); the AI never sees it.
struct LoginRequestSheet: View {
    let request: LoginRequest
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var password = ""
    @State private var name = ""
    @State private var insecureTls = false
    @State private var unlockPassword = ""
    /// "Use another saved login": the list is open, what is typed in its search, and the login the
    /// second question is about.
    @State private var othersOpen = false
    @State private var search = ""
    @State private var pickedId: String?
    /// The confirmation: its button takes a click only once armed, the answer is on its way, and
    /// what the server said when it refused.
    @State private var armed = false
    @State private var sending = false
    @State private var refusal: String?
    @FocusState private var searching: Bool

    var body: some View {
        let botName = request.bot?.name ?? "the bot"
        let bw = store.bitwarden
        let reusable = (request.existing ?? []).filter { $0.allowed != true }
        let others = OtherLogins.of(request)
        let listOpen = othersOpen && !others.isEmpty
        let picked = OtherLogins.picked(others, pickedId)
        Dialog(width: 480, close: { nav.snooze(request.id); dismiss() }) {
            Text("🔐"); NameFigure(request.bot ?? .chief, text: 17); Text("\(botName) needs a login")
        } content: {
            if let e = picked { confirmation(OtherLogins.confirm(request, e, by: botName), login: e) } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Website").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
                    Text(request.site).font(.geist(size: 17, weight: .semibold))
                    Text("It will only ever be used with this address, and only by \(botName).").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
                }
                if let reason = request.reason, !reason.isEmpty {
                    Text("\(request.from == "chief" ? "The Chief says" : "The bot says"): “\(reason)”").font(.geist(size: 13))
                }
                if !reusable.isEmpty {
                    GroupBox("Already in your Vault") {
                        ForEach(reusable, id: \.id) { e in
                            HStack {
                                Text("🔑 ") + Text(e.name ?? "").bold() + Text(e.username.map { " · \($0)" } ?? "")
                                Spacer()
                                Button("Let \(botName) use it") { answer { try await store.allowLogin(request, loginId: e.id) } }
                            }
                        }
                    }
                }
                if !others.isEmpty { otherLogins(others) }
                // The open list takes the place of the new-login fields: the sheet has no room for both.
                if !listOpen {
                if !reusable.isEmpty || !others.isEmpty {
                    Text("or save a new one:").font(.geist(size: 12)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity)
                }
                VStack(alignment: .leading, spacing: 12) {
                    TextField("", text: $username).field("Username, email or token ID")
                    SecureField("", text: $password).textContentType(.password).field("Password, token or key")
                    Toggle("Accept a self-signed certificate (for your own servers)", isOn: $insecureTls)
                    TextField("", text: $name).field("Save as")
                    if bw?.configured == true && bw?.unlocked != true {
                        SecureField("", text: $unlockPassword).field("Bitwarden master password")
                    }
                }
                Text("🛡 Goes straight into \(bw?.configured == true ? "your Bitwarden (bot-dot folder)" : "your encrypted Vault"). The AI never sees it, and it isn't written to the chat or logs. Only continue if you expected this request: web pages can try to trick bots into asking.")
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted)
                }
            }
        } foot: {
            if let e = picked { confirmationFoot(OtherLogins.confirm(request, e, by: botName), login: e) } else {
                Button("Decline", role: .destructive) { answer { try await store.declineRequest(request) } }
                Spacer()
                Button("Later") { nav.snooze(request.id); dismiss() }.keyboardShortcut(.cancelAction)
                if !listOpen {
                    Button("Save and continue", action: save).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
                        .disabled(password.isEmpty || (bw?.configured == true && bw?.unlocked != true && unlockPassword.isEmpty))
                }
            }
        }
        .onAppear { username = request.username ?? ""; name = request.name ?? "" }
        .onDisappear { password = ""; unlockPassword = "" }
    }

    /// The line that opens the logins saved for another website, and the list: with a search and a
    /// scroll of its own when it is long.
    @ViewBuilder private func otherLogins(_ others: [LoginRequest.Other]) -> some View {
        Button(OtherLogins.open) { othersOpen.toggle() }
            .buttonStyle(.textLink).frame(maxWidth: .infinity)
        if othersOpen {
            let long = OtherLogins.hasSearch(others)
            let shown = OtherLogins.shown(others, long ? search : "")
            GroupBox(OtherLogins.heading) {
                if long {
                    TextField(OtherLogins.search, text: $search).webField().focused($searching)
                        .onAppear { searching = true }
                }
                if shown.isEmpty {
                    Text(OtherLogins.noMatch).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.vertical, 6)
                } else if long {
                    ScrollView { otherRows(shown) }.frame(height: 240)
                } else {
                    otherRows(shown)
                }
            }
        }
    }

    private func otherRows(_ rows: [LoginRequest.Other]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rows) { e in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        (Text("🔑 ") + Text(e.name ?? "").bold() + Text((e.username ?? "").isEmpty ? "" : " · \(e.username ?? "")")).lineLimit(1)
                        Text(e.site ?? "").font(.geistMono(size: 11.5)).foregroundStyle(Theme.faint).lineLimit(1)
                    }
                    Spacer()
                    Button(OtherLogins.use) { refusal = nil; armed = false; pickedId = e.id }
                }
            }
        }
    }

    /// The second question: which login, where it is saved, and the host it will also be used on.
    /// Only its button answers the request.
    @ViewBuilder private func confirmation(_ c: OtherLogins.Confirm, login: LoginRequest.Other) -> some View {
        VStack(spacing: 4) {
            Text(OtherLogins.lead).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            Text(c.login).font(.geist(size: 17, weight: .semibold))
            Text(c.savedFor).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            Text(OtherLogins.on).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            Text(c.host).font(.geist(size: 17, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        Caution(text: "⚠️ \(c.warning)")
        if let refusal { Text(refusal).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
    }

    /// The buttons of the second question.
    @ViewBuilder private func confirmationFoot(_ c: OtherLogins.Confirm, login: LoginRequest.Other) -> some View {
        Group {
            if sending { Text(OtherLogins.sending).font(.geist(size: 12.5)).foregroundStyle(Theme.muted) }
            Spacer()
            Button(OtherLogins.back) { pickedId = nil }.keyboardShortcut(.cancelAction).disabled(sending)
            Button(c.yes) {
                sending = true
                refusal = nil
                Task {
                    // The server's refusal is shown here, in the question it answers; the request stays open.
                    do { try await store.allowLogin(request, loginId: login.id); dismiss() } catch { refusal = error.localizedDescription; sending = false }
                }
            }
            .disabled(!armed || sending)
        }
        .task(id: login.id) {
            try? await Task.sleep(for: OtherLogins.confirmAfter)
            armed = true
        }
    }

    private func save() {
        let (u, p, n, t, up) = (username, password, name.trimmingCharacters(in: .whitespaces), insecureTls, unlockPassword)
        password = ""
        unlockPassword = ""
        nav.snooze(request.id)
        dismiss()
        // Saving (and unlocking Bitwarden first) takes a few seconds: it goes on in the background.
        nav.pill = .busy("Saving login…")
        Task {
            do {
                try await store.saveLogin(request, username: u, password: p, name: n, insecureTls: t, unlockPassword: up.isEmpty ? nil : up)
                nav.pill = .ok("Saved. \(request.bot?.name ?? "The bot") will continue.")
            } catch {
                nav.pill = .error(error.localizedDescription.range(of: "not right", options: .caseInsensitive) != nil ? "Wrong master password, login not saved" : "Login not saved: \(error.localizedDescription)")
            }
        }
    }

    private func answer(_ work: @escaping () async throws -> Void) {
        Task {
            do { try await work(); dismiss() } catch { store.problem = error.localizedDescription }
        }
    }
}

/// A bot wants to pay: approve this card on this site (for this run, 15 minutes).
struct PaymentSheet: View {
    let request: LoginRequest
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let card = request.card
        Dialog(width: 460, close: { nav.snooze(request.id); dismiss() }) {
            Text("💳"); NameFigure(request.bot ?? .chief, text: 17); Text("\(request.bot?.name ?? "A bot") wants to pay")
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Text("On").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
                Text(request.site).font(.geist(size: 17, weight: .semibold))
                Text("with \(card?.name ?? "a card")\(card?.last4.map { " (\(card?.brand ?? "card") •••• \($0))" } ?? "")").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            }
            if let amount = request.amount { Text("Amount: ").foregroundStyle(Theme.muted) + Text(amount).bold() }
            if let reason = request.reason, !reason.isEmpty { Text("The bot says: ").foregroundStyle(Theme.muted) + Text("“\(reason)”") }
            Text("If you approve, botdot types the card details into the bot's browser on this site only (the bot never sees them). This covers this run on \(request.site) for 15 minutes. Only approve a purchase you asked for, and check the site is the one you expect.")
                .font(.geist(size: 12)).foregroundStyle(Theme.muted)
        } foot: {
            Button("Decline", role: .destructive) { answer { try await store.declineRequest(request) } }
            Spacer()
            Button("Later") { nav.snooze(request.id); dismiss() }.keyboardShortcut(.cancelAction)
            Button("Approve payment") { answer { try await store.approvePayment(request) } }.buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
        }
    }

    private func answer(_ work: @escaping () async throws -> Void) {
        Task {
            do { try await work(); dismiss() } catch { store.problem = error.localizedDescription }
        }
    }
}

/// Unlock Bitwarden with the master password: used once and forgotten.
struct UnlockSheet: View {
    var reason = ""
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""

    var body: some View {
        Dialog("🔐 Unlock Bitwarden", width: 420) {
            Text("\(reason.isEmpty ? "" : reason + " ")Bots can use the ") + Text("bot-dot").bold() + Text(" folder of \(store.bitwarden?.email ?? "your vault") once it's unlocked. It stays unlocked until botdot restarts or you lock it.")
            SecureField("Master password", text: $password).textContentType(.password).webField().onSubmit(unlock)
            Text("🛡 Used once to unlock and then forgotten: it isn't saved, and the AI never sees it.").font(.geist(size: 12)).foregroundStyle(Theme.muted)
        } foot: {
            Spacer()
            Button("Not now") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Unlock", action: unlock).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction).disabled(password.isEmpty)
        }
        .onDisappear { password = "" }
    }

    private func unlock() {
        let pw = password
        password = ""
        dismiss()
        nav.pill = .busy("Unlocking Password Manager…")
        Task {
            do {
                let moved = try await store.unlockBitwarden(pw)
                nav.pill = .ok(moved > 0 ? "Unlocked. Moved \(moved) saved login\(moved == 1 ? "" : "s") into Bitwarden." : "Unlocked")
            } catch {
                nav.pill = .error(error.localizedDescription.range(of: "not right", options: .caseInsensitive) != nil ? "Wrong master password" : error.localizedDescription)
            }
        }
    }
}

/// A note at the bottom while something goes on in the background (unlocking, saving a login), and when it is done.
struct PillView: View {
    let pill: Navigation.Pill
    let close: () -> Void

    var body: some View {
        Toast(text: pill.text, failed: { if case .error = pill { true } else { false } }(), busy: { if case .busy = pill { true } else { false } }())
            .onTapGesture { if case .busy = pill {} else { close() } }
        .task(id: pill.text) {
            if case .ok = pill { try? await Task.sleep(for: .seconds(3.2)); close() }
            if case .error = pill { try? await Task.sleep(for: .seconds(3.2)); close() }
        }
    }
}
