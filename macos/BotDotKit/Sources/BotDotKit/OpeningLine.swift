import Foundation

/// A working bot's opening line (docs/api.md, "The opening line"), as the web page's
/// public/opening-line.js: the botdot server reads the line from the bot's run and offers it while the
/// run is going on, and the app shows it under the chat and as the bot's preview in the list. The line
/// is plain text and is never a message of the chat: it makes no dot and moves no "New" line
/// (Unread.swift). In a bot's chat the status line is all a working bot shows: against a server without
/// opening lines, and until the bot says one, it says "Working".
/// A run that waits for the owner's OK on an action in a connected app (`waitingFor: "ok"` on the run,
/// the feed's `run_waits`) says "Waiting for your OK" where its line stood, until the wait is over:
/// the line comes back as it was.
/// With `working-line` in the server's `features` a bot's line is its working line (docs/api.md, "The
/// working line"): the server's words for what the bot is doing now, which change as the run goes on
/// ("Reading nytimes.com", "Starting its computer", "Running <job name>"). The app draws them as it
/// draws the opening line, each text as it comes: the server paces them, at most one change a second.
/// The Chief has no `working_line`: its line is the `activity` of its reply (`chiefLine` in Busy.swift).
public enum OpeningLine {
    /// What stands where the line stood while a run waits for the owner's OK. It gets no ellipsis:
    /// nothing moves until the owner answers.
    public static let waitingForOk = "Waiting for your OK"

    /// The line as the app takes it: the server's text (already one line, cut and without marks).
    /// "" for none.
    static func text(_ line: String?) -> String {
        line?.words ?? ""
    }

    /// The bot's preview in the list while it works: its line with the app's ellipsis, or nil for the
    /// usual "Working…".
    public static func preview(_ line: String?) -> String? {
        let t = text(line)
        return t.isEmpty ? nil : "\(t)…"
    }

    /// The status line of a bot's chat, without the ellipsis: its line, or "Working" while it works and
    /// has said none; nil when it rests. `waiting`: its run waits for the owner's OK, and says that in
    /// the line's place.
    public static func status(_ line: String?, working: Bool, waiting: Bool = false) -> String? {
        if waiting { return waitingForOk }
        let t = text(line)
        return t.isEmpty ? (working ? "Working" : nil) : t
    }

    /// The line of a bot's running run, from the run as the server gives it: its working line from a
    /// server that has one (`follows`), its opening line from one that does not. A run that has an
    /// opening line and no working line shows its opening line. nil for a run that has none yet.
    static func ofRun(working: String?, opening: String?, follows: Bool) -> String? {
        let line = follows ? text(working) : ""
        let t = line.isEmpty ? text(opening) : line
        return t.isEmpty ? nil : t
    }

    /// Does this event bring the line of a bot's run, on the feed and in the run's stream?
    /// `working_line` from a server that has the working line, which sends every change of the line with
    /// it, the opening line first; `opening_line` from one that does not. So the line changes when the
    /// server says, and at most once a second.
    static func says(_ event: String, follows: Bool) -> Bool { event == (follows ? "working_line" : "opening_line") }
}

/// The lines of the chats, as the server said them. A chat is "bot:<id>" or "chief:<chatId>". A line
/// belongs to a run (the Chief's to the reply it is writing: no run id), and a chat shows the line of
/// the latest run that said one and still goes on.
/// Every change answers whether anything may look different, so the screens redraw only then.
public struct OpeningLines: Equatable, Sendable {
    /// What a list of the server's says is going on now: a run or a reply, with its line when it has one.
    struct Live {
        var chat: String
        var run: String?
        var text: String?
        /// The run waits for the owner's OK.
        var waits = false
    }

    private struct Said: Equatable, Sendable {
        /// The run's id, or "" for the Chief's reply.
        var run: String
        var text: String
    }

    /// Per chat, in the order they were said.
    private var said: [String: [Said]] = [:]
    /// Runs that ended: a list fetched before that does not bring their line back.
    private var ended: Set<String> = []
    /// Per chat, the runs that wait for the owner's OK.
    private var held: [String: Set<String>] = [:]

    public init() {}

    /// The server said a line (the feed's `opening_line`, a run's stream, a Chief chat's stream).
    mutating func say(_ chat: String?, _ line: String?, run: String? = nil) -> Bool {
        let t = OpeningLine.text(line)
        guard let chat, !chat.isEmpty, !t.isEmpty else { return false }
        if let run, ended.contains(run) { return false }
        var lines = said[chat] ?? []
        if let i = lines.firstIndex(where: { $0.run == run ?? "" }) {
            if lines[i].text == t { return false }
            lines[i].text = t
        } else {
            lines.append(Said(run: run ?? "", text: t))
        }
        said[chat] = lines
        return true
    }

    private mutating func drop(_ chat: String, _ run: String) -> Bool {
        guard var lines = said[chat], let i = lines.firstIndex(where: { $0.run == run }) else { return false }
        lines.remove(at: i)
        said[chat] = lines.isEmpty ? nil : lines
        return true
    }

    /// A run began to wait for the owner's OK (`on`), or no longer waits. A run that ended waits for
    /// nothing.
    mutating func hold(_ chat: String?, run: String?, _ on: Bool) -> Bool {
        guard let chat, !chat.isEmpty, let run, !run.isEmpty else { return false }
        var runs = held[chat] ?? []
        guard on ? !ended.contains(run) && runs.insert(run).inserted : runs.remove(run) != nil else { return false }
        held[chat] = runs.isEmpty ? nil : runs
        return true
    }

    /// The run or the reply ended, whichever way: its line goes, and so does its wait. A run's end
    /// takes only its own line; without a run id, every line of the chat.
    mutating func end(_ chat: String, run: String? = nil) -> Bool {
        guard let run, !run.isEmpty else { return said.removeValue(forKey: chat) != nil }
        if ended.count > 500 { ended.removeAll() }
        ended.insert(run)
        let waited = hold(chat, run: run, false)
        return drop(chat, run) || waited
    }

    /// What is going on now, from one of the server's lists: the runs ("bot:") or the Chief's chats
    /// ("chief:"). A line of those chats whose run is no longer in the list goes; a line the feed
    /// brought meanwhile stays.
    mutating func sync(_ live: [Live], scope: String) -> Bool {
        var changed = false
        for (chat, lines) in said where chat.hasPrefix(scope) {
            for line in lines where !live.contains(where: { $0.chat == chat && ($0.run ?? "") == line.run }) {
                changed = drop(chat, line.run) || changed
            }
        }
        for (chat, runs) in held where chat.hasPrefix(scope) {
            for run in runs where !live.contains(where: { $0.chat == chat && $0.run == run && $0.waits }) {
                changed = hold(chat, run: run, false) || changed
            }
        }
        for x in live {
            changed = say(x.chat, x.text, run: x.run) || changed
            if x.waits { changed = hold(x.chat, run: x.run, true) || changed }
        }
        return changed
    }

    /// Forget everything: the feed could not say what was missed, and the lists are read again.
    mutating func clear() -> Bool {
        let had = !said.isEmpty || !held.isEmpty
        said = [:]
        held = [:]
        return had
    }

    /// The chat's line now, or nil.
    public func of(_ chat: String) -> String? { said[chat]?.last?.text }

    /// Whether that run of the chat waits for the owner's OK now.
    public func waits(_ chat: String, run: String) -> Bool { held[chat]?.contains(run) == true }
}

extension Store {
    /// What the bot of this chat ("bot:<id>" or "chief:<chatId>") said it is about to do, while it works.
    public func openingLine(of chat: String) -> String? { openingLines.of(chat) }

    /// Changes the lines, and tells the screens only when something is different. A run that ended
    /// without a line here is kept too: a list fetched before its end must not bring its line back.
    func lines(_ change: (inout OpeningLines) -> Bool) {
        var now = openingLines
        _ = change(&now)
        if now != openingLines { openingLines = now }
    }

    /// The feed's `opening_line` or `working_line` (`event`): a bot's run, or the Chief in a chat, said
    /// its line. A bot's line is read from one of the two, as the server's features say
    /// (`OpeningLine.says`); the Chief's is its opening line.
    func lineSaid(_ event: String, _ data: Data) {
        struct Line: Decodable { var chat: String?; var runId: String?; var text: String? }
        guard let d = try? JSON.decoder.decode(Line.self, from: data), let chat = d.chat else { return }
        guard chat.hasPrefix("bot:") ? OpeningLine.says(event, follows: has(.workingLine)) : event == "opening_line" else { return }
        lines { $0.say(chat, d.text, run: d.runId) }
    }

    /// A line in the stream of a bot's run (`type`: `opening_line` or `working_line`), also for a chat
    /// opened after it was said: drawn when it is the one this server's line is read from.
    func streamedLine(_ type: String, _ text: String?, in chat: String, run: String) {
        guard OpeningLine.says(type, follows: has(.workingLine)) else { return }
        lines { $0.say(chat, text, run: run) }
    }

    /// The runs were read: the lines of those that are still going on stay, as the list has them now
    /// (`OpeningLine.ofRun`), and the rest go. And which of them wait for the owner's OK, from a server
    /// whose runs do (`connector-waits`).
    func showLines(of listed: [RunSummary]) {
        let waits = has(.connectorWaits), follows = has(.workingLine)
        lines { $0.sync(listed.filter(\.isRunning).compactMap { r in r.botId.map { .init(chat: "bot:\($0)", run: r.id, text: OpeningLine.ofRun(working: r.workingLine, opening: r.openingLine, follows: follows), waits: waits && r.waitsForOk) } }, scope: "bot:") }
    }

    /// What stands for a running run of this bot where the app once had words of its own for a step (a
    /// run's Details, the window of its computer): its line with the app's ellipsis, "Working…" until it
    /// has one. nil from a server without the working line: the app's own words stand there.
    public func workingLine(of botId: String) -> String? {
        guard has(.workingLine) else { return nil }
        return "\(OpeningLine.status(openingLine(of: "bot:\(botId)"), working: true) ?? "Working")…"
    }

    /// Whether this run of the chat ("bot:<id>") waits for the owner's OK on an action in a connected app.
    public func waitsForOk(_ chat: String, run: String) -> Bool { openingLines.waits(chat, run: run) }

    /// The feed's `run_waits`: a run began to wait for the owner's OK (`waitingFor: "ok"`), or, without
    /// the field, no longer waits. Only from a server whose runs wait (`connector-waits`).
    func runWaits(_ data: Data) {
        struct Waits: Decodable { var chat: String?; var runId: String?; var waitingFor: CardText? }
        guard has(.connectorWaits), let d = try? JSON.decoder.decode(Waits.self, from: data) else { return }
        lines { $0.hold(d.chat, run: d.runId, d.waitingFor?.text == "ok") }
    }

    /// The feed's `run_finished`: that run's line goes, with an answer or without.
    func openingLineRunEnded(_ data: Data) {
        struct Ended: Decodable { var id: String?; var botId: String? }
        guard let d = try? JSON.decoder.decode(Ended.self, from: data), let run = d.id, let bot = d.botId else { return }
        lines { $0.end("bot:\(bot)", run: run) }
    }

    /// The feed's `chief_reply`: the Chief's own reply ended (also when it failed or was stopped), and
    /// its line goes. A bot's report in that chat (`from`) doesn't end it.
    func openingLineChiefReplied(_ data: Data) {
        /// Whatever is there: only whether it is matters.
        struct Anything: Decodable { init(from decoder: Decoder) throws {} }
        struct Reply: Decodable { var chatId: String?; var from: Anything? }
        guard let d = try? JSON.decoder.decode(Reply.self, from: data), let chat = d.chatId, d.from == nil else { return }
        lines { $0.end("chief:\(chat)") }
    }
}
