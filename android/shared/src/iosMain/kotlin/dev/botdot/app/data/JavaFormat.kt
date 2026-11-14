package dev.botdot.app.data

/**
 * The part of java.util.Formatter the data layer uses (%d, %s, %f with the flags ',', '0', '-', a width and a
 * precision), for iOS: numbers come out as on Android, with the locale's own separators. %f rounds half up from the
 * shortest decimal that is the number, as the JVM does.
 */
internal object JavaFormat {
    private val SPEC = Regex("%([-0,]*)(\\d+)?(?:\\.(\\d+))?([dfs%])")

    fun format(pattern: String, args: Array<out Any?>, decimal: String, grouping: String): String {
        var next = 0
        return SPEC.replace(pattern) { m ->
            val flags = m.groupValues[1]
            val width = m.groupValues[2].toIntOrNull() ?: 0
            val precision = m.groupValues[3].toIntOrNull()
            val body = when (m.groupValues[4]) {
                "%" -> return@replace "%"
                "s" -> args[next++].toString()
                "d" -> {
                    val n = (args[next++] as Number).toLong()
                    val digits = n.toString().removePrefix("-")
                    (if (n < 0) "-" else "") + if (',' in flags) group(digits, grouping) else digits
                }
                else -> fixed((args[next++] as Number).toDouble(), precision ?: 6, ',' in flags, decimal, grouping)
            }
            pad(body, width, flags)
        }
    }

    private fun pad(s: String, width: Int, flags: String): String = when {
        s.length >= width -> s
        '-' in flags -> s.padEnd(width)
        '0' in flags -> if (s.startsWith("-")) "-" + s.drop(1).padStart(width - 1, '0') else s.padStart(width, '0')
        else -> s.padStart(width)
    }

    private fun group(digits: String, sep: String): String =
        digits.reversed().chunked(3).map { it.reversed() }.reversed().joinToString(sep)

    private fun fixed(v: Double, precision: Int, grouped: Boolean, decimal: String, grouping: String): String {
        if (v.isNaN()) return "NaN"
        if (v.isInfinite()) return if (v > 0) "Infinity" else "-Infinity"
        val negative = v < 0 || (v == 0.0 && 1.0 / v < 0)
        // The shortest decimal of |v|, as digits and the position of the point.
        val (digits, point) = decimalOf(kotlin.math.abs(v))
        val wanted = point + precision
        val d = StringBuilder(digits)
        var p = point
        if (wanted < d.length) {
            val up = wanted >= 0 && d[wanted] >= '5'
            d.setLength(maxOf(wanted, 0))
            if (up) {
                var i = d.length - 1
                while (i >= 0 && d[i] == '9') { d[i] = '0'; i-- }
                if (i >= 0) d[i] = d[i] + 1 else { d.insert(0, '1'); p++ }
            }
        }
        while (d.length < p + precision) d.append('0')
        while (p <= 0) { d.insert(0, '0'); p++ }
        val whole = d.substring(0, p).trimStart('0').ifEmpty { "0" }
        val frac = d.substring(p, p + precision)
        return (if (negative) "-" else "") + (if (grouped) group(whole, grouping) else whole) + if (precision > 0) decimal + frac else ""
    }

    /** "1.25" -> ("125", 1); "0.005" -> ("5", -2); "1.0E10" -> ("1", 11). */
    private fun decimalOf(v: Double): Pair<String, Int> {
        val s = v.toString()
        val mantissa = s.substringBefore('E').substringBefore('e')
        val exp = if ('E' in s || 'e' in s) s.substringAfter('E', s.substringAfter('e')).toInt() else 0
        val intPart = mantissa.substringBefore('.')
        val fracPart = mantissa.substringAfter('.', "")
        val all = (intPart + fracPart).trimStart('0')
        val lead = (intPart + fracPart).length - all.length
        val point = intPart.length + exp - lead
        return all.trimEnd('0').ifEmpty { "0" } to (if (all.isEmpty()) 1 else point)
    }
}
