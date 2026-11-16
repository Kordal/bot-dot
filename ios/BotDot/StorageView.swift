import SwiftUI
import BotdotShared

/// Settings → Storage's model: the shared StorageDesk's state.
@MainActor
@Observable
final class StorageModel {
    private(set) var state: StorageState?
    let desk: StorageDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) { desk = home.storage() }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }

    /// Read it while the screen is there, and again every few seconds while botdot measures.
    func follow() async {
        start()
        defer { stop() }
        try? await desk.load()
    }
}

/// Settings → Storage (Android's StorageScreen): the total, a bar of the groups and a row each, then the largest
/// files. A group or a folder opens to what it holds, largest first. A row Files opens has Open in Files and, where
/// it can go, Delete…, which asks first; the caches clear from their row after the same question.
struct StorageView: View {
    let home: HomeStore
    @State private var model: StorageModel?
    @State private var asking: StorageRow?
    @State private var clearing: Storage.Group?
    @State private var files: FilesPlace?
    /// Ask the Chief: a new Chief chat with the question in its box.
    @State private var asked: Asked?
    struct Asked: Identifiable, Hashable { let words: String; var id: String { words } }

    var body: some View {
        List {
            if let s = model?.state {
                if s.answer == nil {
                    Text(s.error ?? tr("Loading…")).foregroundStyle(.secondary)
                } else {
                    Text(s.total).font(.largeTitle.weight(.semibold)).listRowSeparator(.hidden)
                    if s.trail.isEmpty {
                        groups(s)
                        if !s.largest.isEmpty { Section(tr("Largest")) { ForEach(s.largest, id: \.key) { row($0) } } }
                    } else {
                        if s.rows.isEmpty { Text(tr("Nothing here.")).foregroundStyle(.secondary) }
                        ForEach(s.rows, id: \.key) { row($0) }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(model?.state?.title ?? tr("Storage"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model?.state?.trail.isEmpty == false)
        .toolbar {
            if model?.state?.trail.isEmpty == false {
                ToolbarItem(placement: .topBarLeading) {
                    Button { _ = model?.desk.back() } label: { Image(systemName: "chevron.backward") }.accessibilityLabel(tr("Back"))
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { try? await model?.desk.check() } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(model?.state?.checking == true)
                        .accessibilityLabel(tr("Check again"))
                }
            }
        }
        .confirmationDialog(asking.map { model?.desk.deleteWords(r: $0) ?? "" } ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), titleVisibility: .visible) {
            Button(tr("Delete"), role: .destructive) { if let r = asking { Task { _ = try? await model?.desk.delete(r: r) } } }
            Button(tr("Cancel"), role: .cancel) {}
        }
        .confirmationDialog(clearing.map { model?.desk.clearWords(g: $0) ?? "" } ?? "", isPresented: Binding(get: { clearing != nil }, set: { if !$0 { clearing = nil } }), titleVisibility: .visible) {
            Button(tr("Clear"), role: .destructive) { Task { _ = try? await model?.desk.clearCaches() } }
            Button(tr("Cancel"), role: .cancel) {}
        }
        .navigationDestination(item: $files) { FilesView(api: home.api, at: $0) }
        .navigationDestination(item: $asked) { a in ChiefView(home: home, words: a.words) }
        .modifier(NoticeOverlay(notice: model?.state?.notice, count: Int(model?.state?.noticeCount ?? 0)))
        .task {
            if model == nil { model = StorageModel(home: home) }
            await model?.follow()
        }
    }

    @ViewBuilder
    private func groups(_ s: StorageState) -> some View {
        Section {
            ForEach(s.groups, id: \.id) { g in
                HStack {
                    Button { model?.desk.open(name: g.id) } label: {
                        HStack {
                            Circle().fill(StorageView.color(g.id)).frame(width: 10, height: 10)
                            Text(Storage.shared.groupName(id: g.id))
                            Spacer()
                            Text(Storage.shared.size(bytes: g.bytes)).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    if g.id == "caches" {
                        Button(tr("Clear")) { clearing = g }.buttonStyle(.borderless).disabled(s.busy)
                    }
                }
            }
        }
    }

    private func row(_ r: StorageRow) -> some View {
        Button {
            if r.opens { model?.desk.open(name: r.into) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: r.dir ? "folder" : "doc").foregroundStyle(.secondary)
                Text(r.name).lineLimit(1)
                if let owner = r.owner { Text(owner).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer(minLength: 4)
                ProgressView(value: Double(r.share)).frame(width: 40)
                Text(Storage.shared.size(bytes: r.bytes)).font(.callout).foregroundStyle(.secondary).frame(minWidth: 64, alignment: .trailing)
                if r.opens { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let w = r.`where` {
                if !w.place.gone {
                    Button { files = FilesPlace(owner: Storage.shared.ownerOf(p: w.place), name: "", place: Storage.shared.rootOf(p: w.place), path: model?.desk.filesFolder(r: r) ?? "") } label: {
                        Label(tr("Open in Files"), systemImage: "folder")
                    }
                }
                Button {
                    if let model { asked = Asked(words: home.askChief(desk: model.desk, r: r)) }
                } label: { Label(tr("Ask the Chief"), systemImage: "bubble.left") }
                if r.deletable { Button(role: .destructive) { asking = r } label: { Label(tr("Delete…"), systemImage: "trash") } }
            }
        }
    }

    /// A group's colour, as Android's.
    static func color(_ id: String) -> Color {
        switch id {
        case "computer": .blue
        case "bots": .green
        case "projects": .orange
        case "uploads": .pink
        case "chats": .purple
        case "caches": .gray
        default: Color(white: 0.3)
        }
    }
}
