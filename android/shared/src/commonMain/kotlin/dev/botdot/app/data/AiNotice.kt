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

    /**
     * A message box's Send, held for the notice the first time ([settings] null: never held, as in the tests' boxes).
     * [send] answers the words to send now, or null: held while the notice shows, or a tap while one is checked or
     * held already, which does nothing. [accept] keeps the acceptance and gives the held words to send; [dismiss] (the
     * notice swiped away) sends nothing, and the words stay in the box.
     */
    class Gate(private val settings: Settings?) {
        // A send being checked: claimed in one compare-and-set, so a second tap meanwhile does nothing.
        private val checking = kotlinx.coroutines.flow.MutableStateFlow(false)
        private var held: String? = null

        /** The notice shows: its words are held. */
        val asking: Boolean get() = held != null

        @Throws(Exception::class)
        suspend fun send(text: String): String? {
            if (held != null || !checking.compareAndSet(false, true)) return null
            try {
                val s = settings ?: return text
                if (!asks(s)) return text
                held = text
                return null
            } finally {
                checking.value = false
            }
        }

        @Throws(Exception::class)
        suspend fun accept(): String? {
            val words = held ?: return null
            settings?.setAiNoticeSeen()
            held = null
            return words
        }

        fun dismiss() { held = null }
    }
}
