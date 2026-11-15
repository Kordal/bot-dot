import SwiftUI
import BotdotShared

/// The Chief's settings' model: the shared ChiefSettingsDesk's state, followed while the screen is there.
@MainActor
@Observable
final class ChiefSettingsModel {
    private(set) var state: ChiefSettingsState?
    let desk: ChiefSettingsDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) { desk = home.chiefSettings() }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil; desk.close() }
}

/// The Chief's settings (Android's ChiefSettingsScreen, #379 #381 #384 #408 #636): its name, its model and reasoning
/// (with Advanced), your rules for it and your skills for it, saved by themselves a moment after the last change;
/// what you always approved, with Revoke; its own jobs, each with its switch and Remove; its pages; the checkup's
/// switches; and its earlier chats, each opening in its chat.
struct ChiefSettingsView: View {
    let home: HomeStore
    /// An earlier chat tapped: it opens in the Chief's chat.
    let onChat: (String) -> Void
    @State private var model: ChiefSettingsModel?
    @State private var opening: DocumentView.Opening?

    var body: some View {
        Form {
            if let s = model?.state, s.loaded, let desk = model?.desk {
                rows(s, desk)
            } else if model?.state?.failed == true {
                // The first read failed: nothing to edit, only Try again (the notice says why).
                Button(tr("Try again")) { Task { try? await model?.desk.load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(home.store.chiefName.value)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $opening) { ViewerView(api: home.api, opening: $0) }
        // A page's keeping can change in the viewer: read the pages again when it closes, as Android does.
        .onChange(of: opening == nil) { _, closed in if closed { Task { try? await model?.desk.pagesAgain() } } }
        .modifier(NoticeOverlay(notice: model?.state?.notice, count: Int(model?.state?.noticeCount ?? 0)))
        .task {
            // Read only when the model was just made: back from a page, what is being typed stays (its pages are read again on close).
            if model == nil {
                model = ChiefSettingsModel(home: home)
                model?.start()
                try? await model?.desk.load()
            } else {
                model?.start()
            }
        }
        // A page opened in the viewer hides this screen too: keep following then; stop only when it is left.
        .onDisappear { if opening == nil { model?.stop(); model = nil } }
    }

    @ViewBuilder
    private func rows(_ s: ChiefSettingsState, _ desk: ChiefSettingsDesk) -> some View {
        if let name = s.name {
            Section(tr("Name")) {
                TextField(ChiefName.shared.role, text: Binding(get: { name }, set: { desk.setName(text: $0) }))
            }
        }
        if s.advanced {
            Section {
                Picker(tr("Model"), selection: Binding(get: { s.model }, set: { desk.setModel(id: $0) })) {
                    ForEach(s.models, id: \.id) { Text($0.label).tag($0.id) }
                }
                if s.thinks {
                    Picker(tr("Reasoning"), selection: Binding(get: { s.effort }, set: { desk.setEffort(id: $0) })) {
                        ForEach(s.efforts, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
            }
        }
        Section(tr("Your rules for it")) {
            TextField(tr("Your rules for it"), text: Binding(get: { s.rules }, set: { desk.setRules(text: $0) }), axis: .vertical)
                .lineLimit(3...10)
        }
        if let library = s.skills {
            Section(ChiefSkills.shared.TITLE) {
                if library.isEmpty { Text(ChiefSkills.shared.EMPTY).foregroundStyle(.secondary) }
                ForEach(library, id: \.name) { k in
                    Toggle(isOn: Binding(get: { s.picked.contains(k.name) }, set: { desk.setSkill(skill: k.name, on: $0) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(k.name)
                            if !k.description_.isEmpty { Text(k.description_).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        }
                    }
                }
            }
        }
        if !s.grants.isEmpty {
            Section(ChiefGrant.companion.TITLE) {
                ForEach(s.grants, id: \.id) { g in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.label)
                            Text(g.kind.hint).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(tr("Revoke")) { Task { try? await desk.revoke(g: g) } }.buttonStyle(.bordered)
                    }
                }
            }
        }
        if let jobs = s.jobs {
            Section(ChiefJobs.shared.TITLE) {
                if jobs.isEmpty { Text(ChiefJobs.shared.EMPTY).foregroundStyle(.secondary) }
                ForEach(jobs, id: \.id) { j in
                    Toggle(isOn: Binding(get: { j.on }, set: { on in Task { try? await desk.setJobOn(id: j.id, on: on) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(j.name)
                            Text(ChiefJobs.shared.line(job: j)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions { Button(tr("Remove"), role: .destructive) { Task { try? await desk.removeJob(id: j.id) } } }
                }
            }
        }
        if let pages = s.pages {
            Section(tr("Pages")) {
                if pages.isEmpty { Text(tr("None yet")).foregroundStyle(.secondary) }
                ForEach(pages, id: \.slug) { pg in
                    Button {
                        opening = DocumentView.shared.ofPage(botId: Pages.shared.CHIEF, slug: pg.slug, title: pg.title, from: home.store.chiefName.value)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pg.title)
                            Text(s.pageLine(page: pg)).font(.caption).foregroundStyle(pg.keep != nil ? .green : .secondary)
                        }
                    }
                    .tint(.primary)
                }
            }
        }
        if let c = s.checkup {
            Section {
                Toggle(isOn: Binding(get: { c.on }, set: { on in Task { try? await desk.setCheckup(field: "on", on: on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Checkup.companion.LABEL)
                        if !c.caption.isEmpty { Text(c.caption).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Toggle(Checkup.companion.WEB_SEARCH, isOn: Binding(get: { c.webSearch }, set: { on in Task { try? await desk.setCheckup(field: "webSearch", on: on) } }))
                    .disabled(!c.webSearchUsable)
            }
        }
        Section(tr("Earlier chats")) {
            if s.chats.isEmpty { Text(tr("No earlier chats")).foregroundStyle(.secondary) }
            ForEach(s.chats, id: \.id) { c in
                Button(c.title) { onChat(c.id) }.tint(.primary).lineLimit(1)
            }
        }
    }
}
