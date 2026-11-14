import SwiftUI

/// The iOS app (ADR 242): its screens are SwiftUI, its logic the shared data layer's (BotdotShared).
@main
struct BotDotApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
