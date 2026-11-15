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

    /** A share's message key: kept while it is tried again, so botdot takes it once. */
    fun key(): String = newMessageKey()

    /**
     * What a share has done so far, kept by its caller beside its key: a retry after a failure sends what is left,
     * with the files uploaded before and the Chief's conversation made before, so nothing is uploaded or made twice.
     */
    class Pending {
        /** The message's key, for the words it was made for: words changed after a failure are a new message. */
        internal var key: String? = null
        internal var words: String? = null
        internal var to: String? = null
        /** Each file uploaded, by its place among those shared: a retry uploads only the ones that didn't go. */
        internal val uploaded = mutableMapOf<Int, Attachment>()
        internal var chat: String? = null
    }

    /** The picker's title: the files it carries, or the words when it carries none. */
    fun title(files: Int): String = when {
        files > 1 -> trn(files, "Send {n} file to…", "Send {n} files to…")
        files == 1 -> tr("Send the file to…")
        else -> tr("Send the text to…")
    }

    /** What the picker draws: who can get it, or why botdot couldn't be read ([failed], its sentence), the Chief still first. */
    data class Picker(val picks: List<Pick>, val failed: String?)

    /**
     * The picker as botdot answers it: the Chief and its bots. Not read (offline, a session that ended, a paused
     * account): the Chief alone, and botdot's sentence. The Chief's name falls back to its role.
     */
    @Throws(Exception::class)
    suspend fun picker(api: Api): Picker {
        val chief = try { api.setup().chiefName } catch (e: CancellationException) { throw e } catch (_: Exception) { ChiefName.role }
        return try {
            Picker(picks(api.bots(), chief), null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Picker(picks(emptyList(), chief), e.message ?: tr("Couldn't load"))
        }
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
    suspend fun send(api: Api, to: String, text: String, files: List<OutgoingFile>, pending: Pending = Pending()): String? {
        val words = text.trim()
        if (words.isEmpty() && files.isEmpty()) return tr("Nothing to send")
        // The same words keep their key, so botdot takes them once; edited after a failure, they are another message
        // and get a new one (its files, uploaded already for the same one, stay).
        if (pending.key == null || pending.words != words) { pending.key = key(); pending.words = words }
        val key = pending.key!!
        // Another one picked after a failure: its files go up for it, and the Chief's conversation isn't it.
        if (pending.to != to) { pending.to = to; pending.uploaded.clear(); pending.chat = null }
        return try {
            // Where botdot keeps a message's file: the Chief's, or the bot's ("bot:<id>"), as its chat uploads them.
            val at = if (to == CHIEF) "chief" else "bot:$to"
            val attachments = files.mapIndexed { i, f -> pending.uploaded[i] ?: api.upload(f, at).also { pending.uploaded[i] = it } }
            if (to == CHIEF) {
                val chat = pending.chat ?: api.newChiefChat().id.also { pending.chat = it }
                api.sendToChief(chat, words, attachments, key)
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
