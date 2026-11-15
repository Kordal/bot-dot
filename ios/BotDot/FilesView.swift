import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// Files on the iPhone (#1368), as Android's: one folder of a bot's, the Chief's or a project's files, folders first in
/// the order picked under Sort. At the top: the place (on botdot, the computer, each project, what is kept in mind)
/// and search in every place. A folder opens as the next screen, a file in the viewer; press and hold an entry for
/// what it can do; + uploads from Photos or Files, or makes a folder. A computer that is off starts only on a tap.
struct FilesView: View {
    let at: FilesPlace
    @State private var model: FilesModel
    @State private var photos: [PhotosPickerItem] = []
    @State private var picking = false
    @State private var importing = false
    @State private var naming: Naming?
    @State private var typed = ""
    @State private var deleting: (entry: WorkspaceEntry, words: String)?
    @State private var sharing: SharedFile?
    /// The file asked for on the way in, opened once over the folder.
    @State private var opened: DocumentView.Opening?
    @State private var fileOpened = false

    /// A name asked for: a new folder, or an entry's new name.
    private enum Naming: Identifiable {
        case folder
        case rename(WorkspaceEntry)
        var id: String { if case .rename(let e) = self { return "rename:" + e.path } else { return "folder" } }
    }

    init(api: Api, at: FilesPlace) {
        self.at = at
        _model = State(initialValue: FilesModel(api: api, at: at))
    }

    var body: some View {
        content
            .navigationTitle(model.state?.title ?? at.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .modifier(Searching(on: model.state?.searches == true, query: Binding(get: { model.state?.query ?? "" }, set: { model.files.search(query: $0) })))
            .refreshable { await model.refresh() }
            .overlay(alignment: .bottom) { Notice(text: $model.notice) }
            .alert(naming.map { if case .folder = $0 { tr("New folder") } else { tr("Rename") } } ?? "", isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
                TextField(tr("Name"), text: $typed)
                Button(tr("Cancel"), role: .cancel) { naming = nil }
                Button(naming.map { if case .folder = $0 { tr("Make") } else { tr("Rename") } } ?? "") { name() }
                    .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .alert(tr("Delete?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button(tr("Cancel"), role: .cancel) { deleting = nil }
                Button(tr("Delete"), role: .destructive) {
                    if let e = deleting?.entry { Task { await model.delete(e) } }
                    deleting = nil
                }
            } message: {
                Text(deleting?.words ?? "")
            }
            .sheet(item: $sharing) { ShareSheet(url: $0.url) }
            .onChange(of: photos) { pick(photos) }
            // A picker presented from the menu's button: one placed in a Menu doesn't open reliably.
            .photosPicker(isPresented: $picking, selection: $photos, matching: .any(of: [.images, .videos]))
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result {
                    let copies = urls.map { ($0.lastPathComponent, Self.copied($0)) }
                    Task { await model.upload(copies.compactMap(\.1), unread: copies.filter { $0.1 == nil }.map(\.0)) }
                }
            }
            .navigationDestination(item: $opened) { ViewerView(api: model.files.api, opening: $0) }
            .task {
                model.start()
                if !at.file.isEmpty, !fileOpened { fileOpened = true; opened = model.files.openingOf(path: at.file) }
            }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        if let s = model.state {
            switch s.pane {
            case .computerOff:
                ContentUnavailableView {
                    Label(tr("The computer is off."), systemImage: "power")
                } actions: {
                    Button(tr("Start the computer")) { Task { await model.startComputer() } }.buttonStyle(.borderedProminent)
                }
            case .gone:
                ContentUnavailableView(tr("This folder is gone."), systemImage: "folder.badge.questionmark")
            case .failed:
                ContentUnavailableView(s.failedWords, systemImage: "exclamationmark.triangle")
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .empty:
                ContentUnavailableView(s.emptyWords, systemImage: "folder")
            case .searchFailed:
                ContentUnavailableView {
                    Label(s.searchFailedWords, systemImage: "exclamationmark.triangle")
                } actions: {
                    Button(tr("Try again")) { model.files.retrySearch() }
                }
            case .entries:
                List {
                    // Keyed by place and path: a search finds the same path in more than one place.
                    ForEach(s.shown.indices.map { (key: s.shownAt[$0] + "\u{0}" + s.shown[$0].path, i: $0) }, id: \.key) { k in row(s, k.i, s.shown[k.i]) }
                }
                .listStyle(.plain)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func row(_ s: FilesState, _ i: Int, _ e: WorkspaceEntry) -> some View {
        let label = EntryRow(name: e.name, detail: s.detail(i: Int32(i)), icon: Self.icon(s.kind(e: e)))
        Group {
            if e.type == "folder" {
                NavigationLink(value: FilesPlace(owner: at.owner, name: at.name, place: s.shownAt[i], path: e.path)) { label }
            } else if e.type == "file" {
                NavigationLink(value: s.opening(i: Int32(i))) { label }
            } else {
                label
            }
        }
        .contextMenu { if s.found == nil { actions(s, i, e) } }
        .accessibilityIdentifier("entry-" + e.name)
    }

    /// What the entry can do where it is (FilesExplorer.can).
    @ViewBuilder
    private func actions(_ s: FilesState, _ i: Int, _ e: WorkspaceEntry) -> some View {
        let can = s.can(e: e)
        if can.rename { Button { typed = e.name; naming = .rename(e) } label: { Label(tr("Rename"), systemImage: "pencil") } }
        if can.download {
            Button {
                Task { if let url = await model.saved(s.opening(i: Int32(i))) { sharing = SharedFile(url: url) } }
            } label: { Label(tr("Share…"), systemImage: "square.and.arrow.up") }
        }
        if can.keep { Button { Task { await model.keep(e, true) } } label: { Label(tr("Keep in mind"), systemImage: "pin") } }
        if can.unpin { Button { Task { await model.keep(e, false) } } label: { Label(tr("Unpin"), systemImage: "pin.slash") } }
        if can.delete {
            Button(role: .destructive) {
                Task { if let words = await model.deleteWords(e) { deleting = (e, words) } }
            } label: { Label(tr("Delete"), systemImage: "trash") }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let s = model.state {
                if s.path.isEmpty, s.placeChoices.count > 1 {
                    Menu {
                        ForEach(s.placeChoices, id: \.self) { p in
                            Button { model.files.go(place: p) } label: {
                                if p == s.place { Label(s.placeName(of: p), systemImage: "checkmark") } else { Text(s.placeName(of: p)) }
                            }
                        }
                    } label: {
                        Label(s.placeName, systemImage: "externaldrive")
                    }
                    .accessibilityIdentifier("files-place")
                }
                Menu {
                    ForEach(FilesExplorer.Sort.allCases, id: \.self) { o in
                        Button { model.files.sort(by: o) } label: {
                            if o == s.sort { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                        }
                    }
                } label: {
                    Label(tr("Sort"), systemImage: "arrow.up.arrow.down")
                }
                if s.writesHere {
                    Menu {
                        Button { picking = true } label: { Label(tr("Photos"), systemImage: "photo") }
                        Button { importing = true } label: { Label(tr("Files"), systemImage: "folder") }
                        Button { typed = ""; naming = .folder } label: { Label(tr("New folder"), systemImage: "folder.badge.plus") }
                    } label: {
                        Label(tr("Add"), systemImage: model.busy ? "hourglass" : "plus")
                    }
                    .accessibilityIdentifier("files-add")
                }
            }
        }
    }

    private func name() {
        let n = typed
        switch naming {
        case .folder: Task { await model.makeFolder(n) }
        case .rename(let e): Task { await model.rename(e, to: n) }
        case nil: break
        }
        naming = nil
    }

    /// Photos picked: each saved in the app's storage under a name of its kind, then uploaded.
    private func pick(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photos = []
        Task {
            var picked: [(URL, String)] = []
            var unread: [String] = [] // said, not dropped: the owner would think it went
            for item in items {
                let name = PickedFile.name(of: item.supportedContentTypes.first)
                // Copied as a file (PickedFile): a long video's bytes never sit in memory.
                guard let file = try? await item.loadTransferable(type: PickedFile.self) else { unread.append(name); continue }
                // Under the name it is sent as, in its own folder: the upload deletes that folder after.
                let url = file.folder.appendingPathComponent(name)
                if file.url != url, (try? FileManager.default.moveItem(at: file.url, to: url)) == nil {
                    try? FileManager.default.removeItem(at: file.folder)
                    unread.append(name)
                    continue
                }
                picked.append((url, name))
            }
            await model.upload(picked, unread: unread)
        }
    }

    /// A file picked in Files, copied into the app's storage (it is read as it is sent), with its own name.
    private static func copied(_ url: URL) -> (URL, String)? {
        guard url.startAccessingSecurityScopedResource() else { return nil }
        defer { url.stopAccessingSecurityScopedResource() }
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(url.lastPathComponent)
        guard (try? FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)) != nil,
              (try? FileManager.default.copyItem(at: url, to: copy)) != nil else {
            try? FileManager.default.removeItem(at: copy.deletingLastPathComponent())
            return nil
        }
        return (copy, url.lastPathComponent)
    }

    /// An entry's icon by its kind, as Android's.
    static func icon(_ kind: FilesExplorer.Kind) -> String {
        switch kind {
        case .folder: "folder"
        case .lock: "lock"
        case .link: "link"
        case .sheet: "tablecells"
        case .image: "photo"
        case .doc: "doc.text"
        case .file: "doc"
        }
    }
}

/// One entry of a folder: its icon, its name and the line under it.
struct EntryRow: View {
    let name: String
    let detail: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).frame(width: 28).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).lineLimit(1)
                if !detail.isEmpty { Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Search, only where Files searches.
private struct Searching: ViewModifier {
    let on: Bool
    let query: Binding<String>

    func body(content: Content) -> some View {
        if on { content.searchable(text: query, prompt: tr("Search")) } else { content }
    }
}

/// What a change answered, at the bottom for a few seconds.
struct Notice: View {
    @Binding var text: String?

    var body: some View {
        if let t = text {
            Text(t).font(.callout).padding(.horizontal, 14).padding(.vertical, 10)
                .background(.thinMaterial, in: .capsule).padding(.bottom, 12)
                .accessibilityIdentifier("notice")
                .task(id: t) {
                    try? await Task.sleep(for: .seconds(3))
                    if text == t { text = nil }
                }
        }
    }
}

/// A file saved for the share sheet.
struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The system's share sheet for one file (Save to Files, AirDrop, another app).
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// The document viewer (#1368), as Android's: a file opened full screen. Text and code with line numbers, a CSV as a
/// table (find, and a tap on a column's name sorts by it), and pictures, PDFs and the kinds the app doesn't draw in
/// the phone's own previewer (QuickLook). The ⋯ menu copies its text and shares the file.
struct ViewerView: View {
    let opening: DocumentView.Opening
    // Not private: the interactive page's part of the view is in InteractivePageView.swift.
    @State var model: ViewerModel
    @State var sharing: SharedFile?
    /// An interactive page: its frame alone, the bars hidden; its versions' sheet.
    @State var full = false
    @State var versions = false
    /// Export…'s formats, and Keep up to date's sheet (with what was entered when a save failed).
    @State var exporting = false
    @State var keeping: KeepDraft?

    init(api: Api, opening: DocumentView.Opening) {
        self.opening = opening
        _model = State(initialValue: ViewerModel(api: api, opening: opening))
    }

    var body: some View {
        content
            .navigationTitle(opening.name)
            .navigationSubtitle(model.viewer.subtitle(view: model.viewed?.view))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let v = model.viewed?.view {
                    Menu {
                        if let text = v.text { Button { UIPasteboard.general.string = text } label: { Label(tr("Copy text"), systemImage: "doc.on.doc") } }
                        if v.downloadable {
                            Button { Task { if let url = await model.fetch() { sharing = SharedFile(url: url) } } } label: { Label(tr("Share…"), systemImage: "square.and.arrow.up") }
                        }
                        if model.exports { Button { exporting = true } label: { Label(tr("Export…"), systemImage: "arrow.down.doc") } }
                    } label: {
                        Label(tr("More"), systemImage: "ellipsis.circle")
                    }
                }
            }
            .overlay(alignment: .bottom) { Notice(text: $model.notice) }
            .safeAreaInset(edge: .top) {
                if let bar = model.bar, let page = model.viewed?.view?.page, let desk = model.pageDesk {
                    PageBarView(bar: bar, desk: desk) { keeping = KeepDraft.companion.of(page: page) }
                }
            }
            .onChange(of: model.bar?.reopen) { _, draft in
                if let draft { keeping = draft; model.pageDesk?.reopened() }
            }
            .confirmationDialog(tr("Export…"), isPresented: $exporting) {
                ForEach(DocumentExport.shared.FORMATS, id: \.first) { f in
                    Button(f.second as String? ?? "") { Task { if let url = await model.export(f.first as String? ?? "") { sharing = SharedFile(url: url) } } }
                }
                Button(tr("Cancel"), role: .cancel) {}
            }
            .sheet(item: $keeping) { draft in
                if let page = model.viewed?.view?.page {
                    KeepSheet(page: page, from: opening.from, draft: draft) { d in model.pageDesk?.keep(draft: d) }
                }
            }
            .sheet(item: $sharing) { ShareSheet(url: $0.url) }
            .sheet(isPresented: $versions) {
                if let site = model.viewed?.site {
                    VersionsSheet(title: opening.name, site: site,
                                  onShow: { n in versions = false; Task { await model.show(version: n == Int(site.current) ? nil : n) } },
                                  onCurrent: { n in versions = false; Task { await model.setVersion(n) } })
                }
            }
            .toolbar(full ? .hidden : .visible, for: .navigationBar)
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        if let viewed = model.viewed {
            switch viewed.pane {
            case .notFound:
                ContentUnavailableView(tr("File not found"), systemImage: "doc.questionmark")
            case .computerOff:
                ContentUnavailableView {
                    Label(tr("The computer is off"), systemImage: "power")
                } actions: {
                    if opening.botId != nil {
                        Button(tr("Start the computer")) { Task { await model.startComputer() } }.buttonStyle(.borderedProminent)
                    }
                }
            case .interactive:
                if let site = viewed.site { interactive(site) }
            case .failed:
                ContentUnavailableView(tr("Couldn't open it"), systemImage: "exclamationmark.triangle", description: Text(viewed.failed ?? ""))
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .tooLarge:
                ContentUnavailableView(tr("Too large to bring out of the computer"), systemImage: "externaldrive.badge.exclamationmark")
            case .pdf, .noPreview, .image:
                Previewed(model: model)
            case .text:
                text(viewed)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func text(_ viewed: Viewed) -> some View {
        let v = viewed.view!
        VStack(spacing: 0) {
            if !viewed.switches.isEmpty {
                Picker("", selection: $model.mode) {
                    ForEach(viewed.switches, id: \.self) { Text(viewed.modeLabel(mode: $0)).tag($0) }
                }
                .pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 6)
            }
            if v.truncated {
                Text(tr("Too large to show whole. Showing its start (up to 1 MB or 1,000 lines)."))
                    .font(.footnote).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.orange.opacity(0.15), in: .rect(cornerRadius: 10)).padding(.horizontal)
            }
            if viewed.table(mode: model.mode) {
                CsvTable(viewer: model.viewer, text: v.text ?? "")
            } else if viewed.rendered(mode: model.mode) {
                ScrollView { MarkdownView(text: v.text ?? "").textSelection(.enabled).padding() }
            } else {
                Lines(lines: model.viewer.lines(text: v.text ?? ""))
            }
        }
    }
}

/// Text and code: monospace, each line with its number.
struct Lines: View {
    let lines: [String]

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(i + 1)").foregroundStyle(.tertiary).frame(minWidth: CGFloat(String(lines.count).count) * 9, alignment: .trailing)
                        Text(line.isEmpty ? " " : line).textSelection(.enabled).fixedSize()
                    }
                    .font(.caption.monospaced())
                }
            }
            .padding(12)
        }
        .accessibilityIdentifier("viewer-lines")
    }
}

/// A CSV as a table (DocumentView.table): find in it, and a tap on a column's name sorts by it, again the other way.
struct CsvTable: View {
    let viewer: DocumentViewer
    let text: String
    @State private var find = ""
    @State private var sort: (col: Int, up: Bool)?

    var body: some View {
        let t = viewer.table(text: text, sortCol: Int32(sort?.col ?? -1), ascending: sort?.up ?? true, find: find)
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TextField(tr("Find in table"), text: $find).textFieldStyle(.roundedBorder)
                Text(viewer.tableCount(t: t)).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal).padding(.vertical, 6)
            ScrollView([.vertical, .horizontal]) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow {
                        Text("")
                        ForEach(0..<Int(t.cols), id: \.self) { c in
                            Button { tap(c) } label: {
                                Text((c < t.head.count ? t.head[c] : "") + arrow(c)).bold().lineLimit(2).frame(width: 140, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Divider()
                    ForEach(0..<t.rows.count, id: \.self) { i in
                        let cells = viewer.rowCells(t: t, i: Int32(i))
                        GridRow {
                            Text("\(viewer.rowNumber(t: t, i: Int32(i)))").font(.caption.monospaced()).foregroundStyle(.tertiary)
                            ForEach(0..<Int(t.cols), id: \.self) { c in
                                Text(c < cells.count ? cells[c] : "").lineLimit(3).frame(width: 140, alignment: .leading)
                            }
                        }
                    }
                }
                .font(.subheadline)
                .padding(12)
                if t.rows.isEmpty { Text(tr("Nothing found.")).foregroundStyle(.secondary).padding() }
            }
        }
        .accessibilityIdentifier("viewer-table")
    }

    private func arrow(_ c: Int) -> String {
        guard let sort, sort.col == c else { return "" }
        return sort.up ? " ▲" : " ▼"
    }

    private func tap(_ c: Int) {
        if sort?.col != c { sort = (c, true) } else if sort?.up == true { sort = (c, false) } else { sort = nil }
    }
}

/// A picture, a PDF or another kind of file in the phone's own previewer, once the file is saved on the phone; a kind
/// QuickLook can't show says so, with Share.
struct Previewed: View {
    let model: ViewerModel
    @State private var url: URL?
    @State private var tried = false
    @State private var sharing: SharedFile?

    var body: some View {
        Group {
            if let url, QLPreviewController.canPreview(url as NSURL) {
                QuickLookPreview(url: url).ignoresSafeArea(edges: .bottom).accessibilityIdentifier("viewer-preview")
            } else if tried {
                ContentUnavailableView {
                    Label(tr("No preview for this kind of file"), systemImage: "doc")
                } actions: {
                    if let url { Button(tr("Share…")) { sharing = SharedFile(url: url) }.buttonStyle(.borderedProminent) }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(item: $sharing) { ShareSheet(url: $0.url) }
        .task {
            url = await model.fetch()
            tried = true
        }
    }
}

/// QuickLook's previewer for one file, in the viewer's place.
struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Source { Source(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        if context.coordinator.url != url {
            context.coordinator.url = url
            controller.reloadData()
        }
    }

    final class Source: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
