import SwiftUI
import BotdotShared

/// A new group from a bot's chat (GroupMaker, Android's BotPicker under the "+"): a name, one to five other bots, its own
/// category's first, and Create. botdot's refusal stands in the sheet in its words, and nothing is made.
struct NewGroupSheet: View {
    let home: HomeStore
    let bot: Bot
    let others: [Bot]
    let onMade: (BotdotShared.Group) -> Void
    @State private var name = ""
    @State private var picked: [String] = []
    @State private var failed: String?
    @State private var busy = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section { TextField(tr("Name"), text: $name) }
                Section {
                    ForEach(others, id: \.id) { b in
                        Button { toggle(b.id) } label: {
                            HStack {
                                Circle().fill(ContactRow.tint(b.color)).frame(width: 10, height: 10)
                                Text(b.name).foregroundStyle(.primary)
                                Spacer()
                                if picked.contains(b.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .disabled(!picked.contains(b.id) && picked.count >= Int(GroupMaker.shared.PICKS))
                    }
                } footer: {
                    Text(GroupMaker.shared.hint(n: Int32(picked.count), bot: bot.name))
                }
                if let failed { Text(failed).foregroundStyle(.red) }
            }
            .navigationTitle(tr("New group"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Create"), action: create).disabled(busy || !GroupMaker.shared.ready(picked: Int32(picked.count)))
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if let i = picked.firstIndex(of: id) { picked.remove(at: i) } else { picked.append(id) }
    }

    private func create() {
        busy = true
        failed = nil
        Task {
            let made = try? await GroupMaker.shared.make(api: home.api, store: home.store, bot: bot.id, picked: picked, name: name)
            busy = false
            if let g = made?.group { dismiss(); onMade(g) } else { failed = made?.failed ?? tr("Couldn't create the group") }
        }
    }
}
