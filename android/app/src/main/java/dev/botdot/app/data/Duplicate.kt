package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * "Duplicate" (#227): a second bot with the same settings, such as Coder 2. The server says what the copy gets
 * ([CopyPlan]), the owner can change the name, and the copy is an ordinary bot of its own. Only from a server whose
 * `features` name `duplicate-bot`.
 */
object Duplicate {
    const val FEATURE = "duplicate-bot"

    /** Whether the botdot this app talks to can duplicate a bot. While its features are not known yet: no. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** What the confirmation says, the server's lines as they are. */
    fun text(plan: CopyPlan): String = buildString {
        append(tr("The copy gets:") + "\n")
        plan.copies.forEach { append("• ").append(it).append('\n') }
        append("\n" + tr("Not copied:") + " ").append(plan.notCopied).append('.')
        if (plan.vaultLocked) append("\n\n" + tr("Bitwarden is locked: unlock it first, so the copy can use the same Vault entries."))
    }
}

/** What a copy of a bot would get (`GET /api/bots/:id/duplicate`). */
@Serializable
data class CopyPlan(
    val name: String = "",
    val copies: List<String> = emptyList(),
    val notCopied: String = "",
    val logins: List<String> = emptyList(),
    val vaultLocked: Boolean = false,
)
