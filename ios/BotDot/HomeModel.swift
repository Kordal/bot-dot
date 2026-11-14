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
    /// What's new since the last update (#219): shown once, then seen.
    private(set) var whatsNew: [WhatsNew.Entry] = []
    private var askedWhatsNew = false

    let home: HomeStore
    private var watching: Kotlinx_coroutines_coreJob?
    private var figureKey: String??
    private var figureTask: Task<Void, Never>?

    init(api: Api, bundled: FigureDef? = HomeModel.bundledFigure) {
        home = HomeStore(api: api)
        figure = bundled
    }

    /// Follows the Store: each change of a part draws Home again.
    func start() {
        guard watching == nil else { return }
        watching = home.watch { [weak self] state in
            MainActor.assumeIsolated { self?.show(state) }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        figureTask?.cancel()
        figureTask = nil
        figureKey = nil
    }

    deinit {
        home.close() // Home left for good: another botdot, or signed out
    }

    /// Pull to refresh: everything Home shows, at once.
    func refresh() async {
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

    /// The What's new sheet closed: its notes are seen, and it goes.
    func whatsNewClosed() {
        let seen = whatsNew
        whatsNew = []
        Task { [home] in try? await home.whatsNewSeen(entries: seen) }
    }

    private func show(_ s: HomeState) {
        state = s
        order = Self.order(s)
        if s.version != nil, !askedWhatsNew {
            // Asked once its features are known, as Android's Home asks.
            askedWhatsNew = true
            Task { [home] in
                let notes = (try? await home.whatsNew()) ?? []
                self.whatsNew = notes
            }
        }
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
