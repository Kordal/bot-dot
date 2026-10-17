package dev.botdot.app.ui

import androidx.compose.ui.graphics.Color
import dev.botdot.app.data.Api
import dev.botdot.app.data.ChiefChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** How a Chief reply is drawn from its `text`, `error` and `files`, and what a chip says of what still waits. */
class ChiefReplyTest {
    private fun messages(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[$json]}""").messages

    @Test fun textAndErrorErrorOnlyAndNeither() {
        val (both, problem, neither, fine) = messages("""
            {"role":"chief","text":"Here is the first half","error":"Claude stopped answering."},
            {"role":"chief","text":"","error":"Claude stopped answering."},
            {"role":"chief","text":"  ","actions":[{"kind":"run","text":"Started Coder","botId":"b1"}]},
            {"role":"chief","text":"All done."}""")
        // The text, and the problem in its own block under it.
        chiefReply(both).let { assertEquals("Here is the first half" to "Claude stopped answering.", it.text to it.error) }
        // The problem bubble, as before.
        chiefReply(problem).let { assertEquals(null to "Claude stopped answering.", it.text to it.error) }
        // Nothing: no bubble, and no "Done." of the app's own.
        chiefReply(neither).let { assertEquals(null to null, it.text to it.error) }
        chiefReply(fine).let { assertEquals("All done." to null, it.text to it.error) }
    }

    // BUSY-008: a reply about a bot's result carries that run's files (docs/api.md, A late result).
    // `test/chief-files-web.test.js` holds the web page's side.
    @Test fun aReplyAboutABotsResultDrawsThatRunsFiles() {
        val files = """[{"name":"table.png","file":"r5/table.png","size":2048},{"name":"<b>menu</b>.pdf","file":"r5/%3Cb%3Emenu.pdf"}]"""
        val (late, alone, failed, pending) = messages("""
            {"role":"chief","text":"Web Surfer booked your table.","actions":[{"kind":"from","text":"From Web Surfer","botId":"surf","runId":"r5"}],"files":$files},
            {"role":"chief","text":"","files":$files},
            {"role":"chief","text":"","error":"Claude stopped answering.","files":$files},
            {"role":"chief","text":"","pending":true,"files":$files}""")
        // Under the text, in the server's order; a name is the server's words, drawn as text.
        chiefReply(late).let {
            assertEquals("Web Surfer booked your table.", it.text)
            assertEquals(listOf("table.png" to "r5/table.png", "<b>menu</b>.pdf" to "r5/%3Cb%3Emenu.pdf"), it.files.map { f -> f.name to f.file })
        }
        // No words: the files still show, in a bubble of their own.
        chiefReply(alone).let { assertEquals(Triple(null, null, 2), Triple(it.text, it.error, it.files.size)) }
        // A reply that failed keeps them beside its problem.
        chiefReply(failed).let { assertEquals("Claude stopped answering." to 2, it.error to it.files.size) }
        // A reply still being written draws none.
        assertEquals(0, chiefReply(pending).files.size)
    }

    @Test fun aReplyWithoutFilesIsDrawnAsBefore() {
        val (none, empty, nulled) = messages("""
            {"role":"chief","text":"All done."},
            {"role":"chief","text":"All done.","files":[]},
            {"role":"chief","text":"  ","files":null}""")
        for (m in listOf(none, empty)) chiefReply(m).let { assertEquals(Triple("All done.", null, 0), Triple(it.text, it.error, it.files.size)) }
        // Nothing at all: no bubble, as before.
        chiefReply(nulled).let { assertEquals(Triple(null, null, 0), Triple(it.text, it.error, it.files.size)) }
    }

    @Test fun anErrorThatIsNoWordsDrawsNoProblem() {
        val (blank, flag) = messages("""{"role":"chief","text":"Hi","error":" "},{"role":"chief","text":"Hi","error":true}""")
        assertNull(chiefReply(blank).error)
        assertNull(chiefReply(flag).error)
    }

    @Test fun aChipSaysWhatWaitsAfterItsText() {
        val actions = messages("""{"role":"chief","text":"Made it.","actions":[
            {"kind":"created","text":"Created Web Surfer","botId":"b1","waits":"web access waits for your OK"},
            {"kind":"run","text":"Started Coder","botId":"b2"}]}""").single().actions.orEmpty()
        val warn = Color(0xFF8A5D0A)
        val waiting = chipText(chipWords(actions[0], screen = false), warn)
        assertEquals("✨ Created Web Surfer · web access waits for your OK", waiting.text)
        // What waits, and only that, is in the warning colour.
        val span = waiting.spanStyles.single()
        assertEquals("web access waits for your OK", waiting.text.substring(span.start, span.end))
        assertEquals(warn, span.item.color)
        // As on the web page: what waits comes before "View live screen".
        assertEquals("✨ Created Web Surfer · web access waits for your OK · View live screen", chipText(chipWords(actions[0], screen = true), warn).text)
        // Without it the chip is as before.
        val plain = chipText(chipWords(actions[1], screen = true), warn)
        assertEquals("→ Started Coder · View live screen", plain.text)
        assertEquals(0, plain.spanStyles.size)
    }
}
