import SwiftUI
import BotdotShared

/// A reply's Markdown, read by the shared layer as the web page and Android read it (parseBlocks, inlineRuns), drawn
/// with SwiftUI: headings, paragraphs, lists and tasks, quotes, code and tables; links open in the browser.
struct MarkdownView: View {
    let text: String

    var body: some View {
        let blocks = MarkdownKt.parseBlocks(src: text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(block)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func view(_ block: any Block_) -> some View { // Block_: the Markdown package's Block, beside the Board's
        switch onEnum(of: block) {
        case .heading(let h):
            Text(Self.inline(h.text)).font(h.level == 1 ? .title3.bold() : .headline)
        case .para(let p):
            Text(Self.inline(p.text))
        case .item(let i):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(i.task == "done" ? "☑︎" : i.task == "todo" ? "☐" : i.number.map { "\($0)." } ?? "•")
                    .foregroundStyle(.secondary)
                Text(Self.inline(i.text))
            }
            .padding(.leading, CGFloat(i.indent) * 18)
        case .quote(let q):
            Text(Self.inline(q.text)).foregroundStyle(.secondary)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(.secondary).frame(width: 3) }
        case .code(let c):
            ScrollView(.horizontal) {
                Text(c.text).font(.callout.monospaced()).padding(10)
            }
            .background(.quaternary, in: .rect(cornerRadius: 8))
        case .table(let t):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(Array(t.rows.enumerated()), id: \.offset) { n, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(Self.inline(cell)).font(n == 0 ? .callout.bold() : .callout)
                            }
                        }
                    }
                }
            }
        case .rule:
            Divider()
        }
    }

    /// A line's runs of marked text (inlineRuns) as one attributed string.
    static func inline(_ text: String) -> AttributedString {
        var out = AttributedString()
        for run in MarkdownKt.inlineRuns(s: text, bold: false, italic: false, strike: false) {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if run.code { intent.insert(.code) }
            if run.strike { intent.insert(.strikethrough) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let link = run.link, let url = URL(string: link) { piece.link = url }
            out += piece
        }
        return out
    }
}
