package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * Save to Google Docs for both phones (#351, #378; Android's ExportSheet): the row's status as botdot says it when
 * Export… opens, and the tap. Set up and connected, the Markdown is saved and its Doc opened; not connected, the tap
 * connects Google Docs (the Connectors page's own path) with the sign-in in the browser, and the next tap (which asks
 * botdot again) saves; a
 * connection that lost its access (409) is connected again on the next tap.
 */
class GoogleDocs(private val api: Api) {
    /** The row's status: null until botdot answers. */
    var status: DocumentExport.GoogleDocsStatus? = null
        private set

    /** What the row says beside "Google Docs". */
    val label: String get() = DocumentExport.googleDocsLabel(status)

    /** Asks botdot whether Google Docs is set up and connected (Export… opened). */
    @Throws(Exception::class)
    suspend fun read() {
        status = try { api.googleDocsStatus() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
    }

    /** What a tap came to: words to say, and an address to open (the Doc saved, or Google's sign-in); null: none. */
    class Done(val say: String, val open: String?)

    /** The tap on Google Docs for [title]'s [text]; [saying] hears what is under way ("Saving to Google Docs…"). */
    @Throws(Exception::class)
    suspend fun tap(title: String, text: String, saying: (String) -> Unit): Done {
        // As botdot has it now: a sign-in finished in the browser since Export… opened is connected.
        read()
        val s = status
        if (s != null && !s.configured) return Done(DocumentExport.GOOGLE_DOCS_NOT_SET_UP, null)
        if (s?.connected != false) return save(title, text, saying)
        saying(tr("Opening the Google sign-in…"))
        return try {
            val link = api.connectApp(DocumentExport.GOOGLE_DOCS_APP)
            when {
                link.noAuth -> save(title, text, saying)
                link.redirectUrl != null -> Done(DocumentExport.GOOGLE_DOCS_SIGN_IN, link.redirectUrl)
                else -> Done(tr("Couldn't start connecting Google Docs"), null)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Done(tr("Couldn't start connecting Google Docs: {why}", "why" to (e.message ?: tr("try again"))), null)
        }
    }

    private suspend fun save(title: String, text: String, saying: (String) -> Unit): Done {
        saying(tr("Saving to Google Docs…"))
        return try {
            val url = api.saveToGoogleDocs(title, text)
            Done(tr("Saved to Google Docs"), url)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // 409: not connected, or its connection lacks the access (state "reconnect"): the next tap connects it again.
            if ((e as? ApiException)?.status == 409) {
                status = status?.copy(connected = false)
                Done(tr("Google Docs needs connecting again. Tap Google Docs to connect it."), null)
            } else Done(e.message ?: tr("Couldn't save it to Google Docs"), null)
        }
    }
}
