package dev.botdot.app.data

import okhttp3.Interceptor

/**
 * The session on the pictures' requests (Coil fetches them with OkHttp, BotDotApp): each carries the session's cookie,
 * and its answer is read for the session as the API's are ([Session.answered]).
 */
val Session.interceptor: Interceptor get() = Interceptor { chain ->
    val req = chain.request()
    val server = Session.originOf(req.url.scheme, req.url.host, req.url.port)
    val token = token(server)
    val res = chain.proceed(if (token != null) req.newBuilder().header("Cookie", "${Session.COOKIE}=$token").build() else req)
    answered(server, req.url.encodedPath.startsWith("/api/"), token, res.code, res.headers("Set-Cookie")) { res.peekBody(Session.PEEK.toLong()).string() }
    res
}
