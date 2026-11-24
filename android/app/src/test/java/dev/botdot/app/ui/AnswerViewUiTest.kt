package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
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
}
