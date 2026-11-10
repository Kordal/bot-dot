package dev.botdot.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Go on the start screen of "New project": botdot sends the feed's `project` event for the new project before it
 * answers the POST, so the project is in the list before the answer comes. The new project is shown all the same,
 * not the start screen again (the arrow seemed to do nothing, and a second tap made it twice).
 */
class StoreNewProjectTest {
    private val features = listOf(CompanySetup.FEATURE, CompanySetup.MANY)
    private fun project(id: String, name: String) = """{"id":"$id","name":"$name","start":"$name","phase":"setup"}"""

    @Test fun theNewProjectIsShownWhenTheFeedToldOfItFirst() {
        val bg = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val api = Api("http://127.0.0.1:9")
            val store = Store(bg, MutableStateFlow(api))
            store.version.set(VersionInfo(version = "1", features = features))
            store.company.set(CompanyHeld(null))
            store.handle(FeedEvent("1", "project", Api.JSON.parseToJsonElement("""{"id":"p1","project":${project("p1", "Bakery")}}""").jsonObject))
            store.showProject("p1")
            assertEquals("p1", store.company.value.value?.company?.id)

            store.newProject()
            assertEquals(null, store.company.value.value?.company)
            val made = Api.JSON.decodeFromString(Company.serializer(), project("p2", "Bod-dot.app"))
            // The feed first, then the answer to the POST.
            store.handle(FeedEvent("2", "project", Api.JSON.parseToJsonElement("""{"id":"p2","project":${project("p2", "Bod-dot.app")}}""").jsonObject))
            assertEquals("the start screen is still on until the answer", null, store.company.value.value?.company)
            store.tookProject(made, made = true)
            assertEquals("p2", store.company.value.value?.company?.id)
            assertEquals("p2", api.project)
            assertFalse(store.addingProject.value)
            assertEquals(listOf("p1", "p2"), store.projectList.value.map { it.id })

            // A change of another project, while one is shown, does not take its place.
            store.tookProject(Company("p1", name = "Bakery 2"))
            assertEquals("p2", store.company.value.value?.company?.id)
        } finally {
            bg.cancel()
        }
    }
}
