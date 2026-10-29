package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A card made by Claude on a project's board (#776; docs/api.md "Cards made by Claude", ADR 123; web:
 * public/project-cards.js). [state] is asking (its [questions] wait for [answers]; none yet while the Chief is asked),
 * building ([step] what the run does now, [steps] how many it did), ready or failed ([error] why; a failed refresh keeps
 * [body]). [changing] while a built card waits for the answers of a Change. All of it is plain text, drawn as text.
 */
@Serializable
data class ProjectCard(
    val id: String = "",
    val ask: String = "",
    val title: String = "",
    val state: String = "asking",
    val at: String? = null,
    val answers: List<CardAnswer> = emptyList(),
    val apps: List<String> = emptyList(),
    val questions: List<CardQuestion>? = null,
    val body: CardBody? = null,
    val step: CardStep? = null,
    val steps: Int = 0,
    val error: String? = null,
    val changing: Boolean = false,
) {
    val name: String get() = title.ifBlank { ask }
    val asking: Boolean get() = state == "asking"
    val building: Boolean get() = state == "building"
    val failed: Boolean get() = state == "failed"
    /** The question that waits for its answer: null while the Chief is asked or once all are answered. */
    val next: CardQuestion? get() = questions?.getOrNull(answers.size)
}

@Serializable
data class CardQuestion(val q: String = "", val choices: List<String> = emptyList())

@Serializable
data class CardAnswer(val q: String = "", val a: String = "")

@Serializable
data class CardStep(val kind: String = "", val what: String? = null)

/** What a card shows: [show] number, spark, bars, list or table; [value] its big number as text, [sub] beside it. */
@Serializable
data class CardBody(
    val show: String = "number",
    val value: String = "",
    val sub: String? = null,
    val tone: String? = null,
    val points: List<Double> = emptyList(),
    val bars: List<CardBar> = emptyList(),
    val list: List<CardItem> = emptyList(),
    val rows: List<CardRow> = emptyList(),
)

@Serializable
data class CardBar(val label: String = "", val value: Double = 0.0)

@Serializable
data class CardItem(val text: String = "", val ref: String? = null, val tag: String? = null, val level: String? = null, val url: String? = null)

@Serializable
data class CardRow(val label: String = "", val value: String = "", val change: String? = null, val tone: String? = null)

object ProjectCards {
    const val FEATURE = "project-cards"
    /** A project has at most this many cards. */
    const val MAX = 12

    fun shows(features: Collection<String>?, c: Company): Boolean = features != null && FEATURE in features && c.running

    /** One place in the cards row: a card, its questions, the ask field (a new card's, or a card's Change), or New card. */
    sealed interface Slot {
        val wide: Boolean
        data class Card(val card: ProjectCard) : Slot { override val wide get() = card.body?.show == "table" || card.body?.show == "list" }
        data class Questions(val card: ProjectCard) : Slot { override val wide get() = true }
        /** The ask field: [card] null for a new card, else the card being changed. */
        data class Ask(val card: ProjectCard?) : Slot { override val wide get() = true }
        data object New : Slot { override val wide get() = false }
    }

    /** The row's slots in order: [open] is "new", a card's id (its Change) or null. New card goes once there are 12. */
    fun slots(cards: List<ProjectCard>, open: String?): List<Slot> {
        val shown = cards.take(MAX).map { k ->
            when {
                open == k.id -> Slot.Ask(k)
                k.asking -> Slot.Questions(k)
                else -> Slot.Card(k)
            }
        }
        val tail = when {
            open == NEW -> Slot.Ask(null)
            cards.size >= MAX -> null
            else -> Slot.New
        }
        return shown + listOfNotNull(tail)
    }

    const val NEW = "new"

    /** The slots two to a line, as a phone has them: a wide one takes a line of its own, a half one left alone keeps its half. */
    fun lines(slots: List<Slot>): List<List<Slot>> {
        val out = mutableListOf<List<Slot>>()
        var half: Slot? = null
        for (s in slots) {
            if (s.wide) {
                half?.let { out += listOf(it); half = null }
                out += listOf(s)
            } else if (half == null) half = s
            else { out += listOf(half!!, s); half = null }
        }
        half?.let { out += listOf(it) }
        return out
    }

    /** The building card's live line. */
    fun stepText(s: CardStep?): String = when {
        s == null -> tr("Starting")
        s.kind == "search" -> s.what?.takeIf { it.isNotBlank() }?.let { tr("Searching {what}", "what" to it) } ?: tr("Searching the web")
        else -> s.what?.takeIf { it.isNotBlank() }?.let { tr("Reading {what}", "what" to it) } ?: tr("Reading")
    }

    /** How far the building card's bar is, 0 to 1: a step at a time, never full before it is built. */
    fun progress(steps: Int): Float = minOf(92, 12 + steps * 14) / 100f

    /** The questions' dashes: one per question once there are two or more, done, now or to come. */
    fun dashes(k: ProjectCard): List<String> {
        val qs = k.questions.orEmpty()
        if (qs.size < 2) return emptyList()
        return qs.indices.map { i -> if (i < k.answers.size) "done" else if (i == k.answers.size) "now" else "next" }
    }

    /** A bar's height in its card, 0 to 1 of the highest; a sliver at least, so a zero still shows. */
    fun barHeights(bars: List<CardBar>): List<Float> {
        val hi = maxOf(bars.maxOfOrNull { it.value } ?: 0.0, 1.0)
        return bars.map { maxOf(0.04f, (it.value / hi).toFloat().coerceIn(0f, 1f)) }
    }

    /** A card built a moment ago: it was building and is ready now (a green outline for a few seconds). */
    fun justBuilt(before: List<ProjectCard>, now: List<ProjectCard>): Set<String> {
        val was = before.filter { it.building }.map { it.id }.toSet()
        return now.filter { it.id in was && it.state == "ready" }.map { it.id }.toSet()
    }

    fun askBody(ask: String): JsonObject = buildJsonObject { put("ask", ask.trim()) }
    fun answerBody(text: String): JsonObject = buildJsonObject { put("text", text.trim()) }
}
