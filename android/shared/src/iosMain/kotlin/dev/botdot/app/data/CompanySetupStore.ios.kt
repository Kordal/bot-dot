package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * A project's setup on the iPhone (#1366): a [CompanySetupDesk] on the same shared [Store] as Home, for the project the
 * Store shows ([newProject]: the start screen, for another one). [watch] hands the screen a new [SetupState] after
 * every change, on the main thread; [close] it when the screen goes.
 */
class CompanySetupStore(private val home: HomeStore) {
    private val scope = MainScope()
    private val desk = CompanySetupDesk(home.store, home.api, scope)

    /** Calls [onChange] with the setup now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (SetupState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    fun start() = desk.start()

    /** "New project": the start screen, for another project. */
    fun newProject() = home.store.newProject()

    fun addLink(typed: String): Boolean = desk.addLink(typed)

    /** A file picked on this phone, at [path] (a copy the app may read), uploaded for the Chief. */
    fun addFile(path: String, name: String) = desk.addFile(outgoingFile(path, name))

    fun removeSource(id: String) = desk.removeSource(id)

    @Throws(Exception::class) suspend fun go(typed: String): Boolean = desk.go(typed)
    @Throws(Exception::class) suspend fun scratch(typed: String): Boolean = desk.scratch(typed)
    @Throws(Exception::class) suspend fun chiefChat(): String = desk.chiefChat()

    fun review() = desk.review()
    fun back() = desk.back()
    fun rename(key: String, name: String) = desk.rename(key, name)
    fun remove(key: String) = desk.remove(key)
    fun tick(key: String, on: Boolean) = desk.tick(key, on)
    fun removeNever(index: Int) = desk.removeNever(index)

    @Throws(Exception::class) suspend fun changeTeam(typed: String): Boolean = desk.changeTeam(typed)
    @Throws(Exception::class) suspend fun undo() = desk.undo()
    @Throws(Exception::class) suspend fun approve(): Boolean = desk.approve()
    @Throws(Exception::class) suspend fun delete(dropFolder: Boolean): Boolean = desk.delete(dropFolder)

    fun close() = scope.cancel()
}
