import Foundation

/// Markdown as the replies use it, as a flat list of blocks, by the rules the web page and the
/// Android app share (test/fixtures/markdown-cases.json; `mdBlocks` in public/app.js): an item's depth
/// is how many open items start left of its marker, a numbered list counts up from its first number,
/// a text line under an item belongs to it, and a short line that is only bold is a title. Inline
/// Markdown stays in the text.
public enum MarkdownBlock: Hashable, Sendable {
    /// Its lines up to a blank line, their line breaks kept.
    case paragraph(String)
    /// Levels 1 to 4: a deeper one is level 4.
    case heading(level: Int, text: String)
    /// One item of a list. `number`: the number it is drawn with, nil for a bullet. `depth`: 0 for an
    /// item of the list itself, up to 3 for an item under an item.
    case item(text: String, number: Int?, depth: Int)
    case quote(String)
    case rule
    case code(String)
    /// The first row is the header.
    case table([[String]])

    private static let itemLine = try! NSRegularExpression(pattern: #"^(\s*)(?:[-*•+]|(\d{1,9})[.)])\s+(.*)$"#)
    private static let headingLine = try! NSRegularExpression(pattern: #"^(#{1,6})\s+(.*)$"#)
    private static let boldLine = try! NSRegularExpression(pattern: #"^\*\*([^*]+)\*\*:?\s*$"#)
    private static let tableRule = try! NSRegularExpression(pattern: #"^[|:\-\s]+$"#)
    private static let rules: Set<String> = ["---", "***", "___"]

    /// The groups of the first match in `line`, "" for one that took no part; nil for no match.
    private static func match(_ line: String, _ re: NSRegularExpression) -> [String]? {
        guard let m = re.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: line).map { String(line[$0]) } ?? "" }
    }

    public static func parse(_ source: String) -> [MarkdownBlock] {
        var out: [MarkdownBlock] = []
        var para: [String] = []
        // The open list: the marker columns of the open items, the last number at each depth, and where its last item is.
        var stack: [Int] = []
        var nums: [Int?] = []
        var open: Int?
        var blank = false
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))) }
            para = []
        }
        func endList() { stack = []; nums = []; open = nil; blank = false }
        func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespaces) }
        func isTable(_ t: String) -> Bool { t.count > 1 && t.hasPrefix("|") && t.hasSuffix("|") }
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        // A line that is only bold is a section title when it is short, is no sentence and something follows it.
        func title(_ line: String, at: Int) -> String? {
            guard var text = match(line, boldLine)?[1] else { return nil }
            if text.hasSuffix(":") { text.removeLast() }
            text = trimmed(text)
            guard let last = text.last, text.count <= 60, !".!?".contains(last) else { return nil }
            return lines[(at + 1)...].contains { !trimmed($0).isEmpty } ? text : nil
        }
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let t = trimmed(line)
            if t.hasPrefix("```") {
                flush(); endList()
                var code: [String] = []
                i += 1
                while i < lines.count && !trimmed(lines[i]).hasPrefix("```") { code.append(lines[i]); i += 1 }
                var text = code.joined(separator: "\n")
                while let last = text.last, last.isWhitespace { text.removeLast() }
                out.append(.code(text))
            } else if isTable(t) {
                // Tables, without the separator row.
                flush(); endList()
                var rows: [[String]] = []
                while i < lines.count, isTable(trimmed(lines[i])) {
                    let r = trimmed(lines[i])
                    if match(r, tableRule) == nil {
                        rows.append(r.dropFirst().dropLast().split(separator: "|", omittingEmptySubsequences: false).map { trimmed(String($0)) })
                    }
                    i += 1
                }
                i -= 1
                if !rows.isEmpty { out.append(.table(rows)) }
            } else if t.isEmpty {
                flush()
                if open != nil { blank = true }
            } else if rules.contains(t) {
                flush(); endList()
                out.append(.rule)
            } else if let h = match(t, headingLine) {
                flush(); endList()
                out.append(.heading(level: min(h[1].count, 4), text: h[2]))
            } else if t.hasPrefix(">") {
                flush(); endList()
                var quoted: [String] = []
                while i < lines.count, trimmed(lines[i]).hasPrefix(">") { quoted.append(trimmed(String(trimmed(lines[i]).dropFirst()))); i += 1 }
                i -= 1
                out.append(.quote(quoted.joined(separator: "\n")))
            } else if let m = match(line, itemLine) {
                flush()
                // An item is the child of the open item whose marker starts left of its own; depth stops at 3.
                let column = m[1].count
                while let last = stack.last, last >= column { stack.removeLast() }
                while stack.count > 3 { stack.removeLast() }
                let depth = stack.count
                stack.append(column)
                while nums.count > depth + 1 { nums.removeLast() }
                while nums.count < depth + 1 { nums.append(nil) }
                // The first number of a list is the one written; the next ones count up, whatever is written.
                let number = Int(m[2]).map { written in nums[depth].map { $0 + 1 } ?? written }
                nums[depth] = number
                out.append(.item(text: trimmed(m[3]), number: number, depth: depth))
                open = out.count - 1
                blank = false
            } else if let at = open, case .item(let text, let number, let depth) = out[at], !blank || line.first?.isWhitespace == true {
                // A text line right under an item, or indented under it after a blank line, belongs to that item.
                out[at] = .item(text: "\(text)\n\(t)", number: number, depth: depth)
                blank = false
            } else if let heading = title(line, at: i) {
                flush(); endList()
                out.append(.heading(level: 3, text: heading))
            } else {
                endList()
                para.append(t)
            }
            i += 1
        }
        flush()
        return out
    }
}

/// How the blocks are set, as on the web page (`.md` in public/style.css): what the screen draws them with.
extension MarkdownBlock {
    /// A title is larger than the text (14.5), down to level 4, which is the text's size in semi-bold.
    public static func headingSize(_ level: Int) -> Double {
        switch level { case 1: 19.5; case 2: 17.5; case 3: 15.5; default: 14.5 }
    }

    /// The space above a block: none above the first, more above a title, less between two items of a list.
    public static func gapAbove(_ previous: MarkdownBlock?, _ block: MarkdownBlock) -> Double {
        guard let previous else { return 0 }
        if case .heading = block { return 16 }
        if case .item = block, case .item = previous { return 3 }
        return 7
    }

    /// How far right an item at this depth starts: further than the widest marker of the item above it.
    public static func itemIndent(_ depth: Int) -> Double { Double(depth) * 26 }

    /// The room a marker takes at least; a longer number ("10.") takes what it needs.
    public static func markerWidth(numbered: Bool) -> Double { numbered ? 24 : 16 }
}
