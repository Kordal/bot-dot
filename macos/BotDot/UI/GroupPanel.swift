import SwiftUI
import BotDotKit

/// The picker of bots, as the Android app's: rows to tick, at most `max`, and with `named` a name to
/// give. `done` saves what was picked, in the order it was ticked, and throws with the botdot
/// server's sentence when it is refused: the sentence is then shown here, with nothing lost.
/// `hint`: the line under the rows, by how many are ticked.
struct BotPicker: View {
    let title: String
    let bots: [Bot]
    let max: Int
    let action: String
    let hint: (Int) -> String
    var named = false
    let done: @MainActor (_ picked: [String], _ name: String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    /// In the order they were ticked: the group's order.
    @State private var picked: [String] = []
    @State private var name = ""
    @State private var refused: String?
    @State private var saving = false

    var body: some View {
        Dialog(title, width: 380) {
            if named {
                TextField("Name", text: $name)
                    .webField()
                    .onChange(of: name) { if name.count > 60 { name = String(name.prefix(60)) } }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(bots) { bot in
                        let on = picked.contains(bot.id)
                        Toggle(isOn: Binding(get: { on }, set: { tick in picked.removeAll { $0 == bot.id }; if tick { picked.append(bot.id) } })) {
                            HStack(spacing: 10) {
                                BotFigureView(color: bot.color, state: "idle", size: 32, outfit: bot.outfit)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(bot.name).lineLimit(1)
                                    if let about = bot.description, !about.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        Text(about).font(.geist(size: 12)).foregroundStyle(Theme.faint).lineLimit(1)
                                    }
                                }
                            }
                        }
                        .toggleStyle(.checkbox)
                        .disabled(!on && picked.count >= max) // full: nothing more can be ticked
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 320)
            Text(hint(picked.count)).font(.geist(size: 12.5)).foregroundStyle(Theme.faint)
            if let refused { Text(refused).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
            Button(action) { save() }.buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction).disabled(picked.isEmpty || saving)
        }
    }

    private func save() {
        saving = true
        refused = nil
        Task {
            do {
                try await done(picked, name)
                dismiss()
            } catch { refused = error.localizedDescription }
            saving = false
        }
    }
}

/// A group's panel, opened from its chat's header, as the Android app's: its name, its members each
/// with a way to take it out, "Add a bot", and "Delete this group", which says that it deletes no
/// bot. Every change saves by itself, and what the botdot server refuses is said in its words.
struct GroupPanel: View {
    let groupId: String
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var name = ""
    @State private var refused: String?
    @State private var adding = false
    @State private var askDelete = false
    @FocusState private var typing: Bool

    var body: some View {
        WebForm(inPanel: true) {
            if let group = store.group(groupId) {
              Card {
                let members = Groups.members(group, store.bots)
                GroupPicture(group: group, size: 76).frame(maxWidth: .infinity)
                // The name saves on Return or when the box is left. An emptied box takes the old one back.
                TextField("Name", text: $name)
                    .webField()
                    .focused($typing)
                    .onSubmit { saveName(group) }
                    .onChange(of: typing) { if !typing { saveName(group) } }
                    .onChange(of: name) { if name.count > 60 { name = String(name.prefix(60)) } }
                    .onChange(of: group.name) { if !typing { name = group.name } } // renamed elsewhere; not under the cursor
                Text("Members").font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
                if members.isEmpty { Text(GroupWords.empty([])).font(.geist(size: 12.5)).foregroundStyle(Theme.faint) }
                ForEach(members) { bot in
                    HStack(spacing: 10) {
                        BotFigureView(color: bot.color, state: bot.state ?? "idle", size: 32, outfit: bot.outfit)
                        Text(bot.name).lineLimit(1)
                        Spacer()
                        Button { change { try await store.setMembers(of: group.id, group.members.filter { $0 != bot.id }) } } label: {
                            Image(systemName: "xmark").foregroundStyle(Theme.muted)
                        }
                        .buttonStyle(.plain)
                        .help("Take \(bot.name) out of the group")
                        .accessibilityLabel("Take \(bot.name) out of the group")
                    }
                }
                // Nothing to add: the group is full, or every bot is in it.
                if !Groups.addable(group, store.bots).isEmpty { Button("＋ Add a bot") { adding = true } }
                if let refused { Text(refused).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
              }
                Button("Delete this group", role: .destructive) { askDelete = true }.buttonStyle(.textLink).foregroundStyle(Theme.err)
                Text("Its chat is erased. No bot is deleted.").font(.geist(size: 12.5)).foregroundStyle(Theme.faint)
            }
        }
        .sheet(isPresented: $adding) {
            if let group = store.group(groupId) {
                BotPicker(title: "Add a bot", bots: Groups.addable(group, store.bots).sorted { $0.name.lowercased() < $1.name.lowercased() },
                          max: Groups.most - group.members.count, action: "Add", hint: { GroupWords.addHint($0, members: group.members.count, name: group.name) }) { picked, _ in
                    try await store.setMembers(of: group.id, group.members + picked)
                }
            }
        }
        .confirmationDialog("Delete the group \(store.group(groupId)?.name ?? "")?", isPresented: $askDelete) {
            Button("Delete", role: .destructive) { if let group = store.group(groupId) { delete(group) } }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("Its chat is erased. No bot is deleted: each keeps its own chat.")
        }
        .onAppear { name = store.group(groupId)?.name ?? "" }
        // The panel was closed with the cursor still in the box: the name typed is saved all the same, by the
        // store, which outlives the panel. A group deleted meanwhile is not in the list, and nothing is sent.
        .onDisappear {
            let typed = name
            Task { [store] in
                do { try await store.nameGroup(groupId, typed: typed) } catch { store.problem = error.localizedDescription }
            }
        }
    }

    /// A change to the group, saved at once; what the server refuses is said here.
    private func change(_ save: @escaping @MainActor () async throws -> Void) {
        refused = nil
        Task {
            do { try await save() } catch { refused = error.localizedDescription }
        }
    }

    private func saveName(_ group: BotGroup) {
        if GroupWords.name(typed: name).isEmpty { name = group.name; return }
        let typed = name
        change { try await store.nameGroup(group.id, typed: typed) }
    }

    /// A deleted group has no chat to go back to: the window shows the Chief's.
    private func delete(_ group: BotGroup) {
        change {
            try await store.deleteGroup(group.id)
            nav.page = .chief
        }
    }
}
