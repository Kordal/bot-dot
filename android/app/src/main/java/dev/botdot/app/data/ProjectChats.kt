package dev.botdot.app.data

/**
 * A chat opened from the Projects screen (#705; web: public/dock.js, #691 and #697): a bot's, a team's or the Chief's
 * (#820, its chat id, or "latest"), which slides
 * up from the bottom as a sheet over the floor, half or full height, as the web page does at phone width. One at a time.
 */
object ProjectChats {
    /** What the sheet shows: [kind] [BOT] (a bot's id), [TEAM] (the id of the team chat's group) or [CHIEF] (a chat id). */
    data class Open(val kind: String, val id: String) {
        /** How it is kept across a turn of the phone: "bot:coder", "team:g7". */
        val key: String get() = "$kind:$id"
    }

    const val BOT = "bot"
    const val TEAM = "team"
    const val CHIEF = "chief"

    /** [Open.key] read back; null for anything else. */
    fun of(key: String?): Open? {
        val i = key?.indexOf(':') ?: return null
        if (i < 0) return null
        val kind = key.substring(0, i)
        val id = key.substring(i + 1)
        return Open(kind, id).takeIf { (kind == BOT || kind == TEAM || kind == CHIEF) && id.isNotEmpty() }
    }

    /** Where the sheet goes. */
    enum class Height { HALF, FULL, CLOSED }

    /** How far a drag of the handle must go before it moves the sheet, in dp. */
    const val DRAG_DP = 48f

    /**
     * Where the sheet goes after its handle was dragged [dy] dp (up is negative) from [at]: up makes a half sheet full,
     * down makes a full one half and closes a half one; a drag shorter than [DRAG_DP] leaves it where it is. A tap on
     * the handle ([dy] 0) switches between half and full.
     */
    fun settle(at: Height, dy: Float, tap: Boolean = false): Height = when {
        tap -> if (at == Height.FULL) Height.HALF else Height.FULL
        dy <= -DRAG_DP -> Height.FULL
        dy >= DRAG_DP -> if (at == Height.FULL) Height.HALF else Height.CLOSED
        else -> at
    }
}
