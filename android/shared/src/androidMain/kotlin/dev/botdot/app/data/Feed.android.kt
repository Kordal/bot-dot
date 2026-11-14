package dev.botdot.app.data

import android.content.SharedPreferences

/** The feed's place kept in Android's preferences ("server" and "lastId"), as before the feed was shared. */
fun feedKeep(prefs: SharedPreferences): Feed.Keep = object : Feed.Keep {
    override fun server(): String? = prefs.getString("server", null)
    override fun lastId(): String? = prefs.getString("lastId", null)
    override fun write(server: String, lastId: String?) { prefs.edit().putString("server", server).putString("lastId", lastId).apply() }
}
