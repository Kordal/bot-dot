package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The starter board on Android (#810): what the project carries in setup, how a goal reads, and the PATCH an untick sends. */
class ProjectStarterTest {
    private val c = Api.JSON.decodeFromString<Company>("""{"id":"p1","starter":{"goals":[{"key":"g1","name":"All VMs up","target":0,"on":true},{"key":"g2","name":"Nightly backups","target":7,"on":true}],"cards":[{"key":"c1","ask":"Free space on the NAS","apps":[],"on":true}]}}""")

    @Test fun `a project in setup carries its starter board, and one from before has none`() {
        assertEquals(listOf("g1", "g2"), c.starter!!.goals.map { it.key })
        assertEquals("Free space on the NAS", c.starter!!.cards[0].ask)
        assertNull(Api.JSON.decodeFromString<Company>("""{"id":"p2"}""").starter)
    }

    @Test fun `a goal reads with its number only when it has one`() {
        assertEquals("All VMs up", ProjectStarter.label(c.starter!!.goals[0]))
        assertEquals("Nightly backups · 7", ProjectStarter.label(c.starter!!.goals[1]))
    }

    @Test fun `an untick changes that item only and sends the whole starter board`() {
        val next = ProjectStarter.ticked(c.starter!!, "c1", false)
        assertEquals(listOf(true, true), next.goals.map { it.on })
        assertEquals(false, next.cards[0].on)
        assertEquals("""{"starter":{"goals":[{"key":"g1","name":"All VMs up"},{"key":"g2","name":"Nightly backups","target":7.0}],"cards":[{"key":"c1","ask":"Free space on the NAS","on":false}]}}""", ProjectStarter.patch(next).toString())
    }
}
