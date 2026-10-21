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
import java.time.ZoneOffset

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
        assertEquals("A new version (abc1234) is ready. Your account moves to it by itself on Tuesday, Oct 28, or now if you choose.", u.text(ZoneOffset.UTC))
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
        assertEquals("Your account moves to each new version when the admin updates botdot.", OwnUpdate.of(obj("{}")).text())
    }
}
