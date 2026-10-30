package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * What a proposed bot must reach (#808, ADR 128; docs/api.md "The Company"; web: public/company-team.js): the account's
 * computer and the Vault logins and SSH keys it uses. A need with no entry is a gap its card offers to fill from the
 * Vault; Create grants what the card shows.
 */
object TeamReaches {
    const val FEATURE = "team-reaches"
    const val LOGINS = "logins"
    const val SSH = "ssh"

    /** Its needs of [kind] ([LOGINS] or [SSH]). */
    fun of(p: Proposed, kind: String): List<Need> = if (kind == SSH) p.ssh else p.logins

    /** Its gaps: each need with no Vault entry, with its kind. */
    fun gaps(p: Proposed): List<Pair<String, Need>> = listOf(LOGINS, SSH).flatMap { k -> of(p, k).filter { it.id == null }.map { k to it } }

    /** The Vault's entries a gap of [kind] can be filled with. */
    fun pickable(vault: List<VaultItem>, kind: String): List<VaultItem> = vault.filter { if (kind == SSH) it.kind == "ssh-key" else it.kind == "login" }

    /** The card's change once [need] of [kind] is filled with the entry [id]. */
    fun picked(p: Proposed, kind: String, need: String, id: String): Map<String, JsonElement> =
        mapOf(kind to JsonArray(of(p, kind).map { n ->
            val to = if (n.need == need) id else n.id
            JsonObject(buildMap { put("need", JsonPrimitive(n.need)); if (to != null) put("id", JsonPrimitive(to)) })
        }))
}
