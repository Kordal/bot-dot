import SwiftUI
import BotDotKit

/// Everything about one run: what it was asked, its answer, and every step it took.
struct RunDetailsView: View {
    let runId: String
    /// It stands in the Activity page, beside the list of runs, not in a sheet of its own.
    var inline = false
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var details: RunDetails?
    @State private var problem: String?

    var body: some View {
        Group {
            if inline {
                sheet
            } else {
                Dialog(width: 720) { Text("Run") } content: {
                    sheet.frame(height: 520)
                } foot: {
                    Spacer()
                    if details?.run.isRunning == true { Button("Stop") { Task { await store.stopRun(runId); await load() } } }
                    Button("Done") { dismiss() }.buttonStyle(.pillPrimary).keyboardShortcut(.cancelAction)
                }
            }
        }
        .task { await load() }
        // While it runs, every new step shows here too.
        .onChange(of: store.botChat.live?.steps.count) { Task { await load() } }
        .onChange(of: store.botChat.live == nil) { Task { await load() } }
    }

    private var sheet: some View {
        ScrollView {
            if let d = details {
                VStack(alignment: .leading, spacing: 16) {
                    header(d.run)
                    if let p = d.run.prompt, !p.isEmpty { MyBubble(text: p) }
                    if d.run.isRunning {
                        HStack(spacing: 8) {
                            TypingDots()
                            Text(d.run.botId.flatMap { store.workingLine(of: $0) } ?? (store.botChat.live?.runId == runId ? store.botChat.live!.activity : "Getting started…")).foregroundStyle(Theme.muted)
                        }
                        .modifier(BotBubble())
                    } else {
                        MarkdownView(d.answer, wide: false).modifier(BotBubble(problem: d.run.failed))
                    }
                    facts(d.run)
                    ForEach(d.transcript) { entry in TranscriptRow(entry: entry) }
                }
                .padding(inline ? 24 : 0) // a dialog has its own margins
            } else if let problem {
                Text(problem).foregroundStyle(Theme.muted).padding(40)
            } else {
                ProgressView().padding(40)
            }
        }
    }

    private func load() async {
        do { details = try await store.runDetails(runId) } catch { problem = error.localizedDescription }
    }

    private func header(_ run: RunSummary) -> some View {
        let started = run.startedWords
        let facts = [
            "\(started) \(Format.messageTime(run.startedAt))",
            run.kind == "script" ? "⚙️ script, no AI\(run.exitCode.map { " · exit code \($0)" } ?? "")" : nil,
            run.durationMs.map { "took \(Format.duration($0))" },
        ].compactMap { $0 }.joined(separator: " · ")
        let bot = store.bots.first { $0.id == run.botId }
        return HStack(spacing: 12) {
            BotFigureView(color: bot?.color ?? run.botColor, state: run.isRunning ? "working" : run.status == "error" ? "failed" : "idle", size: 34, outfit: bot?.outfit)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.botName ?? "").font(.geist(size: 15, weight: .semibold))
                Text(facts).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            }
            if inline, run.isRunning {
                Spacer(minLength: 0)
                Button("Stop") { Task { await store.stopRun(runId); await load() } }.controlSize(.small)
            }
        }
    }

    @ViewBuilder
    private func facts(_ run: RunSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let p = run.project { Text("Folder ").foregroundStyle(Theme.muted) + Text(p).font(.geistMono(size: 12)) }
            if let m = run.modelUsed ?? run.model {
                Text("Model ").foregroundStyle(Theme.muted) + Text(m).bold()
                    + Text(run.effort == nil ? "" : " · reasoning ").foregroundStyle(Theme.muted) + Text(run.effort ?? "").bold()
            }
            Text("Steps ").foregroundStyle(Theme.muted) + Text(run.numTurns.map(String.init) ?? "—").bold()
            if let s = run.sessionId, let p = run.project {
                let resume = "cd \(p) && claude --resume \(s)"
                HStack {
                    Text("Continue in Claude Code: ").foregroundStyle(Theme.muted) + Text(resume).font(.geistMono(size: 12))
                    BubbleMeta(time: "", copy: resume)
                }
            }
        }
        .font(.geist(size: 12.5))
        .textSelection(.enabled)
    }
}

/// One line of a run's transcript; a tool opens to its input and what came back.
struct TranscriptRow: View {
    let entry: TranscriptEntry
    @State private var open = false

    var body: some View {
        switch entry.kind {
        case .text:
            MarkdownView(entry.text).font(.geist(size: 13.5))
        case .stderr:
            Text(entry.text).font(.geistMono(size: 12)).foregroundStyle(Theme.err).textSelection(.enabled)
        case .scriptOutput:
            Text(entry.text).font(.geistMono(size: 12)).textSelection(.enabled)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunk))
        case .tool:
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 6) {
                    if let input = entry.toolInput { Text(input).font(.geistMono(size: 11.5)) }
                    if let result = entry.toolResult {
                        Text(result.count > 4000 ? String(result.prefix(4000)) + "…" : result)
                            .font(.geistMono(size: 11.5))
                            .foregroundStyle(entry.toolFailed ? Theme.err : Theme.muted)
                    }
                }
                .textSelection(.enabled)
                .padding(.vertical, 4)
            } label: {
                HStack(spacing: 8) {
                    Text(entry.toolName ?? "").font(.geistMono(size: 12.5, weight: .semibold))
                    Text(entry.toolArgument ?? "").font(.geistMono(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(1)
                    Spacer()
                    if entry.toolResult == nil { Text("…").foregroundStyle(Theme.faint) }
                    else if entry.toolFailed { Image(systemName: "xmark").foregroundStyle(Theme.err) }
                }
            }
        }
    }
}
