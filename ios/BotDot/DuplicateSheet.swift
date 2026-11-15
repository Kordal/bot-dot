import SwiftUI
import BotdotShared

/// "Duplicate" (#227; Android's confirmation): what the copy gets and what it doesn't, its name to change, then the
/// copy is made and its chat opens. While it is made the sheet says so and waits; a refusal stays here with
/// botdot's sentence.
struct DuplicateSheet: View {
    let desk: DuplicateDesk
    let botName: String
    /// The copy made: its id and name; [onMade] closes the sheet and opens its chat.
    let onMade: (String, String) -> Void
    /// What to say over the settings once the sheet went ("… made").
    let onSaid: (String) -> Void
    @State private var state: DuplicateState?
    @State private var watching: Kotlinx_coroutines_coreJob?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let s = state {
                    Section(tr("Name")) {
                        TextField(tr("Name"), text: Binding(get: { s.name }, set: { desk.setName(name: $0) }))
                            .disabled(s.busy)
                    }
                    Section { Text(s.text) }
                    // Duplicating… while the copy is made, or botdot's sentence when it said no.
                    if let notice = s.notice, s.plan != nil {
                        Section {
                            HStack(spacing: 8) {
                                if s.busy { ProgressView().controlSize(.small) }
                                Text(notice).foregroundStyle(s.busy ? Color.secondary : Color.red)
                            }
                        }
                    }
                }
            }
            .navigationTitle(tr("Duplicate {name}?", ["name": botName]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { desk.cancel(); dismiss() }.disabled(state?.busy == true) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Duplicate")) {
                        let name = state?.name ?? ""
                        Task {
                            guard let id = try? await desk.go() else { return } // refused: its sentence shows here
                            if let made = desk.state.value.notice { onSaid(made) }
                            onMade(id, name.trimmingCharacters(in: .whitespaces))
                        }
                    }
                    .disabled(state?.canGo != true)
                }
            }
        }
        .interactiveDismissDisabled(state?.busy == true)
        .onAppear {
            state = desk.state.value
            watching = desk.watch { s in MainActor.assumeIsolated { state = s } }
        }
        .onDisappear { watching?.cancel(cause: nil); watching = nil }
    }
}
