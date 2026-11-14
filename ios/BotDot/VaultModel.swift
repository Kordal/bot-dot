import Foundation
import Observation
import BotdotShared

/// The Vault for one signed-in botdot: the shared VaultStore's state, and what the search field holds. What it shows
/// and saves is the shared layer's (Vault, VaultLogin, VaultTypes), as on Android.
@MainActor
@Observable
final class VaultModel {
    private(set) var state: VaultState?
    var query = ""
    var error: String?

    let vault: VaultStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(api: Api, settings: Settings) {
        vault = VaultStore(api: api, settings: settings)
    }

    /// Follows the store, and reads the Vault.
    func start() async {
        if watching == nil {
            watching = vault.watch { [weak self] state in
                MainActor.assumeIsolated { self?.state = state }
            }
        }
        await refresh()
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
    }

    deinit {
        vault.close() // the screen went
    }

    /// Pull to refresh.
    func refresh() async {
        try? await vault.refresh()
    }

    /// The list as drawn: the entries the search shows, in their categories.
    var sections: [Vault.Section] { state?.sections(query: query) ?? [] }

    /// A tap on a category's heading: folded or open again, kept on this phone.
    func toggle(_ category: String) async {
        error = nil
        do {
            _ = try await vault.toggle(category: category)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Saves the editor's [form] as [item] (nil: a new login). Nil when saved, else the server's sentence for the form.
    func save(_ item: VaultItem?, _ form: VaultLogin) async -> String? {
        do {
            try await vault.save(item: item, form: form)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// Deletes [item]. Nil when it went, else what to say in the form.
    func delete(_ item: VaultItem) async -> String? {
        do {
            try await vault.delete(item: item)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// Unlocks Bitwarden. Nil when it opened, else what to say.
    func unlock(_ master: String) async -> String? {
        do {
            return try await vault.unlock(master: master)
        } catch {
            return error.localizedDescription
        }
    }
}
