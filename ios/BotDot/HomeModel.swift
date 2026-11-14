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

    let home: HomeStore
    private var watching: Kotlinx_coroutines_coreJob?
    private var figureKey: String??

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
        home.close()
    }

    /// Pull to refresh: everything Home shows, at once.
    func refresh() async {
        try? await home.refresh()
    }

    /// A row was let go at its new place: saved as Android's list saves it, then the list is read again.
    func move(from: IndexSet, to: Int) {
        guard let state, let first = from.first else { return }
        let key = order[first]
        order.move(fromOffsets: from, toOffset: to)
        let now = order
        Task {
            do {
                try await home.move(state: state, order: now, key: key)
            } catch {
                self.error = error.localizedDescription
                if let s = self.state { self.order = Self.order(s) } // didn't save: back where it was
            }
        }
    }

    private func show(_ s: HomeState) {
        state = s
        order = Self.order(s)
        let key = s.version?.figureKey
        if s.version != nil, figureKey != .some(key) {
            figureKey = .some(key)
            let bundled = Self.bundledFigure
            Task { [home] in
                if let def = try? await Figures.shared.of(api: home.api, key: key, bundled: bundled) { self.figure = def }
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
