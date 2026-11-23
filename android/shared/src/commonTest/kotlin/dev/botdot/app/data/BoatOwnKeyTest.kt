package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The account's own boat.dev key and a bot's machine of its own (ADR 263), for both phones: what the key row says, who chooses, the bot's choice. */
class BoatOwnKeyTest {
    private fun bot(json: String) = Api.JSON.decodeFromString(Bot.serializer(), json)
    private val onBoat = bot("""{"id":"a","name":"A","computer":"boat","computerPlace":"boat"}""")
    private val features = listOf("account-computer", "computer-move", "bot-own-machine", "boat-own-key")

    @Test fun theKeyIsSaidInWordsAndTheModelHasNoKey() {
        val none = Api.JSON.decodeFromString(BoatKey.serializer(), """{"set":false,"machines":0,"machineKey":true}""")
        assertEquals("Not set", none.stateLine)
        assertFalse(none.failing)
        val good = Api.JSON.decodeFromString(BoatKey.serializer(), """{"set":true,"check":"ok","machines":2,"machineKey":false}""")
        assertEquals("Set · Works", good.stateLine)
        assertEquals(2, good.machines)
        assertFalse(good.failing)
        assertEquals("Set · boat.dev refuses it", BoatKey(set = true, check = "refused").stateLine)
        assertEquals("Set · boat.dev wants a plan or a payment method first", BoatKey(set = true, check = "billing").stateLine)
        assertEquals("Set · boat.dev can't be reached", BoatKey(set = true, check = "unreachable").stateLine)
        assertTrue(BoatKey(set = true, check = "refused").failing)
        assertEquals("Set", BoatKey(set = true).stateLine, "before its first check")
        assertFalse("\"key\"" in Api.JSON.encodeToString(BoatKey.serializer(), good), "the key itself is not in what the model says")
    }

    @Test fun theKeyRowShowsWithAdvancedOnAndAServerThatKnowsIt() {
        assertTrue(BoatKey.shows(features, advanced = true))
        assertFalse(BoatKey.shows(features, advanced = false))
        assertFalse(BoatKey.shows(listOf("account-computer"), advanced = true), "an older server")
        assertFalse(BoatKey.shows(null, advanced = true))
    }

    @Test fun theOwnerChoosesTheComputerAndSizeOnlyWhileTheAccountHasItsOwnKey() {
        val with = Api.JSON.decodeFromString(ComputerPlace.serializer(), """{"place":"boat","boat":true,"ownKey":true}""")
        val without = Api.JSON.decodeFromString(ComputerPlace.serializer(), """{"place":"boat","boat":true}""")
        assertTrue(ComputerPlace.byOwner(features, with))
        assertFalse(ComputerPlace.byOwner(features, without), "with the machine's key it is the admin's")
        assertFalse(ComputerPlace.byOwner(listOf("account-computer"), with), "an older server")
        assertFalse(ComputerPlace.byOwner(features, null))
        assertTrue(Api.JSON.decodeFromString(BoatSizes.serializer(), """{"size":"large","sizes":[],"ownKey":true}""").ownKey)
    }

    @Test fun aBotsMachineOfItsOwnShowsForABotOnBoatDevWhileTheAccountHasItsOwnKey() {
        assertEquals(listOf("" to "Shared with the account's bots", "own" to "Its own machine"),
            BotSettings.ownMachineChoices(true, features, ownKey = true, onBoat)?.map { it.id to it.label })
        assertNull(BotSettings.ownMachineChoices(false, features, true, onBoat), "Advanced off")
        assertNull(BotSettings.ownMachineChoices(true, features, ownKey = false, onBoat), "with the machine's key every bot shares the account's")
        assertNull(BotSettings.ownMachineChoices(true, features, true, bot("""{"id":"a","name":"A","computer":"linux"}""")), "only on the External Virtual PC")
        assertNull(BotSettings.ownMachineChoices(true, listOf("boat-own-key"), true, onBoat), "an older server")
        val own = bot("""{"id":"a","name":"A","computer":"boat","boatOwnMachine":true}""")
        assertTrue(own.boatOwnMachine)
        assertTrue(BotSettings.ownMachineChoices(true, features, ownKey = false, own) != null, "it has one already: it can come back")
    }

    @Test fun aChangeOfItsMachineIsSentAloneWithItsFilesWhenAsked() {
        val d = BotSettings.draft(onBoat, emptyList())
        assertFalse(d.boatOwnMachine)
        assertFalse("boatOwnMachine" in BotSettings.changes(onBoat, d, features, emptyList()), "nothing changed, nothing sent")
        val copy = BotSettings.changes(onBoat, d.withOwnMachine(true, move = true), features, emptyList())
        assertEquals("true", copy["boatOwnMachine"]?.toString())
        assertEquals("true", copy["moveFiles"]?.toString())
        assertFalse("computer" in copy || "computerPlace" in copy, "its place stays")
        val empty = BotSettings.changes(onBoat, d.withOwnMachine(true, move = false), features, emptyList())
        assertEquals("true", empty["boatOwnMachine"]?.toString())
        assertFalse("moveFiles" in empty, "Start empty")
        val back = BotSettings.draft(bot("""{"id":"a","name":"A","computer":"boat","boatOwnMachine":true}"""), emptyList())
        assertTrue(back.boatOwnMachine)
        assertEquals("false", BotSettings.changes(bot("""{"id":"a","name":"A","computer":"boat","boatOwnMachine":true}"""), back.withOwnMachine(false, move = false), features, emptyList())["boatOwnMachine"]?.toString())
    }

    @Test fun itsFilesAreAskedAboutAsAMoveOfItsComputerIs() {
        assertEquals("Copy its files to its own machine?", BotSettings.ownMachineQuestion(true))
        assertEquals("Copy its files to the account's machine?", BotSettings.ownMachineQuestion(false))
    }
}
