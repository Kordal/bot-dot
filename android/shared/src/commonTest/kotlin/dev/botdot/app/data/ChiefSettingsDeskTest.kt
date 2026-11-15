package dev.botdot.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** The Chief's settings for both phones (ChiefSettingsDesk): what shows from which botdot, the save after the last change, and what acts at once. */
class ChiefSettingsDeskTest {
    private val settings = """{"settings":{"defaultModel":"sonnet","chiefRules":"Be brief","chiefSkills":["deploy"]},"models":[{"id":"sonnet","label":"Sonnet"},{"id":"haiku","label":"Haiku","effort":false}],"efforts":[{"id":"high","label":"High"}]}"""
    private val all = listOf(ChiefName.FEATURE, ChiefSkills.FEATURE, ChiefJobs.FEATURE, Checkup.FEATURE)

    /** Waits (the desk's timer on the test's clock, botdot's answers on real threads) until [done]. */
    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(300) { if (done()) return; advanceTimeBy(50); runCurrent(); withContext(Dispatchers.Default) { delay(5) } }
        fail("never: $what")
    }

    private fun server(refuseName: Boolean = false) = FakeServer { t ->
        when {
            t.path == "/api/settings" && t.method == "GET" -> 200 to settings
            t.path == "/api/settings" -> 200 to """{"settings":${t.body},"models":[{"id":"sonnet","label":"Sonnet"},{"id":"haiku","label":"Haiku","effort":false}]}"""
            t.path == "/api/settings/chief-name" -> if (refuseName) 409 to """{"error":"A bot has that name"}""" else 200 to """{"name":"Max"}"""
            t.path == "/api/skills" -> 200 to """{"library":[{"name":"review"},{"name":"deploy"}]}"""
            t.path == "/api/chief/jobs" -> 200 to """{"jobs":[{"id":"j1","name":"Digest","when":"Every morning","on":true}]}"""
            t.path.startsWith("/api/chief/jobs/") && t.method == "PUT" -> 200 to """{"id":"j1","name":"Digest","when":"Every morning","on":false}"""
            t.path.startsWith("/api/chief/jobs/") -> 200 to "{}"
            t.path == "/api/settings/checkup" && t.method == "GET" -> 200 to """{"checkup":{"on":true,"webSearch":false,"when":"Weekdays at 08:00"}}"""
            t.path == "/api/settings/checkup" -> 500 to """{"error":"No"}"""
            else -> 200 to "{}"
        }
    }

    @Test fun whatShowsAndASaveAMomentAfterTheLastChange() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = all))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        with(desk.state.value) {
            assertEquals("", name, "the role's name: an empty field")
            assertEquals("Be brief", rules)
            assertEquals(listOf("deploy", "review"), skills?.map { it.name }, "the ones it has first")
            assertEquals("Digest", jobs?.single()?.name)
            assertEquals("Weekdays at 08:00", checkup?.caption)
            assertNull(pages, "no chief-pages: no section")
            assertEquals(listOf("", "sonnet", "haiku"), models.map { it.id })
        }
        desk.setRules("Be very brief")
        desk.setName("Max")
        desk.setSkill("review", true)
        advanceTimeBy(ChiefSettingsDesk.SAVE_MS - 100); runCurrent()
        assertTrue(s.posts().isEmpty(), "not before a moment has passed")
        until("saved") { desk.state.value.savedAt == 2 }
        val sent = s.posts().map { it.path }
        assertEquals(listOf("/api/settings/chief-name", "/api/settings"), sent, "the name, then the rest, once")
        assertTrue("\"chiefRules\":\"Be very brief\"" in s.posts().last().body && "review" in s.posts().last().body)
        desk.setModel("haiku")
        assertEquals(false, desk.state.value.thinks, "a model that doesn't reason: no Reasoning")
    }

    @Test fun aRefusedNameIsPutBackAndARefusedSwitchToo() = runTest {
        val s = server(refuseName = true)
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = all))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        desk.setName("Ada")
        until("put back") { desk.state.value.name == "" }
        assertEquals("A bot has that name", desk.state.value.notice)
        desk.setCheckup("webSearch", true)
        assertEquals(false, desk.state.value.checkup?.webSearch, "refused: back as it was")
        desk.setJobOn("j1", false)
        assertEquals(false, desk.state.value.jobs?.single()?.on)
        desk.removeJob("j1")
        assertTrue(desk.state.value.jobs.orEmpty().isEmpty())
        assertEquals("Removed.", desk.state.value.notice)
    }
    @Test fun featuresThatComeAfterTheSettingsOpenedBringTheirSections() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        with(desk.state.value) { assertNull(name); assertNull(skills); assertNull(jobs); assertNull(checkup) }
        store.version.set(VersionInfo(features = all))
        until("the sections") { desk.state.value.jobs != null && desk.state.value.checkup != null }
        with(desk.state.value) {
            assertEquals("", name)
            assertEquals(listOf("deploy", "review"), skills?.map { it.name })
            assertEquals("Digest", jobs?.single()?.name)
        }
        desk.close()
    }

    @Test fun aRenameFromElsewhereTakesTheFieldUnlessANameTypedHereWaits() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = all))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        store.handle(FeedEvent(null, "chief_name", kotlinx.serialization.json.buildJsonObject { put("name", "Max") }))
        until("the field follows") { desk.state.value.name == "Max" }
        advanceTimeBy(ChiefSettingsDesk.SAVE_MS + 1); runCurrent()
        assertTrue(s.posts().none { it.path == "/api/settings/chief-name" }, "a rename from elsewhere sends no rename")
        desk.setName("Ada")
        store.handle(FeedEvent(null, "chief_name", kotlinx.serialization.json.buildJsonObject { put("name", "Zed") }))
        runCurrent()
        assertEquals("Ada", desk.state.value.name, "a name typed here waits to be saved: it stays")
        desk.close()
    }
}
