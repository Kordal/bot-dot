package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Where a row of Home's list lands when the iPhone's list lets it go (ListLayout.moved), as Android's drag saves it. */
class HomeListTest {
    private val bots = listOf(
        Bot(id = "a", name = "A", pinned = 1),
        Bot(id = "b", name = "B", pinned = 2),
        Bot(id = "c", name = "C", group = "Work", order = 1),
        Bot(id = "d", name = "D", group = "Work", order = 2),
    )
    private val rows = ListLayout.rows(bots, emptyList(), emptySet())
    private val order = rows.pins + rows.layout // a, b, PINS, g:Work, c, d

    @Test fun theListIsDrawnPinnedFirst() = assertEquals(listOf("a", "b", ListLayout.PINS, "g:Work", "c", "d"), order)

    @Test fun aRowLetGoWhereItWasSavesNothing() = assertNull(ListLayout.moved(order, "c", bots, emptyList(), false))

    @Test fun aPinnedBotMovedAmongThePinnedTakesThatPlace() {
        val m = ListLayout.moved(listOf("b", "a", ListLayout.PINS, "g:Work", "c", "d"), "a", bots, emptyList(), false)!!
        assertEquals("a", m.bot)
        assertEquals("""{"pinned":2}""", m.change.toString())
    }

    @Test fun aBotLetGoAboveTheLineIsPinnedLast() {
        val m = ListLayout.moved(listOf("a", "b", "d", ListLayout.PINS, "g:Work", "c"), "d", bots, emptyList(), false)!!
        assertEquals("""{"pinned":3}""", m.change.toString())
    }

    @Test fun aPinnedBotLetGoInACategoryLeavesThePinned() {
        val m = ListLayout.moved(listOf("b", ListLayout.PINS, "g:Work", "a", "c", "d"), "a", bots, emptyList(), false)!!
        assertEquals("""{"group":"Work","order":1,"pinned":0}""", m.change.toString())
    }

    @Test fun aBotMovedInItsCategoryTakesItsNewOrder() {
        val m = ListLayout.moved(listOf("a", "b", ListLayout.PINS, "g:Work", "d", "c"), "d", bots, emptyList(), false)!!
        assertEquals("""{"group":"Work","order":1}""", m.change.toString())
    }
}

/** A bot's mark as the iPhone paints it (FigurePaint), from the definition every app draws from (lib/figure.json). */
class FigurePaintTest {
    private val def = FigureDef.parse(fixture("figureDefinition"))

    @Test fun aColourIsReadAsTheAppsReadIt() {
        assertEquals(0x1D9E75, FigurePaint.colorOf("#1d9e75"))
        assertEquals(0x1D9E75, FigurePaint.colorOf("#ff1d9e75"))
        assertNull(FigurePaint.colorOf("teal"))
        assertNull(FigurePaint.colorOf(null))
    }

    @Test fun aTileIsItsMutedSquareItsIconAndItsStatesSignal() {
        val tile = def.tile!!
        val working = FigurePaint.figure(def, "#1d9e75", "working", null)
        val square = working.ops.first() as FigurePaint.Op.RoundRect
        assertEquals(tile.muted(0x1D9E75), square.color)
        assertEquals(def.signal("working")?.ring != null, working.ops.any { it is FigurePaint.Op.Arc })
        val needs = FigurePaint.figure(def, "#1d9e75", "needs_you", null)
        assertEquals(def.signal("needs_you")?.dot != null, needs.ops.any { it is FigurePaint.Op.Circle && it.cut })
        assertEquals(listOf(0f, 0f, def.box.first, def.box.second), working.view)
    }

    @Test fun theSmallMarkShowsNoState() {
        val small = FigurePaint.small(def, null, null)
        assertEquals(def.small.toList(), small.view)
        assertTrue(small.ops.none { it is FigurePaint.Op.Arc || (it is FigurePaint.Op.Circle && it.cut) })
        assertEquals(def.tile!!.muted(FigureDef.GREY), (small.ops.first() as FigurePaint.Op.RoundRect).color, "a bot without a colour is grey")
    }

    @Test fun withoutATileABareHeadIsItsCircle() {
        val bare = FigurePaint.figure(FigureDef.BARE, "#1d9e75", null, null)
        assertTrue(bare.ops.any { it is FigurePaint.Op.Circle && it.color == 0x1D9E75 })
    }
}
