package dev.botdot.app.data

/** A mail draft in the Chief's chat (docs/api.md, "A mail draft", #415): what the card shows, decided once here. */
object MailCard {
    val SEND: String get() = tr("Send now")
    val KEEP: String get() = tr("Not now")

    /** The state line, without the sent time: "Sent" is followed by it. A look's draft ([MailDraft.unsaved], #422) is in no mailbox yet. */
    fun state(d: MailDraft) = when {
        d.state == "sent" -> tr("Sent")
        d.unsaved -> tr("Not sent")
        d.state == "kept" -> tr("Kept in Drafts · not sent")
        else -> tr("In Drafts · not sent")
    }

    /** The buttons on the card: Send now and Not now while it waits, Send now alone once kept, none when sent or folded. */
    fun actions(d: MailDraft) = when {
        d.earlier || d.state == "sent" -> emptyList()
        d.state == "kept" -> listOf(SEND)
        else -> listOf(SEND, KEEP)
    }

    /** How a file the mail carries opens: as the owner's upload in this chat, as a bot's file, or not at all (a name alone). */
    enum class Opens { OWN, RUN, NONE }
    fun opens(f: Attachment) = when {
        f.file.isBlank() -> Opens.NONE
        f.file.startsWith("uploads/") -> Opens.OWN
        else -> Opens.RUN
    }

    /** A chip of the run that wrote the draft: the card's footer takes its place. */
    fun takesChip(d: MailDraft?, a: ChiefAction) = d?.botId != null && (a.kind == "run" || a.kind == "from") && a.botId == d.botId
}
