package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The address a phone is given (Connect), and the sign-in page it opens, alike on both phones. */
class ConnectTest {
    @Test fun anAddressOnTheTailnetIsCheckedAsHttps() {
        assertEquals(Connect.Address.Remote("https://my-vm.tailnet.ts.net"), Connect.address(" my-vm.tailnet.ts.net/ "))
        assertEquals(Connect.Address.Remote("https://hq.example.com:8443"), Connect.address("https://hq.example.com:8443/sign-in"))
        assertNull(Connect.words(Connect.address("hq.example.com")))
    }

    @Test fun aBotdotOnTheComputerItselfIsExplainedNotChecked() {
        for (a in listOf("localhost", "http://localhost:4747", "127.0.0.1:4747", "https://127.0.0.2", "http://[::1]:4747", "app.localhost")) {
            assertEquals(Connect.Address.Local, Connect.address(a), a)
        }
        assertNotNull(Connect.words(Connect.Address.Local))
    }

    @Test fun plainHttpToAnotherComputerAndNonsenseAreRefused() {
        assertEquals(Connect.Address.Insecure, Connect.address("http://hq.example.com"))
        assertEquals("Use HTTPS for a remote botdot server.", Connect.words(Connect.Address.Insecure))
        assertEquals(Connect.Address.NotAnAddress, Connect.address("   "))
        assertEquals(Connect.Address.NotAnAddress, Connect.address("https://user:pw@hq.example.com"))
    }

    @Test fun aFailedCheckIsNeverConnected() {
        assertEquals("The connection dropped", Connect.answer(null, IllegalStateException()))
        assertEquals("The connection dropped", Connect.answer(null, ApiException(" ")))
        assertEquals("Can't reach it", Connect.answer(null, ApiException("Can't reach it")))
        assertEquals("This botdot is older than the app. Ask its admin to update it, then connect again.", Connect.answer(null, ApiException("Unknown endpoint", 404)))
    }

    @Test fun aBotdotOrItsFrontDoorIsConnected() {
        assertNull(Connect.answer(VersionInfo(app = "bot-dot", apiVersion = Connect.API_VERSION), null))
        assertNull(Connect.answer(VersionInfo(app = "bot-dot", frontDoor = true), null))
        assertEquals("That address answers, but it isn't botdot.", Connect.answer(VersionInfo(app = "other"), null))
        assertEquals("This botdot is newer than the app. Update the app.", Connect.answer(VersionInfo(app = "bot-dot", apiVersion = Connect.API_VERSION + 1), null))
    }
}
