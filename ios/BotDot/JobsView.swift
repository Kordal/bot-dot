import SwiftUI
import Observation
import BotdotShared

/// A bot's scheduled jobs for the screen (JobsDesk): the shared layer's state, pushed as it changes.
@MainActor
@Observable
final class JobsModel {
    private(set) var state: JobsState?
    private let desk: JobsDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore, botId: String) { desk = home.jobs(botId: botId) }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
        Task { try? await desk.refresh() }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }
    func refresh() async { try? await desk.refresh() }
    func setOn(_ id: String, _ on: Bool) async -> String { (try? await desk.setOn(jobId: id, on: on)) ?? "" }
    func run(_ id: String) async -> String { (try? await desk.run(jobId: id)) ?? "" }
}

/// A bot's scheduled jobs (Android's JobsScreen): each with its schedule and status, the switch that pauses it, its last
/// run, Run now, and Review and approve where it waits for the owner's OK (in Needs you).
struct JobsView: View {
    let home: HomeStore
    let botId: String
    let figure: FigureDef?
    @State private var model: JobsModel?
    @State private var notice: String?
    @State private var reviewing = false

    var body: some View {
        List {
            if let state = model?.state {
                if let empty = state.empty { Text(empty).foregroundStyle(.secondary) }
                ForEach(state.jobs ?? [], id: \.id) { j in row(j) }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(tr("Scheduled jobs"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.refresh() }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice).font(.footnote).padding(10).background(.thinMaterial, in: .capsule).padding()
                    .task(id: notice) { try? await Task.sleep(for: .seconds(3)); self.notice = nil }
            }
        }
        .navigationDestination(isPresented: $reviewing) { NeedsYouView(home: home, figure: figure) }
        .task {
            if model == nil { model = JobsModel(home: home, botId: botId) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private func row(_ j: JobView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(j.script ? "⚙️" : "🧠") \(j.name)").font(.headline)
                    if !j.line.isEmpty { Text(j.line).font(.subheadline).foregroundStyle(j.waits ? .orange : .secondary) }
                }
                Spacer()
                Toggle("", isOn: Binding(get: { j.enabled }, set: { on in Task { notice = await model?.setOn(j.id, on) } }))
                    .labelsHidden()
                    .accessibilityLabel(j.name)
            }
            if j.changeWaits { Text(Jobs.shared.CHANGE_WAITS).font(.subheadline).foregroundStyle(.orange) }
            ForEach(j.advanced, id: \.self) { Text($0).font(.caption).foregroundStyle(.tertiary) }
            if let last = j.last {
                Text(last).font(.caption).foregroundStyle(j.tone == .failed ? Color.red : j.tone == .missed ? Color.orange : Color.secondary)
            }
            HStack(spacing: 8) {
                if !j.approved {
                    Button(tr("Review and approve")) { reviewing = true }.buttonStyle(.bordered)
                } else {
                    Button(tr("Run now")) { Task { notice = await model?.run(j.id) } }.buttonStyle(.bordered)
                }
                if j.changeWaits { Button(tr("Review the change")) { reviewing = true }.buttonStyle(.bordered) }
            }
        }
        .padding(.vertical, 4)
    }
}
