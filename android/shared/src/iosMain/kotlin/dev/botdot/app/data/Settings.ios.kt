package dev.botdot.app.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import okio.Path.Companion.toPath

/**
 * What the iPhone app remembers (the botdot it talks to, and the rest Settings keeps), in the file `botdot.preferences_pb`
 * of [directory]: the app's own Application Support, or the App Group's folder it shares with its extension. Make one
 * per directory for the app's whole life.
 */
fun settingsIn(directory: String): Settings =
    Settings(PreferenceDataStoreFactory.createWithPath(produceFile = { "${directory.trimEnd('/')}/botdot.preferences_pb".toPath() }))
