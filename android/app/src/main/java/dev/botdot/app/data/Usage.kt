package dev.botdot.app.data

import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.util.Locale

/**
 * Settings → Usage (#301): the tokens Claude Code reported for this account, for today, the last 7 or 30 days or days
 * the owner picks, in total, per bot (the Chief of Staff is one row) and per day. No cost is shown. The server counts the
 * days in the account's time zone and says which day is today; the ranges here are counted from that day. Against a
 * server without `token-usage` in `features` the section is not shown.
 */
object Usage {
    const val FEATURE = "token-usage"

    @Serializable data class Totals(
        val inputTokens: Long = 0, val outputTokens: Long = 0, val cacheReadTokens: Long = 0, val cacheWriteTokens: Long = 0,
        val totalTokens: Long = 0, val runs: Int = 0,
    )
    @Serializable data class Bot(
        val id: String? = null, val name: String = "", val chief: Boolean = false, val gone: Boolean = false,
        val totalTokens: Long = 0, val runs: Int = 0,
    )
    @Serializable data class Day(val day: String = "", val totalTokens: Long = 0)
    @Serializable data class Answer(
        val from: String = "", val to: String = "", val today: String = "", val timeZone: String = "", val keepDays: Int = 400,
        val totals: Totals = Totals(), val bots: List<Bot> = emptyList(), val days: List<Day> = emptyList(),
    )

    enum class Preset { TODAY, WEEK, MONTH, CUSTOM; val label: String get() = when (this) { TODAY -> tr("Today"); WEEK -> tr("7 days"); MONTH -> tr("30 days"); CUSTOM -> tr("Custom") } }

    /** Whether to show the section: the server announces it. While its features are not known yet: no. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** The days a preset covers, ending on the account's [today] (YYYY-MM-DD); null for a day that isn't one. */
    fun rangeOf(preset: Preset, today: String): Pair<String, String>? {
        val t = day(today) ?: return null
        val from = when (preset) {
            Preset.WEEK -> t.minusDays(6)
            Preset.MONTH -> t.minusDays(29)
            else -> t
        }
        return from.toString() to t.toString()
    }

    /** A custom range as it is sent: both days real, and [to] never before [from] (the other day follows the one changed). */
    fun custom(from: String, to: String, changed: String): Pair<String, String>? {
        val f = day(from) ?: return null
        val t = day(to) ?: return null
        if (!t.isBefore(f)) return f.toString() to t.toString()
        return if (changed == "from") f.toString() to f.toString() else t.toString() to t.toString()
    }

    /** The query of GET /api/usage. */
    fun query(from: String?, to: String?): String =
        if (from.isNullOrBlank() || to.isNullOrBlank()) "" else "?from=$from&to=$to"

    fun day(s: String): LocalDate? = if (Regex("""\d{4}-\d{2}-\d{2}""").matches(s)) runCatching { LocalDate.parse(s) }.getOrNull() else null

    /** 1234 → "1,234"; 10,000 and more → "12.3k"; a million and more → "1.2M". */
    fun tokens(n: Long): String = when {
        n >= 10_000_000 -> String.format(Locale.US, "%.0fM", n / 1e6)
        n >= 1_000_000 -> String.format(Locale.US, "%.1fM", n / 1e6)
        n >= 100_000 -> String.format(Locale.US, "%.0fk", n / 1e3)
        n >= 10_000 -> String.format(Locale.US, "%.1fk", n / 1e3)
        else -> String.format(Locale.US, "%,d", n)
    }

    /** Each day's bar as a share of the busiest day's (0 to 1); a day with something is never quite flat. */
    fun bars(days: List<Day>): List<Float> {
        val top = days.maxOfOrNull { it.totalTokens } ?: 0L
        if (top <= 0L) return days.map { 0f }
        return days.map { if (it.totalTokens <= 0L) 0f else maxOf(0.03f, it.totalTokens.toFloat() / top) }
    }

    /** "16 Oct", for the chart's ends. */
    fun dayLabel(s: String): String = day(s)?.let { "${it.dayOfMonth} ${it.month.getDisplayName(java.time.format.TextStyle.SHORT, I18n.locale)}" } ?: s
}
