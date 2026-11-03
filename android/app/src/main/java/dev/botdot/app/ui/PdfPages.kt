package dev.botdot.app.ui

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.BotFiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * A PDF in the document viewer, drawn by Android's own [PdfRenderer]: the file is fetched once into the app's cache
 * (as Share and Open in another app fetch it), then each page is drawn to the screen's width only when it scrolls
 * into view, so a large scan neither holds the whole file in memory nor stops the screen. Two fingers zoom. A file
 * the renderer can't open (a locked or broken PDF) shows [onFail], the viewer's own Save and Open buttons.
 */
@Composable
fun PdfPages(src: String, name: String, onFail: @Composable () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val app = BotDotApp.of(context)
    val api by app.api.collectAsState()
    var doc by remember(src) { mutableStateOf<PdfDoc?>(null) }
    var failed by remember(src) { mutableStateOf(false) }
    LaunchedEffect(src, api) {
        val a = api ?: return@LaunchedEffect
        runCatching { PdfDoc.open(BotFiles.cached(context, a, src, name)) }
            .onSuccess { doc = it }
            .onFailure { failed = true }
    }
    DisposableEffect(doc) {
        val d = doc
        onDispose { if (d != null) app.scope.launch { d.close() } }
    }
    val d = doc
    when {
        failed -> onFail()
        d == null -> Box(Modifier.fillMaxSize().background(p.bg).padding(Space.s16)) {
            Box(Modifier.fillMaxWidth().aspectRatio(A4).background(p.sunk))
        }
        else -> BoxWithConstraints(Modifier.fillMaxSize().background(p.sunk).clipToBounds()) {
            val width = with(LocalDensity.current) { maxWidth.roundToPx() }
            var scale by remember(d) { mutableFloatStateOf(1f) }
            var shift by remember(d) { mutableFloatStateOf(0f) }
            LazyColumn(
                Modifier.fillMaxSize()
                    .pointerInput(d, width) {
                        // Only a gesture of two fingers is taken: one finger still scrolls the pages.
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val ev = awaitPointerEvent()
                                if (ev.changes.count { it.pressed } >= 2) {
                                    scale = (scale * ev.calculateZoom()).coerceIn(1f, 4f)
                                    val room = (scale - 1f) * width / 2f
                                    shift = (shift + ev.calculatePan().x).coerceIn(-room, room)
                                    ev.changes.forEach { it.consume() }
                                }
                            } while (ev.changes.any { it.pressed })
                        }
                    }
                    .graphicsLayer { scaleX = scale; scaleY = scale; translationX = shift },
                contentPadding = PaddingValues(vertical = Space.s8),
                verticalArrangement = Arrangement.spacedBy(Space.s8),
            ) {
                items(d.count) { i -> PdfPage(d, i, width) }
            }
        }
    }
}

@Composable
private fun PdfPage(doc: PdfDoc, index: Int, width: Int) {
    val p = LocalPaper.current
    var page by remember(doc, index, width) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(doc, index, width) { page = runCatching { doc.render(index, width) }.getOrNull() }
    val b = page
    if (b == null) Box(Modifier.fillMaxWidth().aspectRatio(doc.ratio(index)).background(p.bg))
    else Image(b.asImageBitmap(), contentDescription = null, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().aspectRatio(b.width.toFloat() / b.height))
}

private const val A4 = 1f / 1.414f
/** The tallest page drawn, in pixels, so a strip of a page can't take all the memory. */
private const val MAX_HEIGHT = 6000

/** An open PDF. [PdfRenderer] opens one page at a time, so every use takes [lock]. */
class PdfDoc private constructor(private val fd: ParcelFileDescriptor, private val renderer: PdfRenderer) {
    private val lock = Mutex()
    private var closed = false
    private val ratios = arrayOfNulls<Float>(renderer.pageCount)
    val count: Int = renderer.pageCount

    /** A page's width over its height, once it has been drawn; A4 until then. */
    fun ratio(index: Int): Float = ratios[index] ?: A4

    suspend fun render(index: Int, width: Int): Bitmap? = lock.withLock {
        if (closed) return@withLock null
        withContext(Dispatchers.IO) {
            renderer.openPage(index).use { page ->
                val height = (width.toLong() * page.height / page.width.coerceAtLeast(1)).toInt().coerceIn(1, MAX_HEIGHT)
                ratios[index] = width.toFloat() / height
                Bitmap.createBitmap(width.coerceAtLeast(1), height, Bitmap.Config.ARGB_8888).also { b ->
                    b.eraseColor(Color.WHITE)
                    page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    suspend fun close() = lock.withLock {
        if (closed) return@withLock
        closed = true
        runCatching { renderer.close() }
        runCatching { fd.close() }
    }

    companion object {
        suspend fun open(file: File): PdfDoc = withContext(Dispatchers.IO) {
            val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            try { PdfDoc(fd, PdfRenderer(fd)) } catch (e: Throwable) { fd.close(); throw e }
        }
    }
}
