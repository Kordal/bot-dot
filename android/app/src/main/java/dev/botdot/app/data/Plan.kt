package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A bot's or the Chief's plan (docs/api.md, "The plan"; ADR 057): the steps of its work, as the server reads them from
 * Claude Code's TodoWrite. While it works the plan stands in a dock above the message box; when the work is done it is
 * folded under the reply; when it was stopped or failed before its steps were done, the dock says "Stopped at step N
 * of M" until the owner dismisses it. The steps are the server's plain text, drawn as text.
 */
data class Plan(val steps: List<Step>) {
    /** One step: its words, "done", "doing" or "todo", and while it is at work what it is doing, or "". */
    data class Step(val text: String, val status: String, val doing: String = "")

    val total: Int get() = steps.size
    val done: Int get() = steps.count { it.status == DONE }
    /** The step it is on, from 1: the one at work, else the first that is not done, else the last. */
    val step: Int get() {
        val at = steps.indexOfFirst { it.status == DOING }.takeIf { it >= 0 } ?: steps.indexOfFirst { it.status != DONE }
        return (if (at >= 0) at else total - 1) + 1
    }
    /** The step it is on. */
    val now: Step? get() = steps.getOrNull(step - 1)
    val finished: Boolean get() = total > 0 && done == total
    /** The steps after the one it is on that are not done: "N steps not started" of a stopped plan. */
    val left: Int get() = steps.drop(step).count { it.status != DONE }

    companion object {
        const val DONE = "done"
        const val DOING = "doing"
        const val TODO = "todo"
        /** A plan longer than this folds its done steps into one row, until they are shown. */
        const val MANY = 6

        /** The plan as the server sends it, or null for none (or for anything that is not one). */
        fun of(e: JsonElement?): Plan? {
            val list = ((e as? JsonObject)?.get("steps") as? JsonArray) ?: return null
            val steps = list.mapNotNull { s ->
                val o = s as? JsonObject ?: return@mapNotNull null
                val text = o["text"].string() ?: return@mapNotNull null
                val status = o["status"].string()?.takeIf { it == DONE || it == DOING || it == TODO } ?: TODO
                Step(text, status, if (status == DOING) o["doing"].string().orEmpty() else "")
            }
            return steps.takeIf { it.isNotEmpty() }?.let { Plan(it) }
        }

        private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content?.ifEmpty { null }
    }
}

/** What the dock above a chat's message box shows: the plan of the work going on, or one that was stopped. [id]: whose. */
data class PlanView(val plan: Plan, val stopped: Boolean, val id: String) {
    companion object {
        /** A bot's chat, its runs newest first: its running run's plan, else its newest run's that ended before its plan was done. */
        fun ofBot(runs: List<Run>, dismissed: (String) -> Boolean): PlanView? {
            runs.firstOrNull { it.isRunning }?.let { r -> return r.plan?.let { PlanView(it, stopped = false, id = r.id) } }
            val last = runs.firstOrNull() ?: return null
            val plan = last.plan ?: return null
            return PlanView(plan, stopped = true, id = last.id).takeIf { last.status != "success" && !plan.finished && !dismissed(last.id) }
        }

        /** A Chief chat: its pending reply's plan, else its last reply's when that failed or was stopped before its plan was done. */
        fun ofChief(chatId: String, messages: List<ChiefMessage>, dismissed: (String) -> Boolean): PlanView? {
            val last = messages.lastOrNull { it.role == "chief" } ?: return null
            val plan = last.plan ?: return null
            val id = chiefId(chatId, last)
            if (last.pending) return PlanView(plan, stopped = false, id = id)
            return PlanView(plan, stopped = true, id = id).takeIf { last.failed && !plan.finished && !dismissed(id) }
        }

        /** A Chief reply's plan, for Dismiss: its chat and when it began (as the web page names it). */
        fun chiefId(chatId: String, m: ChiefMessage): String = "chief:$chatId:${m.at.orEmpty()}"
    }
}

/**
 * What the owner did with the plans on this phone: each chat's fold (folded by default, a phone's one line), and the
 * stopped plans they dismissed (the newest 50). [Keep] is where it is kept; none keeps it while the app runs.
 */
class PlanMemory(private val keep: Keep? = null) {
    interface Keep {
        fun read(key: String): String?
        fun write(key: String, value: String)
    }

    private val open = (keep?.read("open")?.split('\n')?.filter { it.isNotEmpty() } ?: emptyList()).toMutableSet()
    private val gone = (keep?.read("dismissed")?.split('\n')?.filter { it.isNotEmpty() } ?: emptyList()).toMutableList()

    fun folded(chat: String): Boolean = chat !in open
    fun setFolded(chat: String, folded: Boolean) {
        if (folded) open.remove(chat) else open.add(chat)
        keep?.write("open", open.joinToString("\n"))
    }
    fun dismissed(id: String): Boolean = id in gone
    fun dismiss(id: String) {
        gone.remove(id); gone.add(id)
        while (gone.size > 50) gone.removeAt(0)
        keep?.write("dismissed", gone.joinToString("\n"))
    }
}
