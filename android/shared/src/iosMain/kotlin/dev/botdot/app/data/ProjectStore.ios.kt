package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Projects on the iPhone (#1366), for the botdot of [home]: a [ProjectDesk] on the same shared [Store] as Home, which
 * follows the live feed. [watch] hands the screen a new [ProjectState] after every change, on the main thread. Home
 * keeps one for the switch of spaces; each project's page keeps its own and [close]s it when it goes.
 */
class ProjectStore(home: HomeStore) {
    private val scope = MainScope()
    private val desk = ProjectDesk(home.store, home.api, scope)

    /** Calls [onChange] with the project's page now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (ProjectState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    fun show(id: String) = desk.show(id)

    /** The Files tile's files are asked while the page is on screen. */
    fun follow(on: Boolean) = desk.follow(on)

    @Throws(Exception::class) suspend fun refresh() = desk.refresh()
    @Throws(Exception::class) suspend fun tidy(): String = desk.tidy()
    @Throws(Exception::class) suspend fun chiefChat(): String = desk.chiefChat()

    fun openCard(id: String) = desk.openCard(id)
    fun closeCard() = desk.closeCard()
    @Throws(Exception::class) suspend fun ask(text: String) = desk.ask(text)
    @Throws(Exception::class) suspend fun answer(card: String, text: String) = desk.answer(card, text)
    @Throws(Exception::class) suspend fun closeQuestions(card: String) = desk.closeQuestions(card)
    @Throws(Exception::class) suspend fun refreshCard(card: String) = desk.refreshCard(card)
    @Throws(Exception::class) suspend fun removeCard(card: String) = desk.removeCard(card)
    @Throws(Exception::class) suspend fun putPiece(piece: String) = desk.putPiece(piece)

    fun offered(team: String): List<Bot> = desk.offered(team)
    fun newBotWords(team: String?): String = desk.newBotWords(team)
    @Throws(Exception::class) suspend fun addOwn(ids: List<String>): Boolean = desk.addOwn(ids)
    @Throws(Exception::class) suspend fun removeOwn(id: String): Boolean = desk.removeOwn(id)
    @Throws(Exception::class) suspend fun addToTeam(team: String, ids: List<String>): Boolean = desk.addToTeam(team, ids)
    @Throws(Exception::class) suspend fun makeLead(team: String, bot: String): Boolean = desk.makeLead(team, bot)

    @Throws(Exception::class) suspend fun rename(name: String): Boolean = desk.rename(name)
    @Throws(Exception::class) suspend fun setColor(color: String): Boolean = desk.setColor(color)
    @Throws(Exception::class) suspend fun setLead(bot: String?): Boolean = desk.setLead(bot)
    @Throws(Exception::class) suspend fun setArchived(on: Boolean): Boolean = desk.setArchived(on)

    fun close() {
        desk.close()
        scope.cancel()
    }
}
