package dev.botdot.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** What Material draws by itself takes botdot's look (#1191), in two weights (#1192). */
class ThemeTest {
    private val sources = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/main/java") }.first { it.exists() }

    private fun scan(re: Regex, skip: Set<String> = emptySet()) = sources.walkTopDown()
        .filter { it.extension == "kt" && it.name !in skip }
        .flatMap { f -> f.readLines().withIndex().filter { re.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}" } }.toList()

    @Test fun noRoleIsLeftAtMaterialsPurple() {
        val p = DarkPaper
        val s = botDotColors(p)
        assertEquals(p.ink, s.inverseSurface)
        assertEquals(p.inkText, s.inverseOnSurface)
        assertEquals(Color.Transparent, s.surfaceTint)
        assertEquals(p.fill, s.primaryContainer)
        assertEquals(p.raise2, s.surfaceContainerLow)
        assertEquals(p.raise2, s.surfaceContainer)
        assertEquals(p.raise2, s.surfaceContainerHigh)
        assertEquals(p.fill, s.surfaceContainerHighest)
        assertEquals(p.mention, s.tertiary)
        assertEquals(p.inkText, s.onError)
    }

    @Test fun materialsCornersAreBotdots() {
        assertEquals(Radius.small, BotDotShapes.extraSmall)
        assertEquals(Radius.card, BotDotShapes.extraLarge)
    }

    @Test fun everyNoteGoesThroughBotSnackbarHost() {
        assertEquals(emptyList<String>(), scan(Regex("""(?<!Bot)SnackbarHost\((?!State)"""), setOf("Snackbars.kt")))
    }

    @Test fun textHasTwoWeights() {
        assertEquals(emptyList<String>(), scan(Regex("""FontWeight\.(Medium|Bold|W\d00|Thin|Light|Black|ExtraBold|ExtraLight)\b""")))
        assertEquals(listOf(FontWeight.Normal, FontWeight.SemiBold), weights)
        assertEquals(FontWeight.Normal, BotDotType.labelLarge.fontWeight)
        assertEquals(FontWeight.SemiBold, BotDotType.titleSmall.fontWeight)
        assertEquals(FontWeight.SemiBold, BotDotType.headlineSmall.fontWeight)
    }
}
