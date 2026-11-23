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
            assertTrue(title, "FoldSection(\"$title\"" in settings || "FoldSection(tr(\"$title\")" in settings) // its label in the account's language (#645)
        }
        assertTrue("Usage folds too", "FoldSection(tr(\"Usage\"))" in source("UsageSection.kt"))
        assertTrue("saved by itself, said in the top bar", "SavedMark(" in settings)
    }

    /** Sign-ins (#1591): "Sign out of this device" ends this session only, first; "Sign out everywhere" stays, after it. */
    @Test fun signInsEndsThisPhoneOnlyOrEveryDevice() {
        val settings = source("SettingsScreen.kt")
        val fold = settings.substringAfter("FoldSection(tr(\"Sign-ins\"))").substringBefore("\"Delete account\"")
        val here = fold.indexOf("tr(\"Sign out of this device\")")
        val everywhere = fold.indexOf("tr(\"Sign out everywhere\")")
        assertTrue("both buttons, this device first", here in 0 until everywhere)
        assertTrue("the first is the primary one", "confirmSignOutHere = true" in fold && "ButtonDefaults.buttonColors(containerColor = p.ink" in fold.substring(0, everywhere))
        assertTrue("the second keeps its own question", "confirmSignOut = true" in fold)
        // Each asks first and ends what its words say, through the front door's own route (Api.signOut and Api.signOutEverywhere).
        val here_dialog = settings.substringAfter("if (confirmSignOutHere) AlertDialog(").substringBefore("if (confirmSignOut) AlertDialog(")
        assertTrue("api!!.signOut()" in here_dialog && "signOutEverywhere" !in here_dialog)
        assertTrue("Cancel keeps the session", "confirmSignOutHere = false" in here_dialog && "Cancel" in here_dialog)
        assertTrue("signOutEverywhere" in settings.substringAfter("if (confirmSignOut) AlertDialog(").substringBefore("if (confirmDelete)"))
    }
}
