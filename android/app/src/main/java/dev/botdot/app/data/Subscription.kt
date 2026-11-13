package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Settings → "Subscription" (ADR 234): a managed machine's billing page, which the fleet console names and the front
 * door's session carries for this account (`subscriptionPage`). Only an https address behind a front door (`accounts`);
 * elsewhere, and from an older front door, null and no row.
 */
object Subscription {
    fun page(features: List<String>?, session: JsonObject?): String? {
        if (features?.contains("accounts") != true) return null
        val page = (session?.get("subscriptionPage") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        return page.takeIf { runCatching { java.net.URI(page) }.getOrNull()?.let { it.scheme == "https" && !it.host.isNullOrEmpty() } == true }
    }
}
