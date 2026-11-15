import SwiftUI
import BotdotShared

/// The notice before anything goes to the bots (App Store guideline 5.1.2(i)): the whole screen, until Continue.
/// The app shows it once signed in, the share extension before it sends; accepted in either, both know (SharedAddress).
struct AiNoticeView: View {
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text(AiNotice.shared.text).font(.title3).multilineTextAlignment(.center)
            Spacer()
            Button(action: onContinue) { Text(AiNotice.shared.go).frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("ai-notice-continue")
        }
        .padding(24)
    }
}
