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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** The Chief's settings for both phones (ChiefSettingsDesk): what shows from which botdot, the save after the last change, and what acts at once. */
class ChiefSettingsDeskTest {
    private val settings = """{"settings":{"defaultModel":"sonnet","chiefRules":"Be brief","chiefSkills":["deploy"]},"models":[{"id":"sonnet","label":"Sonnet"},{"id":"haiku","label":"Haiku","effort":false}],"efforts":[{"id":"high","label":"High"}]}"""
    private val all = listOf(ChiefName.FEATURE, ChiefSkills.FEATURE, ChiefJobs.FEATURE)

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

    @Test fun aRefusedNameIsPutBack() = runTest {
        val s = server(refuseName = true)
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = all))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        desk.setName("Ada")
        until("put back") { desk.state.value.name == "" }
        assertEquals("A bot has that name", desk.state.value.notice)
        desk.setJobOn("j1", false)
        assertEquals(false, desk.state.value.jobs?.single()?.on)
        desk.removeJob("j1")
        assertTrue(desk.state.value.jobs.orEmpty().isEmpty())
        assertEquals("Removed.", desk.state.value.notice)
    }
    @Test fun aBotdotThatStillAnnouncesTheCheckupHasNoSwitchesForItAndIsNotAskedAboutIt() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = all + "checkup"))
        val events = MutableSharedFlow<FeedEvent>(extraBufferCapacity = 4)
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, events)
        desk.load()
        runCurrent()
        events.emit(FeedEvent(null, "checkup", Api.JSON.parseToJsonElement("""{"on":false,"webSearch":false,"when":"Mondays"}""") as kotlinx.serialization.json.JsonObject))
        runCurrent()
        assertEquals("Digest", desk.state.value.jobs?.single()?.name, "the rest shows as before")
        assertTrue(s.sent().none { "checkup" in it.path }, "the checkup is asked for and changed nowhere: the server runs it always")
        desk.close()
    }

    @Test fun itsFilesOpenInFilesFromABotdotThatHasBoth() = runTest {
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = ChiefSettingsDesk(backgroundScope, server().api, store, MutableSharedFlow())
        desk.load()
        assertFalse(desk.state.value.files, "features not known yet")
        store.version.set(VersionInfo(features = all + UploadedFiles.CHIEF_FEATURE))
        until("Files only with files-explorer too") { desk.state.value.loaded }
        assertFalse(desk.state.value.files)
        store.version.set(VersionInfo(features = all + UploadedFiles.CHIEF_FEATURE + FilesExplorer.FEATURE))
        until("its files") { desk.state.value.files }
        desk.close()
    }

    @Test fun featuresThatComeAfterTheSettingsOpenedBringTheirSections() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        with(desk.state.value) { assertNull(name); assertNull(skills); assertNull(jobs) }
        store.version.set(VersionInfo(features = all))
        until("the sections") { desk.state.value.jobs != null }
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
    @Test fun anEditWhileARenameIsOnItsWayDoesNotLoseTheRename() = runTest {
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        val s = FakeServer { t ->
            if (t.path == "/api/settings/chief-name") { gate.await(); 200 to """{"name":"Max"}""" }
            else if (t.path == "/api/settings" && t.method == "PUT") 200 to """{"settings":${t.body},"models":[]}"""
            else if (t.path == "/api/settings") 200 to settings
            else 200 to "{}"
        }
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = listOf(ChiefName.FEATURE)))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        desk.setName("Max")
        advanceTimeBy(ChiefSettingsDesk.SAVE_MS + 1); runCurrent()
        until("the rename is on its way") { s.posts().any { it.path == "/api/settings/chief-name" } }
        desk.setRules("Typed meanwhile")
        gate.complete(Unit)
        until("both saved") { s.posts().any { it.path == "/api/settings" && "Typed meanwhile" in it.body } }
        assertEquals("Max", desk.state.value.name, "the field keeps the saved name")
        assertEquals(1, s.posts().count { it.path == "/api/settings/chief-name" }, "the rename went once, and was not cancelled")
        desk.close()
    }
    /** A botdot whose actions can be refused ([fail]): grants, jobs and pages, with what the desk asked. */
    private class Actions(var fail: Boolean = false) {
        var pagesRead = 0
        val server = FakeServer { t ->
            when {
                t.path == "/api/settings" && t.method == "GET" -> 200 to """{"settings":{"chiefRules":"Be brief"}}"""
                t.path == "/api/settings" -> 200 to """{"settings":${t.body}}"""
                t.path == "/api/chief/connector-actions" && t.method == "GET" -> 200 to """{"grants":[{"action":"send","label":"Send mail"},{"action":"post","label":"Post"}]}"""
                t.path == "/api/chief/connector-actions" -> if (fail) 500 to """{"error":"Not now"}""" else 200 to """{"grants":[{"action":"post","label":"Post"}]}"""
                t.path == "/api/chief/jobs" -> 200 to """{"jobs":[{"id":"j1","name":"Digest","when":"Every morning","on":true},{"id":"j2","name":"Backup","when":"Sundays","on":true}]}"""
                t.path.startsWith("/api/chief/jobs/") && t.method == "PUT" -> if (fail) 500 to """{"error":"Not now"}""" else 200 to """{"id":"j1","name":"Digest","when":"Every morning","on":false}"""
                t.path.startsWith("/api/chief/jobs/") -> if (fail) 500 to """{"error":"Not now"}""" else 200 to "{}"
                t.path == "/api/bots/chief/pages" -> { pagesRead++; 200 to """{"pages":[{"slug":"p$pagesRead","title":"Page $pagesRead"}]}""" }
                else -> 200 to "{}"
            }
        }
    }

    private fun TestScope.actionDesk(a: Actions, events: MutableSharedFlow<FeedEvent> = MutableSharedFlow()): ChiefSettingsDesk {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = listOf(ChiefJobs.FEATURE, ChiefGrant.Kind.APP.feature, Pages.FEATURE, DocumentView.FEATURE, Pages.FEATURE_CHIEF)))
        return ChiefSettingsDesk(backgroundScope, a.server.api, store, events)
    }

    @Test fun revokeTakesTheGrantOffAndSaysSoOrWhyNot() = runTest {
        val a = Actions()
        val desk = actionDesk(a)
        desk.load()
        val send = desk.state.value.grants.first { it.id == "send" }
        desk.revoke(send)
        assertEquals(listOf("post"), desk.state.value.grants.map { it.id })
        assertEquals(ChiefGrant.REVOKED, desk.state.value.notice)
        a.fail = true
        desk.revoke(desk.state.value.grants.single())
        assertEquals(listOf("post"), desk.state.value.grants.map { it.id }, "refused: it stays")
        assertEquals("Not now", desk.state.value.notice)
        desk.close()
    }

    @Test fun aJobsSwitchAndRemoveActAtOnceOrSayWhyNot() = runTest {
        val a = Actions()
        val desk = actionDesk(a)
        desk.load()
        desk.setJobOn("j1", false)
        assertEquals(listOf(false, true), desk.state.value.jobs?.map { it.on })
        desk.removeJob("j2")
        assertEquals(listOf("j1"), desk.state.value.jobs?.map { it.id })
        assertEquals("Removed.", desk.state.value.notice)
        a.fail = true
        desk.setJobOn("j1", true)
        assertEquals(false, desk.state.value.jobs?.single()?.on, "refused: as it was")
        assertEquals("Not now", desk.state.value.notice)
        desk.removeJob("j1")
        assertEquals(listOf("j1"), desk.state.value.jobs?.map { it.id }, "refused: it stays")
        desk.close()
    }

    @Test fun theFeedsJobsAreFollowedUntilItCloses() = runTest {
        val events = MutableSharedFlow<FeedEvent>(extraBufferCapacity = 4)
        val desk = actionDesk(Actions(), events)
        desk.load()
        runCurrent()
        events.emit(FeedEvent(null, "chief_jobs", Api.JSON.parseToJsonElement("""{"jobs":[{"id":"j9","name":"New","when":"Daily","on":true}]}""") as kotlinx.serialization.json.JsonObject))
        runCurrent()
        assertEquals(listOf("j9"), desk.state.value.jobs?.map { it.id })
        desk.close()
        runCurrent()
        events.emit(FeedEvent(null, "chief_jobs", Api.JSON.parseToJsonElement("""{"jobs":[]}""") as kotlinx.serialization.json.JsonObject))
        runCurrent()
        assertEquals(listOf("j9"), desk.state.value.jobs?.map { it.id }, "closed: it follows the feed no more")
    }

    @Test fun pagesAgainReadsItsPagesAgain() = runTest {
        val a = Actions()
        val desk = actionDesk(a)
        desk.load()
        val first = desk.state.value.pages?.single()?.title
        desk.pagesAgain()
        assertTrue(desk.state.value.pages?.single()?.title != first, "read again")
        desk.close()
    }

    @Test fun readAgainAnEditNotSavedYetStays() = runTest {
        val desk = actionDesk(Actions())
        desk.load()
        desk.setRules("Typed, not saved yet")
        desk.load() // back from a page: read again
        assertEquals("Typed, not saved yet", desk.state.value.rules)
        desk.close()
    }
    @Test fun aFailedFirstReadSavesNothingAndTryAgainReadsIt() = runTest {
        var down = true
        val s = FakeServer { t ->
            when {
                t.path == "/api/settings" && t.method == "GET" -> if (down) 503 to """{"error":"botdot is restarting"}""" else 200 to settings
                t.path == "/api/settings" -> 200 to """{"settings":${t.body}}"""
                else -> 200 to "{}"
            }
        }
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        assertTrue(desk.state.value.failed)
        assertFalse(desk.state.value.loaded, "nothing to edit")
        desk.setRules("Typed anyway")
        advanceTimeBy(ChiefSettingsDesk.SAVE_MS + 1); runCurrent()
        withContext(Dispatchers.Default) { delay(50) }
        assertTrue(s.posts().isEmpty(), "blank defaults are never sent over the Chief's own")
        down = false
        desk.load() // Try again
        assertTrue(desk.state.value.loaded)
        assertFalse(desk.state.value.failed)
        assertEquals("Be brief", desk.state.value.rules)
        desk.close()
    }

    @Test fun closeSavesAChangeThatWaitedItsMomentAtOnce() = runTest {
        val s = server()
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = ChiefSettingsDesk(backgroundScope, s.api, store, MutableSharedFlow())
        desk.load()
        desk.setRules("Left at once")
        desk.close()
        until("saved at once") { s.posts().any { it.path == "/api/settings" && "Left at once" in it.body } }
        assertEquals(1, s.posts().count { it.path == "/api/settings" })
        advanceTimeBy(ChiefSettingsDesk.SAVE_MS + 1); runCurrent()
        assertEquals(1, s.posts().count { it.path == "/api/settings" }, "once")
    }
}
