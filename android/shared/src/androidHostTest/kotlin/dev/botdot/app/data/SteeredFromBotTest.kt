package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A teammate's message steered into a run (#1278): the run's `steered` entry names the bot that sent it. */
class SteeredFromBotTest {
    @Test fun aTeammatesSteeredMessageKeepsItsSender() {
        val list = Steered.list(Json.parseToJsonElement("""[
            {"id":"q1","text":"mine","at":"2026-11-12T10:00:00Z"},
            {"id":"msg:r1:1","text":"Bart dopisuje","at":"2026-11-12T10:01:00Z","fromBot":{"id":"pm","name":"Manager","emoji":"🧭","color":"#123456"}},
            {"id":"msg:r1:2","text":"odd","fromBot":"not a bot"}
        ]"""))
        assertEquals(listOf("q1", "msg:r1:1", "msg:r1:2"), list.map { it.id })
        assertNull("the owner's own", list[0].fromBot)
        assertEquals(BotRef("pm", "Manager", "🧭", "#123456"), list[1].fromBot)
        assertNull("what is no bot is left out", list[2].fromBot)
    }
}
