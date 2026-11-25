package dev.botdot.app.data

/**
 * The row under the Chief's header: the three latest earlier chats, from the chat list the server already sends
 * (`GET /api/chief` `chats`, newest first), other than the open one. Written once for Android and iOS;
 * `public/chief.js` (`renderRecentChats`) is the web page's side.
 */
object RecentChats {
    const val SHOWN = 3

    /** The chats the row shows: the first [SHOWN] of [chats] that are not [openId]. A new chat has no open id, so it shows the latest three. */
    fun of(chats: List<ChiefChatSummary>, openId: String?): List<ChiefChatSummary> = chats.filter { it.id != openId }.take(SHOWN)

    /** Whether a chip carries the round mark before its title: the chat has new replies. */
    fun marked(chat: ChiefChatSummary): Boolean = chat.unread > 0
}
