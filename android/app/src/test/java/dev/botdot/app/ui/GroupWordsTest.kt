package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.GroupRef
import dev.botdot.app.data.Groups
import dev.botdot.app.data.Mentions
import dev.botdot.app.data.TurnLine
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What the app says of a group, and where it stands in the list (Milestone 10; the plan of GRP-006). The words are
 * those the web page uses for the same thing (`public/groups.js`, and "For GRP-006" in the Notes of GRP-005).
 */
class GroupWordsTest {
    private val bots: List<Bot> = Api.JSON.decodeFromString("""[
        {"id":"coder","name":"Coder","color":"#3b82f6","group":"Programming","order":1},{"id":"reviewer","name":"Reviewer","color":"#16a34a","group":"Programming","order":2},
        {"id":"writer","name":"Issue Writer","color":"#d97706","group":"Programming"},{"id":"cook","name":"Cook","group":"Home","order":1},
        {"id":"fleet","name":"Fleet Doctor","pinned":1},{"id":"news","name":"News","pinned":2}]""")
    private fun group(more: String = "", id: String = "g1", name: String = "Dev") = Group.list("""[{"id":"$id","name":"$name","members":["coder","reviewer","writer"],"category":"Programming","order":1$more}]""").single()
    private fun message(json: String): GroupMessage = (GroupItem.of(Json.parseToJsonElement("""{"type":"message","id":"m1","text":"Fix it.","at":"2026-10-08T09:00:00Z",$json}""")) as GroupItem.Message).message

    @Test fun namesAreListedAsASentenceDoes() {
        assertEquals(listOf("", "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer"),
            listOf(emptyList(), listOf("Coder"), listOf("Coder", "Reviewer"), listOf("Coder", "Reviewer", "Issue Writer")).map(::namesList))
    }

    @Test fun aGroupsRowSaysItsNewestReplyWithTheBotsNameBeforeIt() {
        val line = groupLine(group(""","last":{"runId":"r2","botId":"reviewer","botName":"Reviewer","status":"success","at":"2026-10-08T09:02:00Z","text":"**Looks good.**\nMerge it."}"""), bots, emptyMap())
        assertEquals(GroupLine("Reviewer", "Looks good. Merge it.", color = "#16a34a"), line)
        // A bot that was renamed since is named as it is now; one that is gone, as the server said it.
        assertEquals("Reviewer", groupLine(group(""","last":{"botId":"reviewer","botName":"Old name","status":"success","text":"x"}"""), bots, emptyMap()).who)
        assertEquals("Tester", groupLine(group(""","last":{"botId":"gone","botName":"Tester","status":"success","text":"x"}"""), bots, emptyMap()).who)
        assertEquals("Done.", groupLine(group(""","last":{"botId":"coder","status":"success","text":""}"""), bots, emptyMap()).text)
        assertEquals("Couldn't finish", groupLine(group(""","last":{"botId":"coder","status":"error","text":null}"""), bots, emptyMap()).text)
        assertEquals("a failed reply says its problem", "Claude is not signed in.", groupLine(group(""","last":{"botId":"coder","status":"error","text":"Claude is not signed in."}"""), bots, emptyMap()).text)
        assertEquals(GroupLine("", "No messages yet", color = "#3b82f6"), groupLine(group(), bots, emptyMap()))
    }

    @Test fun whileAMemberWorksTheRowSaysWhoAndItsOpeningLine() {
        val g = group(""","working":["gone","reviewer","coder"],"asks":{"botId":"coder","text":"Which one?"},"last":{"botId":"coder","status":"success","text":"x"}""")
        assertEquals(GroupLine("Reviewer", "Working…", working = true, color = "#3b82f6"), groupLine(g, bots, emptyMap()))
        val lines = mapOf("r1" to TurnLine("g1", "reviewer", "Reading the diff"), "r2" to TurnLine("g2", "reviewer", "In another group"))
        assertEquals("Reading the diff…", groupLine(g, bots, lines).text)
    }

    @Test fun whenAMemberAsksTheRowSaysAsksWithTheMark() {
        val line = groupLine(group(""","asks":{"botId":"coder","botName":"Coder","text":"Two ways to do it.\nWhich one?","runId":"r3"},"last":{"botId":"reviewer","status":"success","text":"I wait."}"""), bots, emptyMap())
        assertEquals(GroupLine("", "Coder asks: Two ways to do it. Which one?", asks = true, color = "#3b82f6"), line)
        assertEquals("Coder asks", groupLine(group(""","asks":{"botId":"coder","text":""}"""), bots, emptyMap()).text)
    }

    @Test fun typingAnAtInAGroupSuggestsItsMembersAndNoOtherBot() {
        val world = Mentions.World("group:g1", Groups.members(group(), bots), listOf("release-notes"))
        assertEquals(listOf("@Coder", "@Reviewer", "@IssueWriter"), Mentions.suggest("@", world).map { it.text })
        assertEquals("Cook is no member", listOf("@Coder"), Mentions.suggest("Ask @co", world).map { it.text })
        assertEquals("no skill is offered in a group", emptyList<String>(), Mentions.suggest("@release", world).map { it.text })
    }

    @Test fun theSearchBoxFindsAGroupByItsNameItsCategoryAndItsMembers() {
        val text = groupSearchText(group(), bots)
        for (q in listOf("dev", "programming", "issue writer", "coder")) assertTrue(q, text.contains(q))
        assertFalse(text.contains("cook"))
    }

    @Test fun aMessageThatWaitsSaysForWhom() {
        assertEquals("Waits until Coder is free", waitsLine(message(""""waitsFor":["coder"],"canTakeBack":true"""), bots))
        assertEquals("Waits until Coder and Reviewer are free", waitsLine(message(""""waitsFor":["coder","reviewer"]"""), bots))
        assertEquals("", waitsLine(message(""""waitsFor":[],"next":["coder"]"""), bots))
        // None of its turns has started and it waits: at the end of the chat, with "Take back".
        assertTrue(waitsWhole(message(""""waitsFor":["coder"],"canTakeBack":true"""), bots, signedOut = false))
        assertFalse("its first turns went: it stays in its place, and says for whom it still waits", waitsWhole(message(""""waitsFor":["coder"],"canTakeBack":false"""), bots, signedOut = false))
        assertFalse("its first turn is about to start", waitsWhole(message(""""waitsFor":[],"next":["coder"],"canTakeBack":true"""), bots, signedOut = false))
        // While Claude is signed out no turn is given: the message waits for the sign-in.
        val held = message(""""waitsFor":[],"next":["coder","reviewer"],"canTakeBack":true""")
        assertTrue(waitsWhole(held, bots, signedOut = true))
        assertEquals("Waits until Claude is signed in", waitsWords(held, bots))
        assertEquals("Waits until Coder is free", waitsWords(message(""""waitsFor":["coder"],"canTakeBack":true"""), bots))
        // A line stopped at the limit waits for "Go on", not for a member.
        assertFalse(waitsWhole(message(""""waitsFor":[],"next":["coder"],"atLimit":true,"canTakeBack":false"""), bots, signedOut = false))
    }

    @Test fun underTheChatStandsOneLinePerWorkingMember() {
        assertEquals("Coder · Working…", workingWords("Coder", null, null))
        assertEquals("the chat's own word for it, until the feed says one", "Coder · Reading the issue…", workingWords("Coder", null, "Reading the issue"))
        assertEquals("Coder · Writing the fix…", workingWords("Coder", TurnLine("g1", "coder", "Writing the fix"), "Reading the issue"))
        assertEquals("its run waits for the owner's OK", "Coder · Waiting for your OK", workingWords("Coder", TurnLine("g1", "coder", "Writing the fix", held = true), null))
    }

    @Test fun theWordsOfTheEmptyChatThePickerAndACardInNeedsYou() {
        assertEquals("Coder, Reviewer and Issue Writer. What you write here, all of them read.", emptyGroupWords(listOf("Coder", "Reviewer", "Issue Writer")))
        assertEquals("Its bots are all gone. Add one, or delete the group.", emptyGroupWords(emptyList()))
        assertEquals("Pick one to five bots to join Coder. Its own chat stays as it is.", makeHint(0, "Coder"))
        assertEquals("3 bots in the group, with Coder.", makeHint(2, "Coder"))
        assertEquals("A group has two to six bots.", addHint(0, 3, "Dev"))
        assertEquals("4 bots in Dev.", addHint(1, 3, "Dev"))
        assertEquals("Coder in Dev", Named("Coder", "#3b82f6", null).inGroup("Dev").name)
        assertEquals("a card of the bot's own chat", "Coder", Named("Coder", "#3b82f6", null).inGroup(null).name)
        assertEquals("Dev team", groupName("  Dev \n team  "))
        assertEquals("an emptied box", "", groupName("   "))
    }

    @Test fun theSmallPlusIsOfferedOnlyWhereAGroupCanBeMade() {
        assertEquals("Add a bot to this chat", ADD_A_BOT)
        assertTrue(canMakeGroup(listOf("unread", "groups"), otherBots = 1))
        assertFalse("a botdot server without groups", canMakeGroup(listOf("unread", "message-waits"), otherBots = 5))
        assertFalse("its features are not known yet", canMakeGroup(null, otherBots = 5))
        assertFalse("no other bot to add", canMakeGroup(listOf("groups"), otherBots = 0))
        // It is a plus alone, named for a screen reader, with no words beside it (the owner's first look, 2026-10-08),
        // and it stands right of the name in the top of the bot's chat (the owner at the test of Milestone 10, GRP-011).
        val chat = File(sources(), "ui/BotChatScreen.kt").readText()
        assertTrue(chat.contains("beside = if (bot != null && canMakeGroup(features, others.size)) ({ SmallPlus(ADD_A_BOT) { makingGroup = true } }) else null,"))
        assertTrue(File(sources(), "ui/GroupParts.kt").readText().contains("semantics { contentDescription = label }"))
        // The top of a chat draws it after the name's own row, outside what a tap on the name takes, and cuts a long name before it.
        val bar = File(sources(), "ui/Components.kt").readText().substringAfter("fun ChatBar(").substringBefore("private val TIME")
        assertTrue(bar.contains("Modifier.weight(1f, fill = false).height(40.dp)"))
        assertTrue(bar.substringAfter("overflow = TextOverflow.Ellipsis)").replace(Regex("\\s+"), " ").startsWith(" } beside?.invoke() } actions()"))
        // Only a bot's chat has it: not its settings, a group's chat or the Chief's.
        for (f in listOf("ui/BotSettingsScreen.kt", "ui/GroupChatScreen.kt", "ui/ChiefScreen.kt")) {
            val src = File(sources(), f).readText()
            assertFalse(f, src.contains("SmallPlus(") || src.contains("ADD_A_BOT") || src.contains("beside ="))
        }
        assertFalse(chat.contains("Text(ADD_A_BOT"))
        assertFalse(chat.contains("\"＋ Add a bot to this chat\""))
    }

    @Test fun aCardAskedInAGroupStandsAtTheEndOfThatGroupsChatAndInNoOther() {
        val dev = GroupRef("g1", "Dev")
        assertTrue(chatCards("group:g1", dev))
        for (other in listOf("group:g2", "coder", "chief")) assertFalse(other, chatCards(other, dev))
        // A card of a bot's own chat: where it stood before groups, and in no group's chat.
        assertTrue(chatCards("coder", null))
        assertTrue(chatCards("chief", null))
        assertFalse(chatCards("group:g1", null))
    }

    // ---------- the list ----------

    private val groups = Group.list("""[{"id":"g2","name":"Pair","members":["coder","reviewer"],"category":"Programming","order":2},{"id":"g1","name":"Dev","members":["coder","reviewer","writer"],"category":"Programming","order":1},
        {"id":"g3","name":"Kitchen","members":["cook","coder"],"category":"Home","order":1},{"id":"g4","name":"Loose","members":["cook","coder"],"category":"Later","order":1},{"id":"g5","name":"Top","members":["cook","coder"],"pinned":1}]""")

    @Test fun aCategorysGroupsStandAfterItsBotsAndThePinnedGroupsAfterThePinnedBots() {
        val rows = ListLayout.rows(bots, groups, emptySet())
        assertEquals(listOf("fleet", "news", "group:g5"), rows.pins)
        assertEquals(listOf("pins", "g:Home", "cook", "group:g3", "g:Later", "group:g4", "g:Programming", "coder", "reviewer", "writer", "group:g1", "group:g2"), rows.layout)
        // A folded category shows its heading alone, its groups too.
        assertEquals(listOf("pins", "g:Home", "cook", "group:g3", "g:Later", "group:g4", "g:Programming"), ListLayout.rows(bots, groups, setOf("Programming")).layout)
    }

    @Test fun againstAServerWithoutGroupsTheListIsAsItWas() {
        val rows = ListLayout.rows(bots, emptyList(), emptySet())
        assertEquals(listOf("fleet", "news"), rows.pins)
        assertEquals(listOf("pins", "g:Home", "cook", "g:Programming", "coder", "reviewer", "writer"), rows.layout)
        assertTrue(rows.layout.none(ListLayout::isGroup))
        // Bots that are in no category, alone: no heading.
        val loose: List<Bot> = Api.JSON.decodeFromString("""[{"id":"b","name":"Beta"},{"id":"a","name":"alpha"}]""")
        assertEquals(listOf("pins", "a", "b"), ListLayout.rows(loose, emptyList(), emptySet()).layout)
        assertEquals("with a group among them", listOf("pins", "a", "b", "group:g9"), ListLayout.rows(loose, Group.list("""[{"id":"g9","name":"Both","members":["a","b"]}]"""), emptySet()).layout)
    }

    @Test fun aRowIsNeitherAHeadingNorABotWhenItIsAGroup() {
        assertTrue(ListLayout.isGroup(ListLayout.groupRow("g1")))
        assertFalse(ListLayout.isHeading(ListLayout.groupRow("g1")))
        assertFalse("a category called group", ListLayout.isGroup(ListLayout.heading("group:x")))
        assertEquals("g1" to "Home", ListLayout.groupOf("group:g1") to ListLayout.categoryOf("g:Home"))
        // Its chat's key is its row's, and the key its settings panel is open for.
        assertEquals(ListLayout.groupRow("g1"), dev.botdot.app.data.groupKey("g1"))
        assertEquals("group:g1", SettingsPanel.chatOf("group/{id}", "g1", wide = false))
        assertEquals(Panel("group:g1"), SettingsPanel.toggle(null, "group:g1"))
    }

    @Test fun aDraggedGroupLandsAmongTheGroupsAndADraggedBotAmongTheBots() {
        val pins = listOf("fleet", "news", "group:g5")
        fun at(key: String, vararg layout: String) = ListLayout.dropped(layout.toList(), pins, key)
        // A group let go between two bots of another category is the first group there.
        assertEquals(ListLayout.Place.In("Programming", 1), at("group:g3", "pins", "g:Home", "cook", "g:Programming", "coder", "group:g3", "reviewer", "group:g1", "group:g2"))
        assertEquals(ListLayout.Place.In("Programming", 3), at("group:g3", "pins", "g:Home", "cook", "g:Programming", "coder", "reviewer", "group:g1", "group:g2", "group:g3"))
        // A bot let go under a group is the last bot there; between two bots, where it stands among the bots.
        assertEquals(ListLayout.Place.In("Programming", 3), at("cook", "pins", "g:Home", "group:g3", "g:Programming", "coder", "reviewer", "group:g1", "cook", "group:g2"))
        assertEquals(ListLayout.Place.In("Programming", 2), at("cook", "pins", "g:Home", "group:g3", "g:Programming", "coder", "cook", "reviewer", "group:g1"))
        assertEquals("on a folded category's heading", ListLayout.Place.In("Home", 1), at("coder", "pins", "g:Home", "coder", "g:Programming", "reviewer"))
        assertEquals("a list without headings", ListLayout.Place.In("", 2), at("b", "pins", "a", "b", "group:g9"))
        // Above the big figures: pinned, the last of its own kind.
        assertEquals(ListLayout.Place.Pinned(2), at("group:g1", "group:g1", "pins", "g:Programming", "coder"))
        assertEquals(ListLayout.Place.Pinned(3), at("coder", "coder", "pins", "g:Programming", "reviewer"))
        // A big figure moved among the others keeps to its own kind's count.
        assertEquals(ListLayout.Place.Pinned(1), ListLayout.dropped(listOf("pins"), listOf("fleet", "group:g5", "news"), "group:g5"))
        assertEquals(ListLayout.Place.Pinned(2), ListLayout.dropped(listOf("pins"), listOf("fleet", "group:g5", "news"), "news"))
        assertNull(at("nobody", "pins", "coder"))
    }

    // ---------- the word ----------

    private fun sources(): File = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "src/main/java/dev/botdot/app") }.first { it.exists() }

    @Test fun aFolderOfBotsIsCalledACategoryWhereverTheAppSaidGroup() {
        val home = File(sources(), "ui/HomeScreen.kt").readText()
        assertTrue(home.contains("\"Show this category\"") && home.contains("\"Hide this category\""))
        assertTrue(File(sources(), "ui/BotSettingsScreen.kt").readText().contains("\"Category (e.g. Home, Work)\""))
        // What the list and a bot's settings print: no text that calls the folder a group. The field of the API
        // keeps its older name (`group` on a bot), and a group's own row has the key "group:<id>".
        val said = Regex("\"((?:[^\"\\\\]|\\\\.)*)\"")
        for (file in listOf("ui/HomeScreen.kt", "ui/BotSettingsScreen.kt", "ui/ShareScreen.kt", "ui/SettingsScreen.kt")) {
            // Without the comments, and without what a text only puts in from the code ("${'$'}{it.group}").
            val code = File(sources(), file).readLines().filterNot { it.trim().startsWith("//") || it.trim().startsWith("*") || it.trim().startsWith("/*") }.joinToString("\n") { it.substringBefore(" // ") }
            val texts = said.findAll(code).map { it.groupValues[1].replace(Regex("\\$\\{[^}]*\\}"), "") }.filter { Regex("(?i)\\bgroups?\\b").containsMatchIn(it) }.toList()
            assertEquals(file, emptyList<String>(), texts - setOf("group", "New group"))
        }
    }

    @Test fun whoIsNextIsReadOutByNameAndDrawnWithoutWords() {
        // The heads under a group's working lines carry no words and no count: a screen reader is told their names.
        assertEquals("Next: Reviewer", nextWords(listOf("Reviewer")))
        assertEquals("Next: Reviewer and Issue Writer", nextWords(listOf("Reviewer", "Issue Writer")))
        assertEquals("Next: Coder, Reviewer and Issue Writer", nextWords(listOf("Coder", "Reviewer", "Issue Writer")))
        assertEquals("", nextWords(emptyList()))
    }
}
