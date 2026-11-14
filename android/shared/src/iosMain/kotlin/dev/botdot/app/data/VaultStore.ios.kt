package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * The iPhone's Vault (Settings → Passwords on Android): its entries, Bitwarden's state, the server's features and the
 * bots, read as Android's VaultScreen reads them, and the categories folded on this phone ([Settings.foldedVault]).
 * [watch] hands the screen a new [VaultState] on each change, on the main thread. [close] it when the screen goes.
 */
class VaultStore(val api: Api, private val settings: Settings) {
    private val scope = MainScope()
    private val parts = MutableStateFlow(VaultState(null, null, null, emptyList(), emptySet(), null))

    /** Calls [onChange] with the Vault's state now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (VaultState) -> Unit): Job = scope.launch {
        combine(parts, settings.foldedVault) { p, f -> VaultState(p.items, p.bitwarden, p.features, p.bots, f, p.error) }.collect { onChange(it) }
    }

    /** Reads it all again; what went wrong reading the entries is the state's [VaultState.error]. */
    @Throws(Exception::class)
    suspend fun refresh() = coroutineScope {
        val version = async { tried { api.version().features }.getOrNull() }
        val bots = async { tried { api.bots() }.getOrNull() }
        val read = tried { coroutineScope { val i = async { api.vault() }; val b = async { api.bitwarden() }; i.await() to b.await() } }
        val now = parts.value
        parts.value = VaultState(
            read.getOrNull()?.first ?: now.items, read.getOrNull()?.second ?: now.bitwarden, version.await() ?: now.features,
            bots.await() ?: now.bots, now.folded, read.exceptionOrNull()?.let { it.message ?: tr("Couldn't load") },
        )
    }

    /** A tap on a category's heading: folds it, or opens it again, on this phone. */
    @Throws(Exception::class)
    suspend fun toggle(category: String) = settings.toggleVaultFolded(category)

    /** Saves the login editor's [form] as [item] (null: a new login), then reads the list again. A refusal throws its sentence. */
    @Throws(Exception::class)
    suspend fun save(item: VaultItem?, form: VaultLogin) {
        form.save(api, item, parts.value.features ?: api.version().features)
        refresh()
    }

    /** Deletes [item] (with Bitwarden: to its trash), then reads the list again. A refusal throws its sentence. */
    @Throws(Exception::class)
    suspend fun delete(item: VaultItem) {
        api.deleteVaultItem(item.id)
        refresh()
    }

    /** Unlocks Bitwarden with its master password, then reads the list again. Null when it opened, else what to say. */
    @Throws(Exception::class)
    suspend fun unlock(master: String): String? {
        val error = tried { api.unlockBitwarden(master) }.exceptionOrNull()?.let(Vault::unlockError)
        refresh()
        return error
    }

    fun close() = scope.cancel()

    /** [block]'s answer or its failure; a cancellation (the screen went) is not a failure, and goes on up. */
    private inline fun <T> tried(block: () -> T): Result<T> = runCatching(block).onFailure { if (it is CancellationException) throw it }
}
