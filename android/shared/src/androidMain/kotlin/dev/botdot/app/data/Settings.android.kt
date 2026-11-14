package dev.botdot.app.data

import android.content.Context
import androidx.datastore.preferences.preferencesDataStore

private val Context.store by preferencesDataStore("botdot")

/** What the app remembers, in the phone's preferences file "botdot". */
fun Settings(context: Context): Settings = Settings(context.store)
