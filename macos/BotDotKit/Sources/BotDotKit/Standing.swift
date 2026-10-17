import Foundation

/// A line that stands while something keeps botdot from working (docs/api.md, the feed's `hello` and
/// `claude`): beside the logo, and above the message box of every chat.
public enum Standing: Equatable, Sendable {
    /// The live feed is down, and the app is trying again.
    case away
    /// Claude is signed out on the botdot server: no bot can work.
    case signedOut

    /// Beside the logo.
    public var short: String {
        switch self {
        case .away: "Can't reach botdot"
        case .signedOut: "Claude is signed out"
        }
    }

    /// Above the message box. The signed-out line is followed by "Sign in", which opens Setup.
    public var text: String {
        switch self {
        case .away: "Can't reach botdot. Trying again…"
        case .signedOut: "Claude is signed out: bots can't work."
        }
    }
}

/// Whether Claude is signed out, as the feed says it: `hello.claude` and the `claude` event, each
/// `{ loggedIn }`. A check that could not tell (`null`, or no true or false) keeps what was known,
/// and a server from before the line says nothing. As the Android app's `ClaudeState`.
public struct ClaudeSignIn: Equatable, Sendable {
    public private(set) var signedOut = false
    private var says = false
    private var helloAt: String?

    public init() {}

    private struct Said: Decodable { let loggedIn: Bool }
    private struct Hello: Decodable {
        let lastEventId: String?
        let claude: Said?
        enum CodingKeys: String, CodingKey { case lastEventId, claude }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            lastEventId = (try? c.decodeIfPresent(String.self, forKey: .lastEventId)).flatMap { $0?.isEmpty == false ? $0 : nil }
            claude = try? c.decodeIfPresent(Said.self, forKey: .claude)
        }
    }

    /// One event of the feed. `features`: the server's, which say whether it holds work as signed out.
    public mutating func heard(_ event: String, id: String?, _ data: Data, features: Set<String>) {
        switch event {
        case "hello":
            let hello = try? JSONDecoder().decode(Hello.self, from: data)
            helloAt = hello?.lastEventId
            says = [Feature.messageWaits, .endedBy, .jobLine].contains { features.contains($0.rawValue) }
            if !says { signedOut = false } else if let said = hello?.claude { signedOut = !said.loggedIn }
        case "claude" where says && !CardGroups.isReplay(id, hello: helloAt):
            if let said = try? JSONDecoder().decode(Said.self, from: data) { signedOut = !said.loggedIn }
        default:
            break
        }
    }
}

extension Store {
    /// The line that stands now. No answer from botdot comes first: what it last said of Claude may be old.
    public var standing: Standing? { away ? .away : claude.signedOut ? .signedOut : nil }
}
