import SwiftUI
import Observation
import BotdotShared

/// The app's Settings for one signed-in botdot: the shared layer's AppSettingsStore and the state it pushes. Which rows
/// show and what they say are the shared layer's (AppSettingsDesk), as on Android.
@MainActor
@Observable
final class SettingsModel {
    private(set) var state: AppSettingsState?
    let store: AppSettingsStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = AppSettingsStore(home: home)
    }

    func start() {
        guard watching == nil else { return }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        Task { try? await store.load() }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
    }

    deinit {
        store.close() // the screen is gone for good; a screen pushed over it keeps it
    }

    func setModel(_ id: String) async { try? await store.setModel(id: id) }
    func setEffort(_ id: String) async { try? await store.setEffort(id: id) }
    func setAdvanced(_ on: Bool) async { try? await store.setAdvanced(on: on) }
    func setLanguage(_ to: String) async { try? await store.setLanguage(to: to) }
    func setAutoUpdate(_ on: Bool) async { try? await store.setAutoUpdate(on: on) }
    func pick(_ preset: Usage.Preset) async { try? await store.pickUsage(preset: preset) }
}

/// Settings, as Android's: one flat list, a row per setting and no helper text. Apps; with Advanced on the default
/// model and reasoning; the language; Usage; Claude's sign-in; Updates with what the waiting version brings; the
/// Subscription of a managed account (in Safari); Advanced; botdot's address.
struct SettingsView: View {
    let app: AppModel
    let home: HomeStore
    @State private var model: SettingsModel?
    @State private var saved = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            if let model, let state = model.state {
                rows(model, state)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Settings"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if saved { Text(tr("Saved")).font(.footnote).foregroundStyle(.secondary) }
        }
        .task {
            if model == nil {
                let made = SettingsModel(home: home)
                made.start()
                model = made
            }
        }
        .task(id: model?.state?.savedAt) {
            guard (model?.state?.savedAt ?? 0) > 0 else { return }
            saved = true
            try? await Task.sleep(for: .seconds(2))
            saved = false
        }
    }

    @ViewBuilder
    private func rows(_ model: SettingsModel, _ state: AppSettingsState) -> some View {
        if let error = state.error {
            Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
        }
        Section {
            NavigationLink(tr("Apps")) { AppsView(home: home) }
            if Pages.shared.shows(features: home.store.version.value.value?.features) {
                NavigationLink(tr("Pages")) { PagesView(home: home) }
            }
        }
        if state.advanced || state.showsLanguage {
            Section {
                if state.advanced {
                    Picker(tr("Model"), selection: Binding(get: { state.info.settings.defaultModel }, set: { v in Task { await model.setModel(v) } })) {
                        ForEach(state.models, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
                if state.showsEffort {
                    Picker(tr("Reasoning"), selection: Binding(get: { state.info.settings.defaultEffort }, set: { v in Task { await model.setEffort(v) } })) {
                        ForEach(state.efforts, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
                if state.showsLanguage {
                    Picker(tr("Language"), selection: Binding(get: { state.language }, set: { v in Task { await model.setLanguage(v) } })) {
                        ForEach(state.languages, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
            }
        }
        if state.showsUsage {
            Section(tr("Usage")) { UsageRows(state: state) { preset in Task { await model.pick(preset) } } }
        }
        Section {
            if let claude = state.claude {
                LabeledContent("Claude", value: claude)
            }
            if let value = state.updateValue, let update = state.update {
                DisclosureGroup {
                    Toggle(tr("Update automatically"), isOn: Binding(get: { update.autoUpdate }, set: { on in Task { await model.setAutoUpdate(on) } }))
                    if let text = state.updateText { Text(text).font(.footnote).foregroundStyle(.secondary) }
                    if !state.updateNotes.isEmpty { WhatsNewNotes(entries: state.updateNotes) }
                } label: {
                    LabeledContent(tr("Updates"), value: value)
                }
            }
            // "Subscription" (ADR 234): a managed machine's billing page, in Safari.
            if let page = state.subscription, let url = URL(string: page) {
                Button(tr("Subscription")) { openURL(url) }.accessibilityIdentifier("subscription")
            }
            if state.showsAdvanced {
                Toggle(tr("Advanced"), isOn: Binding(get: { state.advanced }, set: { on in Task { await model.setAdvanced(on) } }))
            }
            Button { app.otherAddress() } label: {
                LabeledContent(tr("botdot's address"), value: state.address)
            }
            .foregroundStyle(.primary)
        }
    }
}

/// Settings → Usage: Today, 7 days or 30 days, the days it covers and a row a bot with its share; tokens only with
/// Advanced on.
private struct UsageRows: View {
    let state: AppSettingsState
    let pick: (Usage.Preset) -> Void

    var body: some View {
        Picker(tr("Usage"), selection: Binding(get: { state.usage.preset }, set: { pick($0) })) {
            ForEach(state.presets, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        if let error = state.usage.error {
            Text(error).font(.footnote).foregroundStyle(.red)
        } else if let range = state.usageRange {
            Text(range).font(.footnote).foregroundStyle(.secondary)
            if let none = state.usageNone {
                Text(none).font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(state.usageRows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(row.name).font(.subheadline)
                        Spacer()
                        Text(row.amount).font(.footnote).foregroundStyle(.secondary)
                    }
                    GeometryReader { g in
                        Capsule().fill(.quaternary).overlay(alignment: .leading) {
                            Capsule().fill(.secondary).frame(width: g.size.width * CGFloat(min(max(row.share, 0), 1)))
                        }
                    }
                    .frame(height: 4)
                }
            }
        } else {
            ProgressView()
        }
    }
}

/// What's new: each note's title and its points, as Android's WhatsNewEntries (the newest open, the rest by a tap).
struct WhatsNewNotes: View {
    let entries: [WhatsNew.Entry]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let line = WhatsNew.shared.countLine(entries: entries) {
                Text(line).font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(entries.enumerated()), id: \.element.id) { i, e in
                if WhatsNew.shared.openAtFirst(index: Int32(i)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(e.title).font(.subheadline.weight(.semibold))
                        ForEach(e.points, id: \.self) { Text("• " + $0).font(.subheadline) }
                    }
                } else {
                    DisclosureGroup(e.title) {
                        ForEach(e.points, id: \.self) { Text("• " + $0).font(.subheadline) }
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
        }
    }
}
