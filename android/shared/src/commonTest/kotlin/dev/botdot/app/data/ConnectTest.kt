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

    @Test fun theSignInPageNamesThisPhonesApp() {
        val page = Handoff.start("https://hq.example.com/", 0).page
        assertTrue(page.startsWith("https://hq.example.com/sign-in?app=$signInApp&handoff="), page)
        assertTrue(signInApp == "android" || signInApp == "ios")
    }
}
