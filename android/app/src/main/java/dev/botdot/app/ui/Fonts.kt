package dev.botdot.app.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import dev.botdot.app.R

// Geist and Geist Mono, the web page's and the Mac app's fonts, ship in res/font (licence: assets/fonts/OFL.txt).
// Each file is a variable font: a Font of a weight sets the file's weight axis to it, so no weight is faked.
private val weights = listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold)

/** Geist, for all text. */
val Geist = FontFamily(
    weights.map { Font(R.font.geist, it) } + weights.map { Font(R.font.geist_italic, it, FontStyle.Italic) },
)

/** Geist Mono, for code and scripts. */
val GeistMono = FontFamily(weights.map { Font(R.font.geist_mono, it) })

/** Every style of [this] in Geist, Material's defaults among them (a Text without a style takes bodyLarge). */
fun Typography.inGeist() = copy(
    displayLarge = displayLarge.copy(fontFamily = Geist),
    displayMedium = displayMedium.copy(fontFamily = Geist),
    displaySmall = displaySmall.copy(fontFamily = Geist),
    headlineLarge = headlineLarge.copy(fontFamily = Geist),
    headlineMedium = headlineMedium.copy(fontFamily = Geist),
    headlineSmall = headlineSmall.copy(fontFamily = Geist),
    titleLarge = titleLarge.copy(fontFamily = Geist),
    titleMedium = titleMedium.copy(fontFamily = Geist),
    titleSmall = titleSmall.copy(fontFamily = Geist),
    bodyLarge = bodyLarge.copy(fontFamily = Geist),
    bodyMedium = bodyMedium.copy(fontFamily = Geist),
    bodySmall = bodySmall.copy(fontFamily = Geist),
    labelLarge = labelLarge.copy(fontFamily = Geist),
    labelMedium = labelMedium.copy(fontFamily = Geist),
    labelSmall = labelSmall.copy(fontFamily = Geist),
)
