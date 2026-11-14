package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * What the phone does with a notification botdot pushed, against the payloads the server sealed in
 * test/fixtures/push-seals.json (lib/apns.js; the iOS app's tests open the same seals).
 */
class PushNoticesTest {
    private val cases: List<JsonObject> = Json.parseToJsonElement(fixture("pushSeals")).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }

    private fun JsonObject.s(k: String) = this[k]?.jsonPrimitive?.content

    @Test fun `a tap opens what the server's target names - a chat or Needs you or the app`() {
        assertTrue(cases.size >= 5)
        for (c in cases) {
            val p = c["payload"]!!.jsonObject
            val opens = PushNotices.opens(p.s("target"))
            val want = when (c.s("opens")) {
                "chat" -> PushNotices.Opens.Chat(p.s("target")!!)
                "needs" -> PushNotices.Opens.NeedsYou
                else -> PushNotices.Opens.App
            }
            assertEquals(want, opens, c.s("what"))
            // A notification whose seal was not opened still has its thread, which is the target.
            assertEquals(want, PushNotices.opens(null, c.s("threadId") ?: p.s("target")), c.s("what"))
        }
    }

    @Test fun `what is no chat opens the app`() {
        assertEquals(PushNotices.Opens.App, PushNotices.opens(null))
        assertEquals(PushNotices.Opens.App, PushNotices.opens("room:r1"))
        assertEquals(PushNotices.Opens.App, PushNotices.opens("bot:"))
        assertEquals(PushNotices.Opens.App, PushNotices.opens("bot:../x"))
        assertEquals(PushNotices.Opens.Chat("chief:c1"), PushNotices.opens(" ", "chief:c1"))
    }

    @Test fun `every notification with Reply is a chat a reply can go to`() {
        for (c in cases) {
            val p = c["payload"]!!.jsonObject
            val reply = p["buttons"]?.jsonObject?.containsKey(PushNotices.REPLY) == true
            assertEquals(reply, PushNotices.replyTo(p.s("tag")!!) != null, c.s("what"))
        }
        assertEquals(PushNotices.ReplyTo.Bot("b1"), PushNotices.replyTo("bot:b1"))
        assertEquals(PushNotices.ReplyTo.Chief("c1"), PushNotices.replyTo("chief:c1"))
        assertEquals(PushNotices.ReplyTo.Group("g1"), PushNotices.replyTo("group:g1"))
        assertNull(PushNotices.replyTo("needs"))
    }

    @Test fun `every notification with Approve or Decline is a card its answer reaches`() {
        for (c in cases) {
            val p = c["payload"]!!.jsonObject
            val buttons = p["buttons"]?.jsonObject ?: JsonObject(emptyMap())
            val tag = p.s("tag")!!
            if (PushNotices.NO in buttons) assertTrue(PushNotices.answer(tag, false) != null, c.s("what"))
            if (PushNotices.YES in buttons) assertTrue(PushNotices.answer(tag, true) != null, c.s("what"))
        }
    }

    @Test fun `each card's answer goes where its card's does`() {
        assertEquals(PushNotices.Answer.Job("b1", "j1", true), PushNotices.answer("job:b1/j1", true))
        assertEquals(PushNotices.Answer.Ask("a1", false), PushNotices.answer("ask:a1", false))
        assertEquals(PushNotices.Answer.Tile("t1", true), PushNotices.answer("tile:t1", true))
        assertEquals(PushNotices.Answer.Memory("m1", false), PushNotices.answer("memory:m1", false))
        assertEquals(PushNotices.Answer.PlanApproved("c2"), PushNotices.answer("plan:c2", true))
        assertEquals(PushNotices.Answer.PlanDismissed("c2"), PushNotices.answer("plan:c2", false))
        assertNull(PushNotices.answer("ask:batch:r1", true), "a card of several is answered on its card")
        assertNull(PushNotices.answer("login:l1", true))
        assertNull(PushNotices.answer("bot:b1", true))
        assertNull(PushNotices.answer("job:", true))
    }

    @Test fun `the phone registers its token in lower case with its key and environment`() {
        val body = PushNotices.registration("AB12", "k".repeat(43), PushNotices.environment(fromXcode = true), "  iPhone  ")
        assertEquals(mapOf("token" to "ab12", "key" to "k".repeat(43), "environment" to "development", "device" to "iPhone"), body.mapValues { it.value.jsonPrimitive.content })
        assertFalse("device" in PushNotices.registration("ab", "k", PushNotices.environment(fromXcode = false), " "))
        assertEquals("production", PushNotices.environment(fromXcode = false))
    }

    @Test fun `it registers only with a botdot that sends to iPhones`() {
        assertTrue(PushNotices.sendsToPhones(listOf("web-push", "apns-push")))
        assertFalse(PushNotices.sendsToPhones(listOf("web-push")))
        assertFalse(PushNotices.sendsToPhones(null))
    }

    @Test fun aTapOpensAKnownBotsChatWaitsForTheBotsAndLetsGoOfAnUnknownOne() {
        val bots = listOf(Bot(id = "b1", name = "News"))
        assertEquals(PushNotices.Opening.Wait, PushNotices.opening("bot:b1", null, null), "a cold start: the bots aren't read yet")
        assertEquals(PushNotices.Opening.BotChat("b1", "News"), PushNotices.opening("bot:b1", bots, emptyList()))
        assertEquals(PushNotices.Opening.LetGo, PushNotices.opening("bot:gone", bots, emptyList()), "a bot no longer there")
    }

    @Test fun aChiefConversationOpensAtOnceAndAGroupOnceItsGroupIsKnown() {
        val groups = Group.list("""[{"id":"g1","name":"Dev","members":["b1"]}]""")
        assertEquals(PushNotices.Opening.ChiefChat("c7"), PushNotices.opening("chief:c7", null, null))
        assertEquals(PushNotices.Opening.Wait, PushNotices.opening("group:g1", emptyList(), null), "the groups aren't read yet")
        assertEquals(PushNotices.Opening.GroupChat("g1", "Dev"), PushNotices.opening("group:g1", emptyList(), groups))
        assertEquals(PushNotices.Opening.LetGo, PushNotices.opening("group:gone", emptyList(), groups), "a group no longer there")
        assertEquals(PushNotices.Opening.Unasked, PushNotices.opening(null, null, null))
        assertEquals(PushNotices.Opening.LetGo, PushNotices.opening("room:r1", emptyList(), emptyList()))
    }
}
