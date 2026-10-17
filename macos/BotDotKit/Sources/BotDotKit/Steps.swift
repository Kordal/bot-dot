import Foundation

/// What a bot is doing, in words, as the web page says it (public/app.js stepText and activityFor).
public enum StepWords {
    static let activity: [String: String] = [
        "Read": "Reading files", "Grep": "Looking through files", "Glob": "Looking through files",
        "Edit": "Making changes", "Write": "Writing a file", "MultiEdit": "Making changes",
        "Bash": "Checking something", "WebSearch": "Searching the web", "WebFetch": "Reading a web page",
        "Task": "Asking a helper", "Agent": "Asking a helper", "TodoWrite": "Planning the next steps", "Skill": "Using a skill",
    ]
    static let computer: [String: String] = [
        "screenshot": "Looking at its screen", "click": "Clicking", "move_mouse": "Moving the mouse", "drag": "Dragging",
        "type_text": "Typing", "press_keys": "Pressing keys", "scroll": "Scrolling", "run_shell": "Working in its terminal",
        "request_login": "Waiting for you to add a login", "list_logins": "Checking its saved logins", "type_login": "Signing in",
        "open_browser": "Opening the browser", "read_file": "Reading a file on its computer", "write_file": "Saving a file on its computer",
    ]
    static let other: [String: String] = [
        "mcp__vault__list_logins": "Checking its saved logins",
        "mcp__vault__request_login": "Waiting for you to add a login",
        "mcp__vault__api_request": "Calling an API with a saved login",
        "mcp__self__remember": "Saving a note to its memory",
        "mcp__self__update_memory": "Updating its memory",
        "mcp__self__forget": "Tidying its memory",
        "mcp__self__update_instructions": "Updating its own instructions",
        "mcp__self__create_skill": "Writing a skill for itself",
        "mcp__self__update_skill": "Improving one of its skills",
        "mcp__self__list_jobs": "Checking its scheduled jobs",
        "mcp__self__add_job": "Adding a scheduled job",
        "mcp__self__update_job": "Changing a scheduled job",
        "mcp__self__remove_job": "Removing a scheduled job",
        "mcp__self__list_teammates": "Checking its teammates",
        "mcp__self__message_bot": "Messaging a teammate",
        "mcp__self__send_to_chief": "Sending the Chief a suggestion",
        "mcp__connectors__connector_actions": "Looking up what a connected app can do",
        "mcp__connectors__connector_run": "Using a connected app",
        "ToolSearch": "Getting its tools ready",
    ]
    /// Tools that wait for the owner (a pop-up), shown as waiting until they return.
    static let waiting: Set<String> = ["mcp__vault__request_login", "mcp__computer__type_card"]

    public static func activity(for tool: String?) -> String {
        guard let tool else { return "Working on it" }
        if tool.hasPrefix("mcp__computer__") { return computer[String(tool.dropFirst(15))] ?? "Using its computer" }
        return activity[tool] ?? other[tool] ?? (tool.hasPrefix("mcp__") ? "Using a connected app" : "Working on it")
    }

    static func clip(_ value: Any?, _ n: Int = 60) -> String {
        let t = String(describing: value ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return t.count > n ? String(t.prefix(n)) + "…" : t
    }

    static func host(_ url: Any?) -> String {
        guard let s = url as? String, let h = URL(string: s)?.host() else { return "" }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    /// One step, with a detail when it helps ("Opening x.com in the browser").
    public static func text(for name: String, input: [String: Any], bots: [Bot] = []) -> String {
        let c = name.hasPrefix("mcp__computer__") ? String(name.dropFirst(15)) : nil
        func s(_ k: String) -> String? { input[k] as? String }
        switch c {
        case "open_browser": return s("url").map { "Opening \(host($0).isEmpty ? clip($0) : host($0)) in the browser" } ?? "Opening the browser"
        case "type_text": return "Typing “\(clip(s("text"), 40))”"
        case "press_keys":
            let keys = (input["keys"] as? [String]) ?? [s("keys") ?? s("key")].compactMap { $0 }
            let joined = clip(keys.joined(separator: "+"), 30)
            return "Pressing \(joined.isEmpty ? "keys" : joined)"
        case "type_login": return s("field") == "password" ? "Typing the saved password" : s("field") == "totp" ? "Typing the two-step code" : "Typing the saved username"
        case "type_card":
            let field = s("field") == "code" ? "security code" : (s("field") ?? "details")
            return "Typing the card \(field)\(s("amount").map { " (\(clip($0, 20)))" } ?? "")"
        case "type_identity": return "Filling in \(s("field") ?? "a form field")"
        case "run_shell": return "Running a command: \(clip(s("command"), 50))"
        case "start_program": return "Starting \(clip(s("command"), 40))"
        default: break
        }
        switch name {
        case "mcp__vault__request_login":
            let site = s("site") ?? ""
            return site.isEmpty ? "Waiting for you to add a login (see the pop-up)" : "Waiting for you to add the \(site) login (see the pop-up)"
        case "mcp__vault__api_request": return "Calling \(host(s("url")).isEmpty ? "an API" : host(s("url"))) with a saved login"
        case "mcp__connectors__connector_run":
            let action = clip((s("action") ?? "").lowercased().replacingOccurrences(of: "_", with: " "), 40)
            return "Using \(s("app") ?? "a connected app"): \(action)"
        case "WebFetch": return "Reading \(host(s("url")).isEmpty ? "a web page" : host(s("url")))"
        case "WebSearch": return "Searching the web for “\(clip(s("query"), 40))”"
        case "Bash": return s("description").map { clip($0, 60) } ?? "Checking something"
        case "Skill":
            let skill = (s("skill") ?? "").replacingOccurrences(of: #"^botdot:"#, with: "", options: .regularExpression)
            return "Using the skill \(clip(skill, 40))"
        case "mcp__self__message_bot":
            let to = (s("to") ?? "").lowercased()
            let bot = bots.first { $0.id == s("to") || $0.name.lowercased() == to }
            return "Messaging \(bot?.name ?? "a teammate")"
        default: return activity(for: name)
        }
    }

    /// A tool call's main argument, for the details.
    static func argument(_ input: [String: Any]) -> String {
        for k in ["command", "file_path", "pattern", "path", "url", "query", "description"] {
            if let v = input[k] as? String { return v }
        }
        let json = (try? JSONSerialization.data(withJSONObject: input, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? ""
        return String(json.prefix(120))
    }
}

extension RunSummary {
    /// Why a run didn't finish, in words for the owner (public/app.js friendlyProblem).
    public var problemText: String {
        if let problem, !problem.isEmpty { return problem }
        let text = "\(result ?? "") \(error ?? "")"
        func has(_ pattern: String) -> Bool { text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        if status == "stopped" { return "You stopped this run before it finished." }
        if status == "interrupted" { return "This run was cut off because botdot was restarted." }
        if has(#"not logged in|/login"#) { return "I couldn't start because Claude isn't signed in yet. Open Settings → Setup and sign in to Claude, then try again." }
        if has(#"max.?turns"#) { return "The task took more steps than I was allowed. Try breaking it into smaller pieces." }
        if has(#"ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|reach the API server|network error|fetch failed"#) {
            return "I couldn't reach Claude's servers, so I couldn't start. This computer had no internet connection, or couldn't look up the address (a DNS problem).\(jobName != nil ? " I will try again at the next scheduled time." : " Check the connection and send the message again.")"
        }
        if has(#"overloaded|529|rate.?limit|429|usage limit"#) { return "Claude's servers were busy or my usage limit was reached, so I stopped. Try again in a little while." }
        let why = String((error ?? result ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces).prefix(200))
        return "Something went wrong and I couldn't finish.\(why.isEmpty ? "" : " It said: “\(why)”.") The details show everything that happened."
    }
}

extension RunSummary {
    /// Its reply in the chat: the answer, what went wrong, or a script's output (public/app.js
    /// botThreadHTML and scriptRunHTML).
    public var replyText: String {
        if kind == "script" {
            let out = (result ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return out.isEmpty ? "No output." : out
        }
        if failed { return problemText }
        return result?.isEmpty == false ? result! : "Done. (No written reply.)"
    }

    /// Who sent the task, when it wasn't the owner: another bot, or the Chief (it hands tasks to bots).
    public var sender: Who? {
        if trigger == "bot", let fromBot { return fromBot }
        return startedBy == "chief" ? .chief : nil
    }

    /// Every bot it messaged, each once.
    public var messaged: [Who] { sentToAll?.isEmpty == false ? sentToAll! : sentTo.map { [$0] } ?? [] }

    /// The folded line of a run another bot or the Chief started: "Replied to Fleet Doctor" (with its small head), or whom
    /// else it messaged.
    public var exchange: (prefix: String, who: [Who]) {
        let to = messaged
        if to.isEmpty { return startedBy == "chief" ? ("Replied to", [sender].compactMap { $0 }) : ("Replied", []) }
        return to.allSatisfy({ $0.id == sender?.id }) ? ("Replied to", [sender].compactMap { $0 }) : ("Messaged", to)
    }

    /// How its messages reach the teammates, after "Messaged …" (public/app.js messagedLabel).
    public var messagedHow: String {
        let to = messaged
        if !to.isEmpty && to.allSatisfy({ $0.delivered == "queued" }) { return to.count == 1 ? " · it picks it up when free" : " · they pick it up when free" }
        if !to.isEmpty && to.allSatisfy({ $0.delivered?.hasPrefix("inbox") == true }) { return to.count == 1 ? " · a note for its next run" : " · a note for their next run" }
        return ""
    }
}
