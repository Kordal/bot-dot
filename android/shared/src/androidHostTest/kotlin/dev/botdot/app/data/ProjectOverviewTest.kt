package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ProjectOverviewTest {
    @Test fun recordedStatesAndFutureFieldsDoNotBecomeInferredProgress() {
        val snapshot = Api.JSON.decodeFromString(ProjectOverview.serializer(), """{
          "projectId":"p1","at":"2026-11-13T12:00:00Z","goal":"Publish the site","future":true,
          "work":[{"id":"r1","botId":"writer","name":"Writer","state":"working","text":"Drafting"}],
          "blockers":[{"id":"r2","state":"failed","text":"Cannot connect"}],
          "replies":[{"id":"r3","state":"reply","text":"<b>Draft ready</b>"}]
        }""")
        assertEquals("p1", snapshot.projectId)
        assertEquals("working", snapshot.work.single().state)
        assertEquals("failed", snapshot.blockers.single().state)
        assertEquals("<b>Draft ready</b>", snapshot.replies.single().text)
    }

    @Test fun anEmptySnapshotKeepsTheSectionsEmpty() {
        val snapshot = Api.JSON.decodeFromString(ProjectOverview.serializer(), """{"projectId":"p1","at":"2026-11-13T12:00:00Z"}""")
        assertEquals(emptyList<OverviewEntry>(), snapshot.work)
        assertEquals(emptyList<OverviewEntry>(), snapshot.blockers)
        assertEquals(emptyList<OverviewEntry>(), snapshot.replies)
    }
    @Test fun anOwnerTodoOpensTheProjectsPrimaryConversationNotAnUnrelatedChief() {
        val todo = OverviewEntry(id = "todo", state = "planned", text = "Review copy")
        val project = Company(id = "p1", phase = "running", chiefChat = "c-project")
        val features = listOf(ProjectOverview.FEATURE, ManyProjects.CHIEF, ManyProjects.MANAGER_BOT)
        assertEquals("chief/c-project", todo.destination(project, emptyList(), features))
        assertEquals("project-chief/p1", todo.destination(project.copy(chiefChat = null), emptyList(), features))
        assertEquals("bot/manager", todo.destination(project.copy(lead = "manager"), listOf(Bot(id = "manager", name = "Manager")), features))
    }

    @Test fun eachEntryShowsWhoseItIs() {
        val writer = Bot(id = "writer", name = "Writer")
        assertEquals(Overviews.Head.Of(writer), Overviews.head(OverviewEntry(id = "r", botId = "writer"), listOf(writer)))
        assertEquals(Overviews.Head.Of(writer), Overviews.head(OverviewEntry(id = "g", botId = "writer", groupId = "g1"), listOf(writer)))
        assertEquals(Overviews.Head.Chief, Overviews.head(OverviewEntry(id = "chief", chatId = "c1"), listOf(writer)))
        assertEquals(Overviews.Head.You, Overviews.head(OverviewEntry(id = "todo", state = "planned"), listOf(writer)))
        assertEquals(Overviews.Head.Unknown, Overviews.head(OverviewEntry(id = "r", botId = "gone"), listOf(writer)))
        assertEquals(Overviews.Head.Unknown, Overviews.head(OverviewEntry(id = "r", botId = "writer"), null))
        assertEquals(Overviews.Head.Unknown, Overviews.head(OverviewEntry(id = "g", groupId = "g1"), listOf(writer)))
    }

    @Test fun anOverviewTileOnTheCanvasShowsTheWholeRowsThatFitAndAtLeastOne() {
        val rows = listOf(100, 100, 100, 100)
        assertEquals(4, Overviews.fit(rows, moreHeight = 30, available = 400))
        assertEquals(4, Overviews.fit(rows, moreHeight = 30, available = 500))
        // Four do not fit: the line that says how many more there are takes room from the rows (330 holds three and the line).
        assertEquals(3, Overviews.fit(rows, moreHeight = 30, available = 330))
        assertEquals(2, Overviews.fit(rows, moreHeight = 30, available = 329))
        assertEquals(2, Overviews.fit(rows, moreHeight = 30, available = 250))
        // Taller shows more.
        assertEquals(3, Overviews.fit(rows, moreHeight = 30, available = 340))
        // One row at least, even where not one fits; a lone row is never hidden.
        assertEquals(1, Overviews.fit(rows, moreHeight = 30, available = 40))
        assertEquals(1, Overviews.fit(listOf(500), moreHeight = 30, available = 40))
        assertEquals(0, Overviews.fit(emptyList(), moreHeight = 30, available = 40))
    }
}
