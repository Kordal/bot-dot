import SwiftUI
import Observation
import BotdotShared

/// Every bot's pages for the screen (PagesDesk): the shared layer's state, pushed as it changes.
@MainActor
@Observable
final class PagesModel {
    private(set) var state: PagesState?
    private let desk: PagesDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) { desk = home.pages() }

    /// It follows the list now.
    var following: Bool { watching != nil }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }

    /// Follows the list while the calling task runs: the view's own, which SwiftUI cancels when the list goes off
    /// screen (a page opened over it) and starts again when it comes back, read anew then.
    func follow() async {
        start()
        defer { stop() }
        await load()
        while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
    }
    func load() async { try? await desk.load() }
    func setOnBoard(_ page: PageInfo, _ on: Bool) async { try? await desk.setOnBoard(page: page, on: on) }
}

/// Every bot's pages (Android's PagesScreen, from Settings): the ones kept up to date first, then the others, each with
/// its bot and age, the dot of one kept up to date and, where the Board takes pages, its On the Board switch. A tap opens
/// it in the viewer; the list is read again when the viewer closes.
struct PagesView: View {
    let home: HomeStore
    @State private var model: PagesModel?
    @State private var open: DocumentView.Opening?

    var body: some View {
        List {
            if let state = model?.state {
                if let error = state.error { Text(error).foregroundStyle(.red) }
                if let empty = state.empty { Text(empty).foregroundStyle(.secondary) }
                if !state.kept.isEmpty {
                    Section(tr("Kept up to date")) { ForEach(state.kept, id: \.self) { row($0, state) } }
                }
                if !state.other.isEmpty {
                    Section(state.otherTitle) { ForEach(state.other, id: \.self) { row($0, state) } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Pages"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .navigationDestination(item: $open) { ViewerView(api: home.api, opening: $0) }
        .task {
            if model == nil { model = PagesModel(home: home) }
            await model?.follow()
        }
    }

    private func row(_ page: PageInfo, _ state: PagesState) -> some View {
        HStack(spacing: 12) {
            Button { open = DocumentView.shared.ofPage(botId: page.botId, slug: page.slug, title: page.title, from: page.bot) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "doc.richtext").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(page.title).lineLimit(1)
                        Text(state.line(page: page)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if page.keep != nil { Circle().fill(.green).frame(width: 7, height: 7) }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if state.board, let on = page.onBoard?.boolValue {
                Toggle("", isOn: Binding(get: { on }, set: { v in Task { await model?.setOnBoard(page, v) } }))
                    .labelsHidden().accessibilityLabel(tr("On the Board"))
            }
        }
    }
}
