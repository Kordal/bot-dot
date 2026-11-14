package dev.botdot.app.data

import android.content.Context
import androidx.core.content.edit

/** The phone's own keeping: private to the app, which Android never backs up (allowBackup is off). */
fun Session.Companion.onPhone(context: Context) = Session(object : Session.Keep {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    override fun read(server: String) = prefs.getString(server, null)
    override fun write(server: String, token: String?) {
        prefs.edit { if (token == null) remove(server) else putString(server, token) }
    }
})
