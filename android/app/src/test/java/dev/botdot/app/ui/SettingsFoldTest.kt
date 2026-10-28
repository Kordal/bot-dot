package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Settings (#636): one flat list of rows, no section cards; every row that holds more opens under itself, closed whenever Settings opens. */
class SettingsFoldTest {
    private fun source(name: String) = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/main/java/dev/botdot/app/ui/$name") }.first { it.exists() }.readText()

    @Test fun settingsIsOneFlatListWhoseRowsFold() {
        val settings = source("SettingsScreen.kt")
        assertEquals(emptyList<String>(), Regex("""(?<![A-Za-z])Section\(""").findAll(settings).map { it.value }.toList())
        for (title in listOf("Computer", "Claude", "Backups", "Updates", "Sign-ins")) {
            assertTrue(title, "FoldSection(\"$title\"" in settings)
        }
        assertTrue("Usage folds too", "FoldSection(\"Usage\")" in source("UsageSection.kt"))
        assertTrue("saved by itself, said in the top bar", "SavedMark(" in settings)
    }
}
