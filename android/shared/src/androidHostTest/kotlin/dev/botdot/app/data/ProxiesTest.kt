package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The account's proxies (ADR 171): read as botdot sends them, and a pasted address fills the form as botdot reads it. */
class ProxiesTest {
    @Test fun aProxyNeverCarriesItsPassword() {
        val l = Api.JSON.decodeFromString<ProxyList>("""{"proxies":[{"id":"a1b2c3d4","name":"PL","type":"socks5","host":"pl.example.com","port":1080,"username":"kordal","hasPassword":true,"lastTest":{"ok":true,"ip":"198.51.100.9","country":"PL","city":"Warsaw","ms":412}}],"default":"a1b2c3d4"}""")
        assertEquals("a1b2c3d4", l.default)
        assertEquals(true, l.proxies[0].hasPassword)
        assertEquals("🇵🇱 Warsaw", Proxies.where(l.proxies[0].lastTest))
        assertEquals("", Api.JSON.decodeFromString<Bot>("""{"id":"x","name":"X"}""").proxy)
    }

    @Test fun aPastedAddressFillsTheForm() {
        assertEquals(ProxyForm(type = "socks5", host = "pl.example.com", port = "1080", username = "kordal", password = "p@ss"), Proxies.pasted("socks5://kordal:p%40ss@pl.example.com:1080", ProxyForm()))
        assertEquals(ProxyForm(type = "http", host = "10.0.0.2", port = "3128"), Proxies.pasted("http://10.0.0.2:3128", ProxyForm()))
        assertEquals(ProxyForm(host = "geo.example.com", port = "12321", username = "user", password = "secret"), Proxies.pasted("geo.example.com:12321:user:secret", ProxyForm()))
        assertEquals(ProxyForm(name = "Home", host = "h.example", port = "1080"), Proxies.pasted("h.example:1080", ProxyForm(name = "Home")))
        assertNull(Proxies.pasted("pl.example", ProxyForm()))
    }
}
