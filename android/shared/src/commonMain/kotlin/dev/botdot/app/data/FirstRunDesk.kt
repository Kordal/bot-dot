package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Clock

/**
 * What Home reads once botdot's features are known (#1372): what the front door offers ([offers]: Feedback, Delete
 * account; null while not read), the notes of What's new not seen yet, and the first run's question for the Chief's
 * name ([askName]). What's new shows only once the name was answered ([showsWhatsNew]).
 */
data class FirstRunState(val offers: FrontDoorOffers?, val whatsNew: List<WhatsNew.Entry>, val askName: Boolean) {
    val showsWhatsNew: Boolean get() = whatsNew.isNotEmpty() && !askName
}

/**
 * Home's first reads for the iPhone, with the Android app's rules (ADR 242): asked at once, all together, when the
 * features are first known; a front door that wasn't reached is asked again on pull to refresh, and on Home's next
 * change once [FirstRunDesk.AGAIN_MS] have passed ([now] is the clock, for the tests).
 */
class FirstRunDesk(
    private val api: Api,
    private val scope: CoroutineScope,
    private val zone: String,
    private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    private data class Asked(val first: Boolean = false, val offersAt: Long? = null, val offersReading: Boolean = false)

    private val asked = MutableStateFlow(Asked())
    private val _state = MutableStateFlow(FirstRunState(null, emptyList(), false))
    val state: StateFlow<FirstRunState> = _state.asStateFlow()

    /** Calls [onChange] with the state now and after every change, until the returned job is cancelled. */
    fun watch(onChange: (FirstRunState) -> Unit) = scope.launch { _state.collect { onChange(it) } }

    /** Home drew botdot's [features]: the first time everything is read; after that, offers not read yet are asked again. */
    fun saw(features: List<String>?) {
        if (features == null) return
        var first = false
        asked.update { if (it.first) it else { first = true; it.copy(first = true, offersReading = true) } }
        if (first) {
            scope.launch {
                val offers = async { quiet { FrontDoorDesk(api).read(features) } }
                val notes = async { quiet { WhatsNew.unseen(api, features) }.orEmpty() }
                val ask = async { quiet { ChiefName.firstRun(api, features, zone) } == true }
                // All at once: the name's question first, What's new after it is answered.
                _state.value = FirstRunState(offers.await(), notes.await(), ask.await())
                asked.update { it.copy(offersAt = now(), offersReading = false) }
            }
            return
        }
        val at = asked.value.offersAt ?: return
        if (_state.value.offers == null && now() - at > AGAIN_MS) readOffers(features)
    }

    /** Pull to refresh: offers not read yet are asked again at once. */
    fun refresh(features: List<String>?) {
        if (features != null && asked.value.offersAt != null && _state.value.offers == null) readOffers(features)
    }

    private fun readOffers(features: List<String>) {
        var claimed = false
        asked.update { if (it.offersReading) it else { claimed = true; it.copy(offersReading = true) } }
        if (!claimed) return
        scope.launch {
            val o = quiet { FrontDoorDesk(api).read(features) }
            if (o != null) _state.update { if (it.offers == null) it.copy(offers = o) else it }
            asked.update { it.copy(offersAt = now(), offersReading = false) }
        }
    }

    /** Save or Skip ("") on the Chief's name: null once it was kept (the question goes), else why not, and it stays. */
    @Throws(Exception::class)
    suspend fun nameChief(given: String): String? {
        val failed = try { ChiefName.answer(api, given) } catch (e: CancellationException) { throw e } catch (e: Exception) { e.message ?: tr("Couldn't save the name") }
        if (failed == null) _state.update { it.copy(askName = false) }
        return failed
    }

    /** What's new closed, any way: its notes are seen, here and in every other app. */
    fun whatsNewClosed() {
        val shown = _state.value.whatsNew
        _state.update { it.copy(whatsNew = emptyList()) }
        scope.launch { quiet { WhatsNew.seen(api, shown) } }
    }

    private suspend fun <T> quiet(read: suspend () -> T): T? = try { read() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }

    companion object {
        /** A front door that wasn't reached is asked again on Home's next change after this long. */
        const val AGAIN_MS = 30_000L
    }
}
