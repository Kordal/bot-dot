import SwiftUI

/// The iOS app (ADR 242): its screens are SwiftUI, its logic the shared data layer's (BotdotShared).
@main
struct BotDotApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    /// The app hosts the XCTests (`make ios`): it starts no screen, so it doesn't open the botdot saved on this
    /// simulator and work on the main thread while the tests run there.
    static let hostsTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil

    var body: some Scene {
        WindowGroup {
            if Self.hostsTests {
                Color.clear
            } else {
                RootView(model: delegate.model)
            }
        }
    }
}
