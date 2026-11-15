import SwiftUI
import BotdotShared

/// "Duplicate" (#227; Android's confirmation): what the copy gets and what it doesn't, its name to change, then the
/// copy is made and its chat opens. A refusal stays here with botdot's sentence.
struct DuplicateSheet: View {
    let desk: DuplicateDesk
    let botName: String
    let onMade: (String, String) -> Void
    let onSaid: (String) -> Void
    @State private var state: DuplicateState?
    @State private var watching: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let s = state {
                    Section(tr("Name")) {
                        TextField(tr("Name"), text: Binding(get: { s.name }, set: { desk.setName(name: $0); state = desk.state.value }))
                    }
                    Section { Text(s.text) }
                }
            }
            .navigationTitle(tr("Duplicate {name}?", ["name": botName]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { desk.cancel(); dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Duplicate")) {
                        let name = state?.name ?? ""
                        Task {
                            let id = try? await desk.go()
                            state = desk.state.value
                            if let words = state?.notice { onSaid(words) }
                            if let id { onMade(id, name.trimmingCharacters(in: .whitespaces)) }
                        }
                    }
                    .disabled(state?.canGo != true)
                }
            }
        }
        .onAppear { state = desk.state.value }
    }
}
