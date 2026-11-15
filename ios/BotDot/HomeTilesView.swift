import SwiftUI
import BotdotShared

/// The tiles-on-home sheet's model (#447): the shared HomeTilesDesk's state, and what a check or a drag hands back.
@MainActor
@Observable
final class HomeTilesModel {
    private(set) var state: HomeTilesState?
    private let desk: HomeTilesDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) { desk = home.homeTiles() }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }

    func toggle(_ id: String) async { try? await desk.toggle(id: id) }

    /// Rows on home moved in the list: the new order shown, then saved.
    func move(_ from: IndexSet, _ to: Int) async {
        var ids = (state?.on ?? []).map(\.id)
        ids.move(fromOffsets: from, toOffset: to)
        desk.order(ids: ids)
        try? await desk.drop()
    }
}

/// The tiles on home (Android's HomeTilesSheet, #447): every approved tile of the Board, those on home first in their
/// order, which drag to another place; a tap puts one on home or takes it off. Each change is saved at once.
struct HomeTilesView: View {
    let home: HomeStore
    @State private var model: HomeTilesModel?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let s = model?.state {
                    Section {
                        ForEach(s.on, id: \.id) { t in row(t, checked: true) }
                            .onMove { from, to in Task { await model?.move(from, to) } }
                    }
                    Section {
                        ForEach(s.rest, id: \.id) { t in row(t, checked: false) }
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle(tr("Board"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("Done")) { dismiss() } } }
            .modifier(NoticeOverlay(notice: model?.state?.notice, count: Int(model?.state?.noticeCount ?? 0)))
        }
        .task {
            if model == nil { model = HomeTilesModel(home: home) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private func row(_ t: HomeTileRow, checked: Bool) -> some View {
        Button { Task { await model?.toggle(t.id) } } label: {
            HStack(spacing: 12) {
                Image(systemName: checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? .primary : .secondary)
                Text(t.title).foregroundStyle(checked ? .primary : .secondary).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(t.title), " + (checked ? tr("on home") : tr("not on home")))
        .accessibilityHint(checked ? tr("Take off home") : tr("Put on home"))
    }
}
