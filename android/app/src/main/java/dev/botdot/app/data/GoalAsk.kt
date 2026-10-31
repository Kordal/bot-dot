package dev.botdot.app.data

/**
 * Asking the Chief to change one of a project's goals (#820; web: public/company-home.js, #819; docs/api.md "Changing
 * a goal by chat"): "Change" in a goal card's menu opens a sheet with its name and a field; Send starts a Chief chat
 * that names the goal and opens it over the Projects screen. A botdot without `objective-change` shows no "Change".
 */
object GoalAsk {
    const val FEATURE = "objective-change"

    fun shows(features: Collection<String>?): Boolean = FEATURE in features.orEmpty()
}
