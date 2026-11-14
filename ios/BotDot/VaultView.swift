import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// Passwords, as the Android app's Vault: the entries without a category first, then a heading for each category that
/// folds it, a search field once the list is longer than eight, and a login's editor (Add, or a tap on a login).
/// Bitwarden locked: its master password unlocks it. Pull down to read it again.
struct VaultView: View {
    @State private var vault: VaultModel
    @State private var editing: Editing?
    @State private var master = ""
    @State private var unlocking = false
    @State private var unlockError: String?

    init(api: Api, settings: Settings) {
        _vault = State(initialValue: VaultModel(api: api, settings: settings))
    }

    /// The editor that is open: a new login, or a saved one.
    enum Editing: Identifiable {
        case new
        case saved(VaultItem)
        var id: String { if case .saved(let i) = self { i.id } else { "" } }
        var item: VaultItem? { if case .saved(let i) = self { i } else { nil } }
    }

    var body: some View {
        List {
            if let error = vault.state?.error ?? vault.error {
                Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
            }
            if let state = vault.state, state.items != nil || state.bitwarden != nil {
                if state.locked {
                    unlock
                } else {
                    entries(state)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .modifier(Search(shows: vault.state?.searches == true, query: $vault.query))
        .refreshable { await vault.refresh() }
        .navigationTitle(tr("Passwords"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await vault.start() }
        .onDisappear { vault.stop() }
        .sheet(item: $editing) { e in
            if let state = vault.state {
                LoginEditor(vault: vault, state: state, item: e.item)
            }
        }
    }

    @ViewBuilder
    private func entries(_ state: VaultState) -> some View {
        ForEach(vault.sections, id: \.category) { s in
            if s.category.isEmpty {
                Section { rows(s.items, state) }
            } else {
                Section {
                    if s.open { rows(s.items, state) }
                } header: {
                    Button {
                        Task { await vault.toggle(s.category) }
                    } label: {
                        HStack {
                            Text(s.category).lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.right").rotationEffect(.degrees(s.open ? 90 : 0))
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(s.open ? "" : tr("Folded"))
                }
            }
        }
        if state.noMatches(query: vault.query) {
            Text(tr("No matches")).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        }
        Section {
            Button("＋ " + tr("Add")) { editing = .new }.accessibilityIdentifier("add")
        }
    }

    private func rows(_ items: [VaultItem], _ state: VaultState) -> some View {
        ForEach(items, id: \.id) { i in
            let row = VaultRow(item: i, lines: state.lines(i: i), bots: state.botsLine(i: i))
            if state.edits(i: i) {
                Button { editing = .saved(i) } label: { row }.buttonStyle(.plain)
            } else {
                row
            }
        }
    }

    private var unlock: some View {
        Section("🛡 " + tr("Bitwarden is locked")) {
            SecureField(tr("Master password"), text: $master).textContentType(.password)
            if let unlockError { Text(unlockError).foregroundStyle(.red) }
            Button(unlocking ? tr("Unlocking…") : tr("Unlock")) {
                let typed = master
                master = ""
                unlocking = true
                Task {
                    unlockError = await vault.unlock(typed)
                    unlocking = false
                }
            }
            .disabled(master.isEmpty || unlocking)
        }
    }

    /// The search field, only above a list longer than eight.
    private struct Search: ViewModifier {
        let shows: Bool
        @Binding var query: String
        func body(content: Content) -> some View {
            if shows { content.searchable(text: $query, prompt: tr("Search")) } else { content }
        }
    }
}

/// One entry: its kind's mark and its name, the lines the shared layer writes for it, and which bots may use it.
struct VaultRow: View {
    let item: VaultItem
    let lines: [String]
    let bots: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(Vault.shared.icon(kind: item.kind)) \(item.name)").font(.body)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                Text(l).font(.subheadline).foregroundStyle(.secondary)
            }
            if let bots { Text(bots).font(.caption).foregroundStyle(.tertiary) }
        }
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// Adds a login or changes one: its Type first, then the fields of that type, its category and its additional hosts.
/// No switch and no bots: every login is usable in its computer (ADR 177), and a bot gets one by asking (ADR 192).
struct LoginEditor: View {
    let vault: VaultModel
    let state: VaultState
    let item: VaultItem?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var site: String
    @State private var type: String
    @State private var username: String
    @State private var secret = ""
    @State private var hosts: String
    @State private var category: String
    @State private var error: String?
    @State private var busy = false
    @State private var askDelete = false
    @State private var picking = false

    init(vault: VaultModel, state: VaultState, item: VaultItem?) {
        self.vault = vault
        self.state = state
        self.item = item
        let f = VaultLogin.companion.of(item: item)
        _name = State(initialValue: f.name)
        _site = State(initialValue: f.site)
        _type = State(initialValue: f.type)
        _username = State(initialValue: f.username)
        _hosts = State(initialValue: f.hosts)
        _category = State(initialValue: f.category)
    }

    private var form: VaultLogin {
        VaultLogin(name: name, site: site, type: type, username: username, secret: secret, hosts: hosts, category: category)
    }

    var body: some View {
        let fields = state.fields(form: form, isNew: item == nil)
        NavigationStack {
            Form {
                if state.showsType {
                    Picker(VaultTypes.shared.CONTROL, selection: Binding(get: { type }, set: { id in
                        let next = form.typed(id: id)
                        type = next.type
                        site = next.site
                    })) {
                        ForEach(state.typeIds(current: item?.type), id: \.self) { Text(state.typeLabel(id: $0)).tag($0) }
                    }
                }
                Labeled(tr("Name")) { TextField(tr("Name"), text: $name, prompt: Text("")) }
                Labeled(tr("Website or server")) {
                    TextField(tr("Website or server"), text: $site, prompt: Text("pve.example.ts.net"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let label = fields.username {
                    Labeled(label) {
                        TextField(label, text: $username, prompt: Text(""))
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                if fields.multiline {
                    // A secret of several lines (a private key): as it is, line breaks too, or read from its file.
                    Labeled(fields.secret) {
                        TextField(fields.secret, text: $secret, prompt: Text(""), axis: .vertical)
                            .lineLimit(3...6).font(.body.monospaced()).privacySensitive()
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    Button(tr("Pick its file")) { picking = true }
                } else {
                    Labeled(fields.secret) { SecureField(fields.secret, text: $secret, prompt: Text("")).textContentType(.password) }
                }
                if state.categories {
                    Labeled(tr("Category")) {
                        TextField(tr("Category"), text: Binding(get: { category }, set: { category = String($0.prefix(Int(VaultTypes.shared.CATEGORY_MAX))) }), prompt: Text(""))
                    }
                    let picks = state.suggestions(typed: category)
                    if !picks.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(picks, id: \.self) { c in
                                    Button(c) { category = c }.buttonStyle(.bordered).buttonBorderShape(.capsule)
                                }
                            }
                        }
                    }
                }
                Labeled(tr("Additional exact hosts")) {
                    TextField(tr("Additional exact hosts"), text: $hosts, prompt: Text("api.example.com, auth.example.com"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("error") }
                if item != nil {
                    Button(tr("Delete"), role: .destructive) { askDelete = true }.disabled(busy)
                }
            }
            .navigationTitle(item.map { tr("Edit {name}", ["name": $0.name]) } ?? tr("Add to Passwords"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? tr("Saving…") : tr("Save")) { save() }.disabled(busy || !form.canSave(isNew: item == nil))
                }
            }
            .confirmationDialog(item.map { tr("Delete {name}?", ["name": $0.name]) } ?? "", isPresented: $askDelete, titleVisibility: .visible) {
                Button(tr("Delete"), role: .destructive) { delete() }
                Button(tr("Keep"), role: .cancel) {}
            } message: {
                Text(Vault.shared.deleteWords(bitwarden: state.inBitwarden))
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.item]) { picked in read(picked) }
        }
        .presentationDetents([.large])
    }

    private func save() {
        let sent = form
        busy = true
        Task {
            // A refused save: the server's sentence, the form as it was typed, the secret cleared (docs/api.md).
            if let refused = await vault.save(item, sent) {
                error = refused
                secret = ""
                busy = false
            } else {
                dismiss()
            }
        }
    }

    private func delete() {
        guard let item else { return }
        busy = true
        Task {
            if let refused = await vault.delete(item) {
                error = refused
                busy = false
            } else {
                dismiss()
            }
        }
    }

    /// The secret read from the file the owner picked: at most 64 KB, its text as it is.
    private func read(_ picked: Result<URL, Error>) {
        guard case .success(let url) = picked else { return }
        let open = url.startAccessingSecurityScopedResource()
        defer { if open { url.stopAccessingSecurityScopedResource() } }
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > Int(VaultTypes.shared.SECRET_FILE_MAX) {
            error = tr("That file is too big for Passwords (64 KB at most).")
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            error = tr("Couldn't read that file.")
            return
        }
        guard data.count <= Int(VaultTypes.shared.SECRET_FILE_MAX) else {
            error = tr("That file is too big for Passwords (64 KB at most).")
            return
        }
        secret = String(decoding: data, as: UTF8.self)
        error = nil
    }
}

/// A field of the editor with its label above it, which stays when the field is filled.
private struct Labeled<Field: View>: View {
    let label: String
    @ViewBuilder let field: () -> Field

    init(_ label: String, @ViewBuilder field: @escaping () -> Field) {
        self.label = label
        self.field = field
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
            field()
        }
    }
}
