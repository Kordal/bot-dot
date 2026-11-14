import BotdotShared

// Kotlin/Native objects may be used from any thread (its memory model has no thread confinement), and the shared
// layer guards its own state (StateFlow, atomicfu locks). So the shared types the app hands to their own async calls
// are Sendable to Swift 6.
extension Api: @retroactive @unchecked Sendable {}
extension Settings: @retroactive @unchecked Sendable {}
extension Session: @retroactive @unchecked Sendable {}
extension BrowserSignIn: @retroactive @unchecked Sendable {}
extension HomeStore: @retroactive @unchecked Sendable {}
extension HomeState: @retroactive @unchecked Sendable {}
extension FilesStore: @retroactive @unchecked Sendable {}
extension FilesState: @retroactive @unchecked Sendable {}
extension DocumentViewer: @retroactive @unchecked Sendable {}
extension Viewed: @retroactive @unchecked Sendable {}
extension WorkspaceEntry: @retroactive @unchecked Sendable {}
extension DocumentView.Opening: @retroactive @unchecked Sendable {}
extension FigureDef: @retroactive @unchecked Sendable {}
extension NeedsYouStore: @retroactive @unchecked Sendable {}
extension NeedsState: @retroactive @unchecked Sendable {}
extension BotChat: @retroactive @unchecked Sendable {}
extension VersionInfo: @retroactive @unchecked Sendable {}
extension VaultStore: @retroactive @unchecked Sendable {}
extension VaultState: @retroactive @unchecked Sendable {}
extension VaultItem: @retroactive @unchecked Sendable {}
extension VaultLogin: @retroactive @unchecked Sendable {}
