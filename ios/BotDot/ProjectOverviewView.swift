import SwiftUI
import BotdotShared

/// A project's Overview for the screen (OverviewDesk): read when it shows, then every 30 seconds while it does.
@MainActor
@Observable
final class OverviewModel {
    private(set) var state: OverviewState?
    private let desk: OverviewDesk

    init(api: Api, projectId: String) { desk = OverviewDesk(api: api, projectId: projectId) }

    /// Reads it now and again every 30 seconds until the task is cancelled (the screen went).
    func follow() async {
        while !Task.isCancelled {
            try? await desk.read()
            state = desk.state.value
            try? await Task.sleep(for: .milliseconds(Int(desk.everyMs)))
        }
    }

    func refresh() async { try? await desk.read(); state = desk.state.value }
}

/// A project's Overview (Android's FixedProjectOverview, ADR 236): what botdot recorded, never a score. Its goal, the
/// work going on, what is blocked, the latest replies, each opening its chat, and the newest files of its folder.
struct ProjectOverviewView: View {
    let company: Company
    let api: Api
    /// Where an entry opens: the project's screen does it.
    let onOpen: (OverviewEntry) -> Void
    /// A file of its folder, or the folder itself (nil).
    let onFile: (String?) -> Void
    @State private var model: OverviewModel?

    var body: some View {
        List {
            if let s = model?.state {
                if let problem = s.problem { Text(problem).foregroundStyle(.red) }
                Text(s.status).font(.caption).foregroundStyle(.secondary)
                if let d = s.snapshot {
                    // The questions waiting for the owner, in Needs you, not again under Blockers (as Android's).
                    if !d.questions().isEmpty { entries(tr("Needs you"), d.questions(), "") }
                    entries(tr("Current work"), d.work, Overviews.shared.noWork)
                    entries(tr("Blockers"), d.failures(), Overviews.shared.noBlockers)
                    entries(tr("Latest replies"), d.replies, Overviews.shared.noReplies)
                }
                Section(tr("Files")) {
                    if let problem = s.filesProblem { Text(problem).foregroundStyle(.red) }
                    if let line = s.filesLine {
                        Text(line).foregroundStyle(.secondary)
                    } else {
                        ForEach(s.files?.files ?? [], id: \.path) { f in
                            Button { onFile(f.path) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name)
                                    Text(Overviews.shared.fileWhen(f: f)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .disabled(company.folder == nil)
                        }
                    }
                    if company.folder != nil { Button(tr("Open folder")) { onFile(nil) } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Overview"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.refresh() }
        .task {
            if model == nil { model = OverviewModel(api: api, projectId: company.id) }
            await model?.follow()
        }
    }

    @ViewBuilder
    private func entries(_ title: String, _ items: [OverviewEntry], _ empty: String) -> some View {
        Section(title) {
            if items.isEmpty { Text(empty).foregroundStyle(.secondary) }
            ForEach(items, id: \.id) { e in
                Button { onOpen(e) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.name).fontWeight(.semibold)
                        Text(Overviews.shared.meta(e: e)).font(.caption).foregroundStyle(.secondary)
                        // The bot's Markdown, as in its chat, in at most four lines (as Android's Overview).
                        if e.text.isEmpty { Text(Overviews.shared.text(e: e)) } else { Text(MarkdownView.inline(e.text)).lineLimit(4) }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}
