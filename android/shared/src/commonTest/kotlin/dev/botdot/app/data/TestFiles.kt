package dev.botdot.app.data

import kotlin.test.assertEquals
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readString

/**
 * A file of the repository that every app's tests read alike (test/fixtures, lib/figure.json), by its key in
 * FIXTURES (written by the build, android/shared/build.gradle.kts). Read where the build put the repository, on
 * Android's host and in the iOS simulator alike.
 */
fun fixture(key: String): String =
    SystemFileSystem.source(Path(FIXTURES[key] ?: error("No fixture $key"))).buffered().use { it.readString() }

/**
 * Polish's words of [kind] (lib/i18n/pl/phrases.json, ADR 280), which the apps get from the server with the dictionary:
 * what the shared fixtures' Polish cases read with.
 */
fun polishPhrases(kind: String): List<String> =
    (kotlinx.serialization.json.Json.parseToJsonElement(fixture("polishPhrases")) as kotlinx.serialization.json.JsonObject)[kind]
        .let { it as? kotlinx.serialization.json.JsonArray }?.map { (it as kotlinx.serialization.json.JsonPrimitive).content }.orEmpty()

/** JUnit's assertArrayEquals for floats: the same length, each within [delta]. */
fun assertArrayEquals(expected: FloatArray, actual: FloatArray, delta: Float, message: String? = null) {
    assertEquals(expected.size, actual.size, message)
    for (i in expected.indices) assertEquals(expected[i], actual[i], delta, (message?.let { "$it: " } ?: "") + "[$i]")
}
