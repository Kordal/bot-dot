package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Run
import coil3.compose.AsyncImage

/** The screenshots a run's tools took: one folded line, "Screenshots ›", that opens to a row of them; a tap shows one full screen. */
@Composable
fun RunScreenshots(r: Run) {
    if (r.screenshots <= 0 || r.isRunning) return
    val p = LocalPaper.current
    val app = BotDotApp.of(LocalContext.current)
    var open by remember(r.id) { mutableStateOf(false) }
    var shots by remember(r.id) { mutableStateOf<List<String>?>(null) }
    var failed by remember(r.id) { mutableStateOf(false) }
    var showing by remember(r.id) { mutableStateOf<Int?>(null) }
    LaunchedEffect(r.id, open) {
        if (open && shots == null) runCatching { app.api.value?.runImages(r.id) }.onSuccess { shots = it }.onFailure { failed = true }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Screenshots ${if (open) "⌄" else "›"}", color = p.muted, fontSize = 13.5.sp,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(horizontal = 6.dp, vertical = 2.dp))
        if (open) {
            val list = shots
            when {
                failed -> Text("Couldn't load them.", color = p.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
                list != null -> Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    list.forEachIndexed { i, path ->
                        Shot(path, thumb = true, modifier = Modifier.height(110.dp).clip(RoundedCornerShape(8.dp)).border(1.dp, p.line2, RoundedCornerShape(8.dp)).clickable { showing = i })
                    }
                }
            }
        }
    }
    val list = shots
    val start = showing
    if (list != null && start != null) {
        Dialog(onDismissRequest = { showing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            val pager = rememberPagerState(initialPage = start) { list.size }
            HorizontalPager(pager, Modifier.fillMaxSize().background(Color.Black.copy(alpha = .92f)).clickable { showing = null }) { page ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Shot(list[page], thumb = false, modifier = Modifier.fillMaxSize())
                }
            }
        }
    }
}

/** One screenshot. Coil decodes it at the size it's shown (a run can take dozens) and keeps it in memory and on disk. */
@Composable
private fun Shot(path: String, thumb: Boolean, modifier: Modifier) {
    val app = BotDotApp.of(LocalContext.current)
    val api by app.api.collectAsState()
    val url = api?.url(path) ?: return
    AsyncImage(url, contentDescription = "Screenshot", modifier = if (thumb) modifier.widthIn(min = 60.dp) else modifier,
        contentScale = if (thumb) ContentScale.FillHeight else ContentScale.Fit)
}
