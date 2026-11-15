package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Chief's chat as both phones keep it (ChiefDesk): how it draws a message, and what a send keeps. */
class ChiefDeskTest {
    private val rates = listOf(Ratings.FEATURE)

    @Test fun theOwnersMessageIsTheirsWithItsFilesAndNoTime() {
        val m = ChiefMessage("user", text = "Plan my week", attachments = listOf(Attachment("week.pdf", "f1")), at = "2026-11-14T09:00:00Z")
        val line = chiefLine(m, 12, "", rates)
        assertEquals("user", line.role)
        assertEquals(12, line.index)
        assertEquals("Plan my week", line.text)
        assertEquals(listOf("week.pdf"), line.files.map { it.name })
        assertEquals("", line.time)
        assertFalse(line.rates)
    }

    @Test fun anUnaskedReplyGetsThumbsOnABotdotThatTakesThem() {
        val m = ChiefMessage("chief", text = "Your server's disk is 90% full.", unasked = true, rating = "up", at = "2026-11-14T09:00:00Z")
        val line = chiefLine(m, 3, "", rates)
        assertTrue(line.rates)
        assertEquals("up", line.rating)
        assertFalse(chiefLine(m, 3, "", emptyList()).rates, "a botdot without ratings")
        assertFalse(chiefLine(m.copy(unasked = false), 3, "", rates).rates, "a reply the owner asked for")
    }

    @Test fun whatAMessageIsAboutIsItsTeamAndProject() {
        val about = MessageAbout(AboutTeam("t1", "Garden", "#1d9e75"), AboutProject("p1", "Spring beds"))
        val line = chiefLine(ChiefMessage("chief", text = "Ordered the seeds.", about = about), 0, "", rates)
        assertEquals("Garden", line.team)
        assertEquals("#1d9e75", line.teamColor)
        assertEquals("Spring beds", line.project)
        val nameless = chiefLine(ChiefMessage("chief", text = "x", about = MessageAbout(AboutTeam("t1", ""), AboutProject("p1", "Spring beds"))), 0, "", rates)
        assertNull(nameless.team, "a team without a name is not drawn")
        assertNull(nameless.project)
    }

    @Test fun aBotsSuggestionAndReportSayWhoSentThem() {
        val from = BotRef("b1", "Fleet Doctor")
        assertEquals("Suggestion from Fleet Doctor", chiefLine(ChiefMessage("suggestion", text = "Restart it", from = from), 0, "", rates).from)
        assertEquals("Message from Fleet Doctor", chiefLine(ChiefMessage("report", text = "Done", from = from), 0, "", rates).from)
        assertEquals("Message from a bot", chiefLine(ChiefMessage("report", text = "Done"), 0, "", rates).from)
        assertNull(chiefLine(ChiefMessage("chief", text = "Hi"), 0, "", rates).from)
    }

    @Test fun aReplyBeingWrittenShowsItsDraftAndNoFilesYet() {
        val m = ChiefMessage("chief", text = "", pending = true, files = listOf(Attachment("a.txt", "f")))
        val line = chiefLine(m, 5, "So far **this**", rates)
        assertTrue(line.pending)
        assertEquals("So far **this**", line.text)
        assertEquals(emptyList(), line.files)
        assertEquals("", line.time)
    }

    @Test fun aFailedReplySaysWhyUnderItsText() {
        val line = chiefLine(ChiefMessage("chief", text = "Half done", errorValue = JsonPrimitive("Stopped")), 0, "", rates)
        assertEquals("Half done", line.text)
        assertEquals("Stopped", line.error)
    }

    // Nothing listens on port 1 of this device: every send fails at once. Its reads run in the test's background.
    private fun TestScope.offline(): ChiefDesk {
        val api = Api("http://127.0.0.1:1")
        return ChiefDesk(backgroundScope, api, Store(backgroundScope, MutableStateFlow(api)), emptyFlow())
    }

    @Test fun aNewChiefChatShowsNothingOnItsWay() = runTest {
        val s = offline().state.value
        assertNull(s.chatId)
        assertEquals(emptyList(), s.messages)
        assertNull(s.sent)
        assertFalse(s.busy)
    }

    @Test fun aFailedFirstMessageComesBackWithItsFileOnce() = runTest {
        val desk = offline()
        val file = Attachment("photo.jpeg", "f1")
        desk.pick(file)
        assertFalse(desk.send("Plan my week"))
        assertEquals(emptyList(), desk.state.value.files, "the file went with the message")
        assertEquals("Plan my week", desk.takeFailed())
        assertEquals(listOf(file), desk.state.value.files)
    }

    @Test fun whatWasTypedAndNotSentIsKeptOnce() = runTest {
        val desk = offline()
        desk.leave("Half a thought")
        assertEquals("Half a thought", desk.takeUnsent())
        assertEquals("", desk.takeUnsent())
    }

    @Test fun aChiefWhoseListCantBeReadIsNotDrawnAsANewChat() = runTest {
        val desk = offline()
        desk.load()
        val s = desk.state.value
        assertFalse(s.loaded, "no empty chat whose first message would start a conversation")
        assertTrue(s.failed != null)
        assertNull(s.chatId)
    }

    private fun bot(id: String, name: String, computer: String = "none") =
        Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name","computer":"$computer"}""")

    @Test fun whatTheChiefDidIsAChipEachAndAMailDraftsBotIsInItsCard() {
        val m = ChiefMessage("chief", text = "Drafted it", at = "2026-11-14T09:00:00Z",
            actions = listOf(
                ChiefAction("run", "Started Coder", botId = "b1"),
                ChiefAction("created", "Created Web Surfer", botId = "b2", waitsValue = JsonPrimitive("web access waits for your OK")),
                ChiefAction("run", "Started Mailer", botId = "b3"),
            ),
            draft = MailDraft(to = "ann@example.test", subject = "Dinner", text = "Friday?", botId = "b3"))
        val line = chiefLine(m, 4, "", emptyList(), listOf(bot("b1", "Coder", "linux"), bot("b2", "Web Surfer"), bot("b3", "Mailer")))
        assertEquals(listOf("→ Started Coder", "✨ Created Web Surfer"), line.chips.map { it.text }, "the draft's bot is in its card")
        assertEquals(" · View live screen", line.chips[0].after, "a run on a Linux computer")
        assertEquals("web access waits for your OK", line.chips[1].waits)
        assertTrue(line.chips.all { it.opens })
        val mail = line.mail!!
        assertEquals("ann@example.test", mail.to)
        assertEquals("In Drafts · not sent", mail.state)
        assertEquals(listOf("Send now", "Not now"), mail.actions)
        assertEquals("Mailer", mail.bot)
        assertFalse(mail.sent || mail.screen)
        assertEquals("b3", mail.botId)
    }

    @Test fun aSentMailHasNoButtonsAndAnEarlierOneFolds() {
        val sent = chiefLine(ChiefMessage("chief", text = "Sent", draft = MailDraft(to = "a@example.test", state = "sent", sentAt = "2026-11-14T09:30:00Z")), 0, "", emptyList())
        assertTrue(sent.mail!!.sent)
        assertTrue(sent.mail!!.state.startsWith("Sent "), sent.mail!!.state)
        assertTrue(sent.mail!!.actions.isEmpty())
        val kept = chiefLine(ChiefMessage("chief", text = "Kept", draft = MailDraft(to = "a@example.test", state = "kept")), 0, "", emptyList())
        assertEquals(listOf("Send now"), kept.mail!!.actions)
        val earlier = chiefLine(ChiefMessage("chief", text = "v1", draft = MailDraft(to = "a@example.test", earlier = true)), 0, "", emptyList())
        assertTrue(earlier.mail!!.earlier && earlier.mail!!.actions.isEmpty())
        assertNull(chiefLine(ChiefMessage("user", text = "x", draft = MailDraft()), 0, "", emptyList()).mail, "only under the Chief's reply")
    }
}
