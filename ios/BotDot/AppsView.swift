import SwiftUI
import Observation
import BotdotShared

/// Apps for one signed-in botdot: the shared layer's AppsStore and the state it pushes. Every rule and word is the
/// shared layer's (Apps, AppsDesk), as on Android's Connectors.
@MainActor
@Observable
final class AppsModel {
    private(set) var state: AppsState?
    let store: AppsStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = AppsStore(home: home)
    }

    func start() {
        guard watching == nil else { return }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        Task { await load() }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        store.close()
    }

    func load() async { try? await store.load() }
    func search(_ query: String) async { try? await store.search(query: query) }

    /// Connect: the app's sign-in page to open in Safari; nil when it connected at once, or could not.
    func connect(_ slug: String, another: Bool = false) async -> URL? {
        guard let page = try? await store.connect(slug: slug, another: another) else { return nil }
        return URL(string: page)
    }

    func remove(_ id: String) async { try? await store.remove(id: id) }
    func forget(_ slug: String) async { try? await store.forget(slug: slug) }
    func revoke(_ action: String) async { try? await store.revoke(action: action) }
    func saveKey(_ key: String) async -> Bool { (try? await store.saveKey(key: key))?.boolValue ?? false }
    func removeKey() async { try? await store.removeKey() }
}

/// Apps, as Android's Connectors: the Composio key at the top, the connected apps with which bots use them ("used by all
/// bots" when every bot does), what every bot may do without asking, and a search. Connect opens the app's sign-in in
/// Safari; back in the app, the list is read again.
struct AppsView: View {
    let home: HomeStore
    @State private var model: AppsModel?
    @State private var query = ""
    @State private var key = ""
    @State private var replacing = false
    @State private var askRemove: String?
    @State private var askRemoveKey = false
    @State private var notice: String?
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var phase

    var body: some View {
        List {
            if let model, let state = model.state, let info = state.info {
                rows(model, state, info)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Apps"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16)
                    .accessibilityIdentifier("notice")
            }
        }
        .alert(tr("Remove this app?"), isPresented: Binding(get: { askRemove != nil }, set: { if !$0 { askRemove = nil } }), presenting: askRemove) { id in
            Button(tr("Remove"), role: .destructive) { Task { await model?.remove(id) } }
            Button(tr("Keep"), role: .cancel) {}
        } message: { _ in
            Text(tr("Bots lose access to it, unless you connect it again."))
        }
        .alert(tr("Remove your Composio key?"), isPresented: $askRemoveKey) {
            Button(tr("Remove"), role: .destructive) { Task { await model?.removeKey() } }
            Button(tr("Keep"), role: .cancel) {}
        } message: {
            Text(tr("Apps stop working until you add another."))
        }
        .task {
            if model == nil {
                let made = AppsModel(home: home)
                made.start()
                model = made
            }
        }
        .onDisappear { model?.stop(); model = nil }
        // Back from signing in to an app in Safari: the new connection shows.
        .onChange(of: phase) { _, now in if now == .active { Task { await model?.load() } } }
        .task(id: model?.state?.noticeId) {
            guard let text = model?.state?.notice else { return }
            notice = text
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    @ViewBuilder
    private func rows(_ model: AppsModel, _ state: AppsState, _ info: ConnectorsInfo) -> some View {
        if let title = state.keyTitle {
            // No key yet, or Composio refuses it (#409): botdot makes no Composio account, so the owner pastes one.
            Section(title) { keyField(model) }
        } else {
            Section {
                if replacing {
                    keyField(model)
                } else {
                    HStack {
                        Text(state.keyLine ?? "")
                        Spacer()
                        if state.keyChanges {
                            Button(tr("Replace")) { replacing = true }.buttonStyle(.borderless)
                            Button(tr("Remove"), role: .destructive) { askRemoveKey = true }.buttonStyle(.borderless)
                        }
                    }
                }
                if let error = info.error, !error.isEmpty { Text(error).foregroundStyle(.red) }
            }
            Section(tr("Connected")) {
                ForEach(info.reconnect, id: \.slug) { a in
                    HStack {
                        Text(a.name.isEmpty ? a.slug : a.name)
                        Spacer()
                        Button(tr("Connect again")) { connect(a.slug) }.buttonStyle(.borderless)
                        Button(tr("Remove")) { Task { await model.forget(a.slug) } }.buttonStyle(.borderless).foregroundStyle(.secondary)
                    }
                }
                ForEach(info.connections, id: \.id) { c in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.app?.name ?? c.toolkit)
                            if let label = c.label { Text(label).font(.subheadline) }
                            Text(state.line(c: c)).font(.caption).foregroundStyle(Apps.shared.warns(c: c) ? .orange : .secondary)
                        }
                        Spacer()
                        if state.addsAccount(c: c) {
                            Button(tr("Add account")) { connect(c.toolkit, another: true) }.buttonStyle(.borderless)
                        }
                        Button(tr("Remove"), role: .destructive) { askRemove = c.id }.buttonStyle(.borderless)
                    }
                }
            }
            if !state.everyBot.isEmpty {
                Section(tr("Always allowed for all bots")) {
                    ForEach(state.everyBot, id: \.action) { g in
                        HStack {
                            Text(g.label.isEmpty ? g.action : g.label)
                            Spacer()
                            Button(tr("Revoke")) { Task { await model.revoke(g.action) } }.buttonStyle(.borderless)
                        }
                    }
                }
            }
            Section {
                TextField(tr("Find an app: Gmail, Notion, Slack…"), text: $query)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await model.search(query) } }
                    .accessibilityIdentifier("find")
                ForEach(state.found, id: \.slug) { a in
                    Button { connect(a.slug) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.name.isEmpty ? a.slug : a.name).foregroundStyle(.primary)
                                if let d = a.description_, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                            }
                            Spacer()
                            Text(tr("Connect")).font(.callout)
                        }
                    }
                }
            }
        }
    }

    /// The Composio key field: Save checks it with Composio; the link opens composio.dev in Safari.
    @ViewBuilder
    private func keyField(_ model: AppsModel) -> some View {
        SecureField(tr("Composio API key"), text: $key).textContentType(.password)
        HStack {
            Button(tr("Get a key at composio.dev")) { if let url = URL(string: Apps.shared.COMPOSIO_KEYS) { openURL(url) } }
                .buttonStyle(.borderless).foregroundStyle(.secondary)
            Spacer()
            if replacing { Button(tr("Cancel")) { replacing = false; key = "" }.buttonStyle(.borderless) }
            Button(tr("Save")) {
                let typed = key
                Task {
                    if await model.saveKey(typed) { key = ""; replacing = false }
                }
            }
            .buttonStyle(.borderless)
            .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    /// Connect: its sign-in page in Safari, or connected at once.
    private func connect(_ slug: String, another: Bool = false) {
        Task {
            if let url = await model?.connect(slug, another: another) { openURL(url) }
        }
    }
}
