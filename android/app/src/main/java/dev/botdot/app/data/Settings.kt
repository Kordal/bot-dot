package dev.botdot.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.store by preferencesDataStore("botdot")

/** What the app remembers: which botdot to talk to, the groups you folded in the list, and how wide you made the list. */
class Settings(private val context: Context) {
    private val SERVER = stringPreferencesKey("server")

    // The store sends everything again on any change (folding a group too): pass on only real changes.
    val server: Flow<String?> = context.store.data.map { usableServer(it[SERVER]) }.distinctUntilChanged()
    suspend fun serverNow(): String? = server.first()
    suspend fun setServer(url: String?) = context.store.edit { if (url == null) it.remove(SERVER) else it[SERVER] = url }

    private val FOLDED = stringSetPreferencesKey("folded_groups") // "" is Other
    val foldedGroups: Flow<Set<String>> = context.store.data.map { it[FOLDED].orEmpty() }.distinctUntilChanged()
    suspend fun toggleFolded(group: String) = context.store.edit { val now = it[FOLDED].orEmpty(); it[FOLDED] = if (group in now) now - group else now + group }

    private val LIST_WIDTH = intPreferencesKey("list_width") // dp, beside the chat on a wide screen; none: the standard one
    suspend fun listWidthNow(): Int? = context.store.data.first()[LIST_WIDTH]
    suspend fun setListWidth(dp: Int?) = context.store.edit { if (dp == null) it.remove(LIST_WIDTH) else it[LIST_WIDTH] = dp }

    private val PLACE = stringPreferencesKey("place") // "Bots | Company" (#674): "company", or none for the bots
    suspend fun companyNow(): Boolean = context.store.data.first()[PLACE] == "company"
    suspend fun setCompany(on: Boolean) = context.store.edit { if (on) it[PLACE] = "company" else it.remove(PLACE) }

    private val PROJECT = stringPreferencesKey("project") // the project shown (#703), of the botdot this device is on
    private val TREE = stringSetPreferencesKey("project_tree") // the tree's nodes turned from how they start: "<key>=1" folded, "=0" open
    suspend fun projectNow(): String? = context.store.data.first()[PROJECT]
    suspend fun setProject(id: String?) = context.store.edit { if (id == null) it.remove(PROJECT) else it[PROJECT] = id }
    suspend fun treeNow(): Map<String, Boolean> = context.store.data.first()[TREE].orEmpty().mapNotNull { e -> e.substringBeforeLast('=').takeIf { it.isNotEmpty() }?.let { it to e.endsWith("=1") } }.toMap()
    suspend fun setTree(folds: Map<String, Boolean>) = context.store.edit { it[TREE] = folds.map { (k, v) -> "$k=${if (v) 1 else 0}" }.toSet() }
}

/** A saved address the app may still use. One saved before HTTPS was required (plain http to another computer)
 *  counts as none, so the app asks for the address again instead of failing to start. */
internal fun usableServer(url: String?): String? = url?.takeIf { ReleaseManifest.secureURL(it) }
