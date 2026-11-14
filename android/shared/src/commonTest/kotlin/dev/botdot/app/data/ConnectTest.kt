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

    @Test fun anAddressOnTheDeviceIsTriedAsTheAndroidAppAlwaysDid() {
        assertEquals(Connect.Address.Local("http://localhost:4747"), Connect.address("http://localhost:4747"))
        assertEquals(Connect.Address.Local("https://127.0.0.1:4747"), Connect.address("127.0.0.1:4747"))
        assertEquals(Connect.Address.Local("http://[::1]:4747"), Connect.address("http://[::1]:4747"))
        assertEquals(Connect.Address.Local("https://app.localhost"), Connect.address("app.localhost"))
        // Plain HTTP only to localhost itself and loopback addresses: a phone's resolver may send another .localhost name
        // to DNS, and the session's cookie would go out unencrypted (ReleaseManifest.secureURL).
        assertEquals(Connect.Address.Insecure, Connect.address("http://app.localhost:4747"))
        assertEquals(Connect.Address.Insecure, Connect.address("http://app.example.com"), "remote plain HTTP stays refused")
    }

    @Test fun nothingAnsweringOnTheDeviceIsExplainedAsSo() = kotlinx.coroutines.test.runTest {
        val o = Connect.connect("http://127.0.0.1:1") // nothing listens on port 1
        assertEquals(Connect.Outcome.Refused("That address is on a computer, and only that computer reaches it: a phone can't. Use your botdot's address on your tailnet, the one you open in the browser on the phone."), o)
    }

    @Test fun plainHttpIsRefusedBeforeAnythingIsAsked() = kotlinx.coroutines.test.runTest {
        assertEquals(Connect.Outcome.Refused("Use HTTPS for a remote botdot server."), Connect.connect("http://hq.example.com"))
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
