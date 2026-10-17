package dev.botdot.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until

const val PACKAGE = "dev.botdot.app"

/**
 * The first steps most visits take. The app is installed afresh, so it starts on the Connect screen: with a botdot's
 * address passed in (-Pandroid.testInstrumentationRunnerArguments.server=http://10.0.2.2:4801) it connects to it;
 * without one only the start is covered.
 */
fun MacrobenchmarkScope.usualSteps() {
    val server = InstrumentationRegistry.getArguments().getString("server")
    if (server != null && device.wait(Until.hasObject(By.text("Connect")), 3_000)) {
        device.findObject(By.clazz("android.widget.EditText"))?.text = server
        device.findObject(By.text("Connect"))?.click()
    }
    // The list: its Search button shows once it's there; then a moment for what it shows to come in (rows move meanwhile).
    if (!device.wait(Until.hasObject(By.desc("Search")), 10_000)) return
    settle()
    scroll()
    // The Chief's chat, then back: its row in the list, or on a phone its message box under the sections of keys.
    (device.findObject(By.text("Chief of Staff")) ?: device.findObject(By.text("Ask the Chief…")))?.let {
        it.click()
        if (device.wait(Until.hasObject(By.desc("New chat")), 5_000)) { settle(); scroll(up = true) }
        device.pressBack()
    }
    // The first bot's chat, then back: a row (on a phone a key) with its name and its last message, not a group's heading (NAME ▾).
    if (!device.wait(Until.hasObject(By.desc("Search")), 5_000)) return
    settle()
    val bot = device.findObjects(By.clickable(true).hasChild(By.clazz("android.widget.TextView"))).firstOrNull { row ->
        val texts = row.children.mapNotNull { it.text }
        texts.size >= 2 && texts.none { it == "Needs you" || it == "▾" }
    } ?: return
    bot.click()
    if (device.wait(Until.hasObject(By.desc("Its settings")), 5_000)) { settle(); scroll(up = true) }
    device.pressBack()
    settle()
}

private fun MacrobenchmarkScope.settle() { device.waitForIdle(); Thread.sleep(1_500); device.waitForIdle() }

/** A fling in the middle of the screen: down the list, or up a chat (to its older messages). */
private fun MacrobenchmarkScope.scroll(up: Boolean = false) {
    val x = device.displayWidth / 2
    val (from, to) = device.displayHeight * 3 / 4 to device.displayHeight / 4
    if (up) device.swipe(x, to, x, from, 8) else device.swipe(x, from, x, to, 8)
    device.waitForIdle()
    if (up) device.swipe(x, from, x, to, 8) else device.swipe(x, to, x, from, 8)
    device.waitForIdle()
}
