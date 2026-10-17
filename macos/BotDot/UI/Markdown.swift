import SwiftUI
import BotDotKit

/// A reply in Markdown, drawn like the web page: paragraphs, headings, lists, quotes, rules, code and tables.
extension EnvironmentValues {
    /// The words in the search box, marked in the open chat.
    @Entry var searchTerms: [String] = []
}

/// Marks the searched words (and the words they start) in yellow.
func marked(_ text: AttributedString, _ terms: [String]) -> AttributedString {
    guard !terms.isEmpty else { return text }
    var out = text
    let plain = String(out.characters)
    let pattern = "(?<![\\p{L}\\p{N}])(?:" + terms.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|") + ")[\\p{L}\\p{N}]*"
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return out }
    for m in re.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
        guard let r = Range(m.range, in: plain),
              let lo = AttributedString.Index(r.lowerBound, within: out), let hi = AttributedString.Index(r.upperBound, within: out) else { continue }
        out[lo..<hi].backgroundColor = Color.yellow.opacity(0.55)
        out[lo..<hi].foregroundColor = .black
    }
    return out
}

struct MarkdownView: View {
    let source: String
    /// It takes the width it is given; in a bubble (`wide` false) only what its words need.
    let wide: Bool
    init(_ source: String, wide: Bool = true) { self.source = source; self.wide = wide }
    @Environment(\.searchTerms) private var terms

    var body: some View {
        // The space above each block is its own: more above a title, less between two items of a list.
        let blocks = MarkdownBlock.parse(source)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { i, block in
                view(for: block).padding(.top, MarkdownBlock.gapAbove(i > 0 ? blocks[i - 1] : nil, block))
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: wide ? .infinity : nil, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let t):
            Text(marked(Self.inline(t), terms)).lineSpacing(Bubble.lineSpacing)
        case .heading(let level, let t):
            Text(marked(Self.inline(t), terms)).font(.geist(size: MarkdownBlock.headingSize(level), weight: .semibold))
        case .item(let t, let number, let depth):
            // The indent moves the whole row, so a sub-item's text starts right of its parent's text.
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(number.map { "\($0)." } ?? "•").foregroundStyle(Theme.muted).lineLimit(1).fixedSize().padding(.trailing, 4)
                    .frame(minWidth: MarkdownBlock.markerWidth(numbered: number != nil), alignment: .leading)
                Text(marked(Self.inline(t), terms)).lineSpacing(Bubble.lineSpacing)
            }
            .padding(.leading, MarkdownBlock.itemIndent(depth))
        case .quote(let t):
            Text(marked(Self.inline(t), terms)).lineSpacing(Bubble.lineSpacing).foregroundStyle(Theme.muted)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 3) }
        case .rule:
            Rectangle().fill(Theme.line).frame(height: 1).frame(maxWidth: .infinity).padding(.vertical, 5)
        case .code(let code):
            ScrollView(.horizontal) {
                Text(code).font(.geistMono(size: 12.5)).padding(.horizontal, 12).padding(.vertical, 10)
            }
            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunk))
        case .table(let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(marked(Self.inline(cell), terms))
                                    .font(.geist(size: 13, weight: r == 0 ? .semibold : .regular))
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .border(Theme.line, width: 1)
                            }
                        }
                    }
                }
                .fixedSize()
            }
        }
    }

    static func inline(_ s: String) -> AttributedString {
        var out = linkedChatText((try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s))
        // `code` on a grey chip, in the mono font (`.md code`).
        for run in out.runs where run.inlinePresentationIntent?.contains(.code) == true {
            out[run.range].font = .geistMono(size: 12.5)
            out[run.range].backgroundColor = Theme.sunk
        }
        return out
    }
}

/// Add links after Markdown parsing, so destinations, code and visible text stay intact.
/// Also used by plain chat bubbles, without interpreting the user's Markdown.
func linkedChatText(_ source: AttributedString) -> AttributedString {
    var out = source
    let plain = String(source.characters)
    let candidates = try! NSRegularExpression(pattern: #"(?i)(?<![\p{L}\p{N}_:/])https?://[^\s<>\x22\x27`]+"#)
    let code = try! NSRegularExpression(pattern: #"(`+)[\s\S]*?\1"#)
    let codeRanges = code.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)).map(\.range)
    // Explicit Markdown links use the same web-only policy as detected URLs.
    for run in source.runs {
        if let url = run.link, !["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            out[run.range].link = nil
        }
    }
    for match in candidates.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
        guard !codeRanges.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
              let raw = Range(match.range, in: plain) else { continue }
        var target = String(plain[raw])
        while let last = target.last {
            if ".,;:!?".contains(last) { target.removeLast(); continue }
            let pairs: [Character: Character] = [")": "(", "]": "[", "}": "{"]
            if let open = pairs[last], target.filter({ $0 == last }).count > target.filter({ $0 == open }).count {
                target.removeLast(); continue
            }
            break
        }
        guard let url = URL(string: target), let host = url.host, !host.isEmpty,
              let lo = AttributedString.Index(raw.lowerBound, within: source),
              let hi = AttributedString.Index(plain.index(raw.lowerBound, offsetBy: target.count), within: source) else { continue }
        // Never nest an autolink in an explicit link or inline code span.
        guard !source[lo..<hi].runs.contains(where: {
            $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true
        }) else { continue }
        out[lo..<hi].link = url
    }
    // A link is underlined and keeps the colour of the words around it (the window's tint is ink).
    for run in out.runs where run.link != nil { out[run.range].underlineStyle = .single }
    return out
}
