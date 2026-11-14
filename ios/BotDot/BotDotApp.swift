import SwiftUI

/// The iOS app (ADR 242): its screens are SwiftUI, its logic the shared data layer's (BotdotShared).
@main
struct BotDotApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView(model: delegate.model)
        }
    }
}
