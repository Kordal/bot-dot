import BotdotShared

// Kotlin/Native objects may be used from any thread (its memory model has no thread confinement), and the shared
// layer guards its own state (StateFlow, atomicfu locks). So the shared types the app hands to their own async calls
// are Sendable to Swift 6.
extension Api: @retroactive @unchecked Sendable {}
extension Settings: @retroactive @unchecked Sendable {}
extension Session: @retroactive @unchecked Sendable {}
extension BrowserSignIn: @retroactive @unchecked Sendable {}
