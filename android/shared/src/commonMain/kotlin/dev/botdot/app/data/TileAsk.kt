package dev.botdot.app.data

/**
 * Asking the Chief to change one Board tile (#430, docs/api.md "The Board"): a long press on a tile opens a sheet with
 * its title, a field for what should change, Send and a trash that removes it. Sent, it starts a Chief chat that names
 * the tile. A botdot from before it has no `tile-change`: a long press only offers to remove the tile, as before.
 */
object TileAsk {
    const val FEATURE = "tile-change"
    val PLACEHOLDER: String get() = tr("What should change?")

    fun shows(features: Collection<String>?): Boolean = FEATURE in features.orEmpty()

    /** What the tile says for a moment after the ask went. */
    fun sent(chiefName: String?): String = tr("Sent to {name}", "name" to ChiefName.named(chiefName))
}
