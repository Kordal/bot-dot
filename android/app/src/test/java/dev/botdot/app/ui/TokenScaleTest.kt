package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** One type scale (#722): a text size is a step of [Type], written once in Theme.kt, never a number in a screen. */
class TokenScaleTest {
    private val sources = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/main/java") }.first { it.exists() }

    /** Theme.kt holds the scale; every screen, the Projects screens too (#741), takes its steps. */
    private val allowed = setOf("Theme.kt")

    private val literal = Regex("""(?<![\w.])\d+(\.\d+)?\.sp\b""")

    internal fun literals(text: String) = text.lines().withIndex()
        .filter { (_, line) -> !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && literal.containsMatchIn(line) }
        .map { (i, line) -> "${i + 1}: ${line.trim()}" }

    @Test fun noScreenWritesATextSizeAsANumber() {
        val found = sources.walkTopDown().filter { it.extension == "kt" && it.name !in allowed }
            .flatMap { f -> literals(f.readText()).map { "${f.name}:$it" } }.toList()
        assertEquals(emptyList<String>(), found)
    }

    @Test fun theCheckCatchesANewNumber() {
        assertEquals(1, literals("Text(\"a\", fontSize = 13.sp)\nText(\"b\", fontSize = Type.s14)").size)
        assertEquals(1, literals("val x = 12.5.sp").size)
        assertTrue(literals("val x = size.sp // size * 1.45f").isEmpty())
    }

    @Test fun theScaleHasSixSizes() {
        assertEquals(listOf(12f, 14f, 16f, 20f, 24f, 32f), listOf(Type.s12, Type.s14, Type.s16, Type.s20, Type.s24, Type.s32).map { it.value })
    }
}
