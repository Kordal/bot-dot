package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import dev.botdot.app.data.Company
import dev.botdot.app.data.tr

/** The conversation's landing page, including the route back to the exact first-step review. */
@Composable
internal fun ProjectCreationIntro(c: Company, onChat: () -> Unit, onReview: () -> Unit, header: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        header()
        Text(c.start, color = p.text)
        Text(tr("Discuss the first step with the Chief. Review the proposal before anything starts."), color = p.muted)
        if (c.firstStep.isNotBlank()) {
            Text(tr("First step"), fontSize = Type.s20, fontWeight = FontWeight.SemiBold)
            Text(c.firstStep, color = p.text)
        }
        SmallButton(LocalChiefName.current, onClick = onChat)
        if (!c.proposal.isNullOrEmpty()) SmallButton(tr("Review first step"), onClick = onReview)
    }
}
