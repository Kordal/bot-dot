package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SubscriptionTest {
    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject
    private val accounts = listOf("accounts")

    @Test fun aManagedMachineNamesItsBillingPage() {
        val url = "https://billing.example/p?a=solo"
        assertEquals(url, Subscription.page(accounts, obj("""{"account":"solo","subscriptionPage":"$url"}""")))
        assertEquals("a scheme in capitals", "HTTPS://billing.example/p", Subscription.page(accounts, obj("""{"subscriptionPage":"HTTPS://billing.example/p"}""")))
    }

    @Test fun noRowWithoutAnHttpsPage() {
        assertEquals("no front door", null, Subscription.page(emptyList(), obj("""{"subscriptionPage":"https://billing.example"}""")))
        assertEquals("an older front door", null, Subscription.page(accounts, obj("""{"account":"solo"}""")))
        assertEquals("a self-hosted machine", null, Subscription.page(accounts, obj("""{"subscriptionPage":null}""")))
        assertEquals("not a string", null, Subscription.page(accounts, obj("""{"subscriptionPage":42}""")))
        assertEquals(null, Subscription.page(accounts, null))
        for (bad in listOf("http://billing.example", "javascript:alert(1)", "nope", "https://")) {
            assertEquals(bad, null, Subscription.page(accounts, obj("""{"subscriptionPage":"$bad"}""")))
        }
    }
}
