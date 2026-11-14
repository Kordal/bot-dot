import SwiftUI
import BotdotShared

/// A group's members panel, opened from its chat's title, as Android's group settings: its name, its members each
/// with a way to take it out, "Add a bot", its notes (ADR 139), and "Delete this group", which deletes no bot. Every
/// change saves by itself; what botdot refuses is said in its words, over the chat.
struct GroupPanelView: View {
    let model: GroupChatModel
    let figure: FigureDef?
    @State private var name = ""
    /// The name was typed in, and not saved yet: only that is saved when the panel closes.
    @State private var typing = false
    @FocusState private var naming: Bool
    @State private var adding = false
    @State private var askDelete = false
    @State private var noteKind = "decision"
    @State private var noteText = ""
    @State private var editing: GroupNote?
    @State private var edited = ""

    var body: some View {
        NavigationStack {
            Form {
                if let s = model.state, let g = s.group {
                    if s.renames {
                        TextField(tr("Name"), text: $name)
                            .focused($naming)
                            .submitLabel(.done)
                            .onChange(of: name) { if naming { typing = true } }
                            .onSubmit { model.rename(name); typing = false }
                    }
                    Section(tr("Members")) {
                        ForEach(s.members, id: \.id) { b in
                            HStack(spacing: 10) {
                                if let figure {
                                    FigureView(drawing: FigurePaint.shared.figure(def: figure, color: b.color, state: b.state, outfit: b.outfit, dark: true)).frame(width: 32, height: 32)
                                }
                                Text(b.name).lineLimit(1)
                                Spacer()
                                if s.canTakeOut {
                                    Button { model.takeOut(b.id) } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                                        .buttonStyle(.borderless)
                                        .accessibilityLabel(g.team != nil ? tr("Take {name} out of the team", ["name": b.name]) : tr("Take {name} out of the group", ["name": b.name]))
                                }
                            }
                        }
                        if s.changesMembers && !s.addable.isEmpty {
                            Button("＋ " + tr("Add a bot")) { adding = true }
                        }
                    }
                    if let notes = s.notes {
                        Section(tr("Notes")) {
                            ForEach(notes, id: \.id) { n in
                                HStack {
                                    kindMenu(n.kind) { model.setNoteKind(n, $0) }
                                    Button { edited = n.text; editing = n } label: { Text(n.text).foregroundStyle(.primary) }
                                        .buttonStyle(.plain)
                                    Spacer()
                                    Button { model.removeNote(n) } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                                        .buttonStyle(.borderless)
                                        .accessibilityLabel(tr("Remove"))
                                }
                            }
                            HStack {
                                kindMenu(noteKind) { noteKind = $0 }
                                TextField(tr("Add a note"), text: $noteText)
                                    .submitLabel(.done)
                                    .onSubmit { model.addNote(kind: noteKind, noteText); noteText = "" }
                            }
                        }
                    }
                    if s.deletes {
                        Button(g.team != nil ? tr("Delete team") : tr("Delete this group"), role: .destructive) { askDelete = true }
                            .confirmationDialog(g.team != nil ? tr("Delete the team {name}?", ["name": g.name]) : tr("Delete the group {name}?", ["name": g.name]), isPresented: $askDelete, titleVisibility: .visible) {
                                Button(tr("Delete"), role: .destructive) { Task { _ = await model.delete() } } // gone: the chat closes, and this with it
                                Button(tr("Keep"), role: .cancel) {}
                            } message: {
                                Text(g.team != nil ? tr("Its chat is erased. Its bots stay.") : tr("Its chat is erased. No bot is deleted: each keeps its own chat."))
                            }
                    }
                }
            }
            .navigationTitle(model.state?.group?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $adding) { AddBots(model: model, figure: figure) }
            .alert(editing.map { GroupNotes.shared.kindWord(kind: $0.kind) } ?? "", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
                TextField("", text: $edited)
                Button(tr("Save")) { if let n = editing { model.setNoteText(n, edited) }; editing = nil }
                Button(tr("Cancel"), role: .cancel) { editing = nil }
            }
        }
        .onAppear { name = model.state?.group?.name ?? "" }
        // Renamed elsewhere: shown, unless a name is being typed here.
        .onChange(of: model.state?.group?.name) { _, now in if !typing, let now { name = now } }
        .onDisappear { if typing { model.rename(name) } } // closed with the name still typed: saved all the same
    }

    private func kindMenu(_ kind: String, onPick: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(GroupNotes.shared.KINDS, id: \.self) { k in Button(GroupNotes.shared.kindWord(kind: k)) { onPick(k) } }
        } label: {
            Text(GroupNotes.shared.kindWord(kind: kind)).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

/// The bots that can join, to tick; Add saves them, up to what the group holds.
private struct AddBots: View {
    let model: GroupChatModel
    let figure: FigureDef?
    @State private var picked: [String] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(model.state?.addable ?? [], id: \.id) { b in
                    let on = picked.contains(b.id)
                    Button {
                        if on { picked.removeAll { $0 == b.id } } else if picked.count < room { picked.append(b.id) }
                    } label: {
                        HStack(spacing: 10) {
                            if let figure {
                                FigureView(drawing: FigurePaint.shared.figure(def: figure, color: b.color, state: b.state, outfit: b.outfit, dark: true)).frame(width: 32, height: 32)
                            }
                            Text(b.name).foregroundStyle(.primary)
                            Spacer()
                            if on { Image(systemName: "checkmark") }
                        }
                    }
                }
            }
            .navigationTitle(tr("Add a bot"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Add")) { model.add(picked); dismiss() }.disabled(picked.isEmpty)
                }
            }
        }
    }

    private var room: Int { Int(model.state?.room ?? 0) }
}
