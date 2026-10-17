import Foundation
import Testing
@testable import BotDotKit

/// The Mention rules, as the shared table test/fixtures/mentions.json writes them down (the botdot
/// server, the web page and Android are checked against the same table).
@Suite struct MentionsTests {
    struct Table: Decodable {
        let maxRows: Int
        let shortNames: [[String]]
        let worlds: [String: World]
        let cases: [Case]
        let picks: [Pick]
    }
    struct World: Decodable {
        let bots: [BotRow]
        let library: [Skill]
    }
    struct BotRow: Decodable {
        let id: String
        let name: String
        let useSkills: Bool?
        let skills: [String]?
        let jobs: [JobRow]?
    }
    struct JobRow: Decodable { let id: String; let name: String }
    struct Skill: Decodable { let name: String }
    struct Case: Decodable {
        let name: String
        let world: String
        let chat: String
        let text: String?
        let matches: [Found]?
        let typed: String?
        let suggestions: [String]?
    }
    struct Pick: Decodable {
        let name: String
        let world: String
        let chat: String
        let before: String
        let pick: String
        let after: String
        let jobsNext: Bool
    }
    struct Found: Decodable, Equatable {
        let kind: String
        let text: String
        let bot: String?
        let job: String?
        let skill: String?
    }

    static let table: Table = {
        let url = TestServer.repo.appending(path: "test/fixtures/mentions.json")
        return try! JSONDecoder().decode(Table.self, from: Data(contentsOf: url))
    }()

    static func mentions(_ c: Case) -> Mentions { mentions(world: c.world, chat: c.chat) }

    static func mentions(world: String, chat: String) -> Mentions {
        let w = table.worlds[world]!
        let bots = w.bots.map {
            Mentions.Target(id: $0.id, name: $0.name, useSkills: $0.useSkills, skills: $0.skills,
                            jobs: ($0.jobs ?? []).map { Mentions.JobName(id: $0.id, name: $0.name) })
        }
        return Mentions(chat: chat, bots: bots, library: w.library.map(\.name))
    }

    @Test func maxRows() {
        #expect(Mentions.maxRows == Self.table.maxRows)
    }

    @Test(arguments: table.shortNames)
    func shortName(_ pair: [String]) {
        #expect(Mentions.shortName(pair[0]) == pair[1])
    }

    @Test(arguments: table.cases.filter { $0.text != nil })
    func matches(_ c: Case) {
        let text = c.text!
        let found = Self.mentions(c).find(in: text)
        let got = found.map { Found(kind: $0.kind.rawValue, text: $0.text, bot: $0.bot?.id, job: $0.job?.id, skill: $0.skill) }
        #expect(got == c.matches, "\(c.name)")
        for m in found { #expect(String(text[m.range]) == m.text, "\(c.name)") }
    }

    @Test(arguments: table.cases.filter { $0.typed != nil })
    func suggestions(_ c: Case) {
        #expect(Self.mentions(c).suggest(c.typed!).map(\.text) == c.suggestions, "\(c.name)")
    }

    @Test(arguments: table.picks)
    func pick(_ c: Pick) throws {
        let caret = c.before.firstIndex(of: "|")!
        let text = c.before.replacingOccurrences(of: "|", with: "")
        let at = String.Index(utf16Offset: c.before.utf16.distance(from: c.before.startIndex, to: caret), in: text)
        let row = try #require(Self.mentions(world: c.world, chat: c.chat).suggest(String(text[..<at])).first { $0.text == c.pick }, "\(c.pick) is offered")
        let done = try #require(Mentions.pick(row, in: text, at: at))
        #expect(String(done.text[..<done.cursor]) + "|" + String(done.text[done.cursor...]) == c.after, "\(c.name)")
        #expect(done.jobsNext == c.jobsNext, "\(c.name)")
    }

    @Test func nothingBeingTypedNothingPicked() {
        let row = Mentions.Suggestion(kind: .bot, text: "@FleetDoctor", label: "Fleet Doctor")
        let text = "no mention here"
        #expect(Mentions.pick(row, in: text, at: text.index(text.startIndex, offsetBy: 4)) == nil)
    }

    @Test func theChiefIsWhoChief() {
        #expect(Mentions.Target.chief.id == Who.chief.id)
        #expect(Mentions.Target.chief.color == Who.chief.color)
    }
}

extension MentionsTests.Case: CustomTestStringConvertible {
    var testDescription: String { name }
}

extension MentionsTests.Pick: CustomTestStringConvertible {
    var testDescription: String { name }
}
