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
    val known: Boolean get() = verb == CONNECT || (verb == OPEN && screen == CONNECTORS)

    companion object {
        const val CONNECT = "connect"
        const val OPEN = "open"
        const val CONNECTORS = "connectors"

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
    val act = act?.takeIf { it.known } ?: return null
    return act.label ?: if (act.verb == AskAct.CONNECT) (if (mode == "reconnect") tr("Reconnect") else tr("Connect")) else tr("Open Apps")
}

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
