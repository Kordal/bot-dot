package dev.botdot.app.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.navigation.NavBackStackEntry

/**
 * How one screen takes another's place in the NavHost (#496), in place of Navigation's 700 ms fade. On a phone a
 * screen pushes in from the right and slides back out, which predictive back follows with the finger; beside the
 * list a chat cross-fades with the one before it; the Board grows in and shrinks back.
 */
object ScreenMotion {
    enum class Kind { PUSH, FADE, BOARD }

    /** The screens that stand in place of all (signing in, connecting, a paused account): they come and go as a fade. */
    private val ALONE = setOf("connect", "sign-in", "paused")

    /** The movement from [from] to [to] (routes as the NavHost names them); [back]: [from] is being left by Back. */
    fun kind(from: String?, to: String?, wide: Boolean, back: Boolean): Kind = when {
        (if (back) from else to) == "dashboard" -> Kind.BOARD
        wide || from == null || to == null || from in ALONE || to in ALONE -> Kind.FADE
        else -> Kind.PUSH
    }

    private fun AnimatedContentTransitionScope<NavBackStackEntry>.kind(wide: Boolean, back: Boolean) =
        kind(initialState.destination.route, targetState.destination.route, wide, back)

    fun enter(wide: Boolean): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        when (kind(wide, back = false)) {
            Kind.PUSH -> slideInHorizontally(Motion.enter(Motion.SLOW)) { it }
            Kind.FADE -> fadeIn(Motion.enter())
            Kind.BOARD -> scaleIn(Motion.enter(), initialScale = 0.98f) + fadeIn(Motion.enter())
        }
    }

    /** The screen under a new one: it moves a quarter to the left, as long as the new one takes to come in. */
    fun exit(wide: Boolean): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        when (kind(wide, back = false)) {
            Kind.PUSH -> slideOutHorizontally(Motion.enter(Motion.SLOW)) { -it / 4 }
            Kind.FADE, Kind.BOARD -> fadeOut(Motion.exit())
        }
    }

    /** Back: the screen below comes back from where it went. */
    fun popEnter(wide: Boolean): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        when (kind(wide, back = true)) {
            Kind.PUSH -> slideInHorizontally(Motion.enter()) { -it / 4 }
            Kind.FADE, Kind.BOARD -> fadeIn(Motion.enter(Motion.FAST))
        }
    }

    /** Back: the screen on top leaves one step faster than it came. */
    fun popExit(wide: Boolean): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        when (kind(wide, back = true)) {
            Kind.PUSH -> slideOutHorizontally(Motion.exit(Motion.BASE)) { it }
            Kind.FADE -> fadeOut(Motion.exit())
            Kind.BOARD -> scaleOut(Motion.exit(), targetScale = 0.98f) + fadeOut(Motion.exit())
        }
    }
}
