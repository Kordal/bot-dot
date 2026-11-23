import SwiftUI
import BotdotShared

/// The small × after a reply's quick answers (`choices-dismiss`, QuickAnswers in the shared layer): not an answer, a way
/// to put them all away without answering. A plain round icon, quiet until pressed.
struct DismissX: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 28, height: 28)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tr("Dismiss suggested answers"))
    }
}

/// "Answers hidden · Undo", for [QuickAnswers.UNDO_MS] in the place of the row that was put away.
struct AnswersHidden: View {
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(tr("Answers hidden") + " ·")
            Button(tr("Undo"), action: onUndo)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

extension View {
    /// Ends [undo] once the line has stood for its few seconds (and starts the wait again when it is set again).
    func undoEnds(_ undo: Binding<Bool>) -> some View {
        task(id: undo.wrappedValue) {
            guard undo.wrappedValue else { return }
            try? await Task.sleep(nanoseconds: UInt64(QuickAnswers.shared.UNDO_MS) * 1_000_000)
            if !Task.isCancelled { undo.wrappedValue = false }
        }
    }
}
