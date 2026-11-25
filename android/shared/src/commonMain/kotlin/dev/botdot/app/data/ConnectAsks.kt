package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The main button of a card the server names by a verb (`act`, docs/api.md "A missing connected app", ADR 168):
 * `connect` opens the app's sign-in page through its card, `open` with `screen: "connectors"` the Connectors screen.
 * As the web page reads it (public/needs.js actLabel).
 */
data class AskAct(val verb: String, val label: String?, val screen: String?) {
    /** Whether this app knows what the button does. A card whose verb it does not know is not drawn. */
    val known: Boolean get() = verb == CONNECT || (verb == OPEN && screen == CONNECTORS) || verb in UPDATE_VERBS

    companion object {
        const val CONNECT = "connect"
        const val OPEN = "open"
        const val CONNECTORS = "connectors"

        /** A new version's buttons (#1690): `update-moving` is the verb of a card that only says it moves, with none. */
        const val UPDATE_NOW = "update-now"
        const val UPDATE_TONIGHT = "update-tonight"
        const val UPDATE_MOVING = "update-moving"
        val UPDATE_VERBS = listOf(UPDATE_NOW, UPDATE_TONIGHT, UPDATE_MOVING)

        /** `act` as the server sent it; null when there is none, or one without a verb. */
        fun of(v: JsonElement?): AskAct? {
            val o = v as? JsonObject ?: return null
            val verb = o["verb"].textOrNull()?.takeIf { it.isNotBlank() } ?: return null
            return AskAct(verb, o["label"].textOrNull()?.takeIf { it.isNotBlank() }, o["screen"].textOrNull())
        }
    }
}

/** The server feature that has `POST /api/asks/:id/connect`: without it, that route is a no on the card. */
const val CONNECT_CARDS = "connect-cards"

/**
 * The main button's word ("Connect", "Reconnect", "Open Connectors"): the server's, else this app's own by the verb.
 * Null for a card with no `act`, or a verb this app does not know.
 */
val Ask.actLabel: String? get() {
    if (kind == "update") return null // its buttons are its own (updateButtons), not one main button
    val act = act?.takeIf { it.known } ?: return null
    return act.label ?: if (act.verb == AskAct.CONNECT) (if (mode == "reconnect") tr("Reconnect") else tr("Connect")) else tr("Open Apps")
}

/**
 * The buttons of a new version's card (`update`, #1690, ADR 271), the main one first: Now, and Tonight where the server
 * offers it, each with the server's word. They go to the front door's own routes, never the account's botdot server. None
 * while it moves (its `act` is `update-moving`), and none for a verb this app does not know.
 */
val Ask.updateButtons: List<AskAct> get() =
    if (kind != "update" || act?.verb !in AskAct.UPDATE_VERBS) emptyList()
    else acts.filter { it.verb == AskAct.UPDATE_NOW || it.verb == AskAct.UPDATE_TONIGHT }.filter { !it.label.isNullOrBlank() }

/** Now asks first only when the card says the account is busy (`busy` is true); with `busy` absent or false it goes at once. */
val Ask.asksBeforeNow: Boolean get() = busy == true

/** Whether a card has an `act` this app cannot draw: it is left out, as the web page leaves it out. */
val Ask.unknownAct: Boolean get() = act?.known == false

/** What `POST` and `GET /api/asks/:id/connect` answer: the sign-in page, or how the connection stands. */
@Serializable
data class AskConnect(val redirectUrl: String? = null, val noAuth: Boolean = false, val settled: Boolean = false, val status: String? = null) {
    /** Where the card is after it: connected (the card goes with the next list), still waiting, or ended (its button again). */
    val outcome: Outcome get() = when {
        settled || noAuth || status == "ACTIVE" -> Outcome.Connected
        status == "FAILED" || status == "EXPIRED" -> Outcome.Ended
        else -> Outcome.Waiting
    }

    enum class Outcome { Connected, Waiting, Ended }
}

/** An app the run found signed out has a missing app's card of that bot (or the Chief) waiting: the card connects it, and the run draws no second one. */
fun hasConnectCard(asks: List<Ask>, botId: String?, app: String): Boolean = asks.any { it.kind == "connect-app" && it.app == app && it.bot?.id == botId }
