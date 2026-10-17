package dev.botdot.app.feed

import dev.botdot.app.data.FeedEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationAudienceTest {
    private fun event(type: String = "run_finished", data: String) = FeedEvent("boot.4", type, Json.parseToJsonElement(data).jsonObject)

    @Test fun internalResultsStaySilent() {
        for (status in listOf("success", "error", "interrupted")) {
            assertFalse(shouldNotifyOwner(event(data = """{"trigger":"bot","status":"$status","quiet":false}""")))
            assertFalse(shouldNotifyOwner(event(data = """{"trigger":"replies","status":"$status","notificationAudience":"internal"}""")))
        }
    }
    @Test fun ownerRepliesAndReleasedScheduledReportsRemainEligible() {
        for (trigger in listOf("manual", "schedule", "replies")) {
            assertTrue(shouldNotifyOwner(event(data = """{"trigger":"$trigger","notificationAudience":"owner","status":"success"}""")))
        }
        assertTrue(shouldNotifyOwner(event(data = """{"trigger":"manual","status":"error"}""")))
        assertTrue(shouldNotifyOwner(event(data = """{"trigger":"schedule","reporting":"delivered"}""")))
    }
    @Test fun quietAndForwardedRunsDoNotNotify() {
        assertFalse(shouldNotifyOwner(event(data = """{"notificationAudience":"owner","quiet":true}""")))
        assertFalse(shouldNotifyOwner(event(data = """{"notificationAudience":"owner","passedOn":true}""")))
    }
    @Test fun legacyMetadataIsRespected() {
        assertFalse(shouldNotifyOwner(event(data = """{"startedBy":"chief","trigger":"manual"}""")))
        assertFalse(shouldNotifyOwner(event(data = """{"fromBot":{"id":"peer"}}""")))
        assertTrue(shouldNotifyOwner(event(data = """{"trigger":"replies"}""")))
    }
    @Test fun chiefReportsAndApprovalsRemainEligible() {
        assertTrue(shouldNotifyOwner(event("chief_reply", """{"from":{"id":"peer"},"status":"success"}""")))
        assertFalse(shouldNotifyOwner(event("chief_reply", """{"status":"stopped"}""")))
        for (type in listOf("chief_suggestion", "approvals", "asks", "login_request", "bitwarden")) {
            assertTrue(shouldNotifyOwner(event(type, """{"from":{"id":"peer"}}""")))
        }
    }
}
