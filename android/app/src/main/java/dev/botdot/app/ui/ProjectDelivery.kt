package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AllInclusive
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.botdot.app.data.I18n
import dev.botdot.app.data.tr
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * The target delivery date (#792): `deliverBy` is a day as YYYY-MM-DD, "none" for Indefinite, "" while not answered.
 * The presets (#800) are days the app works out from today; the server sees only the day.
 */
internal object Delivery {
    const val NONE = "none"
    val PRESETS = listOf("month", "quarter", "year")
    fun day(deliverBy: String): LocalDate? = runCatching { LocalDate.parse(deliverBy) }.getOrNull()
    fun dayText(d: LocalDate): String = d.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(I18n.locale))

    /** The day of [preset] from [today]: in one month, in three months, the last day of the year. */
    fun presetDay(preset: String, today: LocalDate): LocalDate = when (preset) {
        "month" -> today.plusMonths(1)
        "quarter" -> today.plusMonths(3)
        else -> LocalDate.of(today.year, 12, 31)
    }

    /** The preset [deliverBy] is from [today], or null for another day (shown on Pick a date) or none. */
    fun presetOf(deliverBy: String, today: LocalDate): String? = day(deliverBy)?.let { d -> PRESETS.firstOrNull { presetDay(it, today) == d } }

    fun presetName(preset: String): String = when (preset) {
        "month" -> tr("In 1 month")
        "quarter" -> tr("In 3 months")
        else -> tr("End of year")
    }

    /** The review's value, or null while not answered. */
    fun value(deliverBy: String): String? = if (deliverBy == NONE) tr("Indefinite") else day(deliverBy)?.let(::dayText)
}

/**
 * The presets, a day picked on the calendar, or Indefinite (#800). [onSet] gets the new `deliverBy` ("" when the
 * picked chip is tapped off).
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun DeliveryChips(deliverBy: String, onSet: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    val today = remember { LocalDate.now() }
    val day = Delivery.day(deliverBy)
    val preset = Delivery.presetOf(deliverBy, today)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Delivery.PRESETS.forEach { k ->
            CoChip(Delivery.presetName(k), on = preset == k, dashed = false) { onSet(if (preset == k) "" else Delivery.presetDay(k, today).toString()) }
        }
        CoChip(if (day != null && preset == null) Delivery.dayText(day) else tr("Pick a date"), on = day != null && preset == null, dashed = false, icon = Icons.Filled.DateRange) { picking = true }
        CoChip(tr("Indefinite"), on = deliverBy == Delivery.NONE, dashed = false, icon = Icons.Filled.AllInclusive) { onSet(if (deliverBy == Delivery.NONE) "" else Delivery.NONE) }
    }
    if (picking) {
        val start = day ?: LocalDate.now()
        val state = rememberDatePickerState(initialSelectedDateMillis = start.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton({ state.selectedDateMillis?.let { ms -> onSet(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
    }
}
