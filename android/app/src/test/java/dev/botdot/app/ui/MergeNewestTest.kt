package dev.botdot.app.ui

import dev.botdot.app.data.Run
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MergeNewestTest {
    private fun runs(vararg ids: String, status: String = "success") = ids.map { Run(id = it, status = status) }
    private fun ids(l: List<Run>?) = l?.map { it.id }

    @Test fun newRunsGoOnTopOfWhatWasThere() {
        val had = runs("5", "4", "3", "2", "1")
        assertEquals(listOf("7", "6", "5", "4", "3", "2", "1"), ids(mergeNewest(had, runs("7", "6", "5", "4"), limit = 4)))
    }

    @Test fun aChangedRunReplacesTheOldOne() {
        val had = runs("3", status = "running") + runs("2", "1")
        val merged = mergeNewest(had, runs("3", "2"), limit = 4)!!
        assertEquals(listOf("3", "2", "1"), ids(merged))
        assertEquals("success", merged[0].status)
    }

    @Test fun whenTheyDontMeetTheChatStartsOver() {
        assertNull(mergeNewest(runs("3", "2", "1"), runs("9", "8", "7", "6"), limit = 4))
    }

    @Test fun fewerThanALookBringsIsAllThereIs() {
        assertEquals(listOf("2", "1"), ids(mergeNewest(runs("9"), runs("2", "1"), limit = 4)))
        assertEquals(listOf("1"), ids(mergeNewest(emptyList(), runs("1"), limit = 4)))
    }
}
