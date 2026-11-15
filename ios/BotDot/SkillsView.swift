import SwiftUI
import BotdotShared

/// Settings → Skills' model: the shared SkillsDesk's state.
@MainActor
@Observable
final class SkillsModel {
    private(set) var state: SkillsState?
    let desk: SkillsDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) { desk = home.skills() }

    func follow() async {
        if watching == nil { watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } } }
        try? await desk.load()
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }
}

/// Settings → Skills (Android's SkillsScreen): your library, each with who uses it, opening to what it tells the bot,
/// who uses it by name and who made it; then the skills built into Claude Code. They are given to a bot in its
/// settings, and to the Chief in its.
struct SkillsView: View {
    let home: HomeStore
    @State private var model: SkillsModel?

    var body: some View {
        List {
            if let s = model?.state, s.loaded {
                if let error = s.error { Text(error).foregroundStyle(.red) }
                Section {
                    if s.library.isEmpty { Text(tr("Your library is empty. Ask the Chief to make or import one.")).foregroundStyle(.secondary) }
                    ForEach(s.library, id: \.name) { k in
                        NavigationLink { detail(k) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.name).font(.headline)
                                if !k.description_.isEmpty { Text(k.description_).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                                Text(SkillWords.shared.usedLine(k: k)).font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
                if !s.builtin.isEmpty {
                    Section(tr("Built into Claude Code")) {
                        Text(s.builtin.map(\.name).joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Skills"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.follow() }
        .task {
            if model == nil { model = SkillsModel(home: home) }
            await model?.follow()
        }
        .onDisappear { model?.stop() }
    }

    private func detail(_ k: Skill) -> some View {
        List {
            Section {
                if !k.description_.isEmpty { Text(k.description_) }
                Text(model?.desk.users(k: k) ?? "").foregroundStyle(.secondary)
                if let made = model?.desk.madeBy(k: k) { Text(made).foregroundStyle(.secondary) }
            }
            Section(tr("What it tells the bot")) {
                if k.instructions.isEmpty { Text(tr("(empty)")).foregroundStyle(.secondary) } else { MarkdownView(text: k.instructions) }
            }
        }
        .navigationTitle(k.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
