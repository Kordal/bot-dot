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
extension BoardStore: @retroactive @unchecked Sendable {}
extension BoardState: @retroactive @unchecked Sendable {}
extension BoardTap: @retroactive @unchecked Sendable {}
extension FrontDoorOffers: @retroactive @unchecked Sendable {}
extension FrontDoorDesk: @retroactive @unchecked Sendable {}
extension FrontDoorDesk.Deleted: @retroactive @unchecked Sendable {}
extension WhatsNew.Entry: @retroactive @unchecked Sendable {}
extension PausedWatch: @retroactive @unchecked Sendable {}
extension KotlinByteArray: @retroactive @unchecked Sendable {}
extension BotSettingsStore: @retroactive @unchecked Sendable {}
extension BotSettingsState: @retroactive @unchecked Sendable {}
extension BotDraft: @retroactive @unchecked Sendable {}
extension AppSettingsStore: @retroactive @unchecked Sendable {}
extension AppSettingsState: @retroactive @unchecked Sendable {}
extension AppsStore: @retroactive @unchecked Sendable {}
extension AppsState: @retroactive @unchecked Sendable {}
extension ScreenStore: @retroactive @unchecked Sendable {}
extension ScreenState: @retroactive @unchecked Sendable {}
extension BotChat: @retroactive @unchecked Sendable {}
extension VersionInfo: @retroactive @unchecked Sendable {}
extension VaultStore: @retroactive @unchecked Sendable {}
extension VaultState: @retroactive @unchecked Sendable {}
extension VaultItem: @retroactive @unchecked Sendable {}
extension VaultLogin: @retroactive @unchecked Sendable {}
extension ChiefDesk: @retroactive @unchecked Sendable {}
extension GroupChat: @retroactive @unchecked Sendable {}
extension GroupChatState: @retroactive @unchecked Sendable {}
