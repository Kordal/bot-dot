package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What Milestone 6 adds to an ask, a waiting job, a waiting tile and a run (docs/api.md, "What follows a yes"), read
 * as the app reads `GET /api/asks`: each field present, absent and of a kind this app does not expect. A field it
 * cannot read leaves today's card, and never loses the asks that came with it.
 */
class AskFieldsTest {
    private fun asks(json: String): List<Ask> = Ask.list(json)
    private fun event(id: String, type: String, data: String) = FeedEvent(id, type, Json.parseToJsonElement(data).jsonObject)

    private val news = """{"id":"news","name":"News Watcher","color":"#e0703a"}"""
    private val mail = """{"id":"mail","name":"Mail Writer","color":"#9b59d0"}"""
    private val here = "The Chief carries on in this chat when you allow it."
    private val inChat = "The Chief carries on in “Morning tech news” when you allow it."
    // A changed bot that the Chief asked for, as OK-002's contract hands it out.
    private val change = """{"id":"a1","kind":"bot-change","botId":"news","bot":$news,"reason":"The Chief set it up for you","at":"2026-10-05T09:00:00.000Z",
        "by":"chief","chatId":"c1","title":"Change News Watcher: web access, new main assignment?","details":"allowedTools: +WebSearch",
        "parts":[{"label":"Web access","now":"allowed"},{"label":"Main assignment","was":"Read the tech news.","now":"Read the tech news and send the three best stories."}],
        "then":{"who":"chief","chatId":"c1","text":"$inChat","here":"$here"},"yesOn":"card"}"""
    // An action in a connected app whose run waits, as OK-003's contract hands it out.
    private val email = """{"id":"a2","kind":"connector-action","botId":"mail","bot":$mail,"reason":"","at":"2026-10-05T13:42:00.000Z",
        "title":"Send email with Gmail?","details":"Allow once applies only while this run is active.\n\n{\n  \"recipient_email\": \"anna@example.com\"\n}",
        "rows":[{"label":"To","value":"anna@example.com"},{"label":"Subject","value":""},{"label":"Text","value":"Hi Anna, I'll be 20 minutes late."},{"label":"Attempts","value":3}],
        "held":true,"yesOn":"card"}"""
    private val permission = """{"id":"a3","kind":"permission","botId":"news","bot":$news,"permission":"Bash","what":{"label":"run commands","hint":"run commands in its own workspace"},"reason":"To read the log",
        "then":{"who":"bot","text":"It carries on with “Check why the backup failed last night.” when you allow it."}}"""

    @Test fun everyNewFieldIsReadWhenItIsThere() {
        val (c, e, p) = asks("[$change,$email,$permission]")
        assertTrue(c.byChief)
        assertEquals("Change News Watcher: web access, new main assignment?", c.title)
        assertEquals(
            listOf(ChangedPart("Web access", null, "allowed"), ChangedPart("Main assignment", "Read the tech news.", "Read the tech news and send the three best stories.")),
            c.parts,
        )
        assertEquals(Then(inChat, "c1", here), c.then)

        assertEquals("Send email with Gmail?", e.title)
        // The rows in the server's order; a value can be empty (no subject) or a number.
        assertEquals(listOf("To" to "anna@example.com", "Subject" to "", "Text" to "Hi Anna, I'll be 20 minutes late.", "Attempts" to "3"), e.rows.map { it.label to it.value })
        assertEquals(true, e.held)
        assertNull(e.stoppedAt)
        assertNull("a held action says nothing of what follows: its own run goes on", e.then)

        assertEquals(Then("It carries on with “Check why the backup failed last night.” when you allow it."), p.then)
        assertFalse(p.byChief)
    }

    @Test fun aChangedBotSaysWhatItsYesButtonReads() {
        // A change whose parts only give permissions: `yes` is "Allow" (OK-007); any other change has none.
        fun yes(more: String) = asks("[${change.replace("\"yesOn\":\"card\"", "\"yesOn\":\"card\"$more")}]").single().yes
        assertEquals("Allow", yes(",\"yes\":\"Allow\""))
        assertEquals("without the blanks around it", "Allow", yes(",\"yes\":\" Allow \""))
        assertNull(yes(""))
        // A `yes` that is no word leaves the app's own "Approve", and the ask is still read.
        for (odd in listOf("true", "1", "null", "\"\"", "\"  \"", "[\"Allow\"]", "{\"text\":\"Allow\"}")) assertNull(odd, yes(",\"yes\":$odd"))
    }

    @Test fun anActionSaysWhenItIsTooLongAndWhereARowWasClipped() {
        // `more` beside the rows: the action is too long to show in full (OK-008). Read like every new field: only `true` says it.
        fun long(more: String) = asks("[${email.replace("\"held\":true", "\"held\":true$more")}]").single()
        assertFalse(long("").tooLong)
        assertTrue(long(",\"more\":true").tooLong)
        assertFalse("no row was clipped", long(",\"more\":true").rowsCut)
        assertEquals("the rows are still read", 4, long(",\"more\":true").rows.size)
        for (odd in listOf("false", "\"true\"", "1", "null", "{}", "[true]")) assertFalse(odd, long(",\"more\":$odd").tooLong)
        // `more` on a row: its value was clipped, as the feed's short form marks it.
        val row = asks("""[{"id":"a1","kind":"connector-action","rows":[{"label":"To","value":"anna@example.com"},{"label":"Text","value":"Hi…","more":true}]}]""").single()
        assertTrue(row.rowsCut)
        assertFalse(row.tooLong)
        assertEquals(listOf("To" to "anna@example.com", "Text" to "Hi…"), row.rows.map { it.label to it.value })
        val odd = asks("""[{"id":"a1","kind":"connector-action","rows":"To: anna","more":7}]""").single()
        assertFalse(odd.rowsCut || odd.tooLong)
    }

    @Test fun anActionThatStoppedWaitingSaysWhenAndWhatFollows() {
        val late = asks("[${email.replace("\"held\":true", "\"held\":false,\"stoppedAt\":\"2026-10-05T13:52:00.000Z\",\"then\":{\"who\":\"bot\",\"text\":\"It carries on when you allow it.\"}")}]").single()
        assertEquals(false, late.held)
        assertEquals("2026-10-05T13:52:00.000Z", late.stoppedAt)
        assertEquals("It carries on when you allow it.", late.then?.line())
    }

    @Test fun anAskFromAServerWithoutTheFieldsIsTodays() {
        // As a botdot server without `ask-continues` and `connector-waits` hands them out.
        val old = asks("""[{"id":"a1","kind":"bot-change","bot":$news,"reason":"asked by the Chief","title":"Change News Watcher","details":"allowedTools: +WebSearch"},
            {"id":"a2","kind":"connector-action","bot":$mail,"title":"Allow gmail: gmail send email?","details":"Allow once applies only while this run is active."},
            {"id":"a3","kind":"permission","bot":$news,"permission":"Bash","what":{"label":"run commands","hint":"run commands"}}]""")
        assertEquals(3, old.size)
        for (a in old) {
            assertNull(a.id, a.then)
            assertFalse(a.id, a.byChief)
            assertEquals(a.id, emptyList<ChangedPart>(), a.parts)
            assertEquals(a.id, emptyList<ToolCard.Fact>(), a.rows)
            assertNull(a.id, a.held)
            assertNull(a.id, a.stoppedAt)
            assertNull(a.id, a.yes)
            assertFalse(a.id, a.rowsCut)
        }
        assertEquals("Change News Watcher" to "allowedTools: +WebSearch", old[0].title to old[0].details)
    }

    @Test fun aFieldOfAnUnexpectedKindLeavesTodaysCardAndEveryAsk() {
        // Each new field as something this app does not expect, on an ask between two that are as they should be.
        val odd = listOf(
            """"then":"it carries on"""", """"then":{"text":5}""", """"then":{"who":"bot"}""", """"then":["x"]""", """"then":null""",
            """"by":3""", """"by":{"who":"chief"}""", """"chatId":{"id":"c1"}""",
            """"parts":"web access"""", """"parts":{"label":"Web access"}""", """"parts":[]""",
            """"rows":{"To":"anna@example.com"}""", """"rows":"To: anna"""", """"rows":7""",
            """"held":"true"""", """"held":1""", """"held":{}""", """"stoppedAt":1759672320000""", """"stoppedAt":[]""",
            """"title":5""", """"title":{"en":"Change News Watcher"}""", """"title":["Change"]""", """"title":null""",
            """"yes":7""", """"yes":{"text":"Allow"}""", """"yes":null""", """"more":"true"""", """"more":{"rows":3}""", """"more":null""",
        )
        for (field in odd) {
            val read = asks("""[$permission,{"id":"odd","kind":"bot-change","bot":$news,"details":"allowedTools: +WebSearch",$field},$email]""")
            assertEquals(field, listOf("a3", "odd", "a2"), read.map { it.id })
            val a = read[1]
            assertNull(field, a.then)
            assertFalse(field, a.byChief)
            assertEquals(field, emptyList<ChangedPart>(), a.parts)
            assertEquals(field, emptyList<ToolCard.Fact>(), a.rows)
            assertNull(field, a.held)
            assertNull(field, a.stoppedAt)
            assertEquals(field, "", a.title) // a title is drawn only as the text the server wrote
            assertNull(field, a.yes)
            assertFalse(field, a.rowsCut)
            assertEquals(field, "allowedTools: +WebSearch", a.details) // what the card then shows
            // The asks around it are whole.
            assertEquals(field, 4, read[2].rows.size)
            assertEquals(field, "It carries on with “Check why the backup failed last night.” when you allow it.", read[0].then?.text)
        }
    }

    @Test fun aListWithOneEntryThisAppCannotReadIsNotShownInPart() {
        // The owner approves what the card shows: with a part or a row missing, it would show less. So `details`.
        fun parts(json: String) = asks("""[{"id":"a1","kind":"bot-change","details":"all of it","parts":$json}]""").single().parts
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Web access","now":"allowed"},"and its own computer"]"""))
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Web access","now":"allowed"},{"label":{"en":"Rules"},"now":[]}]"""))
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Web access","now":"allowed"},{}]"""))
        // What a field becomes is text: a list, a yes or an object would be drawn as nothing, under a title that asks for a yes.
        for (now in listOf("""["Gmail"]""", "true", """{"apps":["Gmail"]}""", "null")) {
            assertEquals(now, emptyList<ChangedPart>(), parts("""[{"label":"Web access","now":"allowed"},{"label":"Apps","now":$now}]"""))
        }
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Apps"}]"""))
        assertEquals(emptyList<ChangedPart>(), parts("""[{"now":"allowed"}]"""))
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Rules","was":7,"now":"Never post anywhere."}]"""))
        assertEquals(emptyList<ChangedPart>(), parts("""[{"label":"Rules","was":"Never post.","now":{"text":"Post daily."}}]"""))
        // A text that was empty before, or is empty now, has `was` all the same; `was: null` is a part without one.
        assertEquals(listOf(ChangedPart("Rules", "", "Never post anywhere.")), parts("""[{"label":"Rules","was":"","now":"Never post anywhere."}]"""))
        assertEquals(listOf(ChangedPart("Rules", "Never post anywhere.", "")), parts("""[{"label":"Rules","was":"Never post anywhere.","now":""}]"""))
        assertEquals(listOf(ChangedPart("Web access", null, "allowed")), parts("""[{"label":"Web access","was":null,"now":"allowed"}]"""))

        fun rows(json: String) = asks("""[{"id":"a1","kind":"connector-action","details":"all of it","rows":$json}]""").single().rows
        assertEquals(emptyList<ToolCard.Fact>(), rows("""[{"label":"To","value":"anna@example.com"},["Subject","Late"]]"""))
        assertEquals(emptyList<ToolCard.Fact>(), rows("""[{"label":"To","value":"anna@example.com"},{"label":"Cc","value":["a","b"]}]"""))
        assertEquals(emptyList<ToolCard.Fact>(), rows("""[{"label":"To","value":"anna@example.com"},{"value":"no label"}]"""))
        assertEquals(emptyList<ToolCard.Fact>(), rows("""[{"label":"To"}]"""))
    }

    @Test fun anAskOfAnUnknownKindIsReadWithItsFields() {
        val a = asks("""[{"id":"x1","kind":"something-new","bot":$news,"title":"Something new?","then":{"who":"bot","text":"It carries on when you allow it."}},$permission]""")
        assertEquals(listOf("something-new", "permission"), a.map { it.kind })
        assertEquals("It carries on when you allow it.", a[0].then?.line())
        assertTrue(a[0].standsInChat("news"))
        assertFalse(a[0].standsInChat("chief"))
    }

    @Test fun anAskThisAppCannotReadAtAllIsLeftOutAndTheOthersStay() {
        // A field from before this milestone of a kind the app cannot take: that ask alone is missing.
        val read = asks("""[$permission,{"id":"bad","kind":"bot-change","reason":{"en":"Because"}},{"kind":"permission"},"not an ask",$email]""")
        assertEquals(listOf("a3", "a2"), read.map { it.id })
        assertEquals(emptyList<Ask>(), asks("[]"))
    }

    @Test fun aWaitingTileSaysWhatFollows() {
        val d = Api.JSON.decodeFromString<Dashboard>("""{"pending":[
            {"id":"t1","title":"Disk space","changedBy":"chief","then":{"who":"chief","chatId":"c1","text":"$inChat","here":"$here"}},
            {"id":"t2","title":"Lights","changedBy":"bot"},
            {"id":"t3","title":"Odd","then":"soon"}]}""")
        assertEquals(listOf(Then(inChat, "c1", here), null, null), d.pending.map { it.then })
    }

    @Test fun aWaitingJobSaysWhatFollowsOnTheFeed() {
        // The feed's `approvals`: the bots' own jobs, which the cards are drawn from, do not carry `then`.
        val approvals = """{"jobs":[
            {"botId":"news","botName":"News Watcher","jobId":"j1","jobName":"Morning news","kind":"script","text":"Waits to run a script","yesOn":"card","then":{"who":"chief","chatId":"c1","text":"$inChat","here":"$here"}},
            {"botId":"news","jobId":"j2","jobName":"Evening news","kind":"ai"},
            {"botId":"mail","jobId":"j1","jobName":"Odd","then":7}],"tiles":[],"memory":0}"""
        assertEquals(mapOf("news/j1" to Then(inChat, "c1", here)), Then.ofJobs(Json.parseToJsonElement(approvals).jsonObject))
        assertNull(Then.ofJobs(Json.parseToJsonElement("""{"memory":0}""").jsonObject))

        val thens = JobThens()
        thens.handle(event("boot.7", "hello", """{"lastEventId":"boot.7","approvals":$approvals}"""))
        assertEquals(setOf("news/j1"), thens.value.value.keys)
        // Replayed from before "hello": older than where things stand. Then a new one: the owner wrote in that chat, and `then` went.
        thens.handle(event("boot.5", "approvals", """{"jobs":[{"botId":"news","jobId":"j2","then":{"text":"From before"}}]}"""))
        assertEquals(setOf("news/j1"), thens.value.value.keys)
        thens.handle(event("boot.8", "approvals", """{"jobs":[{"botId":"news","jobId":"j1","jobName":"Morning news"}]}"""))
        assertEquals(emptyMap<String, Then>(), thens.value.value)
        // A server without the field, and another botdot.
        thens.handle(event("boot.9", "approvals", """{"jobs":[{"botId":"news","jobId":"j1","then":{"text":"$inChat"}}]}"""))
        thens.handle(event("boot2.1", "hello", """{"lastEventId":"boot2.1","features":[]}"""))
        assertEquals(emptyMap<String, Then>(), thens.value.value)
        thens.handle(event("boot2.2", "approvals", """{"jobs":[{"botId":"news","jobId":"j1","then":{"text":"$inChat"}}]}"""))
        thens.clear()
        assertEquals(emptyMap<String, Then>(), thens.value.value)
    }

    @Test fun aRunsNewFieldsNeverLoseTheChat() {
        val runs = Api.JSON.decodeFromString<List<Run>>("""[
            {"id":"r5","botId":"b1","status":"running","waitingFor":"ok"},
            {"id":"r4","botId":"b1","status":"success","continues":"r3","customPrompt":false,"prompt":"Check why the backup failed last night."},
            {"id":"r3","botId":"b1","status":"success","customPrompt":true,"prompt":"Check why the backup failed last night."},
            {"id":"r2","botId":"b1","status":"running","waitingFor":{"for":"ok"},"continues":["r1"]},
            {"id":"r1","botId":"b1","status":"success","waitingFor":"ok","continues":""}]""")
        assertEquals(5, runs.size)
        assertEquals(listOf(true, false, false, false, false), runs.map { it.waitsForOk }) // only while it runs
        assertEquals(listOf(null, "r3", null, null, null), runs.map { it.continues })
    }

    @Test fun theAnswerOfAYesSaysWhatCarriesOn() {
        assertEquals(CarriesOn("it carries on"), CarriesOn.of("""{"ok":true,"carriesOn":{"who":"bot","text":"it carries on"}}"""))
        assertEquals(CarriesOn("the Chief carries on"), CarriesOn.of("""{"ok":true,"carriesOn":{"who":"chief","text":" the Chief carries on "}}"""))
        // A yes that only changed the setting, an older server, and an answer this app does not expect: the yes still went.
        for (answer in listOf("""{"ok":true}""", """{"ok":true,"carriesOn":null}""", """{"ok":true,"carriesOn":"it carries on"}""", """{"ok":true,"carriesOn":{"text":7}}""",
            """{"ok":true,"carriesOn":{"who":"bot","text":"  "}}""", """["ok"]""", "", "<html>ok</html>")) {
            assertNull(answer, CarriesOn.of(answer))
        }
    }

    @Test fun aVaultSwitchHasItsTitlePartsWarningAndYes() {
        // A bot asks to turn on "Usable in its computer" for a login (docs/api.md, "A switch of a saved login").
        val ask = asks("""[{"id":"v2","kind":"vault-switch","botId":"pve","bot":{"id":"pve","name":"Proxmox Admin","color":"#4a7fd8"},"reason":"To read mail through Proton Bridge.",
            "loginId":"l2","loginName":"Proton Bridge","site":"127.0.0.1","vaultSwitch":"inComputer","title":"Let Proxmox Admin use “Proton Bridge” in its computer?",
            "parts":[{"label":"Login","now":"Proton Bridge (127.0.0.1)"},{"label":"Switch","now":"Usable in its computer"},{"label":"Only for","now":"this login, for every bot it is shared with"}],
            "warning":"Proxmox Admin's commands will be able to read this secret. Only for a secret that guards something on its own computer.","yes":"Allow","yesOn":"card","at":"2026-10-18T19:31:00.000Z"}]""").single()
        assertEquals("vault-switch", ask.kind)
        assertEquals("Let Proxmox Admin use “Proton Bridge” in its computer?", ask.title)
        assertEquals(listOf(ChangedPart("Login", null, "Proton Bridge (127.0.0.1)"), ChangedPart("Switch", null, "Usable in its computer"), ChangedPart("Only for", null, "this login, for every bot it is shared with")), ask.parts)
        assertEquals("Proxmox Admin's commands will be able to read this secret. Only for a secret that guards something on its own computer.", ToolCard.text(ask.warning))
        assertEquals("Allow", ask.yes)
    }
}
