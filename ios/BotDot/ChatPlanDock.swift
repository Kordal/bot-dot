import SwiftUI
import BotdotShared

/// Each chat's plan fold and the stopped plans dismissed, kept in the app's defaults (PlanMemory, as Android keeps them).
final class PlanKeep: NSObject, PlanMemoryKeep {
    private let defaults = UserDefaults.standard
    func read(key: String) -> String? { defaults.string(forKey: "plan." + key) }
    func write(key: String, value: String) { defaults.set(value, forKey: "plan." + key) }
}

/// The plan above a bot's or the Chief's message box (DockPlan, Android's PlanDock): folded to its step and what it does
/// now, with how much is done; open to every step; stopped, what was done, the step it stopped at and what was not
/// started, with Dismiss. The fold is kept per chat.
struct ChatPlanDock: View {
    let plan: DockPlan
    let color: String?
    var onFold: (Bool) -> Void = { _ in }
    var onDismiss: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if plan.stopped { stopped } else if plan.folded { folded } else { open }
        }
        .padding(12)
        .background(.bar, in: .rect(cornerRadius: 14))
        .accessibilityIdentifier("plan-dock")
    }

    private var accent: Color { ContactRow.tint(color) }

    private var folded: some View {
        Button { withAnimation { onFold(false) } } label: {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini).tint(accent)
                    Text(tr("Plan")).font(.subheadline.weight(.semibold))
                    Text(plan.stepLine).font(.caption.monospaced()).foregroundStyle(.secondary)
                    Text(plan.now).font(.subheadline).lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up").font(.caption).foregroundStyle(.secondary)
                }
                ProgressView(value: Double(plan.progress)).tint(accent)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(tr("Open the plan"))
    }

    private var open: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation { onFold(true) } } label: {
                HStack(spacing: 8) {
                    Text(tr("Plan")).font(.subheadline.weight(.semibold))
                    Text(plan.doneLine).font(.caption.monospaced()).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(tr("Fold the plan"))
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { (_, step: Plan.Step) in row(step) }
                }
            }
            .frame(maxHeight: 280)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ step: Plan.Step) -> some View {
        let done = step.status == Plan.companion.DONE
        let doing = step.status == Plan.companion.DOING
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: done ? "checkmark.circle.fill" : doing ? "circle.dotted" : "circle")
                .foregroundStyle(done ? Color.green : doing ? accent : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.text).font(.subheadline).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
                if doing && !step.doing.isEmpty && step.doing != step.text {
                    Text(step.doing).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var stopped: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(tr("Plan")).font(.subheadline.weight(.semibold))
                Text(plan.stoppedLine).font(.caption.monospaced()).foregroundStyle(.orange)
            }
            if let done = plan.doneSteps { Label(done, systemImage: "checkmark").foregroundStyle(.secondary) }
            if let at = plan.stoppedAt { Label(at, systemImage: "xmark").foregroundStyle(.orange) }
            if let left = plan.notStarted { Label(left, systemImage: "circle.dashed").foregroundStyle(.secondary) }
            Button(tr("Dismiss"), action: onDismiss).buttonStyle(.bordered)
        }
        .font(.subheadline)
    }
}
