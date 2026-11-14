package dev.botdot.app.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ProjectCreationTest {
    @Test fun whitespaceEditsKeepTheSameEffectiveCreationRequest() {
        assertEquals("Prepare the talk", CompanySetup.creationText("  Prepare  the talk \n"))
    }

    @Test fun onlyTheNegotiatedRequestOptsIntoConversationAndKeepsItsRetryKey() {
        val sources = listOf(SourceDraft("link", "link", "Brief", "https://example.com/brief"))
        val legacy = CompanySetup.startBody("  Launch  ", sources)
        assertFalse(legacy.containsKey("conversation"))
        val next = CompanySetup.startBody("  Launch  ", sources, "creation-test-003")
        assertTrue(next.getValue("conversation").jsonPrimitive.boolean)
        assertEquals("creation-test-003", next.getValue("key").jsonPrimitive.content)
        assertEquals(legacy.getValue("sources"), next.getValue("sources"))
    }

    @Test fun draftSourcesRetainTheirUploadsAndFailuresAcrossRestoration() {
        val list = listOf(SourceDraft("file", "file", "brief.txt", upload = Attachment(name = "brief.txt", file = "uploads/brief.txt")), SourceDraft("failed", "file", "retry.txt", failed = true))
        val serializer = ListSerializer(SourceDraft.serializer())
        assertEquals(list, Api.JSON.decodeFromString(serializer, Api.JSON.encodeToString(serializer, list)))
    }

    @Test fun conversationalSetupOpensItsChiefAndLegacySetupStillHasNoPrimaryChat() {
        val c = Company(id = "p", conversation = true, chiefChat = "c", creationSent = true)
        val features = listOf("project-chief", "project-conversation")
        assertEquals("chief/c", Spaces.defaultChat(c, emptyList(), features))
        assertEquals("project-chief/p", Spaces.defaultChat(c.copy(creationSent = false), emptyList(), features))
        assertNull(Spaces.defaultChat(c.copy(conversation = false), emptyList(), features))
        assertNull(Spaces.defaultChat(c, emptyList(), listOf("project-chief")))
    }
}
