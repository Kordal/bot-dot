import SwiftUI

/// Several questions at once (the Chief's, or a group member's): a box under each, its choices under it to fill it,
/// and one Send for all. Sent, it goes; refused, what was typed stays for Send again.
struct QuestionsBox: View {
    let questions: [String]
    let choices: [[String]]
    let onSend: ([String]) async -> Bool
    @State private var answers: [String] = []
    @State private var sending = false
    @State private var sent = false

    var body: some View {
        if !sent {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(questions.enumerated()), id: \.offset) { (i, q: String) in question(i, q) }
                HStack {
                    Spacer()
                    Button(tr("Send"), action: send).buttonStyle(.borderedProminent)
                        .disabled(sending || !answers.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
                }
            }
            .padding(14)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 14))
            .onAppear { if answers.count != questions.count { answers = Array(repeating: "", count: questions.count) } }
        }
    }

    private func question(_ i: Int, _ q: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(q).font(.subheadline)
            TextField("", text: binding(i), axis: .vertical).lineLimit(1...6).textFieldStyle(.roundedBorder)
            if i < choices.count, !choices[i].isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(choices[i], id: \.self) { (c: String) in
                            Button(c) { answers[i] = c }
                                .buttonStyle(.bordered).tint(answer(i) == c ? .accentColor : .secondary)
                        }
                    }
                }
            }
        }
    }

    private func answer(_ i: Int) -> String { i < answers.count ? answers[i].trimmingCharacters(in: .whitespaces) : "" }

    private func binding(_ i: Int) -> Binding<String> {
        Binding(get: { i < answers.count ? answers[i] : "" }, set: { v in if i < answers.count { answers[i] = v } })
    }

    private func send() {
        sending = true
        let all = answers
        Task {
            if await onSend(all) { sent = true }
            sending = false
        }
    }
}
