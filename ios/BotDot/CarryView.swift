import SwiftUI
import BotdotShared

/// Move to… and Copy to…'s model: the shared CarryDesk's state.
@MainActor
@Observable
final class CarryModel {
    private(set) var state: CarryState
    let desk: CarryDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(desk: CarryDesk) {
        self.desk = desk
        state = desk.state.value
    }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] s in MainActor.assumeIsolated { self?.state = s } }
    }

    func stop() { watching?.cancel(cause: nil); watching = nil }
}

/// Move to… and Copy to… (Android's CarryDialog): every place of the owner as a tree, each folder opened by its chevron;
/// the folder the item is in, and the item itself with what it holds, can't be picked. New folder makes one in the
/// folder picked; Move here or Copy here carries it there.
struct CarryView: View {
    let desk: CarryDesk
    let onGo: () -> Void
    @State private var model: CarryModel?
    @State private var naming = false
    @State private var newName = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let s = model?.state {
                    ForEach(s.nodes, id: \.self) { n in row(n) }
                }
            }
            .listStyle(.plain)
            .navigationTitle(model?.state.title ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model?.state.goWords ?? "") { onGo(); dismiss() }.disabled(model?.state.to == nil)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button(tr("New folder")) { newName = ""; naming = true }.disabled(model?.state.to == nil)
                }
            }
            .alert(tr("New folder"), isPresented: $naming) {
                TextField(tr("Name"), text: $newName)
                Button(tr("Make")) { let n = newName; Task { _ = try? await desk.makeFolder(name: n) } }
                Button(tr("Cancel"), role: .cancel) {}
            }
        }
        .task {
            if model == nil { model = CarryModel(desk: desk) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private func row(_ n: CarryNode) -> some View {
        HStack(spacing: 8) {
            Button { desk.toggle(root: n.root, path: n.path) } label: {
                Image(systemName: n.open ? "chevron.down" : "chevron.right").frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(tr("Open"))
            Button { desk.pick(root: n.root, path: n.path) } label: {
                HStack(spacing: 10) {
                    Image(systemName: n.depth == 0 ? "externaldrive" : "folder")
                    Text(n.name).lineLimit(1)
                    Spacer(minLength: 0)
                    if n.picked { Image(systemName: "checkmark").foregroundStyle(.tint) }
                }
                .foregroundStyle(n.takes ? .primary : .tertiary)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!n.takes)
        }
        .padding(.leading, CGFloat(n.depth) * 18)
        .listRowBackground(n.picked ? Color.accentColor.opacity(0.12) : nil)
    }
}
