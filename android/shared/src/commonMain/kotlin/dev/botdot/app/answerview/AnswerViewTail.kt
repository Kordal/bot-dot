package dev.botdot.app.answerview

import dev.botdot.app.data.tr
import kotlinx.serialization.json.JsonObject
import kotlin.math.floor

// The long tail of the answer views (#1629, wave 3), for both phones: what the web page reads in public/answer-text.js
// (outline, month, agenda, shade, moment, countdown). The rules are the web page's and their cases are `calendars`,
// `outlines`, `shades` and `countdowns` in test/fixtures/ui-cases.json, which AnswerViewTest runs here. It only reads the tree
// and counts: a view of this kind runs, approves and changes nothing, and a countdown counts on the device only.

/** A calendar's month: its [days], and the weekday of its first day ([start], Monday 0). */
data class ViewMonth(val year: Int, val month: Int, val days: Int, val start: Int)

/** The time left to a countdown's moment: [ms] (0 once it has [over]) and the words it shows, or '' when over. */
data class ViewCountdown(val ms: Long, val over: Boolean, val shows: String)

object ViewTail {
    private val MONTH = Regex("^(\\d{4})-(\\d{2})$")
    private val DAY = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")
    private val WHEN = Regex("^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2}))?)?\\s*(Z|[+-]\\d{2}(?::?\\d{2})?)?$", RegexOption.IGNORE_CASE)
    private val ZONE = Regex("^([+-])(\\d{2}):?(\\d{2})?$")

    private fun leap(y: Int) = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
    private fun daysIn(y: Int, m: Int) = when (m) { 2 -> if (leap(y)) 29 else 28; 4, 6, 9, 11 -> 30; else -> 31 }

    /** Days since 1970-01-01 of a day of the proleptic Gregorian calendar. */
    private fun epochDay(y: Int, m: Int, d: Int): Long {
        val yy = (if (m <= 2) y - 1 else y).toLong()
        val era = (if (yy >= 0) yy else yy - 399) / 400
        val yoe = yy - era * 400
        val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    /** The depths a tree is drawn at: a depth the bot wrote, but never more than one deeper than the item before it (the first is 0). */
    fun outline(depths: List<Int>): List<Int> {
        var prev = -1
        return depths.map { d -> val at = minOf(maxOf(d, 0), prev + 1); prev = at; at }
    }

    /** A tree's depths as its items carry them (an item with no depth is 0). */
    fun outlineOf(items: List<JsonObject>): List<Int> = outline(items.map { it.number("depth")?.let { d -> floor(d + 0.5).toInt() } ?: 0 })

    /** A calendar's month, "2026-11": its days and the weekday of its first (Monday is 0); null for a text that is no month. */
    fun month(text: String?): ViewMonth? {
        val m = MONTH.matchEntire(text.orEmpty().jsTrim()) ?: return null
        val year = m.groupValues[1].toInt()
        val mo = m.groupValues[2].toInt()
        if (mo < 1 || mo > 12 || year < 1) return null
        return ViewMonth(year, mo, daysIn(year, mo), (((epochDay(year, mo, 1) + 3) % 7 + 7) % 7).toInt())
    }

    /** Whether a text is a real day, "2026-11-03". */
    fun realDay(text: String?): Boolean {
        val m = DAY.matchEntire(text.orEmpty()) ?: return false
        val (y, mo, d) = m.groupValues.drop(1).map { it.toInt() }
        return mo in 1..12 && d >= 1 && d <= daysIn(y, mo)
    }

    /** A calendar's events in the order of their dates (equal dates keep the bot's order); one whose date is no real day comes last. */
    fun agenda(events: List<JsonObject>): List<JsonObject> {
        val (ok, rest) = events.partition { realDay(it.text("date")) }
        return ok.sortedBy { it.text("date") } + rest
    }

    /** How dark each cell of a heatmap is, from 0 (the smallest number) to 1 (the biggest); every cell the same is half; null for an empty one. */
    fun shade(values: List<List<Double?>>): List<List<Double?>> {
        val all = values.flatten().filterNotNull()
        val lo = all.minOrNull() ?: 0.0
        val hi = all.maxOrNull() ?: 0.0
        return values.map { row -> row.map { v -> if (v == null) null else if (hi == lo) 0.5 else floor((v - lo) / (hi - lo) * 1000 + 0.5) / 1000 } }
    }

    /**
     * A countdown's moment: a day ("2026-12-31", its midnight) or a day and time ("2026-12-31T18:00", seconds too), with a Z or
     * an offset ("+02:00") to name its zone, else the owner's own: [offset] minutes east of UTC, or, when that is not given,
     * [offsetAt] (the device's zone: its offset at a moment given in milliseconds since 1970). → milliseconds since 1970, or null
     * when it is not a real day and time.
     */
    fun moment(to: String?, offset: Int? = null, offsetAt: ((Long) -> Int)? = null): Long? {
        val m = WHEN.matchEntire(to.orEmpty().jsTrim()) ?: return null
        val v = m.groupValues
        if (v[7].isNotEmpty() && v[4].isEmpty()) return null
        val y = v[1].toInt(); val mo = v[2].toInt(); val d = v[3].toInt()
        val h = v[4].ifEmpty { "0" }.toInt(); val mi = v[5].ifEmpty { "0" }.toInt(); val sec = v[6].ifEmpty { "0" }.toInt()
        if (mo !in 1..12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || sec > 59) return null
        val local = epochDay(y, mo, d) * 86_400_000L + h * 3_600_000L + mi * 60_000L + sec * 1000L // as if it were UTC
        if (v[7].isNotEmpty()) {
            val zone = if (v[7].equals("z", ignoreCase = true)) 0 else {
                val z = ZONE.matchEntire(v[7]) ?: return null
                val hh = z.groupValues[2].toInt(); val mm = z.groupValues[3].ifEmpty { "0" }.toInt()
                if (hh > 14 || mm > 59) return null
                (if (z.groupValues[1] == "-") -1 else 1) * (hh * 60 + mm)
            }
            return local - zone * 60_000L
        }
        if (offset != null) return local - offset * 60_000L
        if (offsetAt == null) return local
        // The owner's own zone as this device keeps it, summer time of that day included.
        val first = offsetAt(local)
        val guess = local - first * 60_000L
        val second = offsetAt(guess)
        return if (second == first) guess else local - second * 60_000L
    }

    /** The time left to a countdown's moment [to] at [now] (milliseconds since 1970); null when [to] is not a real day and time. Counted on the device and nowhere else. */
    fun countdown(to: String?, now: Long, offset: Int? = null, offsetAt: ((Long) -> Int)? = null): ViewCountdown? {
        val at = moment(to, offset, offsetAt) ?: return null
        val ms = at - now
        if (ms <= 0) return ViewCountdown(0, true, "")
        val sec = ms / 1000
        val d = sec / 86400; val h = (sec % 86400) / 3600; val m = (sec % 3600) / 60; val s = sec % 60
        val shows = when {
            d > 0 -> tr("{d} d {h} h", "d" to d, "h" to h)
            h > 0 -> tr("{h} h {m} min", "h" to h, "m" to m)
            m > 0 -> tr("{m} min {s} s", "m" to m, "s" to s)
            else -> tr("{s} s", "s" to s)
        }
        return ViewCountdown(ms, false, shows)
    }

    /** What a quiz says of the choice that was sent: whether it was the right one and the words; null while nothing was sent that is one of its choices, and for a quiz that names no answer. */
    fun verdict(options: List<String>, answer: Int?, explain: String?, said: String): Pair<Boolean, String>? {
        if (said !in options || answer == null || answer < 0 || answer >= options.size) return null
        val right = options[answer] == said
        val first = if (right) tr("Correct.") else tr("Not quite. The answer is {answer}.", "answer" to options[answer])
        return right to (if (explain.isNullOrEmpty()) first else "$first $explain")
    }
}
