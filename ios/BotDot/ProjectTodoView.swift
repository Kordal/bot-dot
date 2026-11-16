import SwiftUI
import BotdotShared

/// The project's To-do (#692; Android's TodoPanel): what it holds is the shared ProjectTodo.panel. Its title and
/// number, the filters, what waits for the owner here (Approve or Review) and the bots that ask (Reply), the items
/// (whom each is for, its chip, its tick and Delete), and Add a task with whom and when.
struct TodoPanelView: View {
    let panel: ProjectTodo.Panel
    let adding: Bool
    let figure: FigureDef?
    let model: ProjectModel
    let onApprove: (String) -> Void
    let onReview: () -> Void
    let onBot: (Bot) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(panel.title).font(.headline)
                Spacer()
                if panel.count > 0 { Count(n: Int(panel.count)) }
            }
            if panel.full {
                Picker(tr("Show"), selection: Binding(get: { panel.filter }, set: { model.todoFilter($0) })) {
                    ForEach(ProjectTodo.shared.FILTERS, id: \.self) { k in Text(TodoWords.filter(k)).tag(k) }
                }
                .pickerStyle(.segmented)
            }
            ForEach(Array(panel.waits.enumerated()), id: \.offset) { _, w in
                HStack(spacing: 12) {
                    Text(w.text).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                    if let id = w.permission {
                        Button(tr("Approve")) { onApprove(id) }.buttonStyle(.bordered).font(.caption)
                    } else {
                        Button(tr("Review"), action: onReview).buttonStyle(.bordered).font(.caption)
                    }
                }
            }
            ForEach(panel.asking, id: \.id) { b in
                HStack(spacing: 12) {
                    ProjectHead(bot: b, figure: figure, size: 28)
                    Text(ProjectRules.shared.question(b: b) ?? "").font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                    Button(tr("Reply")) { onBot(b) }.buttonStyle(.bordered).font(.caption)
                }
            }
            ForEach(panel.rows, id: \.todo.id) { r in row(r) }
            AddTodoRow(full: panel.full, forBots: panel.forBots, adding: adding, figure: figure, model: model)
        }
        .buttonStyle(.borderless)
    }

    private func row(_ r: ProjectTodo.Row) -> some View {
        HStack(spacing: 12) {
            if let b = r.bot { ProjectHead(bot: b, figure: figure, size: 24) } else { YouHead(size: 24) }
            Text(r.todo.text).font(.subheadline).lineLimit(3).foregroundStyle(r.todo.done ? .tertiary : .primary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if panel.full, let chip = TodoWords.chip(r) {
                Text(chip).font(.caption).lineLimit(1)
                    .foregroundStyle(r.chip == .working ? .green : r.late ? .orange : .secondary)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.secondary.opacity(0.12), in: .capsule)
            }
            Button { Task { await model.tickTodo(r.todo.id, !r.todo.done) } } label: {
                Image(systemName: r.todo.done ? "checkmark.circle.fill" : "circle").imageScale(.large)
            }
            .accessibilityLabel(tr("Done"))
            if panel.full {
                Button { Task { await model.deleteTodo(r.todo.id) } } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                    .accessibilityLabel(tr("Delete"))
            }
        }
    }
}

/// The words of the To-do drawn on the phone: weekdays and days in the phone's language.
enum TodoWords {
    static func filter(_ k: String) -> String {
        switch k { case "you": tr("You"); case "bots": tr("Bots"); case "done": tr("Done"); default: tr("All") }
    }

    /// A weekday's short name, 0 Sunday.
    static func weekday(_ d: Int32) -> String { Calendar.current.shortWeekdaySymbols[Int(d) % 7] }

    /// Today, Tomorrow, else "3 Nov".
    static func day(_ due: String) -> String {
        switch ProjectTodo.shared.dueToday(due: due) {
        case .today: return tr("Today")
        case .tomorrow: return tr("Tomorrow")
        default:
            guard let d = ISODay.date(due) else { return due }
            return d.formatted(.dateTime.day().month(.abbreviated))
        }
    }

    static func when(_ due: String?, _ repeat_: Repeat?) -> String? {
        if let r = repeat_ { return ProjectTodo.shared.rhythmLabel(r: r) { weekday($0.int32Value) } }
        return due.map(day)
    }

    static func chip(_ r: ProjectTodo.Row) -> String? {
        switch r.chip {
        case .`repeat`: return r.todo.`repeat`.map { ProjectTodo.shared.rhythmLabel(r: $0) { weekday($0.int32Value) } }
        case .working: return tr("Working")
        case .due: return r.todo.due.map(day)
        default: return nil
        }
    }
}

/// The owner's own head: a person on a filled circle.
struct YouHead: View {
    let size: CGFloat
    var body: some View {
        Image(systemName: "person.fill").font(.system(size: size * 0.5)).foregroundStyle(.white)
            .frame(width: size, height: size).background(Color.secondary, in: .circle)
            .accessibilityLabel(tr("You"))
    }
}

/// Add a task: whom it is for, its text, when it is due and how it repeats, Add. "@Bot text" gives it to that bot.
private struct AddTodoRow: View {
    let full: Bool
    let forBots: [Bot]
    let adding: Bool
    let figure: FigureDef?
    let model: ProjectModel
    @State private var typed = ""
    @State private var who: Bot?
    @State private var due: String?
    @State private var repeat_: Repeat?
    @State private var picking = false

    var body: some View {
        HStack(spacing: 8) {
            if full {
                Menu {
                    Button(tr("You")) { who = nil }
                    ForEach(forBots, id: \.id) { b in Button(b.name) { who = b } }
                } label: {
                    if let who { ProjectHead(bot: who, figure: figure, size: 28) } else { YouHead(size: 28) }
                }
            }
            TextField(tr("Add a task"), text: $typed)
                .onChange(of: typed) { _, t in if t.count > 300 { typed = String(t.prefix(300)) } }
                .onSubmit(go)
                .disabled(adding)
            if full {
                Button { picking = true } label: {
                    if let w = TodoWords.when(due, repeat_) { Text(w).font(.caption).lineLimit(1) } else { Image(systemName: "calendar") }
                }
                .accessibilityLabel(tr("Due"))
            }
            Button(tr("Add"), action: go).disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty || adding)
        }
        .sheet(isPresented: $picking) { WhenSheet(due: $due, repeat_: $repeat_).presentationDetents([.medium]) }
    }

    private func go() {
        let text = typed
        Task {
            if await model.addTodo(text, who: who?.id, due: due, repeat: repeat_) { typed = ""; who = nil; due = nil; repeat_ = nil }
        }
    }
}

/// When: a day (or none) and how it repeats; a weekly one on its weekdays, a custom one every N days (ProjectTodo).
private struct WhenSheet: View {
    @Binding var due: String?
    @Binding var repeat_: Repeat?

    var body: some View {
        Form {
            Section {
                Toggle(tr("Due"), isOn: Binding(get: { due != nil }, set: { due = $0 ? ISODay.string(.now) : nil }))
                if let d = due, let date = ISODay.date(d) {
                    DatePicker(tr("Due"), selection: Binding(get: { date }, set: { due = ISODay.string($0) }), displayedComponents: .date)
                }
            }
            Section {
                Picker(tr("Due"), selection: Binding(get: { repeat_?.every ?? "" }, set: { repeat_ = ProjectTodo.shared.rhythmToday(every: $0, due: due) })) {
                    ForEach(ProjectTodo.shared.RHYTHMS, id: \.self) { k in Text(Self.rhythmWord(k)).tag(k) }
                }
                .pickerStyle(.segmented)
                if let r = repeat_, r.every == "week" {
                    HStack {
                        ForEach([1, 2, 3, 4, 5, 6, 0] as [Int32], id: \.self) { d in
                            let on = (r.days ?? []).contains { $0.int32Value == d }
                            Button(TodoWords.weekday(d)) { repeat_ = ProjectTodo.shared.flipDay(r: r, day: d) }
                                .buttonStyle(.borderless).font(.caption)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(on ? Color.primary : Color.secondary.opacity(0.15), in: .capsule)
                                .foregroundStyle(on ? Color(.systemBackground) : .primary)
                        }
                    }
                }
                if let r = repeat_, r.every == "days" {
                    Stepper(tr("Every {n} days", ["n": "\(r.n?.intValue ?? 2)"]), value: Binding(get: { Int(r.n?.intValue ?? 2) }, set: { repeat_ = ProjectTodo.shared.everyN(r: r, n: Int32($0)) }), in: 2...365)
                }
            }
        }
    }

    static func rhythmWord(_ k: String) -> String {
        switch k { case "day": tr("Daily"); case "week": tr("Weekly"); case "month": tr("Monthly"); case "days": tr("Custom"); default: tr("None") }
    }
}
