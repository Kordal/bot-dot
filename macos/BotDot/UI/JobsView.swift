import SwiftUI
import BotDotKit

/// A bot's scheduled jobs, as on the web: one card each, every change saving by itself, and a switch
/// that pauses or resumes a job right away.
struct JobsView: View {
    let botId: String
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var fresh: String?

    private var bot: Bot? { store.bots.first { $0.id == botId } }

    var body: some View {
        WebForm(inPanel: true) {
            PageHead(title: "Scheduled jobs", sub: bot.map { "\($0.name) runs these on its own. Changes save by themselves. Easiest: ask it or the Chief, e.g. \"check the news every morning at 8\"." } ?? "", small: true)
            if let bot {
                let jobs = bot.jobs ?? []
                if jobs.isEmpty {
                    Text("No jobs yet.").foregroundStyle(Theme.muted).padding(28).frame(maxWidth: .infinity)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
                }
                VStack(spacing: 8) {
                    ForEach(jobs) { j in JobCard(botId: botId, job: j, startOpen: fresh == j.id || j.approved == false).id(j.id) }
                }
                Button("＋ Add job", action: add)
            }
        }
    }

    private func add() {
        Task {
            do { fresh = try await store.addJob(botId, ["name": "", "kind": "ai", "cron": "0 9 * * *", "prompt": ""]).id }
            catch { store.problem = error.localizedDescription }
        }
    }
}

/// One job: its name, when it runs, whether it's on; open, everything about it.
struct JobCard: View {
    let botId: String
    let job: Job
    let startOpen: Bool
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav

    @State private var open = false
    @State private var name = ""
    @State private var cron = ""
    @State private var kind = "ai"
    @State private var prompt = ""
    @State private var script = ""
    @State private var aiWhen = "output"
    @State private var timeout = 300
    @State private var other = false
    /// The schedule in words beside the name: the job's own, then the preview's while it is edited.
    @State private var words = ""
    @State private var preview = ""
    @State private var previewBad = false
    @State private var status = ""
    @State private var ready = false
    @State private var saveTask: Task<Void, Never>?
    @State private var confirmRemove = false
    @State private var confirmApprove = false

    private var fields: [String: String] {
        ["name": name.trimmingCharacters(in: .whitespaces), "kind": kind, "cron": cron.trimmingCharacters(in: .whitespaces), "prompt": prompt, "script": script, "aiWhen": aiWhen, "timeoutSeconds": String(timeout)]
    }

    var body: some View {
        // The web page's `.job-card`: grey, with a hairline.
        VStack(alignment: .leading, spacing: 10) {
            header
            if open { details }
        }
        .font(.geist(size: 13.5))
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.sunk))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line, lineWidth: 1))
        .onAppear(perform: load)
        .onChange(of: fields) { saveSoon() }
        .task(id: [cron, other ? "typed" : "listed"]) { await previewCron() } // also when "Another time…" opens the field
        .confirmationDialog("Remove this job?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { remove() }
        }
        .confirmationDialog("Approve this job as it was set up? It will start running on its schedule.", isPresented: $confirmApprove) {
            Button("Approve") { approve() }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 10) {
                    Text(kind == "script" ? "⚙️" : "🧠")
                    Text(name.isEmpty ? "New job" : name).bold()
                    Text(words.isEmpty ? job.schedule : words).foregroundStyle(Theme.muted).lineLimit(1)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // It runs as approved, and a change waits beside it: answered on its card in Needs you.
            if store.has(.stagedChanges), job.staged != nil { Pill(ChangeCard.waits, warn: true) }
            if job.approved == false { Pill("needs your OK", warn: true) }
            else if job.enabled == false { Pill("paused") }
            else if job.last?.status == "error" { Pill("last run failed", warn: true) }
            else if let next = job.nextRunAt { Pill("next \(Format.shortTime(next))") }
            Toggle("", isOn: Binding(get: { job.enabled != false }, set: { setEnabled($0) }))
                .toggleStyle(.webSwitch).labelsHidden().controlSize(.small)
                .help(job.enabled != false ? "On: click to pause" : "Paused: click to resume")
        }
    }

    @ViewBuilder
    private var details: some View {
        if job.approved == false {
            HStack {
                Text("\(job.changedBy == "bot" ? "The bot" : job.changedBy == "chief" ? "The Chief" : "Someone") set this up, so it waits for your OK before it runs.")
                Spacer()
                Button("Approve") { confirmApprove = true }.buttonStyle(.pillPrimary).controlSize(.small)
            }
            .font(.geist(size: 13)).padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Theme.warnSoft))
        }
        if let why = job.assessment, !why.isEmpty { Text("💡 \(why)").font(.geist(size: 12.5)).foregroundStyle(Theme.muted) }
        HStack(alignment: .top, spacing: 14) {
            LabeledField("Name") { TextField("", text: $name, prompt: Text("e.g. Morning news")) }
            LabeledField("When") {
                Picker("", selection: Binding(get: { other ? "" : cron }, set: { v in
                    if v.isEmpty { other = true } else { other = false; cron = v }
                })) {
                    ForEach(Cron.presets, id: \.cron) { p in Text(p.label).tag(p.cron) }
                    Text("Another time…").tag("")
                }
                .labelsHidden()
            }
        }
        if other {
            LabeledField("Schedule", hint: "cron: min hour day month weekday, e.g. 30 7 * * 1-5") {
                TextField("", text: $cron).font(.geistMono(size: 13))
            }
            Text(preview).font(.geist(size: 12.5)).foregroundStyle(previewBad ? Theme.err : Theme.muted)
        }
        if kind == "script" {
            LabeledField("Script", hint: "bash, runs in the bot's folder on this computer. Print nothing when there's nothing to report. $JOB_STATE_DIR keeps files between runs.") {
                TextEditor(text: $script).font(.geistMono(size: 12.5)).frame(minHeight: 90)
            }
            LabeledField("Then ask the AI") {
                Picker("", selection: $aiWhen) { ForEach(AIWhen.allCases, id: \.rawValue) { a in Text(a.label).tag(a.rawValue) } }.labelsHidden()
            }
        }
        LabeledField(kind == "script" ? "What the AI should do with the output" : "Task", hint: kind == "script" ? "when it is asked" : "leave empty for the bot's usual task") {
            TextEditor(text: $prompt).font(.geist(size: 13)).frame(minHeight: 60)
        }
        DisclosureGroup("More options") {
            HStack(alignment: .top, spacing: 14) {
                LabeledField("Kind") {
                    Picker("", selection: $kind) {
                        Text("🧠 AI: a run of the bot").tag("ai")
                        Text("⚙️ Script, no AI").tag("script")
                    }
                    .labelsHidden()
                }
                if kind == "script" {
                    LabeledField("Script time limit (seconds)") { TextField("", value: $timeout, format: .number) }
                }
            }
        }
        .font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
        HStack {
            Text(status.isEmpty ? store.lastText(of: job) + (job.createdBy.map { $0 != "you" ? " Set up by \(["chief": "the Chief", "bot": "the bot itself"][$0] ?? $0)." : "" } ?? "") : status)
                // The job's line says why it failed, or why it did not run: in its own colour, as on Android.
                .font(.geist(size: 12.5)).foregroundStyle(!status.isEmpty || job.lineTone == .fine ? Theme.faint : job.lineTone == .failed ? Theme.err : Theme.warnText)
            Spacer()
            Button("Run now", action: run)
            Button("Remove", role: .destructive) { confirmRemove = true }
        }
        .controlSize(.small)
    }

    private func load() {
        name = job.name; cron = job.cron; kind = job.kind ?? "ai"; prompt = job.prompt ?? ""; script = job.script ?? ""
        aiWhen = job.aiWhen ?? "output"; timeout = job.timeoutSeconds ?? 300
        other = !Cron.presets.contains { $0.cron == job.cron }
        words = job.schedule
        open = startOpen
        DispatchQueue.main.async { ready = true }
    }

    /// The words beside the name and the line under the field follow the schedule as it is typed or picked.
    private func previewCron() async {
        let expr = cron.trimmingCharacters(in: .whitespaces)
        guard ready || !expr.isEmpty else { return } // before the job's own schedule is loaded
        guard other else {
            words = Cron.listed(expr, of: job)
            return
        }
        let answer = await store.cronPreview(expr)
        // Only the answer about what the field holds now is shown: an earlier one can arrive after it.
        guard !Task.isCancelled, other, expr == cron.trimmingCharacters(in: .whitespaces) else { return }
        if let said = answer.words { words = said }
        previewBad = answer.error != nil
        preview = answer.line { $0.formatted(date: .abbreviated, time: .shortened) }
    }

    /// Saves what changed, a moment after the last change (a script job without its script waits).
    private func saveSoon() {
        guard ready else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, !(kind == "script" && script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) else { return }
            var body: [String: Any] = fields
            body["timeoutSeconds"] = timeout
            do {
                try await store.updateJob(botId, job.id, body)
                let now = store.bots.first { $0.id == botId }?.jobs?.first { $0.id == job.id }
                status = now?.approved == false ? "Saved. It waits for your OK again." : "Saved."
            } catch { store.problem = error.localizedDescription }
        }
    }

    private func setEnabled(_ on: Bool) {
        Task {
            do {
                try await store.updateJob(botId, job.id, ["enabled": on])
                nav.pill = .ok(on ? "Job resumed" : "Job paused. It won’t run until you turn it back on.")
            } catch { store.problem = error.localizedDescription }
        }
    }

    private func run() {
        Task {
            do { nav.pill = .ok(try await store.runJob(botId, job.id)) } catch { store.problem = error.localizedDescription }
        }
    }

    private func remove() {
        Task {
            do { try await store.removeJob(botId, job.id); nav.pill = .ok("Job removed") } catch { store.problem = error.localizedDescription }
        }
    }

    private func approve() {
        guard let item = store.needs.first(where: { $0.key == "job:\(job.id)" }) else { return }
        Task {
            do { try await store.decide(item, yes: true); nav.pill = .ok("Approved") } catch { store.problem = error.localizedDescription }
        }
    }
}

/// A small grey (or amber) label: "next 09:00", "paused".
struct Pill: View {
    let text: String
    var warn = false
    init(_ text: String, warn: Bool = false) { self.text = text; self.warn = warn }
    var body: some View {
        Text(text).font(.geist(size: 11.5)).padding(.horizontal, 8).padding(.vertical, 2)
            .background(Capsule().fill(warn ? Theme.warnSoft : Theme.sunk))
            .foregroundStyle(warn ? Theme.warnText : Theme.muted)
    }
}

/// A field with its label above it, and an optional hint.
struct LabeledField<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder let content: () -> Content
    init(_ label: String, hint: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.label = label; self.hint = hint; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            (Text(label).fontWeight(.medium).foregroundStyle(Theme.muted) + Text(hint.map { "  \($0)" } ?? "").foregroundStyle(Theme.faint))
                .font(.geist(size: 12.5)).fixedSize(horizontal: false, vertical: true)
            content().font(.geist(size: 13.5)).webField()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
