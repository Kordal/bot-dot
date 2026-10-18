package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * An ask answered on the Needs you screen, kept for the chats its card stood in (issue #29): the chat of the bot
 * that asked, the Chief's, a group's ([chatsOf]). [key] is the card's ("a:<id>"), [title] what it was about and
 * [label] what the owner said ("Allowed · it carries on"), as the faded line under a card answered in the chat.
 */
data class AnsweredAsk(val key: String, val scopes: Set<String>, val title: String, val label: String)

/**
 * The answers given on the Needs you screen, until each chat they belong to has taken them. A chat takes its own
 * when it is drawn ([take]) and then shows them as it shows a card answered there: a faded line, until it is left.
 * The web page keeps the same (`answeredAway` in public/app.js).
 */
class AnsweredAway {
    private val _value = MutableStateFlow<List<AnsweredAsk>>(emptyList())
    val value: StateFlow<List<AnsweredAsk>> = _value.asStateFlow()

    /** [a] was answered on the Needs you screen: each chat its card stood in will say so. */
    fun add(a: Ask, title: String, label: String) {
        val scopes = chatsOf(a)
        if (scopes.isEmpty()) return
        val key = "a:${a.id}"
        _value.update { list -> list.filter { it.key != key } + AnsweredAsk(key, scopes, title, label) }
    }

    /** The answers for the chat [scope], taken out: another chat keeps its own. */
    fun take(scope: String): List<AnsweredAsk> {
        var mine = emptyList<AnsweredAsk>()
        _value.update { list ->
            mine = list.filter { scope in it.scopes }
            list.mapNotNull { if (scope in it.scopes) it.copy(scopes = it.scopes - scope).takeIf { c -> c.scopes.isNotEmpty() } else it }
        }
        return mine
    }

    /** Another botdot: forget what this one was told. */
    fun clear() { _value.value = emptyList() }

    companion object {
        /** The chats [a]'s card stands in besides Needs you, by the rule that draws it there ([standsInChat]). */
        fun chatsOf(a: Ask): Set<String> = listOfNotNull(a.bot?.id, "chief", a.group?.let { "group:${it.id}" }).filter { a.standsInChat(it) }.toSet()
    }
}
