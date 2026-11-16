import SwiftUI
import BotdotShared

/// The bot the Chief suggests (Android's SuggestedCard): a dashed card in the colour of the team it would join, its
/// name and why, ✕ and Add (ProjectDesk.answerSuggested).
struct SuggestedTeamCard: View {
    let suggested: Suggested
    let project: Company
    let figure: FigureDef?
    let model: ProjectModel
    @State private var busy = false

    var body: some View {
        let color = ManyProjects.shared.suggestedColor(c: project, s: suggested)
        HStack(spacing: 12) {
            Group {
                if let figure { FigureView(drawing: FigurePaint.shared.figure(def: figure, color: color, state: "idle", outfit: nil, dark: true)) }
                else { Circle().fill(ContactRow.tint(color)) }
            }
            .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(suggested.name).font(.subheadline.weight(.semibold))
                if !suggested.why.isEmpty { Text(suggested.why).font(.caption).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { answer(false) } label: { Image(systemName: "xmark") }.accessibilityLabel(tr("Dismiss")).disabled(busy)
            Button(tr("Add")) { answer(true) }.buttonStyle(.borderedProminent).disabled(busy)
        }
        .buttonStyle(.borderless)
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(ContactRow.tint(color), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private func answer(_ add: Bool) {
        busy = true
        Task { await model.answerSuggested(add: add); busy = false }
    }
}

/// A dashed "New team" (Android's NewTeam): the team's editor opens new, the bots in no team offered first.
struct NewTeamTile: View {
    let bots: [Bot]
    let model: ProjectModel
    @State private var draft: TeamDraft?

    var body: some View {
        Button { draft = TeamDraft(id: nil, name: "", bots: [], lead: nil) } label: {
            Label(tr("New team"), systemImage: "plus").font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 56)
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.secondary.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        }
        .buttonStyle(.plain)
        .sheet(item: $draft) { d in TeamEditorView(draft: d, bots: bots, model: model) }
    }
}
