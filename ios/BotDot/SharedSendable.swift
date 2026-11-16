import BotdotShared

// Kotlin/Native objects may be used from any thread (its memory model has no thread confinement), and the shared
// layer guards its own state (StateFlow, atomicfu locks). So the shared types the app hands to their own async calls
// are Sendable to Swift 6.
extension Api: @retroactive @unchecked Sendable {}
extension OutgoingFile: @retroactive @unchecked Sendable {}
extension Share.Pending: @retroactive @unchecked Sendable {}
extension Share.Picker: @retroactive @unchecked Sendable {}
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
extension FirstRunDesk: @retroactive @unchecked Sendable {}
extension FirstRunState: @retroactive @unchecked Sendable {}
extension FrontDoorDesk.Deleted: @retroactive @unchecked Sendable {}
extension WhatsNew.Entry: @retroactive @unchecked Sendable {}
extension PausedWatch: @retroactive @unchecked Sendable {}
extension KotlinByteArray: @retroactive @unchecked Sendable {}
extension RoomsStore: @retroactive @unchecked Sendable {}
extension RoomsState: @retroactive @unchecked Sendable {}
extension RoomsDone: @retroactive @unchecked Sendable {}
extension RoomsJoin: @retroactive @unchecked Sendable {}
extension RoomChatDesk: @retroactive @unchecked Sendable {}
extension RoomChatState: @retroactive @unchecked Sendable {}
extension RoomSettingsDesk: @retroactive @unchecked Sendable {}
extension RoomSettingsState: @retroactive @unchecked Sendable {}
extension BotSettingsStore: @retroactive @unchecked Sendable {}
extension BotSettingsState: @retroactive @unchecked Sendable {}
extension BotDraft: @retroactive @unchecked Sendable {}
extension Bot: @retroactive @unchecked Sendable {}
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
extension ProjectStore: @retroactive @unchecked Sendable {}
extension CompanySetupStore: @retroactive @unchecked Sendable {}
extension SetupState: @retroactive @unchecked Sendable {}
extension ProjectState: @retroactive @unchecked Sendable {}
extension ChiefDesk: @retroactive @unchecked Sendable {}
extension GroupChat: @retroactive @unchecked Sendable {}
extension GroupChatState: @retroactive @unchecked Sendable {}
/// Read on the main actor and in a picture's task, which only downloads a file.
extension ReplyPictures: @retroactive @unchecked Sendable {}
/// An immutable value from the shared layer.
extension Attachment: @retroactive @unchecked Sendable {}
/// Read on the main actor; load only refreshes the store.
extension MentionBox: @retroactive @unchecked Sendable {}
/// Called from the main actor (JobsModel).
extension JobsDesk: @retroactive @unchecked Sendable {}
/// Immutable values from the shared layer, read on the main actor.
extension ChiefDesk.ChipBot: @retroactive @unchecked Sendable {}
extension ChiefChip: @retroactive @unchecked Sendable {}
/// Called from the main actor (PagesModel); an immutable value from the shared layer.
extension PagesDesk: @retroactive @unchecked Sendable {}
extension PageInfo: @retroactive @unchecked Sendable {}
/// Read from the main actor (OverviewModel).
extension OverviewDesk: @retroactive @unchecked Sendable {}
extension CarryDesk: @retroactive @unchecked Sendable {}
extension PageDesk: @retroactive @unchecked Sendable {}
extension PageBarState: @retroactive @unchecked Sendable {}
extension HomeTilesDesk: @retroactive @unchecked Sendable {}
extension StorageDesk: @retroactive @unchecked Sendable {}
extension StorageRow: @retroactive @unchecked Sendable {}
extension Storage.Group: @retroactive @unchecked Sendable {}
extension SkillsDesk: @retroactive @unchecked Sendable {}
extension ChiefSettingsDesk: @retroactive @unchecked Sendable {}
extension ChiefGrant: @retroactive @unchecked Sendable {}
extension DuplicateDesk: @retroactive @unchecked Sendable {}
extension BoardCanvas.R: @retroactive @unchecked Sendable {}
extension CalendarDesk: @retroactive @unchecked Sendable {}
extension CalendarState: @retroactive @unchecked Sendable {}
