package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * Sharing from another app to a bot or the Chief (#1373; Android's ShareScreen): who can get it, what the picker says,
 * and the send itself, for the iPhone's share extension. The files go up to the one picked, then one message carries
 * them with the words: to a bot's chat, or to a new conversation with the Chief, which can pass it on.
 */
object Share {
    /** Who the Chief is in the picker, beside the bots' ids. */
    const val CHIEF = "chief"

    /** One row of the picker: the Chief first, then each bot by its name. */
    data class Pick(val id: String, val name: String, val line: String, val color: String?)

    /** The picker's title: the files it carries, or the words when it carries none. */
    fun title(files: Int): String = when {
        files > 1 -> trn(files, "Send {n} file to…", "Send {n} files to…")
        files == 1 -> tr("Send the file to…")
        else -> tr("Send the text to…")
    }

    /** The Chief, then the bots in their names' order, as Android's picker lists them. */
    fun picks(bots: List<Bot>, chiefName: String): List<Pick> =
        listOf(Pick(CHIEF, chiefName, tr("It can pass it on to the right bot"), CHIEF_COLOR)) +
            bots.sortedBy { it.name.lowercase() }.map { Pick(it.id, it.name, it.description, it.color) }

    /**
     * Sends [text] and [files] to [to] (a bot's id, or [CHIEF]): null once it went, else why not, in the app's words or
     * botdot's. Nothing is sent when there is nothing to send. One key for the message, so a retry is taken once.
     */
    @Throws(Exception::class)
    suspend fun send(api: Api, to: String, text: String, files: List<OutgoingFile>, key: String = newMessageKey()): String? {
        val words = text.trim()
        if (words.isEmpty() && files.isEmpty()) return tr("Nothing to send")
        return try {
            val attachments = files.map { api.upload(it, to) }
            if (to == CHIEF) {
                val chat = api.newChiefChat()
                api.sendToChief(chat.id, words, attachments, key)
            } else {
                api.runBot(to, words, attachments, key)
            }
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: tr("Couldn't send")
        }
    }
}
