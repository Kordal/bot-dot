package dev.botdot.app.data

/**
 * What a phone says once before the first message goes (App Store guideline 5.1.2(i), #1374): the bots run on Claude by
 * Anthropic, so what is sent to them goes to Anthropic. Accepted once on the device ([Settings.setAiNoticeSeen]); the
 * iPhone shows it before its first send.
 */
object AiNotice {
    val text: String get() = tr("Your bots run on Claude by Anthropic. What you send them goes to Anthropic.")
    val go: String get() = tr("Continue")

    /** Whether a send waits for the notice first: not once it was accepted on this device. */
    @Throws(Exception::class)
    suspend fun asks(settings: Settings): Boolean = !settings.aiNoticeSeenNow()
}
