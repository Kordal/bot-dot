import Foundation
import Observation
import BotdotShared

/// Home for one signed-in botdot: the shared Store's state (HomeStore), the figure definition its bots are drawn from,
/// and the list's order while a row is dragged. What it shows and saves is the shared layer's, as on Android.
@MainActor
@Observable
final class HomeModel {
    private(set) var state: HomeState?
    private(set) var figure: FigureDef?
    /// The list as drawn: the pinned rows, the line under them (ListLayout.PINS), then each category and its rows.
    private(set) var order: [String] = []
    var error: String?
    /// Home's first reads, as the shared layer keeps them (FirstRunDesk): the front door's offers, What's new, the name.
    private(set) var firstRun: FirstRunState?
    /// What the front door offers this account (deleting it, Feedback); nil while not read.
    var offers: FrontDoorOffers? { firstRun?.offers }
    /// The notes of the releases this person has not seen (What's new), shown once.
    var whatsNew: [WhatsNew.Entry] { firstRun?.whatsNew ?? [] }
    /// The first run's question for the Chief's name (ChiefName.firstRun); What's new waits for it.
    var askName: Bool { firstRun?.askName ?? false }
    var showsWhatsNew: Bool { firstRun?.showsWhatsNew ?? false }
    private let firstRunDesk: FirstRunDesk
    private var firstRunWatch: Kotlinx_coroutines_coreJob?

    let home: HomeStore
    /// Shared rooms, where the front door has them on for this account: Home's row, and the screens it opens.
    let rooms: RoomsModel
    private var watching: Kotlinx_coroutines_coreJob?
    private var figureKey: String??
    private var figureTask: Task<Void, Never>?

    init(api: Api, bundled: FigureDef? = HomeModel.bundledFigure) {
        home = HomeStore(api: api)
        rooms = RoomsModel(home: home)
        firstRunDesk = home.firstRun(zone: TimeZone.current.identifier)
        figure = bundled
    }

    /// Follows the Store: each change of a part draws Home again.
    func start() {
        guard watching == nil else { return }
        rooms.start()
        watching = home.watch { [weak self] state in
            MainActor.assumeIsolated { self?.show(state) }
        }
        firstRunWatch = firstRunDesk.watch { [weak self] run in
            MainActor.assumeIsolated { self?.firstRun = run }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        firstRunWatch?.cancel(cause: nil)
        firstRunWatch = nil
        figureTask?.cancel()
        figureTask = nil
        figureKey = nil
    }

    deinit {
        home.close() // Home left for good: another botdot, or signed out
    }

    /// Pull to refresh: everything Home shows, at once, and what the front door offers if it wasn't read yet.
    func refresh() async {
        firstRunDesk.refresh(features: state?.version?.features)
        try? await home.refresh()
    }

    /// A row was let go at its new place: saved as Android's list saves it, then the list is read again.
    func move(from: IndexSet, to: Int) {
        guard state != nil, let first = from.first else { return }
        let key = order[first]
        order.move(fromOffsets: from, toOffset: to)
        let now = order
        Task {
            do {
                try await home.move(order: now, key: key)
            } catch {
                self.error = error.localizedDescription
            }
            // The list as read again; as it was when nothing was saved or nothing changed.
            if let s = self.state { self.order = Self.order(s) }
        }
    }


    private func show(_ s: HomeState) {
        state = s
        order = Self.order(s)
        // Once the features are known, the first reads; a front door not reached yet is asked again (FirstRunDesk).
        firstRunDesk.saw(features: s.version?.features)
        let key = s.version?.figureKey
        if s.version != nil, figureKey != .some(key) {
            // Another server version: the definition is asked anew, and an answer for the one before is dropped.
            figureKey = .some(key)
            figureTask?.cancel()
            let bundled = Self.bundledFigure
            figureTask = Task { [home] in
                let def = try? await Figures.shared.of(api: home.api, key: key, bundled: bundled)
                guard !Task.isCancelled, self.figureKey == .some(key) else { return }
                guard let def else { self.figureKey = nil; return } // asked again on the next change
                self.figure = def
            }
        }
    }

    /// What's new closed, any way: its notes are seen, here and in every other app.
    func whatsNewClosed() { firstRunDesk.whatsNewClosed() }

    /// Allow or No on a Needs you row that asks for a permission; why not, when it didn't go.
    func answer(_ permission: String, yes: Bool) async {
        if let failed = (try? await home.answer(permission: permission, yes: yes)) ?? nil { error = failed }
    }

    /// Save or Skip on the Chief's name: nil once it was kept, else why not, and the question stays.
    func nameChief(_ given: String) async -> String? {
        let failed: String?
        do { failed = try await firstRunDesk.nameChief(given: given) } catch { failed = tr("Couldn't save the name") }
        if failed == nil { await refresh() }
        return failed
    }

    private static func order(_ s: HomeState) -> [String] {
        let rows = s.rows
        return rows.pins + rows.layout
    }

    /// The definition the app was built with (lib/figure.json, a copy in the app), until the server hands out its own.
    static let bundledFigure: FigureDef? = {
        guard let url = Bundle.main.url(forResource: "figure", withExtension: "json"), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return Figures.shared.parse(text: text)
    }()
}
