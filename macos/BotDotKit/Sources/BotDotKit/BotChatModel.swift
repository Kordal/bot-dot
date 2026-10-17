import Foundation

/// A step of a run that's going on, in words.
public struct LiveStep: Hashable, Sendable {
    public var text: String
    /// Waiting for the owner (a pop-up) until the tool returns.
    public var waiting: Bool
}

/// The run a bot is working on now, as the open chat follows it.
public struct LiveRun: Sendable {
    public let runId: String
    /// What it's doing now ("Searching the web…").
    public var activity: String = "Working on it…"
    public var steps: [LiveStep] = []
    /// Files it attached so far: shown at once.
    public var files: [FileRef] = []
}

/// A bot's chat on screen: its runs, oldest first.
public struct BotChatState: Sendable {
    public var botId: String?
    public var runs: [RunSummary] = []
    /// Notes teammates left for it, waiting for its next run.
    public var notes: [Note] = []
    /// Its runs have been read (until then, it isn't an empty chat yet).
    public var loaded = false
    public var live: LiveRun?
}

/// Everything about one run, for its Details.
public struct RunDetails: Sendable {
    public var run: RunSummary
    /// Its reply, or what went wrong, in words.
    public var answer: String
    public var transcript: [TranscriptEntry]
}

/// One thing in a run's transcript: something it wrote, a tool it used (with what came back), or an
/// error.
public struct TranscriptEntry: Identifiable, Sendable {
    public enum Kind: Sendable { case text, tool, stderr, scriptOutput }
    public let id: Int
    public let kind: Kind
    public var text: String = ""
    public var toolName: String?
    public var toolArgument: String?
    /// The tool's input, as JSON.
    public var toolInput: String?
    public var toolResult: String?
    public var toolFailed = false
}

extension Store {
    /// How many of a bot's newest runs its chat shows, as on the web.
    static let chatRuns = 40
    /// How many pages of older runs are read to get to the "New" line.
    static let reachPages = 10

    /// Shows a bot's chat: its newest runs, and the one it's working on live.
    public func openBot(_ botId: String) {
        runFollow?.cancel()
        runFollow = nil
        botChat = BotChatState(botId: botId)
        Task { await loadBotRuns(botId) }
    }

    func loadBotRuns(_ botId: String) async {
        guard let api else { return }
        do {
            let newest: [RunSummary] = try await api.get("runs?botId=\(botId)&limit=\(Self.chatRuns)")
            let line = newLine
            let back = await back(toNewLineOf: botId, from: newest)
            guard botChat.botId == botId else { return }
            let page = newLine == line ? back : newest // the chat was left while its older runs were read
            botChat.runs = page.reversed()
            botChat.loaded = true
            await loadNotes(botId)
            follow(botChat.runs.last { $0.isRunning && $0.kind != "script" })
        } catch {
            problem = error.localizedDescription
        }
    }

    /// The runs a bot's chat shows, newest first: `newest` (its newest runs), and, while the chat's
    /// "New" line is above a run older than those, every run back to it, so the chat opens at the line
    /// however many runs came after that reply. They are the ones the chat holds already, or are read
    /// page by page. `newest` alone when the run can't be reached: it is gone, the server can't be
    /// asked, or it is further back than `reachPages` pages.
    func back(toNewLineOf botId: String, from newest: [RunSummary]) async -> [RunSummary] {
        guard let api, let line = newLine, line.chat == "bot:\(botId)", let first = line.first.run,
              !newest.contains(where: { $0.id == first }), let oldest = newest.last?.id, lineNotReached != line else { return newest }
        // Held from an earlier look (the chat's runs are oldest first).
        if botChat.botId == botId, let from = botChat.runs.firstIndex(where: { $0.id == first }),
           let to = botChat.runs.firstIndex(where: { $0.id == oldest }), from < to {
            return newest + botChat.runs[from..<to].reversed()
        }
        var all = newest
        for _ in 0..<Self.reachPages {
            guard let before = all.last?.id,
                  let older: [RunSummary] = try? await api.get("runs?botId=\(botId)&limit=\(Self.chatRuns)&before=\(before)") else { return newest }
            let known = Set(all.map(\.id))
            let fresh = older.filter { !known.contains($0.id) }
            if fresh.isEmpty { break } // nothing older (or a server that sends the newest again)
            all += fresh
            if fresh.contains(where: { $0.id == first }) { return all }
        }
        lineNotReached = line // it isn't there: the next reload doesn't read all of this again
        return newest
    }

    /// The "New" line was placed in the open bot's chat above a run it doesn't hold: read back to it.
    func reachNewLine() {
        guard let line = newLine, let first = line.first.run, let botId = botChat.botId, line.chat == "bot:\(botId)",
              !botChat.runs.contains(where: { $0.id == first }) else { return }
        Task { await loadBotRuns(botId) }
    }

    /// The notes waiting in the open bot's inbox.
    func loadNotes(_ botId: String) async {
        guard let api, let notes: [Note] = try? await api.get("bots/\(botId)/inbox"), botChat.botId == botId else { return }
        botChat.notes = notes
    }

    /// Gives the open bot a task (`text`), or runs its usual task (nil). `key`: the message's key,
    /// which goes with it to a server that takes a key once (see Outbox.swift); sent again with the
    /// same key, the answer is the run the first one started. With no botdot server followed, or no
    /// chat open (the server was left meanwhile), it throws: the message did not leave.
    public func sendToBot(_ text: String?, attachments: [FileRef] = [], key: String? = nil) async throws {
        guard let api, let botId = botChat.botId else { throw NotSent(cause: ConnectError(message: "Not connected.")) }
        struct Message: Encodable { let prompt: String?; let attachments: [FileRef]; let key: String? }
        let run: RunSummary = try await api.send("bots/\(botId)/run", body: Message(prompt: text, attachments: attachments, key: takesOnce ? key : nil))
        // The bot is busy: the message waits its turn, in its list and not among its runs.
        if run.isQueued {
            waits(Queued(id: run.id, text: text ?? "", attachments: attachments, at: run.queuedAt), in: "bot:\(botId)")
            return
        }
        guard botChat.botId == botId else { return } // another chat was opened meanwhile
        if !botChat.runs.contains(where: { $0.id == run.id }) { botChat.runs.append(run) }
        follow(run)
    }

    /// Stops a run.
    public func stopRun(_ runId: String) async {
        guard let api else { return }
        if botChat.live?.runId == runId { botChat.live?.activity = "Stopping…" }
        do { try await api.send("runs/\(runId)/stop") } catch { problem = error.localizedDescription }
    }

    /// Follows a running run's steps (the stream replays the earlier ones first), then reloads the chat.
    func follow(_ run: RunSummary?) {
        guard let run, run.isRunning, let api, let botId = botChat.botId, !followed.contains(run.id) else { return }
        if botChat.live?.runId == run.id, runFollow != nil { return }
        runFollow?.cancel()
        botChat.live = LiveRun(runId: run.id, activity: "\(run.phase ?? "Working on it")…")
        runFollow = Task { [weak self] in
            var ended = false
            // A dropped stream is opened again (it replays what happened); only the end stops it.
            for attempt in 0..<5 where !ended && !Task.isCancelled {
                if attempt > 0 { try? await Task.sleep(for: .seconds(1)) }
                do {
                    var fresh = true // the stream starts with everything so far: count the steps again
                    for try await ev in api.events("runs/\(run.id)/stream") {
                        guard let self, let live = self.botChat.live, live.runId == run.id else { return }
                        guard let e = try? JSONSerialization.jsonObject(with: Data(ev.data.utf8)) as? [String: Any] else { continue }
                        if e["type"] as? String == "run_end" { ended = true; break }
                        // Its line, also for a chat opened after it was said.
                        if let type = e["type"] as? String, type == "opening_line" || type == "working_line" { self.streamedLine(type, e["text"] as? String, in: "bot:\(botId)", run: run.id); continue }
                        self.botChat.live = self.stepped(fresh ? LiveRun(runId: run.id, activity: live.activity) : live, by: e)
                        fresh = false
                    }
                } catch {}
            }
            guard let self, !Task.isCancelled, self.botChat.botId == botId else { return }
            self.runFollow = nil
            if ended {
                self.followed.insert(run.id) // don't open it again if the list lags behind
                self.lines { $0.end("bot:\(botId)", run: run.id) }
            }
            if self.botChat.live?.runId == run.id { self.botChat.live = nil }
            await self.loadBotRuns(botId)
        }
    }

    /// A live run after one raw stream event (public/app.js watchRunSteps).
    func stepped(_ live: LiveRun, by e: [String: Any]) -> LiveRun {
        var live = live
        switch e["type"] as? String {
        case "phase":
            if let t = e["text"] as? String, !t.isEmpty { live.activity = "\(t)…" }
        case "assistant":
            let content = ((e["message"] as? [String: Any])?["content"] as? [[String: Any]]) ?? []
            let tools = content.filter { $0["type"] as? String == "tool_use" }
            for t in tools {
                let name = t["name"] as? String ?? ""
                let text = StepWords.text(for: name, input: t["input"] as? [String: Any] ?? [:], bots: bots)
                if live.steps.last?.text == text && !text.hasPrefix("Typing") { continue } // many screenshots in a row
                live.steps.append(LiveStep(text: text, waiting: StepWords.waiting.contains(name)))
            }
            if let last = tools.last {
                live.activity = "\(StepWords.text(for: last["name"] as? String ?? "", input: last["input"] as? [String: Any] ?? [:], bots: bots))…"
            } else if content.contains(where: { $0["type"] as? String == "text" }) {
                live.activity = "Writing the answer…"
            }
        case "file":
            if let f = e["file"], let data = try? JSONSerialization.data(withJSONObject: f),
               let file = try? JSON.decoder.decode(FileRef.self, from: data), !live.files.contains(file) {
                live.files.append(file)
            }
        case "user":
            if live.steps.last?.waiting == true { live.steps[live.steps.count - 1].waiting = false } // the wait is over
        default:
            break
        }
        return live
    }

    /// A run with everything that happened in it.
    public func runDetails(_ runId: String) async throws -> RunDetails {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let data = try await api.data("runs/\(runId)")
        let run = try JSON.decoder.decode(RunSummary.self, from: data)
        let raw = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["events"] as? [[String: Any]] ?? []
        var transcript: [TranscriptEntry] = []
        var toolIndex: [String: Int] = [:]
        var resultText: String?
        var resultIsError = false
        for e in raw {
            switch e["type"] as? String {
            case "assistant":
                for c in ((e["message"] as? [String: Any])?["content"] as? [[String: Any]]) ?? [] {
                    if c["type"] as? String == "text", let t = c["text"] as? String, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        transcript.append(TranscriptEntry(id: transcript.count, kind: .text, text: t))
                    } else if c["type"] as? String == "tool_use" {
                        let input = c["input"] as? [String: Any] ?? [:]
                        let json = (try? JSONSerialization.data(withJSONObject: input, options: [.prettyPrinted, .sortedKeys])).map { String(decoding: $0, as: UTF8.self) }
                        if let id = c["id"] as? String { toolIndex[id] = transcript.count }
                        transcript.append(TranscriptEntry(id: transcript.count, kind: .tool, toolName: c["name"] as? String, toolArgument: StepWords.argument(input), toolInput: json))
                    }
                }
            case "user":
                for c in ((e["message"] as? [String: Any])?["content"] as? [[String: Any]]) ?? [] where c["type"] as? String == "tool_result" {
                    guard let id = c["tool_use_id"] as? String, let i = toolIndex[id] else { continue }
                    transcript[i].toolResult = Self.contentText(c["content"])
                    transcript[i].toolFailed = c["is_error"] as? Bool ?? false
                }
            case "result":
                resultText = e["result"] as? String
                resultIsError = e["is_error"] as? Bool ?? false
            case "stderr", "raw":
                transcript.append(TranscriptEntry(id: transcript.count, kind: .stderr, text: e["text"] as? String ?? ""))
            case "script_output":
                let t = e["text"] as? String ?? ""
                transcript.append(TranscriptEntry(id: transcript.count, kind: .scriptOutput, text: t.isEmpty ? "(no output)" : t))
            default:
                break
            }
        }
        if let error = run.error, !error.isEmpty { transcript.append(TranscriptEntry(id: transcript.count, kind: .stderr, text: error)) }
        var done = run
        if done.result?.isEmpty != false { done.result = resultText }
        if resultIsError && !done.failed { done.status = "error" }
        let answer = run.isRunning ? "Getting started…" : done.replyText
        return RunDetails(run: run, answer: answer, transcript: transcript)
    }

    static func contentText(_ c: Any?) -> String {
        if let s = c as? String { return s }
        if let list = c as? [[String: Any]] {
            return list.map { x in
                x["type"] as? String == "text" ? (x["text"] as? String ?? "") : x["type"] as? String == "image" ? "[image]" : String(describing: x)
            }.joined(separator: "\n")
        }
        return c.map { String(describing: $0) } ?? ""
    }
}
