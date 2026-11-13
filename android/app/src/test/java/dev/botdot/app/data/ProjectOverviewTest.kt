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
}
