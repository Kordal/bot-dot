package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign

/**
 * An empty chat (#727), as on the web page: [figure] and [name] in the middle, the message box ([composer]) right under
 * them and [jobs] under it as chips, each (id, name); a tap is [onJob]. No words besides. [top]: what waits for the
 * owner's OK in this chat, above it all. The first message puts the box back at the foot (the screen's own layout).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EmptyChat(pad: PaddingValues, name: String, jobs: List<Pair<String, String>>, onJob: (String) -> Unit, figure: @Composable () -> Unit, top: @Composable () -> Unit = {}, composer: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxSize().padding(pad).imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.fillMaxWidth().padding(horizontal = Space.s16)) { top() }
        Spacer(Modifier.weight(1f))
        figure()
        Text(name, color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = Space.s16, bottom = Space.s8).padding(horizontal = Space.s24))
        composer()
        if (jobs.isNotEmpty()) FlowRow(Modifier.fillMaxWidth().padding(horizontal = Space.s16),
            horizontalArrangement = Arrangement.spacedBy(Space.s8, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            for ((id, job) in jobs) Text(job, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.clip(Radius.pill).background(p.sunk).clickable { onJob(id) }.padding(horizontal = Space.s12, vertical = Space.s8))
        }
        Spacer(Modifier.weight(1f))
    }
}
