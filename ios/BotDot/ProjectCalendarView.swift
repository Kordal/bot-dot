import SwiftUI
import BotdotShared

/// The project's calendar tile (#695; Android's CalendarTile): this week's days, today lit, a dot under a day with
/// something on it, and the next few items; a tap opens the month on that day. What it shows, and the month's days
/// and events, are the shared CalendarDesk.
struct CalendarTileView: View {
    let model: ProjectModel
    let bots: [Bot]
    let figure: FigureDef?
    @State private var desk: CalendarDesk?
    @State private var state: CalendarState?
    @State private var watching: Kotlinx_coroutines_coreJob?
    @State private var said: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(Board.tint(ProjectCalendar.shared.PROJECT_COLOR, .purple)).frame(width: 8, height: 8)
                Text(tr("Calendar")).font(.subheadline.weight(.semibold))
            }
            if let s = state {
                HStack(spacing: 4) {
                    ForEach(s.week, id: \.day) { d in
                        Button { desk?.open(day: d.day) } label: {
                            VStack(spacing: 4) {
                                Text(CalendarWords.weekday(d.weekday)).font(.caption2)
                                Text("\(d.number)").font(.subheadline.weight(.semibold))
                                Circle().fill(d.dots.first.map { Board.tint($0, .secondary) } ?? .clear).frame(width: 5, height: 5)
                            }
                            .foregroundStyle(d.today ? Color(.systemBackground) : d.past ? .secondary : .primary)
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(d.today ? Color.primary : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(CalendarWords.day(d.day, long: true))
                    }
                }
                ForEach(Array(s.next.enumerated()), id: \.offset) { _, x in
                    CalendarItemRow(item: x, bots: bots, figure: figure, when: ProjectCalendar.shared.whenOf(x: x, today: s.today) ?? CalendarWords.day(x.day, long: false))
                }
            }
        }
        .contentShape(.rect)
        .onTapGesture { if let s = state { desk?.open(day: s.today) } }
        .sheet(isPresented: Binding(get: { state?.month != nil }, set: { if !$0 { desk?.shut() } })) {
            if let desk, let s = state { MonthSheet(desk: desk, state: s, bots: bots, figure: figure) }
        }
        .onAppear {
            guard desk == nil else { return }
            let d = model.store.calendar()
            desk = d
            state = d.state.value
            watching = d.watch { s in MainActor.assumeIsolated { state = s } }
        }
        .onDisappear { watching?.cancel(cause: nil); watching = nil; desk?.close(); desk = nil }
        .onChange(of: state?.noticeCount) { said = state?.notice }
        .alert(said ?? "", isPresented: Binding(get: { said != nil }, set: { if !$0 { said = nil } })) { Button(tr("Close")) {} }
    }
}

/// The words the calendar draws in the phone's language.
enum CalendarWords {

    static func weekday(_ d: Int32) -> String { Calendar.current.shortWeekdaySymbols[Int(d) % 7] }

    /// "Mon 3", or with [long] "Mon, 3 Nov".
    static func day(_ day: String, long: Bool) -> String {
        guard let d = ISODay.date(day) else { return day }
        return long ? d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) : d.formatted(.dateTime.weekday(.abbreviated).day())
    }

    /// "November 2026".
    static func month(_ ym: String) -> String {
        guard let d = ISODay.date(ym + "-01") else { return ym }
        return d.formatted(.dateTime.month(.wide).year())
    }
}

/// One item: when, whose it is, its title, a repeat mark; an event the owner may change has Delete, a tap edits it.
private struct CalendarItemRow: View {
    let item: CalendarItem
    let bots: [Bot]
    let figure: FigureDef?
    let when: String
    var picked = false
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            Text(when).font(.caption.monospaced()).foregroundStyle(.tertiary).lineLimit(1).frame(width: 72, alignment: .leading)
            head
            Text(ProjectCalendar.shared.titleOf(x: item)).font(.subheadline).lineLimit(2)
                .foregroundStyle(item.done ? .tertiary : .primary).frame(maxWidth: .infinity, alignment: .leading)
            if ProjectCalendar.shared.repeats(x: item) { Image(systemName: "repeat").foregroundStyle(.tertiary) }
            if let onDelete { Button(action: onDelete) { Image(systemName: "xmark").foregroundStyle(.secondary) }.accessibilityLabel(tr("Delete")) }
        }
        .padding(.vertical, 4)
        .background(picked ? Color.secondary.opacity(0.12) : .clear, in: .rect(cornerRadius: 8))
        .contentShape(.rect)
        .onTapGesture { onEdit?() }
        .buttonStyle(.borderless)
    }

    @ViewBuilder private var head: some View {
        let who = ProjectCalendar.shared.whoOf(x: item)
        if who == nil {
            Image(systemName: "flag").foregroundStyle(Board.tint(ProjectCalendar.shared.CHECKIN_COLOR, .yellow)).frame(width: 24, height: 24)
        } else if let b = bots.first(where: { $0.id == who }) {
            ProjectHead(bot: b, figure: figure, size: 24)
        } else {
            YouHead(size: 24)
        }
    }
}

/// The month (#695): its days in whole weeks with a dot per item, the picked day's list under it, where the owner
/// adds an event (a title and a time) and changes, moves or deletes one. Only events change here.
private struct MonthSheet: View {
    let desk: CalendarDesk
    let state: CalendarState
    let bots: [Bot]
    let figure: FigureDef?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        ForEach(state.week, id: \.day) { d in Text(CalendarWords.weekday(d.weekday)).font(.caption.monospaced()).foregroundStyle(.tertiary).frame(maxWidth: .infinity) }
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                        ForEach(state.cells, id: \.day) { d in
                            Button { desk.pick(day: d.day) } label: {
                                VStack(spacing: 4) {
                                    Text("\(d.number)").font(.subheadline.weight(d.today ? .semibold : .regular))
                                        .foregroundStyle(d.today ? Color(.systemBackground) : d.out ? .secondary : .primary)
                                        .frame(width: 28, height: 28).background(d.today ? Color.primary : .clear, in: .circle)
                                    HStack(spacing: 3) { ForEach(Array(d.dots.enumerated()), id: \.offset) { _, c in Circle().fill(Board.tint(c, .secondary)).frame(width: 5, height: 5) } }
                                        .frame(height: 5)
                                }
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .background(d.out ? Color.secondary.opacity(0.06) : .clear)
                                .overlay(Rectangle().strokeBorder(d.day == state.picked ? Color.secondary : Color.secondary.opacity(0.15), lineWidth: 0.5))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(CalendarWords.day(d.day, long: true))
                        }
                    }
                    if let picked = state.picked {
                        Text(CalendarWords.day(picked, long: true)).font(.headline).padding(.top, 8)
                        ForEach(Array(state.pickedItems.enumerated()), id: \.offset) { _, x in
                            if ProjectCalendar.shared.editable(x: x), let id = x.id {
                                CalendarItemRow(item: x, bots: bots, figure: figure, when: x.time ?? "", picked: state.editing?.id == id,
                                                onEdit: { desk.edit(id: id) }, onDelete: { Task { try? await desk.delete(id: id) } })
                            } else {
                                CalendarItemRow(item: x, bots: bots, figure: figure, when: x.time ?? "")
                            }
                        }
                        EventForm(desk: desk, event: state.editing, busy: state.busy)
                    }
                }
                .padding()
            }
            .navigationTitle(state.month.map(CalendarWords.month) ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button { desk.turn(by: -1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel(tr("Previous month"))
                    Button { desk.turn(by: 1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel(tr("Next month"))
                }
                ToolbarItem(placement: .topBarTrailing) { Button(tr("Close")) { dismiss() } }
            }
        }
    }
}

/// Add an event on the picked day (a title and an optional time), or change the one being edited, its day too.
private struct EventForm: View {
    let desk: CalendarDesk
    let event: CalendarItem?
    let busy: Bool
    @State private var title = ""
    @State private var time = ""
    @State private var moveTo: Date?

    var body: some View {
        let ready = !title.trimmingCharacters(in: .whitespaces).isEmpty && ProjectCalendar.shared.time(typed: time) != nil && !busy
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                YouHead(size: 28)
                TextField(tr("Add an event"), text: $title).onSubmit { go(ready) }.disabled(busy)
            }
            HStack(spacing: 8) {
                TextField("--:--", text: $time).keyboardType(.numbersAndPunctuation).frame(maxWidth: 90)
                    .foregroundStyle(ProjectCalendar.shared.time(typed: time) == nil ? .red : .primary)
                    .accessibilityLabel(tr("Time"))
                if event != nil {
                    DatePicker(tr("Day"), selection: Binding(get: { moveTo ?? .now }, set: { moveTo = $0 }), displayedComponents: .date).labelsHidden()
                }
                Spacer()
                Button(event != nil ? tr("Save") : tr("Add")) { go(ready) }.buttonStyle(.borderedProminent).disabled(!ready)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
        .onChange(of: event?.id, initial: true) {
            title = event?.title ?? ""
            time = event?.time ?? ""
            moveTo = event.flatMap { ISODay.date($0.day) }
        }
    }

    private func go(_ ready: Bool) {
        guard ready else { return }
        let move = moveTo.map { ISODay.string($0) }
        Task { if (try? await desk.save(title: title, typedTime: time, moveTo: move))?.boolValue == true { title = ""; time = "" } }
    }
}
