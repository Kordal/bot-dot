package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Api
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** A product of a ```products fence (#685, ADR 113): what the cards draw of it. [off]: how much less than [was], in
 *  whole percent; [was] is kept only with it. */
data class Product(
    val name: String, val url: String, val image: String, val price: String, val was: String, val off: Int,
    val store: String, val rating: Double?, val reviews: Int?, val arrives: String, val why: String,
)

/**
 * Shopping results in a reply (#685, ADR 113): a ```products fence holds a JSON list, the first product is the bot's
 * pick. Read by the rules the web page shares (test/fixtures/products-cases.json; public/products.js): known fields
 * only, cut to their lengths, https addresses only, at most [MAX]; a fence that can't be read stays its code.
 */
object Products {
    const val MAX = 10
    private val HTTPS = Regex("""^https://[^\s/?#]+\S*$""")
    private val AMOUNT = Regex("""\d[\d\s.,'  ]*""")
    private val DECIMAL = Regex("""^(.*\d)[.,](\d{1,2})$""")

    private fun str(v: JsonElement?, n: Int): String {
        val p = v as? JsonPrimitive ?: return ""
        if (p is JsonNull || (!p.isString && p.booleanOrNull != null)) return ""
        return p.content.replace(Regex("\\s+"), " ").trim().take(n)
    }
    private fun https(v: JsonElement?): String = str(v, 2000).takeIf { HTTPS.matches(it) }.orEmpty()
    /** A number, or a text that is one; anything else is none. */
    private fun num(v: JsonElement?): Double? {
        val p = v as? JsonPrimitive ?: return null
        if (p is JsonNull || (!p.isString && p.booleanOrNull != null)) return null
        return if (p.isString) p.content.trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull() else p.doubleOrNull
    }

    /** A price's number: "€1.299" 1299, "379,99 zł" 379.99, "$1,299.00" 1299; NaN without digits. A separator followed
     *  by one or two digits at the number's end is its decimal point; any other is a thousands separator. */
    fun amount(text: String): Double {
        val m = AMOUNT.find(text) ?: return Double.NaN
        val t = m.value.replace(Regex("[\\s'  ]"), "").trimEnd('.', ',')
        val dec = DECIMAL.matchEntire(t)
        return (if (dec != null) "${dec.groupValues[1].replace(Regex("[.,]"), "")}.${dec.groupValues[2]}" else t.replace(Regex("[.,]"), "")).toDoubleOrNull() ?: Double.NaN
    }

    /** How much less than it was, in whole percent: 15 for €339 that was €399; 0 when it is not less. */
    fun off(price: String, was: String): Int {
        val p = amount(price); val w = amount(was)
        if (!(p > 0) || !(w > p)) return 0
        return Math.round((1 - p / w) * 100).toInt()
    }

    /** The products a fence holds, or null when it can't be drawn. */
    fun parse(text: String): List<Product>? {
        val v = runCatching { Json.parseToJsonElement(text) }.getOrNull() ?: return null
        val items = when (v) { is JsonArray -> v.toList(); is JsonObject -> listOf(v); else -> emptyList() }
        val list = items.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val name = str(o["name"], 120).ifEmpty { return@mapNotNull null }
            val price = str(o["price"], 30); val was = str(o["was"], 30)
            val off = off(price, was)
            val rating = num(o["rating"])?.takeIf { it > 0 && it <= 5 }?.let { Math.round(it * 10) / 10.0 }
            val reviews = num(o["reviews"])?.takeIf { it >= 1 }?.let { Math.floor(it).toInt() }
            Product(name, https(o["url"]), https(o["image"]), price, if (off > 0) was else "", off, str(o["store"], 60), rating, reviews, str(o["arrives"], 60), str(o["why"], 200))
        }.take(MAX)
        return list.ifEmpty { null }
    }
}

/** Product cards in the replies of a chat: only from a server whose features name `product-cards` (#685). */
val LocalProductCards = compositionLocalOf { false }
internal fun productCardsShown(features: List<String>?) = features?.contains("product-cards") == true
/** The bot whose reply it is, for Save; null where there is none (the Chief's chat, a room, a page). */
val LocalProductSaver = compositionLocalOf<String?> { null }

/** What each bot has saved, by address: asked once per bot, then kept as Save changes it. */
private object SavedProducts {
    val urls = mutableStateMapOf<String, Set<String>>()
    private val asked = mutableSetOf<String>()
    suspend fun load(api: Api, botId: String) {
        if (!asked.add(botId)) return
        runCatching { api.savedProducts(botId) }.onSuccess { got -> urls[botId] = urls[botId].orEmpty() + got }.onFailure { asked.remove(botId) }
    }
}

/** The cards: the pick as a card with its photo on top, Open and Save; the rest as rows that open their store. */
@Composable
fun ProductCards(list: List<Product>, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val open = { url: String -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }; Unit }
    val pick = list.first()
    Column(modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().clip(Radius.card).background(p.panel).border(1.dp, p.line2, Radius.card).padding(Space.s12),
            verticalArrangement = Arrangement.spacedBy(Space.s8),
        ) {
            ProductPhoto(pick.image, Modifier.fillMaxWidth().aspectRatio(16f / 9f), Radius.card)
            Spacer(Modifier.height(Space.s4))
            Text(pick.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
            if (pick.price.isNotEmpty()) Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Text(pick.price, color = p.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold)
                if (pick.was.isNotEmpty()) Text(pick.was, color = p.faint, fontSize = Type.s14, textDecoration = TextDecoration.LineThrough, modifier = Modifier.padding(bottom = Space.s4))
                if (pick.off > 0) Text("−${pick.off}%", color = p.okText, fontSize = Type.s12, fontFamily = GeistMono, modifier = Modifier.padding(bottom = Space.s4))
            }
            ProductFacts(pick, arrives = false)
            if (pick.why.isNotEmpty()) Text(pick.why, color = Color(0xFFD0D0D0), fontSize = Type.s14)
            if (pick.arrives.isNotEmpty()) Text(pick.arrives, color = p.muted, fontSize = Type.s12)
            val saver = LocalProductSaver.current?.takeIf { pick.url.isNotEmpty() }
            if (pick.url.isNotEmpty()) Row(Modifier.padding(top = Space.s8), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Button(onClick = { open(pick.url) }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText), modifier = Modifier.heightIn(min = 36.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(Space.s8))
                    Text(tr("Open"), fontSize = Type.s14, fontWeight = FontWeight.Medium)
                }
                if (saver != null) SaveButton(saver, pick)
            }
        }
        if (list.size > 1) Column(Modifier.padding(top = Space.s12).fillMaxWidth()) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.sunk))
            list.drop(1).forEach { r ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 64.dp).let { if (r.url.isNotEmpty()) it.clickable { open(r.url) } else it }.padding(vertical = Space.s8, horizontal = Space.s4),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12),
                ) {
                    ProductPhoto(r.image, Modifier.size(48.dp), Radius.small)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                        Text(r.name, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        ProductFacts(r, arrives = true)
                    }
                    if (r.price.isNotEmpty()) Column(horizontalAlignment = Alignment.End) {
                        Text(r.price, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        if (r.off > 0) Text("−${r.off}%", color = p.okText, fontSize = Type.s12, fontFamily = GeistMono)
                    }
                    if (r.url.isNotEmpty()) Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, tint = p.faint, modifier = Modifier.size(16.dp))
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(p.sunk))
            }
        }
    }
}

/** "★ 4.6 · 2140 reviews · amazon.de", and the delivery after it in a row. */
@Composable
private fun ProductFacts(x: Product, arrives: Boolean) {
    val p = LocalPaper.current
    val bits = listOfNotNull(
        x.reviews?.let { trn(it, "{n} review", "{n} reviews") },
        x.store.ifEmpty { null },
        x.arrives.takeIf { arrives && it.isNotEmpty() },
    )
    if (x.rating == null && bits.isEmpty()) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        if (x.rating != null) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = p.warn, modifier = Modifier.size(12.dp))
            Text(String.format(java.util.Locale.ROOT, "%.1f", x.rating), color = p.muted, fontSize = Type.s12, maxLines = 1)
        }
        bits.forEachIndexed { i, b ->
            if (i > 0 || x.rating != null) Box(Modifier.size(3.dp).clip(CircleShape).background(Color(0xFF5F5F5F)))
            Text(b, color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        }
    }
}

/** A product's photo through botdot (/api/product-image), never from the store; the bag where there is none. */
@Composable
private fun ProductPhoto(image: String, modifier: Modifier, shape: RoundedCornerShape) {
    val p = LocalPaper.current
    val api by BotDotApp.of(LocalContext.current).api.collectAsState()
    var failed by remember(image) { mutableStateOf(false) }
    val a = api
    Box(modifier.clip(shape).background(p.sunk), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.ShoppingBag, contentDescription = null, tint = p.faint, modifier = Modifier.size(22.dp))
        if (image.isNotEmpty() && !failed && a != null) {
            coil3.compose.AsyncImage(model = a.url("/product-image?url=" + Api.enc(image)), contentDescription = null, contentScale = ContentScale.Fit,
                onState = { if (it is coil3.compose.AsyncImagePainter.State.Error) failed = true }, modifier = Modifier.fillMaxSize().background(Color.White))
        }
    }
}

/** Save: the product goes in the bot's Saved-products file, and again comes out. */
@Composable
private fun SaveButton(botId: String, x: Product) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val app = BotDotApp.of(context)
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(botId, api) { api?.let { SavedProducts.load(it, botId) } }
    val on = x.url in SavedProducts.urls[botId].orEmpty()
    OutlinedButton(
        onClick = {
            val a = api ?: return@OutlinedButton
            val next = !on
            val before = SavedProducts.urls[botId].orEmpty()
            SavedProducts.urls[botId] = if (next) before + x.url else before - x.url
            scope.launch {
                runCatching { a.saveProduct(botId, x.name, x.url, x.price, x.store, next) }.onFailure {
                    SavedProducts.urls[botId] = before
                    android.widget.Toast.makeText(context, it.message ?: tr("Couldn't save it"), android.widget.Toast.LENGTH_LONG).show()
                }
            }
        },
        border = BorderStroke(1.dp, p.line2), colors = ButtonDefaults.outlinedButtonColors(contentColor = p.text), modifier = Modifier.heightIn(min = 36.dp),
    ) {
        Icon(if (on) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, contentDescription = null, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(Space.s8))
        Text(if (on) tr("Saved") else tr("Save"), fontSize = Type.s14, fontWeight = FontWeight.Medium)
    }
}
