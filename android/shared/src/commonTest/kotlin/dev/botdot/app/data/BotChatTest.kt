package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** A bot's chat as both phones keep it (BotChat): what it shows before botdot answered. */
class BotChatTest {
    @Test fun aNewChatShowsNothingYetAndNothingOnItsWay() {
        val scope = TestScope()
        val api = Api("https://hq.example.com")
        val chat = BotChat(scope, api, Store(scope, MutableStateFlow(api)), emptyFlow(), "b1")
        val s = chat.state.value
        assertFalse(s.loaded)
        assertEquals(emptyList(), s.runs)
        assertNull(s.sent)
        assertNull(s.note)
        assertFalse(s.running)
    }
}
