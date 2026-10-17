// swift-tools-version: 6.2
// What the botdot apps know about a botdot server: its API, the live feed, and the Store the screens
// read. No AppKit or UIKit here, so the iOS app can use it too.
import PackageDescription

let package = Package(
    name: "BotDotKit",
    platforms: [.macOS(.v26), .iOS(.v26)],
    products: [.library(name: "BotDotKit", targets: ["BotDotKit"])],
    targets: [
        .target(name: "BotDotKit"),
        .testTarget(name: "BotDotKitTests", dependencies: ["BotDotKit"]),
    ]
)
