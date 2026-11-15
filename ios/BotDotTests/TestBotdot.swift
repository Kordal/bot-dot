import BotdotShared

/// A botdot that answers nothing, for the tests: a local port nothing listens on, so every request is refused at once.
/// A test that waits for a failure waits no longer than that, whatever the machine; one that waits for no answer at all
/// (a call kept busy) uses a TEST-NET address instead.
let unreachable = "https://127.0.0.1:9"

func unreachableApi(session: Session? = nil) -> Api { Api(baseUrl: unreachable, session: session, quietMs: 1_000) }
