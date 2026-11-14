import SwiftUI
import BotdotShared

/// The skeleton's one screen (#1358): the app's name and an address the shared data layer read, which proves the
/// bridge to Kotlin works. The sign-in comes in phase 1.
struct StartView: View {
    /// What the shared layer makes of an address typed without a scheme.
    static let address = Api.companion.normalize(input: "my-vm.tailnet.ts.net") ?? ""

    var body: some View {
        VStack(spacing: 12) {
            Text("botdot")
                .font(.largeTitle.bold())
            Text(Self.address)
                .font(.body.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("address")
        }
        .padding()
    }
}

#Preview {
    StartView()
}
