package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
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

/** The target delivery date (#792): `deliverBy` is a day as YYYY-MM-DD, "none" for no date, "" while not answered. */
internal object Delivery {
    const val NONE = "none"
    fun day(deliverBy: String): LocalDate? = runCatching { LocalDate.parse(deliverBy) }.getOrNull()
    fun dayText(d: LocalDate): String = d.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(I18n.locale))
    /** The line of what the Chief knows, or null while not answered. */
    fun line(deliverBy: String): String? = when {
        deliverBy == NONE -> tr("No delivery date")
        else -> day(deliverBy)?.let { tr("Delivery") + ": " + dayText(it) }
    }
}

/** A day picked on the calendar, or No date. [onSet] gets the new `deliverBy` ("" when a picked chip is tapped off). */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun DeliveryChips(deliverBy: String, onSet: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    val day = Delivery.day(deliverBy)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        CoChip(day?.let(Delivery::dayText) ?: tr("Pick a date"), on = day != null, icon = Icons.Filled.DateRange) { picking = true }
        CoChip(tr("No date"), on = deliverBy == Delivery.NONE) { onSet(if (deliverBy == Delivery.NONE) "" else Delivery.NONE) }
    }
    if (picking) {
        val start = day ?: LocalDate.now()
        val state = rememberDatePickerState(initialSelectedDateMillis = start.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton({ state.selectedDateMillis?.let { ms -> onSet(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
    }
}
