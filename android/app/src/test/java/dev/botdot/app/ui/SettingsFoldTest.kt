package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Settings: every section folds, closed whenever Settings opens; only the links under More stay open. */
class SettingsFoldTest {
    private fun source(name: String) = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/main/java/dev/botdot/app/ui/$name") }.first { it.exists() }.readText()

    @Test fun everySectionOfSettingsFolds() {
        val settings = source("SettingsScreen.kt")
        val open = Regex("""(?<!Fold)Section\("([^"]+)"""").findAll(settings).map { it.groupValues[1] }.toList()
        assertEquals(listOf("More"), open)
        for (title in listOf("Default model and reasoning", "✳︎ Claude", "Backups", "Updates", "Sign-ins")) {
            assertTrue(title, "FoldSection(\"$title\")" in settings)
        }
        assertTrue("Usage folds too", "FoldSection(\"Usage\")" in source("UsageSection.kt"))
    }
}
