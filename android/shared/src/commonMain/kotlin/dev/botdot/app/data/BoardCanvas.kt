package dev.botdot.app.data

/**
 * A project's board as a free canvas (#784; web: public/board-canvas.js, ADR 124, docs/api.md "The board's layout"):
 * where its tiles stand, `[x, y, w, h]` on a canvas [W] wide, y down. No two tiles overlap: one the moved or resized
 * tile would cover slides down below it, [GAP] apart, and so on. A tile with no place takes the first free spot,
 * highest then leftmost, in its kind's first size. The same rules and numbers as the web page's, checked against the
 * same cases.
 */
object BoardCanvas {
    const val FEATURE = "project-layout"
    const val W = 1200
    const val GAP = 16
    /** The smallest scale the canvas is drawn at (ADR 147, amended by ADR 273): below it the board is read as one column. */
    const val MIN_SCALE = 0.8

    /** Whether a board [width] dp wide is read as one column: the canvas scaled to it would be under [MIN_SCALE]. An unknown width (0) keeps the canvas. */
    fun column(width: Double): Boolean = width > 0 && width < MIN_SCALE * W
    private const val MAX_H = 4000

    /** A kind's smallest, its first size and, for a button (New team, New card), its tallest: as tall as a button. */
    class Kind(val minW: Int, val minH: Int, val w: Int, val h: Int, val maxH: Int = MAX_H)
    val KINDS = mapOf(
        "days" to Kind(480, 96, 1200, 140),
        "goal" to Kind(320, 160, 592, 260),
        "room" to Kind(240, 200, 592, 320),
        "chief" to Kind(140, 160, 188, 200),
        "bot" to Kind(140, 160, 188, 200),
        "suggest" to Kind(280, 140, 392, 180),
        "new-team" to Kind(140, 56, 392, 64, maxH = 64),
        "calendar" to Kind(420, 260, 792, 340),
        "todo" to Kind(280, 280, 392, 560),
        "files" to Kind(280, 120, 392, 260),
        "needs" to Kind(280, 96, 1200, 160),
        "work" to Kind(280, 120, 592, 300),
        "blockers" to Kind(280, 120, 592, 300),
        "replies" to Kind(280, 120, 1200, 300),
        "card" to Kind(240, 140, 392, 220),
        "new-card" to Kind(200, 56, 392, 64, maxH = 64),
    )
    private val ID = Regex("^([a-z-]+)(?::([A-Za-z0-9_-]{1,64}))?$")
    private val NAMED = setOf("goal", "room", "bot", "card")

    /** A tile's place: x, y, width, height. */
    data class R(val x: Int, val y: Int, val w: Int, val h: Int) {
        val bottom get() = y + h
        val right get() = x + w
    }

    /** The kind of tile [id], or null for an id that is none. */
    fun kindOf(id: String): String? {
        val m = ID.matchEntire(id) ?: return null
        val k = m.groupValues[1]
        if (k !in KINDS) return null
        return k.takeIf { (k in NAMED) == m.groupValues[2].isNotEmpty() }
    }

    private fun round(v: Double) = jround(v).toInt()

    /** On the canvas, whole units, no smaller and no taller than its kind allows. */
    fun fit(id: String, x: Double, y: Double, w: Double, h: Double): R {
        val k = KINDS.getValue(kindOf(id)!!)
        val fw = round(w).coerceIn(k.minW, W)
        val fh = round(h).coerceIn(k.minH, k.maxH)
        return R(round(x).coerceIn(0, W - fw), round(y).coerceAtLeast(0), fw, fh)
    }

    /** Closer than [GAP] on both axes. */
    fun hits(a: R, b: R) = a.x < b.right + GAP && b.x < a.right + GAP && a.y < b.bottom + GAP && b.y < a.bottom + GAP

    /** No overlap: [first] stays; every other, from the top, slides below what it would cover. */
    fun settle(layout: Map<String, R>, first: String? = null): Map<String, R> {
        val out = LinkedHashMap<String, R>()
        val placed = mutableListOf<R>()
        if (first != null) layout[first]?.let { out[first] = it; placed += it }
        val rest = layout.keys.filter { it != first }.sortedWith(compareBy({ layout.getValue(it).y }, { layout.getValue(it).x }))
        for (id in rest) {
            var r = layout.getValue(id)
            while (true) {
                val under = placed.filter { hits(r, it) }
                if (under.isEmpty()) break
                r = r.copy(y = under.maxOf { it.bottom + GAP })
            }
            out[id] = r
            placed += r
        }
        return out
    }

    /** The first free spot for a tile [w] by [h]. */
    fun spot(layout: Map<String, R>, w: Int, h: Int): Pair<Int, Int> {
        val rs = layout.values
        val ys = (listOf(0) + rs.map { it.bottom + GAP }).sorted()
        val xs = (listOf(0) + rs.map { it.right + GAP }).filter { it + w <= W }.sorted()
        for (y in ys) for (x in xs) if (rs.none { hits(R(x, y, w, h), it) }) return x to y
        return 0 to ys.last()
    }

    /** The tiles shown, [ids]: where [layout] has them, the others at the first free spot. */
    fun complete(layout: Map<String, R>?, ids: List<String>): Map<String, R> {
        val known = ids.filter { kindOf(it) != null }
        val set = LinkedHashMap(settle(known.mapNotNull { id -> layout?.get(id)?.let { id to fit(id, it.x.toDouble(), it.y.toDouble(), it.w.toDouble(), it.h.toDouble()) } }.toMap()))
        for (id in known) {
            if (id in set) continue
            val k = KINDS.getValue(kindOf(id)!!)
            val f = fit(id, 0.0, 0.0, k.w.toDouble(), k.h.toDouble())
            val (x, y) = spot(set, f.w, f.h)
            set[id] = R(x, y, f.w, f.h)
        }
        return set
    }

    /** Tile [id] moved by ([dx], [dy]), or resized from [edge] (any of n, e, s, w; "se" the corner), the rest settled. */
    fun drag(layout: Map<String, R>, id: String, edge: String?, dx: Double, dy: Double): Map<String, R> {
        val o = layout.getValue(id)
        var x = o.x.toDouble(); var y = o.y.toDouble(); var w = o.w.toDouble(); var h = o.h.toDouble()
        if (edge == null) { x += dx; y += dy } else {
            if ('e' in edge) w = o.w + dx
            if ('s' in edge) h = o.h + dy
            if ('w' in edge) { w = o.w - dx; x = (o.right - fit(id, x, y, w, h).w).toDouble() }
            if ('n' in edge) { h = o.h - dy; y = (o.bottom - fit(id, x, y, w, h).h).toDouble() }
        }
        return settle(layout + (id to fit(id, x, y, w, h)), id)
    }

    /**
     * The layout drawn while tile [id] needs at least [w] by [h] (New card opened into its ask field): the tile that
     * big, kept on the canvas, what it would cover slid down below it. Only drawn, never saved: [fit] takes it back.
     */
    fun grown(layout: Map<String, R>, id: String, w: Int, h: Int): Map<String, R> {
        val r = layout[id] ?: return layout
        if (r.w >= w && r.h >= h) return layout
        val gw = maxOf(r.w, w).coerceAtMost(W)
        return settle(layout + (id to R(minOf(r.x, W - gw), r.y, gw, maxOf(r.h, h))), id)
    }

    /** The tiles in the order a column reads them: from the top, left to right where two start level. */
    fun order(layout: Map<String, R>): List<String> = layout.keys.sortedWith(compareBy({ layout.getValue(it).y }, { layout.getValue(it).x }))

    /** How high the canvas is: the bottom of the lowest tile. */
    fun height(layout: Map<String, R>) = layout.values.maxOfOrNull { it.bottom } ?: 0

    /** A layout as botdot sends it, `{ tile: [x, y, w, h] }`; tiles that are none or numbers that are not four left out. */
    fun of(raw: Map<String, List<Double>>?): Map<String, R>? = raw?.mapNotNull { (id, v) ->
        if (kindOf(id) == null || v.size != 4) null else id to fit(id, v[0], v[1], v[2], v[3])
    }?.toMap()

    /** The layout as botdot takes it. */
    fun raw(layout: Map<String, R>): Map<String, List<Int>> = layout.mapValues { (_, r) -> listOf(r.x, r.y, r.w, r.h) }

    /**
     * The board's tiles there are now, in the order they take free spots (CompanyHome's): Needs you when something
     * waits, Current work and Blockers, the days line or an ongoing project's review, its goals, its cards (and New
     * card), the suggested team and New team, the calendar, the to-dos, Files, and Latest replies.
     */
    fun tiles(f: Collection<String>, c: Company, needsYou: Boolean, overviewBoard: Boolean, cards: List<ProjectCards.Slot>?, files: Boolean): List<String> = buildList {
        fun on(k: String) = ProjectBoard.shows(c, k)
        if (needsYou) add("needs")
        if (overviewBoard) listOf("work", "blockers").filter(::on).forEach(::add)
        if ((on("days") && c.day != null) || (!on("days") && c.ongoing && c.checkin != null)) add("days")
        if (CompanyFloor.DISPLAY in f && on("goals")) c.objectives.forEach { add("goal:${it.id}") }
        cards?.forEach { add(ProjectCards.tileOf(it)) }
        if (on("teams")) { if (c.suggestion != null) add("suggest"); add("new-team") }
        if (ProjectCalendar.FEATURE in f && on("calendar")) add("calendar")
        if (on("todo")) add("todo")
        if (files) add("files")
        if (overviewBoard && on("replies")) add("replies")
    }

    /** A board the owner arranged (#784, with [FEATURE]): each of its [tiles] where it stands; null while never arranged. */
    fun arranged(f: Collection<String>, layout: Map<String, List<Double>>?, tiles: List<String>): Map<String, R>? {
        if (FEATURE !in f) return null
        val saved = of(layout) ?: return null
        return complete(saved, tiles)
    }

    /** A board the owner arranged: its [tiles] in the order a phone's column reads them (ADR 147); null while never arranged. */
    fun readOrder(f: Collection<String>, layout: Map<String, List<Double>>?, tiles: List<String>): List<String>? = arranged(f, layout, tiles)?.let(::order)

    /** How far two fingers zoom the canvas in: 1 (all of it) to [MAX_ZOOM] times. */
    const val MAX_ZOOM = 4.0

    /** A zoom as two fingers leave it: kept between 1 and [MAX_ZOOM]. */
    fun zoomIn(z: Double): Double = z.coerceIn(1.0, MAX_ZOOM)

    /**
     * Where the zoomed canvas stands ([x], [y], 0 or less): its top left held inside a view [w] by [h], so no space
     * shows beyond its edges at zoom [z].
     */
    fun panIn(z: Double, w: Double, h: Double, x: Double, y: Double): Pair<Double, Double> =
        (x.coerceIn(-(z - 1) * w, 0.0) + 0.0) to (y.coerceIn(-(z - 1) * h, 0.0) + 0.0) // + 0.0: no -0.0

    /** How near an edge, in canvas units, a held finger resizes the tile rather than moving it. */
    const val NEAR = 28

    /**
     * The tile a finger held at ([x], [y]) on the canvas takes, and from where: null to move it, else the edges it
     * resizes from ("s", "e", "w", "se", "sw"). Null for no tile there.
     */
    fun held(layout: Map<String, R>, x: Double, y: Double): Pair<String, String?>? {
        val (id, r) = layout.entries.lastOrNull { (_, r) -> x >= r.x && x <= r.right && y >= r.y && y <= r.bottom } ?: return null
        val edge = buildString {
            if (y > r.bottom - NEAR) append('s')
            if (x > r.right - NEAR) append('e') else if (x < r.x + NEAR) append('w')
        }.ifEmpty { null }
        return id to edge
    }
}
