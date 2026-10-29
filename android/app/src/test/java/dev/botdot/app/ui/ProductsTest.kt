package dev.botdot.app.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ProductsTest {
    // The rules the web page shares (test/fixtures/products-cases.json): what a fence holds once read, prices and
    // their numbers, and what a reply draft draws of a products fence.
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("productsCases") ?: "../../test/fixtures/products-cases.json").readText(),
    ).jsonObject

    private fun JsonObject.s(k: String) = getValue(k).jsonPrimitive.content
    private fun product(o: JsonObject) = Product(
        o.s("name"), o.s("url"), o.s("image"), o.s("price"), o.s("was"), o.getValue("off").jsonPrimitive.int, o.s("store"),
        o.getValue("rating").let { if (it is JsonNull) null else it.jsonPrimitive.double },
        o.getValue("reviews").let { if (it is JsonNull) null else it.jsonPrimitive.int },
        o.s("arrives"), o.s("why"),
    )

    @Test fun everyCaseOfTheSharedFixtureIsReadIntoItsProductsOrStaysCode() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 10)
        cases.forEach { c ->
            val want = c.getValue("products").let { if (it is JsonNull) null else it.jsonArray.map { p -> product(p.jsonObject) } }
            assertEquals(c.s("name"), want, Products.parse(c.s("source")))
        }
    }

    @Test fun aPriceIsReadIntoItsNumberWhateverItsSeparators() {
        fixture.getValue("amounts").jsonArray.forEach { a ->
            val (text, n) = a.jsonArray
            val got = Products.amount(text.jsonPrimitive.content)
            if (n is JsonNull) assertTrue(text.toString(), got.isNaN()) else assertEquals(text.toString(), n.jsonPrimitive.double, got, 0.0)
        }
    }

    @Test fun aReplyStillBeingWrittenWaitsForItsProductsFenceToClose() {
        fixture.getValue("drafts").jsonArray.map { it.jsonObject }.forEach { d ->
            assertEquals(d.s("name"), d.s("draft"), draftSource(d.s("source")))
        }
    }

    @Test fun theDrawnBlockIsCodeWithTheWordProducts() {
        val blocks = parseBlocks("Four fit.\n\n```products\n[{\"name\":\"A\"}]\n```")
        assertEquals(Block.Code("[{\"name\":\"A\"}]", "products"), blocks.last())
        assertNull(Products.parse("[]"))
    }
}
