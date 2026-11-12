package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Settings → "Delete account" (#1307), against a stand-in front door: shown only where the front door's session says
 * this account may, never for the admin's own account, Delete only for the account's name typed exactly, and sent to
 * the front door's own route.
 */
class AccountDeletionTest {
    private lateinit var door: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        door = MockWebServer()
        door.start()
        api = Api(door.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = door.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
    private fun obj(s: String) = Api.JSON.parseToJsonElement(s).jsonObject

    @Test fun showsOnlyWhereTheFrontDoorSaysThisAccountMay() {
        val accounts = listOf("accounts")
        assertTrue(AccountDeletion.on(accounts, obj("""{"account":"bob","admin":false,"deleteAccount":true}""")))
        assertFalse("an older front door", AccountDeletion.on(accounts, obj("""{"account":"bob","admin":false}""")))
        assertFalse("no front door", AccountDeletion.on(emptyList(), obj("""{"deleteAccount":true}""")))
        assertFalse("not a boolean", AccountDeletion.on(accounts, obj("""{"deleteAccount":"true"}""")))
        assertFalse("no session", AccountDeletion.on(accounts, null))
    }

    @Test fun theAdminsOwnAccountIsNotOfferedItAndIsToldWhy() {
        val admin = obj("""{"account":"ann","admin":true,"deleteAccount":false}""")
        assertFalse(AccountDeletion.on(listOf("accounts"), admin))
        assertTrue(AccountDeletion.adminNote(listOf("accounts"), admin))
        assertFalse("an older front door says nothing", AccountDeletion.adminNote(listOf("accounts"), obj("""{"account":"ann","admin":true}""")))
        assertFalse("not the admin", AccountDeletion.adminNote(listOf("accounts"), obj("""{"account":"bob","admin":false,"deleteAccount":false}""")))
    }

    @Test fun deleteWorksOnlyForTheNameTypedExactly() {
        val account = AccountDeletion.account(obj("""{"account":"bob","deleteAccount":true}"""))
        assertEquals("bob", account)
        assertTrue(AccountDeletion.matches("bob", account))
        for (wrong in listOf("", "bo", "Bob", "bob ", " bob")) assertFalse(wrong, AccountDeletion.matches(wrong, account))
        assertFalse("no account sent", AccountDeletion.matches("", AccountDeletion.account(obj("{}"))))
    }

    @Test fun sendsTheNameToTheFrontDoorsOwnRouteAndSaysARefusal() = runBlocking {
        door.enqueue(json("""{"ok":true,"deleted":"/front-door/deleted"}"""))
        api.deleteAccount("bob")
        val r = door.takeRequest()
        assertEquals("POST" to "/front-door/delete-account", r.method to r.target)
        assertEquals("1", r.headers["X-Bot-Dot"])
        assertEquals("bob", Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject["name"]!!.jsonPrimitive.content)

        door.enqueue(json("""{"error":"ann is the admin's account: it can't be deleted here. The machine is removed by its admin instead."}""", 409))
        try { api.deleteAccount("ann"); fail("refused") } catch (e: ApiException) { assertTrue(e.message!!.contains("removed by its admin")) }
    }
}
