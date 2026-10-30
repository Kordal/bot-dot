package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement

/**
 * The starter board (#810, ADR 129; docs/api.md "The Company"; web: public/company-team.js): the objectives and the
 * cards the Chief proposes with the team, each ticked until the owner unticks it. Create makes the ticked ones.
 */
@Serializable
data class Starter(val goals: List<StarterGoal> = emptyList(), val cards: List<StarterCard> = emptyList())

@Serializable
data class StarterGoal(val key: String, val name: String = "", val target: Double = 0.0, val on: Boolean = true)

@Serializable
data class StarterCard(val key: String, val ask: String = "", val apps: List<String> = emptyList(), val on: Boolean = true)

object ProjectStarter {
    const val FEATURE = "project-starter"

    /** How a goal reads in the list: its name, and its number when it has one. */
    fun label(g: StarterGoal): String = if (g.target > 0) "${g.name} · ${if (g.target % 1.0 == 0.0) g.target.toLong().toString() else g.target.toString()}" else g.name

    /** The starter board with the item [key] ticked or not. */
    fun ticked(s: Starter, key: String, on: Boolean): Starter = s.copy(
        goals = s.goals.map { if (it.key == key) it.copy(on = on) else it },
        cards = s.cards.map { if (it.key == key) it.copy(on = on) else it },
    )

    /** The PATCH that keeps [s]. */
    fun patch(s: Starter): JsonObject = JsonObject(mapOf("starter" to Api.JSON.encodeToJsonElement(s)))
}
