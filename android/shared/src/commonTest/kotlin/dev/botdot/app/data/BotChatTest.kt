package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
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

    // Nothing listens on port 1 of this device: every send fails at once, before botdot could have taken it.
    // The chat's own reads run in the test's background, cancelled when it ends.
    private fun TestScope.offline(): BotChat {
        val api = Api("http://127.0.0.1:1")
        return BotChat(backgroundScope, api, Store(backgroundScope, MutableStateFlow(api)), emptyFlow(), "b1")
    }

    @Test fun aFailedSendGivesItsFileBackOnce() = runTest {
        val chat = offline()
        val file = Attachment("photo.jpeg", "f1")
        chat.pick(file)
        assertFalse(chat.send("Look at this"))
        assertEquals(emptyList(), chat.state.value.files, "the file went with the message")
        assertEquals("Look at this", chat.takeFailed())
        assertEquals(listOf(file), chat.state.value.files)
    }

    @Test fun aFilePickedAfterASendStaysForTheNextMessage() = runTest {
        val chat = offline()
        val sent = Attachment("photo.jpeg", "f1")
        val later = Attachment("notes.pdf", "f2")
        chat.pick(sent)
        chat.send("Look at this")
        chat.pick(later)
        assertEquals(listOf(later), chat.state.value.files)
        chat.takeFailed()
        assertEquals(listOf(sent, later), chat.state.value.files, "the message's file in front, the later one kept")
    }
}
