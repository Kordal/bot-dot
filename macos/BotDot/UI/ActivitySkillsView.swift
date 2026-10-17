import SwiftUI
import BotDotKit

/// Every bot run, live and past, as on the web. A click opens its Details.
struct ActivityView: View {
    @Environment(Store.self) private var store
    @State private var runs: [RunSummary] = []
    @State private var filter = ""
    @State private var details: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .bottom) {
                PageHead(title: "Activity", sub: "Every bot run, live and past.")
                Spacer()
                Picker("", selection: $filter) {
                    Text("All bots").tag("")
                    ForEach(store.bots) { b in Text(b.name).tag(b.id) }
                }
                .webSelect().fixedSize().webField()
            }
            // The web page's `.runs-layout`: the runs on the left, the picked one beside them.
            HStack(alignment: .top, spacing: 16) {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(runs) { r in ActivityRow(run: r).sideRow(active: details == r.id, radius: 12) { details = r.id } }
                        if runs.isEmpty { Text("No runs yet").foregroundStyle(Theme.muted).padding(40) }
                    }
                    .padding(6)
                }
                .frame(width: 320)
                .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line, lineWidth: 1))
                Group {
                    if let details {
                        RunDetailsView(runId: details, inline: true).id(details)
                    } else {
                        Text("Pick a run, or message a bot to start one.").foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity, minHeight: 400)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
                .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line, lineWidth: 1))
            }
        }
        .frame(maxWidth: 1100, alignment: .leading)
        .padding(.horizontal, 40).padding(.top, 34).padding(.bottom, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg)
        .task(id: "\(filter)|\(store.recentRuns.first?.id ?? "")|\(store.runningCount)") {
            runs = (try? await store.runs(bot: filter.isEmpty ? nil : filter)) ?? runs
        }
    }
}

struct ActivityRow: View {
    let run: RunSummary
    @Environment(Store.self) private var store

    var body: some View {
        let bot = store.bots.first { $0.id == run.botId }
        HStack(spacing: 12) {
            BotFigureView(color: bot?.color ?? run.botColor, state: run.isRunning ? "working" : run.status == "error" ? "failed" : "idle", size: 34, outfit: bot?.outfit)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.botName ?? "").font(.geist(size: 13.5, weight: .semibold))
                Text(sub).font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            Spacer()
            Pill(run.status ?? "", warn: run.status == "error" || run.status == "stopped" || run.status == "interrupted")
        }
    }

    private var sub: String {
        let when = Format.date(run.startedAt).map { Format.ago($0) } ?? "—"
        let job = run.jobName.map { "⏰ \($0) · " } ?? (run.trigger == "schedule" ? "⏰ " : "")
        let rest = [run.kind == "script" ? "no AI" : nil, run.durationMs.map(Format.duration)].compactMap { $0 }.joined(separator: " · ")
        return "\(when) · \(job)\(rest)"
    }
}

/// Skills: your library (give each to the bots that need it), the ones on this computer, and the ones
/// built into Claude Code.
struct SkillsView: View {
    @Environment(Store.self) private var store
    @State private var lists: SkillLists?
    @State private var editing: SkillEdit?
    @State private var importing = false

    struct SkillEdit: Identifiable { let skill: SkillInfo?; var id: String { skill?.name ?? "new" } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Skills").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                    Spacer()
                    Button("Import") { importing = true }
                    Button("＋ New skill") { editing = SkillEdit(skill: nil) }.buttonStyle(.pillPrimary)
                }
                (Text("Your library").font(.geist(size: 13, weight: .semibold)) + Text(" · give each skill to the bots that need it").foregroundStyle(Theme.faint))
                if let lists {
                    if lists.library.isEmpty {
                        VStack(spacing: 8) {
                            Text("✦").font(.geist(size: 28))
                            Text("No skills yet. Write one, import one from skills.sh or GitHub, or ask the Chief (\"make a skill for how I like my weekly reports\"). Bots also write their own as they learn.")
                                .multilineTextAlignment(.center).foregroundStyle(Theme.muted)
                        }
                        .padding(36).frame(maxWidth: .infinity).background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                        ForEach(lists.library, id: \.name) { k in
                            Button { open(k.name) } label: { SkillCard(skill: k) }.buttonStyle(.plain)
                        }
                    }
                    Text("On this computer").font(.geist(size: 13, weight: .semibold)).padding(.top, 8)
                    VStack(alignment: .leading, spacing: 8) {
                        if lists.machine.isEmpty { Text("None found in ~/.claude/skills.").foregroundStyle(Theme.faint) }
                        ForEach(lists.machine, id: \.name) { k in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(k.name).font(.geist(size: 13, weight: .semibold))
                                Text(k.description.map { $0.count > 160 ? String($0.prefix(160)) + "…" : $0 } ?? "").foregroundStyle(Theme.muted).lineLimit(2)
                                Spacer()
                                Text(k.origin ?? "").foregroundStyle(Theme.faint)
                            }
                            .font(.geist(size: 12.5))
                        }
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
                    if let builtin = lists.builtin, !builtin.isEmpty {
                        Text("Built into Claude Code").font(.geist(size: 13, weight: .semibold)).padding(.top, 8)
                        FlowLayout(spacing: 6) { ForEach(builtin, id: \.name) { k in Chip(text: k.name) } }
                    }
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: 1100, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Skills")
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { e in SkillEditor(skill: e.skill) }
        .sheet(isPresented: $importing, onDismiss: { Task { await load() } }) { SkillImport() }
    }

    private func load() async { lists = try? await store.skillLists() }

    private func open(_ name: String) {
        Task {
            do { editing = SkillEdit(skill: try await store.skill(name)) } catch { store.problem = error.localizedDescription }
        }
    }
}

struct SkillCard: View {
    let skill: SkillInfo
    @Environment(Store.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(skill.name).font(.geist(size: 14, weight: .semibold)); Spacer(); Pill(skill.originText(store.bots)) }
            Text(skill.description ?? "").font(.geist(size: 12.5)).foregroundStyle(Theme.muted).lineLimit(3)
            if let s = skill.scripts, !s.isEmpty { Text("Includes \(s.count) script\(s.count == 1 ? "" : "s") a bot may run").font(.geist(size: 12)).foregroundStyle(Theme.warnText) }
            if let t = skill.allowedTools, !t.isEmpty { Text("Can use without asking: \(t.joined(separator: ", "))").font(.geist(size: 12)).foregroundStyle(Theme.warnText) }
            let users = store.bots.filter { (skill.usedBy ?? []).contains($0.id) }
            if users.isEmpty { Text("No bot has it yet").font(.geist(size: 12.5)).foregroundStyle(Theme.faint) }
            FlowLayout(spacing: 6) {
                ForEach(users) { b in HStack(spacing: 4) { NameFigure(Who(b)); Text(b.name) }.font(.geist(size: 12)).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(Theme.sunk)) }
            }
        }
        .padding(16).frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
        .contentShape(Rectangle())
    }
}

/// Which bots have a skill: one checkbox each (not those with skills switched off).
struct BotPicks: View {
    @Binding var selected: Set<String>
    /// Skills can't go to a bot with skills turned off; logins and apps can go to any bot.
    var forSkills = true
    @Environment(Store.self) private var store
    var body: some View {
        FlowLayout(spacing: 10) {
            ForEach(store.bots) { b in
                Toggle(isOn: Binding(get: { selected.contains(b.id) }, set: { on in if on { selected.insert(b.id) } else { selected.remove(b.id) } })) {
                    HStack(spacing: 4) { NameFigure(Who(b)); Text(b.name) }
                }
                .toggleStyle(.checkbox)
                .disabled(forSkills && b.useSkills == false)
                .help(forSkills && b.useSkills == false ? "Skills are turned off for this bot" : "")
            }
        }
    }
}

/// Write a skill, or change one.
struct SkillEditor: View {
    let skill: SkillInfo?
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var bots: Set<String> = []
    @State private var confirmDelete = false
    @State private var failed: String?

    var body: some View {
        Dialog(skill?.name ?? "New skill", width: 640) {
            HStack(alignment: .top, spacing: 12) {
                LabeledField("Name", hint: "lowercase-with-dashes") { TextField("", text: $name, prompt: Text("weekly-report")) }
                LabeledField("When to use it", hint: "bots decide from this") { TextField("", text: $description, prompt: Text("Use when writing the weekly status report")) }
            }
            LabeledField("Instructions", hint: "markdown: steps, rules, templates, examples") {
                TextEditor(text: $instructions).font(.geistMono(size: 12.5)).frame(minHeight: 220)
            }
            if let k = skill, k.createdBy?.hasPrefix("bot:") == true {
                Text("\(k.originText(store.bots)) while learning. It may keep improving it, and its changes reach every bot that has this skill.")
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            if let k = skill, k.source == "github" {
                Text("Imported from \(k.sourceUrl ?? "") · \((k.fileCount ?? 0) + 1) files\((k.scripts ?? []).isEmpty ? "" : " · scripts: \(k.scripts!.joined(separator: ", "))")")
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            Text("Bots with this skill").font(.geist(size: 12.5, weight: .medium))
            BotPicks(selected: $bots)
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            if skill != nil { Button("Delete", role: .destructive) { confirmDelete = true } }
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button(skill == nil ? "Create skill" : "Save", action: save).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
                .disabled(name.isEmpty || description.isEmpty || instructions.isEmpty)
        }
        .onAppear {
            name = skill?.name ?? ""; description = skill?.description ?? ""; instructions = skill?.instructions ?? ""
            bots = Set(skill?.usedBy ?? [])
        }
        .confirmationDialog("Delete the skill \"\(skill?.name ?? "")\"? Bots that have it will stop using it.", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) {
                Task { do { try await store.deleteSkill(skill!.name); dismiss() } catch { failed = error.localizedDescription } }
            }
        }
    }

    private func save() {
        Task {
            do {
                try await store.saveSkill(original: skill?.name, name: name.trimmingCharacters(in: .whitespaces).lowercased(), description: description.trimmingCharacters(in: .whitespaces), instructions: instructions, bots: Array(bots))
                dismiss()
            } catch { failed = error.localizedDescription }
        }
    }
}

/// Import a skill from skills.sh or a GitHub folder: preview first (what it says, its files, scripts
/// and tools), then who gets it.
struct SkillImport: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var preview: SkillPreview?
    @State private var name = ""
    @State private var bots: Set<String> = []
    @State private var fetching = false
    @State private var failed: String?

    var body: some View {
        Dialog("Import a skill", width: 620) {
            LabeledField("Link to the skill", hint: "on skills.sh, or its folder on GitHub") {
                TextField("", text: $url, prompt: Text("https://skills.sh/vercel-labs/skills/find-skills")).disabled(preview != nil)
            }
            if let p = preview {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 12) {
                            LabeledField("Name") { TextField("", text: $name) }
                            LabeledField("Files") {
                                Text("\(p.files.count) file\(p.files.count == 1 ? "" : "s") · \(String(format: "%.1f", (p.totalBytes ?? 0) / 1024 / 1024)) MB\(p.folder.map { " · from \($0)" } ?? "")").foregroundStyle(Theme.muted)
                            }
                        }
                        if p.exists == true { Text("You already have a skill with this name. Importing replaces it.").foregroundStyle(Theme.warnText) }
                        Text(p.description ?? "(no description)").bold()
                        if !p.scripts.isEmpty { Text("⚠︎ Includes scripts a bot may run: \(p.scripts.joined(separator: ", ")). Only import skills from people you trust.").foregroundStyle(Theme.warnText) }
                        if !p.allowedTools.isEmpty { Text("⚠︎ Lets a bot use these without asking while the skill is active: \(p.allowedTools.joined(separator: ", "))").foregroundStyle(Theme.warnText) }
                        DisclosureGroup("SKILL.md · what the bot will read", isExpanded: .constant(true)) { MarkdownView(p.instructions ?? "") }
                        Text("Give it to").font(.geist(size: 12.5, weight: .medium))
                        BotPicks(selected: $bots)
                    }
                    .font(.geist(size: 12.5))
                }
                .frame(maxHeight: 420)
            }
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button(preview == nil ? (fetching ? "Fetching…" : "Preview") : "Import skill", action: go)
                .buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction).disabled(fetching || url.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func go() {
        Task {
            if let p = preview {
                do { try await store.importSkill(p, name: name.trimmingCharacters(in: .whitespaces).lowercased(), bots: Array(bots)); dismiss() } catch { failed = error.localizedDescription }
                return
            }
            fetching = true
            failed = nil
            do {
                let p = try await store.previewSkill(url.trimmingCharacters(in: .whitespaces))
                preview = p
                name = p.name
            } catch { failed = error.localizedDescription }
            fetching = false
        }
    }
}
