import SwiftUI
import BotDotKit

// MARK: - Vault

/// Saved logins bots can use without seeing them: the built-in vault, or Bitwarden's bot-dot folder
/// (with its cards and identities), as on the web.
struct VaultView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var items: [VaultItem] = []
    @State private var bw: BitwardenDetails?
    @State private var editing: LoginEdit?
    @State private var botsFor: VaultItem?

    struct LoginEdit: Identifiable { let item: VaultItem?; var id: String { item?.id ?? "new" } }

    private var locked: Bool { bw?.configured == true && bw?.unlocked != true }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Vault").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                        if bw?.configured == true {
                            (Text("Your Bitwarden's ") + Text("bot-dot").bold() + Text(" folder: logins, cards and identities your bots can use without ever seeing them."))
                                .foregroundStyle(Theme.muted)
                        } else {
                            Text("Saved logins your bots can use without ever seeing the password.").foregroundStyle(Theme.muted)
                        }
                    }
                    Spacer()
                    if !locked { Button("＋ Add login") { editing = LoginEdit(item: nil) }.buttonStyle(.pillPrimary) }
                }
                if let bw {
                    if bw.configured != true {
                        if bw.installed == false {
                            Caution(text: "To use Bitwarden, install its command-line tool first: brew install bitwarden-cli, then reload.")
                        } else {
                            BitwardenSetup(done: { Task { await load(); nav.sheet = .unlock("") } })
                        }
                    } else {
                        bitwardenBar(bw)
                        if let e = bw.error { Caution(text: e) }
                    }
                }
                if locked {
                    Empty(icon: "🔐", text: "Unlock Bitwarden to see what bots can use.")
                } else if items.isEmpty {
                    Empty(icon: "🔐", text: bw?.configured == true ? "Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here." : "No saved logins yet. Add one so a bot can sign in to a site for you.")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                        ForEach(items) { item in
                            VaultCard(item: item) { if item.isLogin { editing = LoginEdit(item: item) } else { botsFor = item } }
                        }
                    }
                }
            }
            .frame(maxWidth: 1100, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Vault")
        // Again once it's unlocked or locked (from here, the Needs banner or a pop-up).
        .task(id: "\(store.bitwarden?.unlocked ?? false)|\(store.bitwarden?.configured ?? false)") { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { e in LoginEditor(item: e.item, bitwarden: bw?.configured == true) }
        .sheet(item: $botsFor, onDismiss: { Task { await load() } }) { item in ItemBots(item: item) }
    }

    private func bitwardenBar(_ bw: BitwardenDetails) -> some View {
        HStack(spacing: 8) {
            Text("🛡 Bitwarden · \(bw.email ?? bw.server ?? "") · ") + (bw.unlocked == true
                ? Text("unlocked · \(bw.items ?? 0) item\(bw.items == 1 ? "" : "s") in bot-dot\(bw.lastSync.flatMap(Format.date).map { " · synced \(Format.ago($0))" } ?? "")")
                : Text("locked").bold())
            Spacer()
            if bw.unlocked == true {
                Button("Sync") { Task { do { try await store.syncBitwarden(); nav.pill = .ok("Synced") } catch { store.problem = error.localizedDescription }; await load() } }
                Button("Lock") { Task { try? await store.lockBitwarden(); nav.pill = .ok("Locked"); await load() } }
            } else {
                Button("Unlock") { nav.sheet = .unlock("") }.buttonStyle(.pillPrimary)
            }
        }
        .font(.geist(size: 13)).controlSize(.small)
        .padding(12).background(RoundedRectangle(cornerRadius: 14).fill(Theme.panel).stroke(Theme.line))
    }

    private func load() async {
        bw = try? await store.bitwardenDetails()
        items = (try? await store.vault()) ?? []
    }
}

struct VaultCard: View {
    let item: VaultItem
    let open: () -> Void
    @Environment(Store.self) private var store

    private var icon: String { ["card": "💳", "identity": "🪪"][item.kind ?? ""] ?? "🔑" }
    private var line: String {
        switch item.kind ?? "login" {
        case "card": "💳 \(item.brand ?? "Card") •••• \(item.last4 ?? "")\(item.expiry.map { " · expires \($0)" } ?? "") · you approve each payment"
        case "identity": "🪪 \(item.holder ?? "")\(item.email.map { " · \($0)" } ?? "")"
        default: "👤 \(item.username?.isEmpty == false ? item.username! : "(no username)") · 🔒 secret saved\(item.hasTotp == true ? " · two-step code" : "")\(item.insecureTls == true ? " · self-signed certificate OK" : "")"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(icon).font(.geist(size: 20)).frame(width: 36, height: 36).background(Circle().fill(Theme.sunk))
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name).font(.geist(size: 14, weight: .semibold))
                    Text(item.isLogin ? (item.site ?? "") : item.kind == "card" ? "Payment card" : "Identity").font(.geist(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            Text(line).font(.geist(size: 12.5))
            if item.reprompt == true { Text("Asks for the master password again in Bitwarden, so bots can't use it.").font(.geist(size: 12)).foregroundStyle(Theme.faint) }
            let names = item.allowedBots.map { id in store.bots.first { $0.id == id }?.name ?? id }
            Text(names.isEmpty ? "No bot may use it yet" : "Can be used by: \(names.joined(separator: ", "))")
                .font(.geist(size: 12.5)).foregroundStyle(names.isEmpty ? Theme.faint : Theme.muted)
            HStack { Spacer(); Button(item.isLogin ? "Edit" : "Bots…", action: open).controlSize(.small) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }
}

/// Add a login, or change one. The password field is secure and never shows the saved secret.
struct LoginEditor: View {
    let item: VaultItem?
    let bitwarden: Bool
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var site = ""
    @State private var username = ""
    @State private var password = ""
    @State private var allowedHosts = ""
    @State private var insecureTls = false
    @State private var bots: Set<String> = []
    @State private var failed: String?
    @State private var confirmDelete = false

    var body: some View {
        Dialog(item.map { "Edit \($0.name)" } ?? "Add login", width: 620) {
            HStack(alignment: .top, spacing: 12) {
                LabeledField("Name") { TextField("", text: $name, prompt: Text("e.g. Recipes")) }
                LabeledField("Website or server", hint: "the secret is only used with this address") { TextField("", text: $site, prompt: Text("recipes.example.com or pve.example.ts.net")) }
            }
            HStack(alignment: .top, spacing: 12) {
                LabeledField("Username, email or token ID") { TextField("", text: $username) }
                LabeledField("Password, token or key", hint: item == nil ? nil : "leave empty to keep the current one") {
                    SecureField("", text: $password, prompt: Text(item == nil ? "" : "••••••••")).textContentType(.newPassword)
                }
            }
            TextField("Additional exact hosts, separated by commas", text: $allowedHosts)
            Toggle("Accept a self-signed certificate (for your own servers, e.g. Proxmox or a NAS)", isOn: $insecureTls).toggleStyle(.checkbox)
            Caution(text: "Bots can use this login to sign in on the website, or to call its API: they write {{username}} and {{password}} in the request and botdot fills them in, so they never see the secret. For an API token, put the token ID in the first field and the secret in the second.")
            Text("Bots that may use it").font(.geist(size: 12.5, weight: .medium))
            BotPicks(selected: $bots, forSkills: false)
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            if item != nil { Button("Delete", role: .destructive) { confirmDelete = true } }
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button(item == nil ? "Save login" : "Save", action: save).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
                .disabled(site.trimmingCharacters(in: .whitespaces).isEmpty || (item == nil && password.isEmpty))
        }
        .onAppear {
            name = item?.name ?? ""; site = item?.site ?? ""; username = item?.username ?? ""
            allowedHosts = (item?.allowedHosts ?? []).joined(separator: ", ")
            insecureTls = item?.insecureTls ?? false; bots = Set(item?.allowedBots ?? [])
        }
        .onDisappear { password = "" }
        .confirmationDialog(bitwarden ? "Delete \"\(item?.name ?? "")\"? It moves to Bitwarden's trash, where you can restore it for 30 days." : "Delete the saved login \"\(item?.name ?? "")\"?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) {
                Task {
                    do { try await store.deleteVaultItem(item!.id); nav.pill = .ok("Login deleted"); dismiss() } catch { failed = error.localizedDescription }
                }
            }
        }
    }

    private func save() {
        let pw = password
        password = ""
        Task {
            do {
                try await store.saveVaultLogin(id: item?.id, name: name.trimmingCharacters(in: .whitespaces), site: site.trimmingCharacters(in: .whitespaces), username: username, password: pw, insecureTls: insecureTls, bots: Array(bots), allowedHosts: allowedHosts.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
                nav.pill = .ok(bitwarden ? (item == nil ? "Saved to Bitwarden (bot-dot folder)" : "Saved in Bitwarden") : item == nil ? "Login saved" : "Saved")
                dismiss()
            } catch { failed = error.localizedDescription }
        }
    }
}

/// Which bots may use a card or an identity from Bitwarden.
struct ItemBots: View {
    let item: VaultItem
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var bots: Set<String> = []
    @State private var failed: String?

    var body: some View {
        Dialog("\(item.kind == "card" ? "💳" : "🪪") \(item.name)", width: 480) {
            Text("\(item.kind == "card" ? "Bots that may pay with this card. You still approve every payment in a pop-up." : "Bots that may type these details into forms.") Change the details themselves in Bitwarden.")
                .foregroundStyle(Theme.muted)
            BotPicks(selected: $bots, forSkills: false)
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Save") {
                Task { do { try await store.setVaultBots(item.id, Array(bots)); dismiss() } catch { failed = error.localizedDescription } }
            }.buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
        }
        .onAppear { bots = Set(item.allowedBots) }
    }
}

/// Connecting Bitwarden with its API key.
struct BitwardenSetup: View {
    let done: () -> Void
    @Environment(Store.self) private var store
    @State private var server = "us"
    @State private var serverUrl = ""
    @State private var clientId = ""
    @State private var clientSecret = ""
    @State private var busy = false
    @State private var failed: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Use your Bitwarden").font(.geist(size: 15, weight: .semibold))
            (Text("Bots will use the logins, payment cards and identities in a folder called ") + Text("bot-dot").bold() + Text(" in your Bitwarden, and nothing else in it. You approve every card payment in a pop-up. Your master password is only used to unlock (after each restart of botdot) and is never saved."))
                .foregroundStyle(Theme.muted)
            (Text("1. In the Bitwarden web vault, open ") + Text("Settings → Security → Keys → View API key").bold() + Text(".\n2. Copy the ") + Text("client_id").bold() + Text(" and ") + Text("client_secret").bold() + Text(" here."))
            HStack(alignment: .top, spacing: 12) {
                LabeledField("Server") {
                    Picker("", selection: $server) {
                        Text("bitwarden.com (US)").tag("us")
                        Text("bitwarden.eu (EU)").tag("eu")
                        Text("Self-hosted…").tag("custom")
                    }.labelsHidden()
                }
                if server == "custom" { LabeledField("Address") { TextField("", text: $serverUrl, prompt: Text("https://vault.example.com")) } }
            }
            HStack(alignment: .top, spacing: 12) {
                LabeledField("client_id") { TextField("", text: $clientId, prompt: Text("user.xxxxxxxx-…")).autocorrectionDisabled() }
                LabeledField("client_secret") { SecureField("", text: $clientSecret) }
            }
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
            Button(busy ? "Connecting…" : "Connect Bitwarden", action: connect)
                .buttonStyle(.pillPrimary)
                .disabled(busy || clientId.isEmpty || clientSecret.isEmpty)
        }
        .font(.geist(size: 13))
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }

    private func connect() {
        busy = true
        failed = nil
        let secret = clientSecret
        Task {
            do {
                try await store.setUpBitwarden(server: server, serverUrl: serverUrl, clientId: clientId, clientSecret: secret)
                clientSecret = ""
                done()
            } catch { failed = error.localizedDescription }
            busy = false
        }
    }
}

// MARK: - Connectors

/// Apps bots can use through Composio: yours (and which bots may use each), and the marketplace.
struct ConnectorsView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.openURL) private var openURL
    @State private var state: ConnectorsState?
    @State private var catalog: [CatalogApp] = []
    @State private var next: String?
    @State private var total = 0
    @State private var search = ""
    @State private var category = ""
    @State private var categories: [CatalogCategory] = []
    @State private var botsFor: AppBots?
    @State private var disconnecting: ConnectorsState.Connection?
    @State private var key = ""
    @State private var email = ""
    @State private var accountOpen = false

    struct AppBots: Identifiable { let slug: String; let name: String; let justConnected: Bool; var id: String { slug } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Connectors").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                if let d = state {
                    if d.configured != true { notWorking(d) } else { page(d) }
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: 1100, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Connectors")
        .task { await load() }
        .task(id: "\(search)|\(category)") {
            guard state?.configured == true else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await loadCatalog(reset: true)
        }
        .sheet(item: $botsFor, onDismiss: { Task { await load() } }) { a in ChooseAppBots(slug: a.slug, name: a.name, justConnected: a.justConnected) }
        .confirmationDialog("Disconnect \(disconnecting?.name ?? "")? Bots lose access, and Composio revokes its access to your account.", isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } })) {
            Button("Disconnect", role: .destructive) {
                guard let c = disconnecting else { return }
                Task {
                    do { try await store.disconnect(c.id); nav.pill = .ok("Disconnected") } catch { store.problem = error.localizedDescription }
                    await load()
                }
            }
        }
    }

    private func notWorking(_ d: ConnectorsState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Connectors aren't working yet").font(.geist(size: 15, weight: .semibold))
            if let e = d.error { Text(e).foregroundStyle(Theme.faint) }
            Button("Try again") { Task { state = nil; await load() } }
            Text("Or use your own Composio account: paste its project API key (composio.dev → Settings → API keys).").font(.geist(size: 12.5)).foregroundStyle(Theme.faint)
            HStack {
                SecureField("Composio API key", text: $key).webField()
                Button("Save") { useKey(confirm: false) }.buttonStyle(.pillPrimary).disabled(key.isEmpty)
            }
        }
        .font(.geist(size: 13))
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }

    @ViewBuilder
    private func page(_ d: ConnectorsState) -> some View {
        if let e = d.error { Caution(text: e) }
        (Text("Your apps").font(.geist(size: 13, weight: .semibold)) + Text(" · choose which bots may use each one").foregroundStyle(Theme.faint))
        if d.connections.isEmpty {
            Text("No apps connected yet. Pick one below.").foregroundStyle(Theme.muted).padding(24).frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                ForEach(d.connections) { c in connectionCard(c) }
            }
        }
        (Text("Marketplace").font(.geist(size: 13, weight: .semibold)) + Text(" · " + (search.isEmpty && category.isEmpty ? "\(total) apps" : "\(total) match\(total == 1 ? "" : "es")")).foregroundStyle(Theme.faint))
            .padding(.top, 8)
        HStack {
            TextField("", text: $search, prompt: Text("Search apps, e.g. gmail, calendar, notion")).webField()
                .frame(minWidth: 140)
            Picker("", selection: $category) {
                Text("All categories").tag("")
                ForEach(categories, id: \.id) { c in Text("\(c.name) (\(c.count ?? 0))").tag(c.id) }
            }
            .labelsHidden().frame(maxWidth: 180)
        }
        let connected = Set(d.connections.filter { $0.status == "ACTIVE" }.map(\.toolkit))
        let pending = Set(d.connections.filter { $0.status != "ACTIVE" }.map(\.toolkit))
        if catalog.isEmpty {
            Text(search.isEmpty ? "" : "No apps match \"\(search)\". Try another word.").foregroundStyle(Theme.faint)
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
            ForEach(catalog) { t in catalogCard(t, connected: connected.contains(t.slug), pending: pending.contains(t.slug)) }
        }
        if next != nil {
            Button("Show more") { Task { await loadCatalog(reset: false) } }.frame(maxWidth: .infinity)
        }
        DisclosureGroup("Composio account", isExpanded: $accountOpen) { account(d) }
            .foregroundStyle(Theme.faint).padding(.top, 16)
    }

    private func connectionCard(_ c: ConnectorsState.Connection) -> some View {
        let status = c.statusText
        let users = store.bots.filter { (c.usedBy ?? []).contains($0.id) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                AppLogo(url: c.app?.logo, name: c.name)
                VStack(alignment: .leading, spacing: 3) { Text(c.name).bold(); Pill(status.text, warn: status.warn) }
            }
            FlowLayout(spacing: 6) {
                if users.isEmpty { Text("No bot uses it yet").font(.geist(size: 12.5)).foregroundStyle(Theme.faint) }
                ForEach(users) { b in HStack(spacing: 4) { NameFigure(Who(b)); Text(b.name) }.font(.geist(size: 12)).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(Theme.sunk)) }
            }
            HStack {
                if c.status == "ACTIVE" { Button("Bots…") { botsFor = AppBots(slug: c.toolkit, name: c.name, justConnected: false) } }
                else { Button("Connect again") { connect(c.toolkit, name: c.name) }.buttonStyle(.pillPrimary) }
                Button("Disconnect", role: .destructive) { disconnecting = c }
            }
            .controlSize(.small)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }

    private func catalogCard(_ t: CatalogApp, connected: Bool, pending: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                AppLogo(url: t.logo, name: t.name)
                VStack(alignment: .leading, spacing: 1) { Text(t.name).bold(); Text(t.subtitle).font(.geist(size: 12)).foregroundStyle(Theme.faint) }
            }
            Text(t.description ?? "").font(.geist(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(3)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                if connected { Pill("connected") }
                else if t.noAuth == true {
                    Button("Give to bots") { botsFor = AppBots(slug: t.slug, name: t.name, justConnected: false) }
                    Text("no sign-in needed").font(.geist(size: 12)).foregroundStyle(Theme.faint)
                } else if t.connect != "developer" {
                    Button(pending ? "Finish connecting" : "Connect") { connect(t.slug, name: t.name) }.buttonStyle(.pillPrimary)
                    if t.connect == "key" { Text("asks for your \(t.name) API key").font(.geist(size: 12)).foregroundStyle(Theme.faint) }
                } else {
                    Button("Connect") { connect(t.slug, name: t.name) }
                    Text("needs your own developer app in Composio").font(.geist(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            .controlSize(.small)
        }
        .padding(16).frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }

    @ViewBuilder
    private func account(_ d: ConnectorsState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if d.account == "botdot" {
                HStack {
                    TextField("Your email", text: $email).webField()
                    Button("Claim it", action: claim).disabled(!email.contains("@"))
                }
                Text(d.claimInvite.map { "Invite sent to \($0)." } ?? "For Composio's dashboard. Your apps stay connected.").font(.geist(size: 12))
                HStack {
                    SecureField("Or your own Composio key", text: $key).webField()
                    Button("Use") { useKey(confirm: !d.connections.isEmpty) }.disabled(key.isEmpty)
                }
            } else {
                HStack(spacing: 4) {
                    Text("Your key \(d.keyHint ?? "") ·")
                    Button("Remove", action: forgetKey).buttonStyle(.textLink)
                }
                .font(.geist(size: 12.5))
            }
        }
        .padding(.top, 8)
        .foregroundStyle(Theme.muted)
    }

    private func load() async {
        do { state = try await store.connectors() } catch { state = ConnectorsState(configured: false, error: error.localizedDescription, connections: []) }
        guard state?.configured == true else { return }
        if catalog.isEmpty { await loadCatalog(reset: true) }
        if categories.isEmpty { categories = await store.catalogCategories() }
    }

    private func loadCatalog(reset: Bool) async {
        do {
            let p = try await store.catalog(search: search.trimmingCharacters(in: .whitespaces), category: category, offset: reset ? nil : next)
            catalog = reset ? p.items : catalog + p.items
            next = p.nextOffset
            total = p.total ?? catalog.count
        } catch { store.problem = error.localizedDescription }
    }

    /// Composio's sign-in page opens in the browser; this waits for the connection to become active.
    private func connect(_ slug: String, name: String) {
        Task {
            let r: ConnectStart
            do { r = try await store.connectApp(slug) } catch { store.problem = error.localizedDescription; return }
            if r.noAuth == true { botsFor = AppBots(slug: slug, name: name, justConnected: false); return }
            guard let link = r.redirectUrl.flatMap(URL.init(string:)), let id = r.connectionId else { return }
            openURL(link)
            nav.pill = .busy("Sign in on the page that opened. botdot notices when you're done.")
            let until = Date().addingTimeInterval(600)
            while Date() < until {
                try? await Task.sleep(for: .seconds(3))
                guard let c = try? await store.connection(id) else { continue }
                if c.status == "ACTIVE" {
                    nav.pill = .ok("Connected")
                    await load()
                    botsFor = AppBots(slug: slug, name: name, justConnected: true)
                    return
                }
                if c.status == "FAILED" || c.status == "EXPIRED" {
                    nav.pill = .error("Connecting didn't work\(c.statusReason.map { ": \($0)" } ?? "")")
                    await load()
                    return
                }
            }
            nav.pill = nil
        }
    }

    private func useKey(confirm: Bool) {
        if confirm {
            let a = NSAlert()
            a.messageText = "Use your own Composio account? Apps connected so far need connecting again there."
            a.addButton(withTitle: "Use it"); a.addButton(withTitle: "Cancel")
            guard a.runModal() == .alertFirstButtonReturn else { return }
        }
        let k = key
        key = ""
        Task {
            do { try await store.setComposioKey(k); nav.pill = .ok("Saved"); catalog = []; state = nil; await load() } catch { store.problem = error.localizedDescription }
        }
    }

    private func forgetKey() {
        let a = NSAlert()
        a.messageText = "Stop using your Composio key? botdot uses its own Composio account instead, and apps connected with your key need connecting again."
        a.addButton(withTitle: "Stop using it"); a.addButton(withTitle: "Cancel")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        Task { try? await store.removeComposioKey(); catalog = []; state = nil; await load() }
    }

    private func claim() {
        Task {
            do { try await store.claimComposio(email); nav.pill = .ok("Invite sent. Check your email"); await load() } catch { store.problem = error.localizedDescription }
        }
    }
}

/// Which bots may use an app (they act on your real account).
struct ChooseAppBots: View {
    let slug: String
    let name: String
    let justConnected: Bool
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var bots: Set<String> = []
    @State private var failed: String?

    var body: some View {
        Dialog(justConnected ? "\(name) is connected" : "Bots that may use \(name)", width: 480) {
            Text("They act on your real account. They'll read freely, but only send, post, change or delete things when you (or their task) ask for it.")
                .foregroundStyle(Theme.muted)
            BotPicks(selected: $bots, forSkills: false)
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Save") {
                Task {
                    do { try await store.setAppBots(slug, Array(bots)); nav.pill = .ok("Saved"); dismiss() } catch { failed = error.localizedDescription }
                }
            }.buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
        }
        .onAppear { bots = Set(store.bots.filter { ($0.connectors ?? []).contains(slug) }.map(\.id)) }
    }
}

/// An app's logo. Composio's are SVG, which AsyncImage can't draw but NSImage can.
struct AppLogo: View {
    let url: String?
    let name: String
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image { Image(nsImage: image).resizable().scaledToFit().padding(3) }
            else { Text(String(name.prefix(1))).bold().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.sunk) }
        }
        .frame(width: 32, height: 32)
        .background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(image == nil ? 0 : 0.92)))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .task(id: url) { image = await LogoCache.shared.image(url) }
    }
}

@MainActor
final class LogoCache {
    static let shared = LogoCache()
    private var images: [String: NSImage] = [:]

    func image(_ url: String?) async -> NSImage? {
        guard let url, let link = URL(string: url) else { return nil }
        if let i = images[url] { return i }
        guard let (data, _) = try? await URLSession.shared.data(from: link), let i = NSImage(data: data) else { return nil }
        images[url] = i
        return i
    }
}

// MARK: - Shared bits

/// A tinted note: something to know before going on.
struct Caution: View {
    let text: String
    var body: some View {
        Text(text).font(.geist(size: 12.5)).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.warnSoft))
    }
}

/// An empty page's card.
struct Empty: View {
    let icon: String
    let text: String
    var body: some View {
        VStack(spacing: 8) {
            Text(icon).font(.geist(size: 28))
            Text(text).multilineTextAlignment(.center).foregroundStyle(Theme.muted)
        }
        .padding(36).frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }
}
