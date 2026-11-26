package dev.botdot.app.ui

import dev.botdot.app.data.without
import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import dev.botdot.app.R

// Geist and Geist Mono, the web page's fonts, ship in res/font (licence: assets/fonts/OFL.txt).
// Each file is a variable font: a Font of a weight sets the file's weight axis to it, so no weight is faked.
// Two weights, as on the web page: 400 for words and 600 for names and titles (FontWeightTest keeps it so).
internal val weights = listOf(FontWeight.Normal, FontWeight.SemiBold)

/** Geist, for all text. */
val Geist = FontFamily(
    weights.map { Font(R.font.geist, it) } + weights.map { Font(R.font.geist_italic, it, FontStyle.Italic) },
)

/** Geist Mono, for code and scripts. */
val GeistMono = FontFamily(weights.map { Font(R.font.geist_mono, it) })

/**
 * Every style of [this] in the interface's language [tag] (ADR 280): Geist has no Chinese, Japanese or Korean letters,
 * which Android draws from its own fonts, and the locale picks that language's forms of the shared Han characters
 * (a Japanese 直, not the Chinese one), whatever the phone's own language is.
 */
fun Typography.inLocale(tag: String): Typography {
    val l = LocaleList(tag)
    return copy(
        displayLarge = displayLarge.copy(localeList = l), displayMedium = displayMedium.copy(localeList = l), displaySmall = displaySmall.copy(localeList = l),
        headlineLarge = headlineLarge.copy(localeList = l), headlineMedium = headlineMedium.copy(localeList = l), headlineSmall = headlineSmall.copy(localeList = l),
        titleLarge = titleLarge.copy(localeList = l), titleMedium = titleMedium.copy(localeList = l), titleSmall = titleSmall.copy(localeList = l),
        bodyLarge = bodyLarge.copy(localeList = l), bodyMedium = bodyMedium.copy(localeList = l), bodySmall = bodySmall.copy(localeList = l),
        labelLarge = labelLarge.copy(localeList = l), labelMedium = labelMedium.copy(localeList = l), labelSmall = labelSmall.copy(localeList = l),
    )
}

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
