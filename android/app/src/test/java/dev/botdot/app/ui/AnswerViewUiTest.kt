package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import dev.botdot.app.answerview.ViewBubble
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.botdot.app.answerview.AnswerViews
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Answer views in a reply (#1626, ADR 264): a ```ui fence is drawn from the catalog the server hands out, with a quiet
 * "Drawing a view…" while it is written, its `alt` above the code when it can't be drawn, "Can't show this here" for a
 * component it doesn't know, a source or "No source" under data, a chart's Data toggle, and labels for TalkBack. What a
 * fence holds is read by the shared validator (AnswerViewTest, test/fixtures/ui-cases.json); this is what is drawn.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class AnswerViewUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val views = AnswerViews.of(File(System.getProperty("uiCatalog") ?: "../../lib/ui-catalog.json").readText())!!
    private fun fence(json: String) = "```ui\n$json\n```"
    private fun show(reply: String, draft: Boolean = false, catalog: AnswerViews? = views) =
        rule.setContent { CompositionLocalProvider(LocalAnswerViews provides catalog) { Column { MarkdownText(reply, draft = draft) } } }

    @Test fun aKpiAndATableAreDrawnWithWhereTheirNumbersCameFrom() {
        show("Here it is.\n\n" + fence("""{"alt":"Users and plans","root":{"type":"stack","children":[
            {"type":"kpi","label":"Users","value":1200,"unit":"k","source":"analytics.csv"},
            {"type":"table","title":"Plans","columns":[{"label":"Plan"},{"label":"Price"}],"rows":[["Basic","10"],["Pro","25"]]}]}}"""))
        rule.onNodeWithText("Here it is.").assertIsDisplayed()
        rule.onNodeWithText("Users").assertIsDisplayed()
        rule.onNodeWithText("Source: analytics.csv").assertIsDisplayed()
        rule.onNodeWithText("Plans").assertIsDisplayed()
        rule.onNodeWithText("Pro").assertIsDisplayed()
        rule.onNodeWithText("No source").assertIsDisplayed() // the table says none
        rule.onAllNodesWithText("Source: analytics.csv").assertCountEquals(1)
    }

    @Test fun aChartHasADataToggleThatShowsItsNumbersAsATable() {
        show(fence("""{"alt":"Sales","root":{"type":"chart","title":"Sales","labels":["Q1","Q2"],"series":[{"label":"EU","points":[10,20]}],"source":"sales.csv"}}"""))
        rule.onNodeWithContentDescription("Line chart, Sales, 2 points. Data shows the numbers as a table.").assertIsDisplayed() // what TalkBack reads
        rule.onAllNodesWithText("Q2").assertCountEquals(0)
        rule.onNodeWithText("Data").performClick()
        rule.onNodeWithText("Q2").assertIsDisplayed()
        rule.onNodeWithText("20").assertIsDisplayed()
        rule.onNodeWithContentDescription("Show the chart").assertIsDisplayed()
        rule.onNodeWithText("Chart").performClick()
        rule.onAllNodesWithText("Q2").assertCountEquals(0)
        rule.onNodeWithText("Source: sales.csv").assertIsDisplayed()
    }

    @Test fun aFenceStillBeingWrittenIsOneQuietLine() {
        show("Looking.\n\n```ui\n{\"alt\":\"Revenue\",\"root\":{\"type\":\"sta", draft = true)
        rule.onNodeWithText("Looking.").assertIsDisplayed()
        rule.onNodeWithText("Drawing a view…").assertIsDisplayed()
        rule.onAllNodesWithText("Revenue", substring = true).assertCountEquals(0)
    }

    @Test fun aFenceThatCannotBeDrawnShowsItsAltAboveItsCode() {
        show(fence("""{"alt":"Revenue by region","root":"stack"}"""))
        rule.onNodeWithText("Revenue by region").assertIsDisplayed()
        rule.onNodeWithText("""{"alt":"Revenue by region","root":"stack"}""").assertIsDisplayed()
    }

    @Test fun aComponentThisAppDoesNotKnowIsOneQuietLineAndItsNeighboursStay() {
        show(fence("""{"alt":"Flows","root":{"type":"stack","children":[{"type":"heading","text":"Flows"},{"type":"sankey","links":[1]},{"type":"text","text":"Still here"}]}}"""))
        rule.onNodeWithText("Flows").assertIsDisplayed()
        rule.onNodeWithText("Can't show this here").assertIsDisplayed()
        rule.onNodeWithText("Still here").assertIsDisplayed()
    }

    @Test fun aViewWhoseRootIsUnknownSaysItsAlt() {
        show(fence("""{"alt":"A flow of money","root":{"type":"sankey"}}"""))
        rule.onNodeWithText("Can't show this here").assertIsDisplayed()
        rule.onNodeWithText("A flow of money").assertIsDisplayed()
    }

    @Test fun withoutTheCatalogAFenceIsCodeAsBefore() {
        val code = """{"alt":"A divider","root":{"type":"divider"}}"""
        show(fence(code), catalog = null)
        rule.onNodeWithText(code).assertIsDisplayed()
    }

    @Test fun aTabShowsOneAtATimeAndAPanelOpensAndCloses() {
        show(fence("""{"alt":"Tabs","root":{"type":"stack","children":[
            {"type":"tabs","children":[{"type":"tab","label":"First","children":[{"type":"text","text":"One"}]},{"type":"tab","label":"Second","children":[{"type":"text","text":"Two"}]}]},
            {"type":"accordion","children":[{"type":"panel","title":"More","children":[{"type":"text","text":"Hidden words"}]}]}]}}"""))
        rule.onNodeWithText("One").assertIsDisplayed()
        rule.onAllNodesWithText("Two").assertCountEquals(0)
        rule.onNodeWithText("Second").performClick()
        rule.onNodeWithText("Two").assertIsDisplayed()
        rule.onAllNodesWithText("Hidden words").assertCountEquals(0)
        rule.onNodeWithText("More").performClick()
        rule.onNodeWithText("Hidden words").assertIsDisplayed()
    }

    @Test fun everyComponentOfWaveOneIsDrawnWithoutAnImage() {
        // A view of every kind of data, chart and text component: nothing may crash or be left as "Can't show this here".
        show(fence("""{"alt":"All","root":{"type":"stack","children":[
          {"type":"hero","eyebrow":"Report","title":"Q3","lead":"Went well.","tags":["eu"]},
          {"type":"stat-row","children":[{"type":"kpi","label":"A","value":"1","points":[1,2,3],"good":"up","source":"s"},{"type":"kpi","label":"B","value":"2","source":"s"}]},
          {"type":"progress","label":"Done","value":40},{"type":"status","text":"On track","tone":"good"},{"type":"badge","text":"New"},
          {"type":"timeline","items":[{"when":"Mon","title":"Kickoff"}]},
          {"type":"comparison","options":["X","Y"],"rows":[{"label":"Price","values":["1","2"]}],"pick":1},
          {"type":"checklist","items":[{"text":"Docs","done":true},{"text":"Tests"}]},
          {"type":"callout","text":"Careful","tone":"warn"},
          {"type":"steps","items":[{"title":"Plan","state":"done"},{"title":"Build","state":"current"},{"title":"Ship"}]},
          {"type":"key-value","items":[{"key":"Owner","value":"Ada"}]},
          {"type":"list","items":["a","b"],"ordered":true},{"type":"quote","text":"Ship it.","by":"Ada"},{"type":"code","text":"x = 1"},
          {"type":"pie","slices":[{"label":"A","value":3},{"label":"B","value":1}],"donut":true,"source":"s"},
          {"type":"scatter","series":[{"label":"Runs","points":[{"x":1,"y":2},{"x":3,"y":4}]}],"source":"s"},
          {"type":"histogram","values":[1,2,2,3],"bins":2,"source":"s"},
          {"type":"sparkline","points":[1,3,2],"source":"s"},{"type":"gauge","label":"Disk","value":70,"source":"s"},
          {"type":"divider","label":"End"},{"type":"spacer"},
          {"type":"video","src":"clips/a.mp4","alt":"Demo"},{"type":"audio","src":"a.mp3","title":"Memo"},{"type":"file","src":"out/report.csv","title":"Report"}]}}"""))
        rule.onAllNodesWithText("Can't show this here").assertCountEquals(0)
        rule.onNodeWithText("On track").assertIsDisplayed()
        rule.onAllNodesWithContentDescription("Pie chart", substring = true).assertCountEquals(0)
        rule.onAllNodesWithContentDescription("Donut chart", substring = true).assertCountEquals(1)
        rule.onAllNodesWithContentDescription("Gauge", substring = true).assertCountEquals(1)
    }

    // ---- wave 2: inputs and buttons that send the owner's own message (#1628, ADR 265) ----

    private val form = fence("""{"alt":"A form","root":{"type":"stack","children":[
        {"type":"text-input","label":"Name","value":"Ada"},{"type":"number","label":"Budget","value":300,"unit":"EUR"},
        {"type":"toggle","label":"Alerts"},{"type":"rating","label":"Grade","max":5,"value":3}]}}""")
    private val buttons = fence("""{"alt":"A choice","root":{"type":"stack","children":[
        {"type":"button","label":"Yes, go ahead","send":"Yes, go ahead with the cheaper plan"},{"type":"button","label":"Approve"}]}}""")

    private fun field(label: String) = rule.onNode(hasContentDescription(label) and hasSetTextAction())

    private fun showIn(chat: ViewChat?, id: String, reply: String) = rule.setContent {
        CompositionLocalProvider(LocalAnswerViews provides views, LocalViewChat provides chat) { ViewReplyScope(id) { Column { MarkdownText(reply) } } }
    }

    @Test fun aFormOnTheNewestMessageTakesInputAndSendsOneMessageOfTheOwnersOwn() {
        val sent = mutableListOf<Pair<String, String>>()
        showIn(ViewChat(listOf(ViewBubble.bot("form-1"))) { t, k -> sent += t to k; true }, "form-1", form)
        field("Name").performTextReplacement("Adam") // "Adam"
        rule.onNodeWithText("Send").performClick()
        rule.waitForIdle()
        assertEquals(1, sent.size)
        assertEquals("Name: Adam\nBudget: 300 EUR\nAlerts: no\nGrade: 3/5", sent[0].first)
        rule.onNodeWithText("Sent: Name: Adam\nBudget: 300 EUR\nAlerts: no\nGrade: 3/5").assertIsDisplayed()
        rule.onNodeWithText("Send").assertIsNotEnabled()
    }

    @Test fun everyInputHasItsLabelForTalkBack() {
        showIn(ViewChat(listOf(ViewBubble.bot("form-2"))) { _, _ -> true }, "form-2", form)
        field("Name").assertExists()
        field("Budget").assertExists()
        rule.onNodeWithText("Alerts").assertExists()
        rule.onNodeWithContentDescription("3 of 5").assertExists()
        rule.onAllNodesWithContentDescription("5 of 5").assertCountEquals(1)
    }

    @Test fun aDoubleTapSendsOnce() {
        val sent = mutableListOf<String>()
        val gate = CompletableDeferred<Boolean>()
        showIn(ViewChat(listOf(ViewBubble.bot("form-3"))) { t, _ -> sent += t; gate.await() }, "form-3", form)
        rule.onNodeWithText("Send").performClick()
        rule.onNodeWithText("Send").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Send").assertIsNotEnabled() // on its way
        gate.complete(true)
        rule.waitForIdle()
        assertEquals(1, sent.size)
    }

    @Test fun aSendThatDidNotGoLeavesTheFormOpenWithWhatWasTyped() {
        var tries = 0
        showIn(ViewChat(listOf(ViewBubble.bot("form-4"))) { _, _ -> tries++; false }, "form-4", form)
        field("Name").performTextReplacement("Adam")
        rule.onNodeWithText("Send").performClick()
        rule.waitForIdle()
        assertEquals(1, tries)
        rule.onNodeWithText("Send").assertIsEnabled()
        rule.onAllNodesWithText("Sent:", substring = true).assertCountEquals(0)
        field("Name").assertTextContains("Adam")
    }

    @Test fun whatWasTypedStaysWhenTheViewIsDrawnAgain() {
        var shown by mutableStateOf(true)
        rule.setContent {
            CompositionLocalProvider(LocalAnswerViews provides views, LocalViewChat provides ViewChat(listOf(ViewBubble.bot("form-5"))) { _, _ -> true }) {
                if (shown) ViewReplyScope("form-5") { Column { MarkdownText(form) } }
            }
        }
        field("Name").performTextReplacement("Adam")
        rule.runOnIdle { shown = false }
        rule.waitForIdle()
        rule.runOnIdle { shown = true }
        rule.waitForIdle()
        field("Name").assertTextContains("Adam")
    }

    @Test fun anOlderViewIsReadOnlyAndSaysItWasNotSent() {
        showIn(ViewChat(listOf(ViewBubble.bot("form-6"), ViewBubble.owner("Thanks"), ViewBubble.bot("form-7"))) { _, _ -> true }, "form-6", form)
        rule.onNodeWithText("Send").assertIsNotEnabled()
        rule.onNode(hasContentDescription("Name")).assertIsNotEnabled()
        rule.onNodeWithText("Not sent").assertIsDisplayed()
    }

    @Test fun anOlderViewTheOwnerAnsweredSaysWhatWasSentReadFromTheirNextMessage() {
        val chat = ViewChat(listOf(ViewBubble.bot("form-8"), ViewBubble.owner("Name: Ada\nBudget: 300 EUR\nAlerts: no\nGrade: 3/5"), ViewBubble.bot("form-9"))) { _, _ -> true }
        showIn(chat, "form-8", form)
        rule.onNodeWithText("Sent: Name: Ada\nBudget: 300 EUR\nAlerts: no\nGrade: 3/5").assertIsDisplayed()
        rule.onAllNodesWithText("Not sent").assertCountEquals(0)
    }

    @Test fun aViewWhereNoChatWiresItIsReadOnlyWithNoLineAsInARoom() {
        showIn(null, "room-1", form)
        rule.onNodeWithText("Send").assertIsNotEnabled()
        rule.onAllNodesWithText("Not sent").assertCountEquals(0)
        rule.onNode(hasContentDescription("Name")).assertIsNotEnabled()
    }

    @Test fun aButtonSendsItsTextOrItsLabelAndApproveIsOnlyTheWord() {
        val sent = mutableListOf<String>()
        showIn(ViewChat(listOf(ViewBubble.bot("btn-1"))) { t, _ -> sent += t; true }, "btn-1", buttons)
        rule.onNodeWithText("Approve").performClick()
        rule.waitForIdle()
        assertEquals(listOf("Approve"), sent)
        rule.onNodeWithText("Sent: Approve").assertIsDisplayed()
        rule.onNodeWithText("Yes, go ahead").assertIsNotEnabled() // a view is sent once
    }

    @Test fun aViewWithOnlyButtonsHasNoSendAndAnOlderOneIsClosed() {
        showIn(ViewChat(listOf(ViewBubble.bot("btn-2"), ViewBubble.bot("btn-3"))) { _, _ -> true }, "btn-2", buttons)
        rule.onAllNodesWithText("Send").assertCountEquals(0)
        rule.onNodeWithText("Yes, go ahead").assertIsNotEnabled()
        rule.onNodeWithText("Not sent").assertIsDisplayed()
    }

    @Test fun aLinkAndACopyButtonWorkInAViewThatIsClosed() {
        val v = fence("""{"alt":"Tools","root":{"type":"stack","children":[{"type":"link","label":"Read the offer","url":"https://example.com/offer"},{"type":"copy","label":"Copy the code","text":"npm test"},{"type":"link","label":"Plain","url":"http://example.com"}]}}""")
        showIn(null, "tools-1", v)
        rule.onNodeWithText("Read the offer").assertIsEnabled()
        rule.onNodeWithText("Copy the code").assertIsEnabled().performClick()
        rule.onNodeWithText("Copied").assertIsDisplayed()
        rule.onAllNodesWithText("Plain").assertCountEquals(0) // no https address: the validator leaves it as one quiet line
    }
}
