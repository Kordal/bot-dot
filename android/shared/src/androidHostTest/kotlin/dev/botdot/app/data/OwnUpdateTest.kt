package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import kotlinx.datetime.TimeZone

/**
 * Settings → Updates (#259, ADR 053), against a stand-in front door: shown only where the front door says this account
 * chooses, read field by field, and "Update automatically" and "Update now" sent to the front door's own routes.
 */
class OwnUpdateTest {
    private lateinit var door: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        door = MockWebServer()
        door.start()
        api = Api(door.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = door.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
    private fun obj(s: String) = Api.JSON.parseToJsonElement(s).jsonObject

    private val ready = """{"autoUpdate":false,"asked":false,"canUpdate":true,"ready":{"version":"abc1234","from":"0123456","since":"2026-10-21T10:00:00.000Z","deadline":"2026-10-28T10:00:00.000Z"},"last":null}"""

    @Test fun showsOnlyWhereTheFrontDoorSaysThisAccountChooses() {
        assertTrue(OwnUpdate.on(listOf("accounts"), obj("""{"admin":false,"updates":true}""")))
        assertFalse("the admin's account", OwnUpdate.on(listOf("accounts"), obj("""{"admin":true,"updates":false}""")))
        assertFalse("an older front door", OwnUpdate.on(listOf("accounts"), obj("""{"admin":false}""")))
        assertFalse("no front door", OwnUpdate.on(emptyList(), obj("""{"updates":true}""")))
        assertFalse("not a boolean", OwnUpdate.on(listOf("accounts"), obj("""{"updates":"true"}""")))
    }

    @Test fun readsAVersionThatWaitsAndSaysItsDeadline() = runBlocking {
        door.enqueue(json(ready))
        val u = api.ownUpdate()
        val r = door.takeRequest()
        assertEquals("GET" to "/front-door/update", r.method to r.target)
        assertFalse(u.autoUpdate)
        assertTrue(u.ready && u.canUpdate && !u.moving)
        assertEquals("A new version (abc1234) is ready. Your account moves to it by itself on Wednesday, Oct 28, or now if you choose.", u.text(TimeZone.UTC))
    }

    @Test fun sendsTheSwitchAndUpdateNowToTheFrontDoor() = runBlocking {
        door.enqueue(json(ready.replace("\"autoUpdate\":false", "\"autoUpdate\":true")))
        assertTrue(api.setAutoUpdate(true).autoUpdate)
        var r = door.takeRequest()
        assertEquals("POST" to "/front-door/update", r.method to r.target)
        assertEquals("1", r.headers["X-Bot-Dot"])
        assertEquals("true", Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject["autoUpdate"]!!.jsonPrimitive.content)

        door.enqueue(json("""{"autoUpdate":false,"asked":true,"canUpdate":false,"ready":null,"last":null}""", 202))
        val now = api.updateNow()
        r = door.takeRequest()
        assertEquals("POST" to "/front-door/update/now", r.method to r.target)
        assertTrue(now.moving)
        assertTrue(now.text().startsWith("Moving to the new version"))

        door.enqueue(json("""{"error":"There is no new version to switch to."}""", 409))
        try { api.updateNow(); fail("refused") } catch (e: ApiException) { assertEquals("There is no new version to switch to.", e.message) }
    }

    @Test fun whatTheFrontDoorLeavesOutOrSendsWrongIsLeftOut() {
        val u = OwnUpdate.of(obj("""{"autoUpdate":"no","ready":{"deadline":"never"},"last":{"state":"kept","error":"Its new botdot server didn't start"}}"""))
        assertTrue("on unless it says false", u.autoUpdate)
        assertFalse(u.ready)
        assertNull(u.readyVersion)
        assertEquals("The last move to a new version didn't happen: Its new botdot server didn't start.", u.text())
        assertEquals("nothing waits or moves: the switch's own two lines say it all", "", OwnUpdate.of(obj("{}")).text())
    }

    @Test fun readsWhatAWaitingVersionBrings() = runBlocking {
        door.enqueue(json("""{"entries":[{"id":"2026-10-22-b","title":"Second","points":["One","Two"]},{"id":"","title":"No id","points":["x","y"]}]}"""))
        val notes = api.updateNotes()
        assertEquals("/front-door/update/notes", door.takeRequest().target)
        assertEquals(listOf(WhatsNew.Entry("2026-10-22-b", "Second", listOf("One", "Two"))), notes)
    }

    // The three-way "When" (ADR 271, #1691): drawn only when the answer has `when`, else the switch, unchanged.
    private fun waiting(`when`: String, more: String = "") =
        """{"when":"$`when`","autoUpdate":${`when` != "manual"},"asked":false,"canUpdate":true$more,"ready":{"version":"abc1234","from":"0123456","since":"2026-10-21T10:00:00.000Z","deadline":"2026-10-28T10:00:00.000Z"},"last":null}"""

    @Test fun readsTheWhenAndDrawsTheChoiceOnlyWhereTheAnswerHasIt() {
        assertEquals(listOf("ready", "night", "manual"), listOf("ready", "night", "manual").map { OwnUpdate.of(obj(waiting(it))).updateWhen })
        assertTrue(OwnUpdate.of(obj(waiting("night"))).chooses)
        assertFalse("an older front door", OwnUpdate.of(obj(ready)).chooses)
        assertNull("not one of the three", OwnUpdate.of(obj("""{"when":"sometimes"}""")).updateWhen)
        assertNull("not a text", OwnUpdate.of(obj("""{"when":true}""")).updateWhen)
        assertEquals(listOf("As soon as it's ready", "At night, when idle", "When I say"), OwnUpdate.WHENS.map { it.second })
        assertEquals("At night, when idle", OwnUpdate.of(obj(waiting("night"))).whenName)
        assertEquals("", OwnUpdate.of(obj(ready)).whenName)
    }

    @Test fun saysWhenTheWaitingVersionMovesAndItsDeadline() {
        val z = TimeZone.UTC
        assertEquals("A new version (abc1234) is ready. Your account moves to it as soon as your bots are idle, by Wednesday, Oct 28 at the latest.", OwnUpdate.of(obj(waiting("ready"))).text(z))
        assertEquals("A new version (abc1234) is ready. Your account moves to it at night, when your bots are idle, by Wednesday, Oct 28 at the latest.", OwnUpdate.of(obj(waiting("night"))).text(z))
        assertEquals("A new version (abc1234) is ready. Your account moves to it when you say, or by Wednesday, Oct 28.", OwnUpdate.of(obj(waiting("manual"))).text(z))
        assertTrue("moving is said as before", OwnUpdate.of(obj("""{"when":"night","asked":true}""")).text(z).startsWith("Moving to the new version"))
        assertEquals("nothing waits: the choice says it all", "", OwnUpdate.of(obj("""{"when":"night"}""")).text(z))
    }

    @Test fun sendsTheChoiceToTheFrontDoor() = runBlocking {
        door.enqueue(json(waiting("manual")))
        assertEquals("manual", api.setUpdateWhen("manual").updateWhen)
        val r = door.takeRequest()
        assertEquals("POST" to "/front-door/update", r.method to r.target)
        assertEquals("1", r.headers["X-Bot-Dot"])
        assertEquals("""{"when":"manual"}""", r.body!!.utf8())

        door.enqueue(json("""{"error":"Your account is paused by the admin."}""", 503))
        try { api.setUpdateWhen("ready"); fail("refused") } catch (e: ApiException) { assertEquals("Your account is paused by the admin.", e.message) }
    }

    @Test fun updateNowWarnsThatWorkStopsOnlyWhenTheAnswerSaysBusy() {
        assertTrue(OwnUpdate.of(obj(waiting("manual", ""","busy":true"""))).warnsOnUpdateNow)
        assertFalse(OwnUpdate.of(obj(waiting("manual", ""","busy":false"""))).warnsOnUpdateNow)
        assertTrue("it doesn't say: today's confirm", OwnUpdate.of(obj(waiting("manual"))).warnsOnUpdateNow)
        assertTrue("an older front door", OwnUpdate.of(obj(ready)).warnsOnUpdateNow)
        assertEquals("At night, when idle", AppSettingsState(update = OwnUpdate.of(obj(waiting("night")))).updateValue)
        assertEquals("Automatic", AppSettingsState(update = OwnUpdate.of(obj(ready.replace("false", "true")))).updateValue)
    }
}
