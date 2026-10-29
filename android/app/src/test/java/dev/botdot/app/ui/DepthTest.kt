package dev.botdot.app.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Depth by lightness (#723): higher is lighter, and a secondary button or a field has a surface, not a ring. */
class DepthTest {
    private val sources = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/main/java") }.first { it.exists() }

    /** Theme.kt draws them; the Projects screens move over after their own tickets (#720). */
    private val allowed = setOf("Theme.kt", "CompanyAbout.kt", "CompanyHome.kt", "CompanyScreen.kt", "CompanyTeam.kt")

    private val ringed = Regex("""\b(OutlinedButton|OutlinedTextField)\(""")

    @Test fun noScreenDrawsARingedButtonOrField() {
        val found = sources.walkTopDown().filter { it.extension == "kt" && it.name !in allowed }
            .flatMap { f -> f.readLines().withIndex().filter { ringed.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}" } }.toList()
        assertEquals(emptyList<String>(), found)
    }

    @Test fun theSurfacesAreTheWebPagesValues() {
        assertEquals(Color(0xFF0F0F0F), DarkPaper.raise)
        assertEquals(Color(0xFF171717), DarkPaper.raise2)
        assertEquals(Color(0xFF232323), DarkPaper.fill)
        assertEquals(Color(0x0FFFFFFF), DarkPaper.hi)
    }
}
