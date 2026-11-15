package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.io.Buffer
import kotlinx.io.writeString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A project's setup as both phones draw it (CompanySetupDesk, #1366): the start screen, the conversation with the Chief
 * before the first step, the review of that step and its team, and Delete, against a fake botdot.
 */
class CompanySetupDeskTest {
    private data class Asked(val method: String, val path: String, val query: String, val body: String)

    private class FakeBotdot(answer: suspend (Asked) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Asked>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val asked = Asked(req.method.value, req.url.encodedPath.removePrefix("/api"), req.url.encodedQuery, (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += asked }
            val (status, body) = answer(asked)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<Asked> = lock.withLock { took.toList() }
    }

    private val talks = listOf(CompanySetup.FEATURE, CompanySetupDesk.CONVERSATION, ProjectStarter.FEATURE)

    private val talking = """{"id":"p1","name":"Kitchen","phase":"setup","start":"A kitchen app","conversation":true,"creationSent":true,"chiefChat":"c1"}"""
    private val proposed = """{"id":"p1","name":"Kitchen","phase":"setup","start":"A kitchen app","conversation":true,"creationSent":true,"chiefChat":"c1",
        "firstStep":"Draft the menu","creationReview":"r1","never":["Pay","Post"],"facts":3,
        "starter":{"goals":[{"key":"g1","name":"Menu","target":10,"on":true}],"cards":[{"key":"k1","ask":"Orders","on":true}]},
        "proposal":[{"key":"a","name":"Ada","description":"Writes the menu","color":"#7f77dd"},{"key":"b","name":"Bo","description":"Checks prices"}]}"""

    private fun TestScope.desk(fake: FakeBotdot, features: List<String> = talks, c: String? = null): Pair<Store, CompanySetupDesk> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = features))
        store.bots.set(emptyList())
        store.company.set(CompanyHeld(c?.let(CompanySetup::of)))
        return store to CompanySetupDesk(store, fake.api, backgroundScope)
    }

    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(400) {
            if (done()) return
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    private fun file(name: String, text: String) = OutgoingFile(name, text.length.toLong()) { Buffer().apply { writeString(text) } }

    @Test fun theStartScreenMakesTheProjectToTalkOverWithTheChief() = runTest {
        val fake = FakeBotdot { a -> if (a.method == "POST" && a.path == "/company") 200 to talking else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        assertEquals(SetupPhase.START, desk.state.value.phase)
        assertFalse(desk.state.value.scratch, "with the conversation there is no Start from scratch")
        assertTrue(desk.addLink("https://kitchen.example"))
        assertTrue(desk.go("  A   kitchen app "))
        until("the conversation opens") { desk.state.value.phase == SetupPhase.CONVERSATION }
        val body = Api.JSON.parseToJsonElement(fake.asked().single { it.method == "POST" }.body).jsonObject
        assertEquals("A kitchen app", body.getValue("start").jsonPrimitive.content)
        assertEquals("true", body.getValue("conversation").jsonPrimitive.content)
        assertTrue(body.getValue("key").jsonPrimitive.content.length >= 8)
        assertTrue(desk.state.value.sources.isEmpty(), "the sources went with it")
        assertEquals("c1", desk.chiefChat(), "its Chief chat, already made")
    }

    @Test fun aGoThatFailedIsSentAgainWithTheSameKeyAndAChangedOneWithANewOne() = runTest {
        var refuse = true
        val fake = FakeBotdot { a -> if (a.method == "POST" && a.path == "/company") { if (refuse) 502 to "" else 200 to talking } else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.go("A kitchen app"))
        assertFalse(desk.go("A kitchen app"))
        refuse = false
        assertTrue(desk.go("A kitchen app, fast"))
        val keys = fake.asked().filter { it.method == "POST" }.map { Api.JSON.parseToJsonElement(it.body).jsonObject.getValue("key").jsonPrimitive.content }
        assertEquals(keys[0], keys[1], "the same words again: the same key, so botdot makes one project")
        assertNotEquals(keys[1], keys[2], "other words: another key")
    }

    @Test fun aFileUploadingOrFailedHoldsGo() = runTest {
        val held = CompletableDeferred<Unit>()
        val fake = FakeBotdot { a -> if (a.path.startsWith("/uploads")) { held.await(); 500 to """{"error":"Too big."}""" } else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        desk.addFile(file("menu.pdf", "x"))
        until("it uploads") { desk.state.value.sources.singleOrNull()?.uploading == true }
        assertFalse(desk.go("A kitchen app"))
        until("it says why") { desk.state.value.notice == "Wait for the files to finish uploading." }
        held.complete(Unit)
        until("it failed") { desk.state.value.sources.single().failed }
        assertFalse(desk.go("A kitchen app"))
        until("it says why") { desk.state.value.notice == "Remove failed files or add them again." }
        desk.removeSource(desk.state.value.sources.single().id)
        assertTrue(fake.asked().none { it.path == "/company" }, "nothing was made")
    }

    @Test fun twoGoTapsAtOnceMakeOneProject() = runTest {
        repeat(20) { round ->
            val held = CompletableDeferred<Unit>()
            val fake = FakeBotdot { a -> if (a.method == "POST" && a.path == "/company") { held.await(); 200 to talking } else 200 to "{}" }
            val (_, desk) = desk(fake)
            runCurrent()
            val taps = List(2) { async(Dispatchers.Default) { desk.go("A kitchen app") } }
            withContext(Dispatchers.Default) { while (fake.asked().none { it.path == "/company" }) delay(1); delay(20) }
            held.complete(Unit)
            assertEquals(1, taps.awaitAll().count { it }, "round $round: one tap goes")
            assertEquals(1, fake.asked().count { it.method == "POST" && it.path == "/company" }, "round $round: one project")
        }
    }

    @Test fun theReviewShowsTheFirstStepAndItsTeamAndApprovingStartsIt() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/company/start" -> 200 to proposed.replace("\"phase\":\"setup\"", "\"phase\":\"running\"")
                else -> 200 to "{}"
            }
        }
        val (_, desk) = desk(fake, c = proposed)
        runCurrent()
        val s = desk.state.value
        assertEquals(SetupPhase.CONVERSATION, s.phase)
        assertTrue(s.review)
        desk.review()
        until("the review") { desk.state.value.phase == SetupPhase.REVIEW }
        val r = desk.state.value
        assertEquals(SetupPhase.REVIEW, r.phase)
        assertEquals("Draft the menu", r.firstStep)
        assertEquals(listOf("Ada", "Bo"), r.proposed.map { it.name })
        assertEquals(listOf("Menu · 10", "Orders"), r.starter.map { it.label })
        assertEquals("Approve first step", r.approve)
        assertTrue(r.approveOn)
        assertTrue(desk.approve())
        assertEquals("""{"review":"r1"}""", fake.asked().single { it.path == "/company/start" }.body, "the proposal reviewed")
        until("it runs") { desk.state.value.phase == SetupPhase.RUNNING }
    }

    @Test fun anEditOnItsWayHoldsApproveAndARefusalGoesBackToTheReview() = runTest {
        val held = CompletableDeferred<Unit>()
        val fake = FakeBotdot { a ->
            when {
                a.method == "PATCH" -> { held.await(); 200 to proposed }
                a.path == "/company/start" -> 409 to """{"error":"The proposal changed."}"""
                else -> 200 to "{}"
            }
        }
        val (store, desk) = desk(fake, c = proposed)
        runCurrent()
        desk.review()
        desk.rename("a", " Ada Lovelace ")
        until("drawn at once") { desk.state.value.proposed.first().name == "Ada Lovelace" }
        until("an edit on its way: Approve is off") { !desk.state.value.approveOn }
        assertFalse(desk.approve())
        held.complete(Unit)
        until("saved") { desk.state.value.approveOn }
        assertTrue(Api.JSON.parseToJsonElement(fake.asked().single { it.method == "PATCH" }.body).toString().contains("Ada Lovelace"))
        assertFalse(desk.approve())
        until("refused: back on the review, saying why") { desk.state.value.phase == SetupPhase.REVIEW && desk.state.value.notice == "The proposal changed." }
        assertEquals("p1", store.company.value.value?.company?.id)
    }

    @Test fun deleteAsksWhetherTheFolderGoesAndTheStartScreenFollows() = runTest {
        val fake = FakeBotdot { 200 to "{}" }
        val (_, desk) = desk(fake, c = talking.replace("\"chiefChat\":\"c1\"", "\"chiefChat\":\"c1\",\"folder\":{\"name\":\"kitchen\",\"path\":\"/home/p/kitchen\"}"))
        runCurrent()
        assertTrue(desk.state.value.folder)
        assertTrue(desk.delete(dropFolder = true))
        val d = fake.asked().single { it.method == "DELETE" }
        assertTrue(d.path.startsWith("/company"))
        until("the start screen") { desk.state.value.phase == SetupPhase.START }
    }
}
