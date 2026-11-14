package dev.botdot.app.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** What the app remembers: which botdot to talk to, the groups you folded in the list, and how wide you made the list. */
class Settings(private val store: DataStore<Preferences>) {
    private val SERVER = stringPreferencesKey("server")

    // The store sends everything again on any change (folding a group too): pass on only real changes.
    val server: Flow<String?> = store.data.map { usableServer(it[SERVER]) }.distinctUntilChanged()
    suspend fun serverNow(): String? = server.first()
    suspend fun setServer(url: String?) = store.edit { if (url == null) it.remove(SERVER) else it[SERVER] = url }

    private val FOLDED = stringSetPreferencesKey("folded_groups") // "" is Other
    val foldedGroups: Flow<Set<String>> = store.data.map { it[FOLDED].orEmpty() }.distinctUntilChanged()
    suspend fun toggleFolded(group: String) = store.edit { val now = it[FOLDED].orEmpty(); it[FOLDED] = if (group in now) now - group else now + group }

    private val LIST_WIDTH = intPreferencesKey("list_width") // dp, beside the chat on a wide screen; none: the standard one
    suspend fun listWidthNow(): Int? = store.data.first()[LIST_WIDTH]
    suspend fun setListWidth(dp: Int?) = store.edit { if (dp == null) it.remove(LIST_WIDTH) else it[LIST_WIDTH] = dp }

    // The space on screen (#840, Spaces): a project's id, or none for Home; "company" from before spaces (the
    // switch was on Projects) is read by Spaces.remembered.
    private val PLACE = stringPreferencesKey("place")
    suspend fun spaceNow(): String? = store.data.first()[PLACE]
    suspend fun setSpace(id: String) = store.edit { if (id == Spaces.HOME) it.remove(PLACE) else it[PLACE] = id }

    private val PROJECT = stringPreferencesKey("project") // the project shown (#703), of the botdot this device is on
    private val TREE = stringSetPreferencesKey("project_tree") // the tree's nodes turned from how they start: "<key>=1" folded, "=0" open
    suspend fun projectNow(): String? = store.data.first()[PROJECT]
    suspend fun setProject(id: String?) = store.edit { if (id == null) it.remove(PROJECT) else it[PROJECT] = id }
    suspend fun treeNow(): Map<String, Boolean> = store.data.first()[TREE].orEmpty().mapNotNull { e -> e.substringBeforeLast('=').takeIf { it.isNotEmpty() }?.let { it to e.endsWith("=1") } }.toMap()
    suspend fun setTree(folds: Map<String, Boolean>) = store.edit { it[TREE] = folds.map { (k, v) -> "$k=${if (v) 1 else 0}" }.toSet() }
}

/** A saved address the app may still use. One saved before HTTPS was required (plain http to another computer)
 *  counts as none, so the app asks for the address again instead of failing to start. */
internal fun usableServer(url: String?): String? = url?.takeIf { ReleaseManifest.secureURL(it) }
