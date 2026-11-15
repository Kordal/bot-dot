import SwiftUI
import BotdotShared

extension KeepDraft: @retroactive Identifiable {
    public var id: String { [every, time, notify, check].joined(separator: "\u{0}") }
}

/// A Markdown page's bar in the viewer (Android's PageBar, #346, #451): what keeps it up to date with Refresh now,
/// Change and Stop, or Keep up to date; Board or On Board; and the line of the action that runs on after the tap.
struct PageBarView: View {
    let bar: PageBarState
    let desk: PageDesk
    let onKeep: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let keep = bar.keep {
                        Text("↻ " + tr("Keeps up to date") + " · \(keep.when)").font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 6).background(.green.opacity(0.15), in: .capsule)
                        Button(tr("Refresh now")) { desk.refresh() }.buttonStyle(.bordered)
                        Button(tr("Change"), action: onKeep).buttonStyle(.borderless)
                        Button(tr("Stop")) { desk.stop() }.buttonStyle(.borderless)
                    } else {
                        Button(tr("Keep up to date"), action: onKeep).buttonStyle(.bordered).disabled(bar.work?.kind == "busy")
                    }
                    if bar.board {
                        let on = bar.onBoard?.boolValue == true
                        // One change at a time: the button waits for botdot's answer.
                        if on {
                            Button { desk.toggleBoard() } label: { Label(tr("On Board"), systemImage: "square.grid.2x2") }.buttonStyle(.borderedProminent).disabled(bar.boarding)
                        } else {
                            Button { desk.toggleBoard() } label: { Label(tr("Board"), systemImage: "square.grid.2x2") }.buttonStyle(.bordered).disabled(bar.boarding)
                        }
                    }
                }
                .padding(.horizontal)
            }
            if let w = bar.work {
                // While it runs, then a moment's ok, or the error, whose tap tries again.
                HStack(spacing: 8) {
                    Circle().fill(w.kind == "ok" ? .green : w.kind == "err" ? .red : .secondary).frame(width: 8, height: 8)
                    Text(w.text).font(.subheadline).foregroundStyle(w.kind == "err" ? .red : .primary)
                    if w.kind == "err" {
                        Spacer(minLength: 0)
                        Button { desk.dismissWork() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel(tr("Close"))
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(w.kind == "err" ? Color.red.opacity(0.12) : Color.secondary.opacity(0.12), in: .capsule)
                .contentShape(.capsule)
                .onTapGesture { if w.kind == "err" { desk.retry() } }
                .padding(.horizontal)
            }
        }
        .padding(.vertical, 6)
        .background(.bar)
    }
}

/// "Keep up to date" (#346; Android's KeepSheet): how often, at what time, whether to hear of every update, and what
/// to check. The tap is the consent: no card follows. It opens with [draft]: what keeps it now, or what was entered
/// before a save that failed.
struct KeepSheet: View {
    let page: PageInfo
    let from: String
    let onKeep: (KeepDraft) -> Void
    @State private var every: String
    @State private var time: String
    @State private var notify: String
    @State private var check: String
    @Environment(\.dismiss) private var dismiss

    init(page: PageInfo, from: String, draft: KeepDraft, onKeep: @escaping (KeepDraft) -> Void) {
        self.page = page
        self.from = from
        self.onKeep = onKeep
        _every = State(initialValue: draft.every)
        _time = State(initialValue: draft.time)
        _notify = State(initialValue: draft.notify)
        _check = State(initialValue: draft.check)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(tr("How often")) {
                    Picker(tr("How often"), selection: $every) {
                        ForEach(Pages.shared.EVERY, id: \.first) { e in Text(e.second as String? ?? "").tag(e.first as String? ?? "") }
                    }
                    .pickerStyle(.segmented)
                    if every != "hour" {
                        TextField(tr("At"), text: Binding(get: { time }, set: { time = String($0.prefix(5)) }))
                            .keyboardType(.numbersAndPunctuation)
                    }
                }
                Section(tr("Tell me")) {
                    Picker(tr("Tell me"), selection: $notify) {
                        Text(tr("Only when something needs me")).tag("report-only")
                        Text(tr("Every time it's updated")).tag("always")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section(tr("What to check")) {
                    TextField(tr("What to check"), text: Binding(get: { check }, set: { check = String($0.prefix(600)) }), axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(tr("Keep “{title}” up to date", ["title": page.title]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Keep it up to date")) { onKeep(KeepDraft(every: every, time: time, notify: notify, check: check)); dismiss() }
                }
            }
        }
    }
}
