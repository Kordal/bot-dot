package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/** The "@" of a chat's box as the iPhone has it (MentionBox): read from the store, the Chief first, a pick in place. */
class MentionBoxTest {
    private fun bot(id: String, name: String) = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name"}""")

    @Test fun theBotsAndTheChiefAreSuggestedAndAPickTakesThePlaceOfWhatIsTyped() = runTest {
        val store = Store(backgroundScope, MutableStateFlow(unreachable()))
        runCurrent()
        val box = MentionBox(store, "b1")
        assertTrue(box.suggest("@Fl", 3).isEmpty(), "nothing before the bots are read")
        store.bots.set(listOf(bot("b1", "Fleet Doctor"), bot("b2", "Web Surfer")))
        store.version.set(VersionInfo(features = emptyList()))
        assertEquals(listOf("@FleetDoctor"), box.suggest("Ask @Fl", 7).map { it.text })
        assertTrue(("@" + Mentions.shortName(store.chiefName.value).take(3)).let { box.suggest(it, it.length) }.any { it.bot == Mentions.CHIEF }, "the Chief is one of them")
        assertTrue(box.suggest("no at sign", 10).isEmpty())
        val row = box.suggest("Ask @we", 7).single()
        assertEquals("Ask @WebSurfer ", box.pick("Ask @we", 7, row)?.text)
        // In the middle of the text: the "@…" before the cursor, the rest of the message kept after it.
        val middle = "Ask @we today"
        assertEquals(listOf("@WebSurfer"), box.suggest(middle, 7).map { it.text })
        assertTrue(box.suggest(middle, middle.length).isEmpty(), "at the end no \"@\" is being typed")
        val picked = box.pick(middle, 7, row)!!
        assertEquals("Ask @WebSurfer today", picked.text)
        assertEquals(15, picked.cursor)
    }

    private fun unreachable() = Api("https://127.0.0.1:9")
}
