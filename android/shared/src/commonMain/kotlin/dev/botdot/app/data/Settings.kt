package dev.botdot.app.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** What the app remembers: which botdot to talk to, the groups you folded in the list (and the Vault's categories), and how wide you made the list. */
class Settings(private val store: DataStore<Preferences>) {
    private val SERVER = stringPreferencesKey("server")

    // The store sends everything again on any change (folding a group too): pass on only real changes.
    val server: Flow<String?> = store.data.map { usableServer(it[SERVER]) }.distinctUntilChanged()
    @Throws(Exception::class)
    suspend fun serverNow(): String? = server.first()
    @Throws(Exception::class)
    suspend fun setServer(url: String?) = store.edit { if (url == null) it.remove(SERVER) else it[SERVER] = url }

    // The notice that the bots run on Claude by Anthropic (AiNotice), seen and accepted on this device.
    private val AI_NOTICE = booleanPreferencesKey("ai_notice")
    val aiNoticeSeen: Flow<Boolean> = store.data.map { it[AI_NOTICE] == true }.distinctUntilChanged()
    @Throws(Exception::class)
    suspend fun aiNoticeSeenNow(): Boolean = aiNoticeSeen.first()
    @Throws(Exception::class)
    suspend fun setAiNoticeSeen() = store.edit { it[AI_NOTICE] = true }

    private val FOLDED = stringSetPreferencesKey("folded_groups") // "" is Other
    val foldedGroups: Flow<Set<String>> = store.data.map { it[FOLDED].orEmpty() }.distinctUntilChanged()
    @Throws(Exception::class)
    suspend fun toggleFolded(group: String) = store.edit { val now = it[FOLDED].orEmpty(); it[FOLDED] = if (group in now) now - group else now + group }

    // The Vault's categories folded (ADR 213), on the iPhone; Android keeps its own in its preferences "vault-folded".
    private val VAULT_FOLDED = stringSetPreferencesKey("vault_folded")
    val foldedVault: Flow<Set<String>> = store.data.map { it[VAULT_FOLDED].orEmpty() }.distinctUntilChanged()
    @Throws(Exception::class)
    suspend fun toggleVaultFolded(category: String) = store.edit { it[VAULT_FOLDED] = Vault.toggled(it[VAULT_FOLDED].orEmpty(), category) }

    private val LIST_WIDTH = intPreferencesKey("list_width") // dp, beside the chat on a wide screen; none: the standard one
    @Throws(Exception::class)
    suspend fun listWidthNow(): Int? = store.data.first()[LIST_WIDTH]
    @Throws(Exception::class)
    suspend fun setListWidth(dp: Int?) = store.edit { if (dp == null) it.remove(LIST_WIDTH) else it[LIST_WIDTH] = dp }

    // The space on screen (#840, Spaces): a project's id, or none for Home; "company" from before spaces (the
    // switch was on Projects) is read by Spaces.remembered.
    private val PLACE = stringPreferencesKey("place")
    @Throws(Exception::class)
    suspend fun spaceNow(): String? = store.data.first()[PLACE]
    @Throws(Exception::class)
    suspend fun setSpace(id: String) = store.edit { if (id == Spaces.HOME) it.remove(PLACE) else it[PLACE] = id }

    private val PROJECT = stringPreferencesKey("project") // the project shown (#703), of the botdot this device is on
    private val TREE = stringSetPreferencesKey("project_tree") // the tree's nodes turned from how they start: "<key>=1" folded, "=0" open
    @Throws(Exception::class)
    suspend fun projectNow(): String? = store.data.first()[PROJECT]
    @Throws(Exception::class)
    suspend fun setProject(id: String?) = store.edit { if (id == null) it.remove(PROJECT) else it[PROJECT] = id }
    @Throws(Exception::class)
    suspend fun treeNow(): Map<String, Boolean> = store.data.first()[TREE].orEmpty().mapNotNull { e -> e.substringBeforeLast('=').takeIf { it.isNotEmpty() }?.let { it to e.endsWith("=1") } }.toMap()
    @Throws(Exception::class)
    suspend fun setTree(folds: Map<String, Boolean>) = store.edit { it[TREE] = folds.map { (k, v) -> "$k=${if (v) 1 else 0}" }.toSet() }
}

/** A saved address the app may still use. One saved before HTTPS was required (plain http to another computer)
 *  counts as none, so the app asks for the address again instead of failing to start. */
internal fun usableServer(url: String?): String? = url?.takeIf { ReleaseManifest.secureURL(it) }
