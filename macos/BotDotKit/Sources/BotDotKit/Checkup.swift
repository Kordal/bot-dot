import Foundation

/// The Chief's checkup (docs/api.md "The Chief's checkup", ADR 023): its setting, as the two switches
/// of the Chief's settings read it. The owner changes whether it runs and whether it may search the
/// web; the days and the time have no control, they tell the Chief. Its message is a Chief reply like
/// any other (`ChiefMessage.checkup`), with answer buttons and no 👍 and 👎.
public struct CheckupSetting: Decodable, Hashable, Sendable {
    /// Whether checkups run.
    public var on: Bool
    /// Whether a checkup may search the web.
    public var webSearch: Bool
    /// The days and the time in the server's words ("Weekdays at 08:00"): shown as they come.
    public var when: String
    public var days: [Int]?
    public var time: String?
    public var timeZone: String?
    public var lastRanAt: String?

    public init(on: Bool, webSearch: Bool = false, when: String = "", days: [Int]? = nil, time: String? = nil, timeZone: String? = nil, lastRanAt: String? = nil) {
        self.on = on
        self.webSearch = webSearch
        self.when = when
        self.days = days
        self.time = time
        self.timeZone = timeZone
        self.lastRanAt = lastRanAt
    }

    enum CodingKeys: CodingKey { case on, webSearch, when, days, time, timeZone, lastRanAt }

    /// Only `on` is needed: a field this app can't read costs that field, not the switches.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = try c.decode(Bool.self, forKey: .on)
        webSearch = (try? c.decodeIfPresent(Bool.self, forKey: .webSearch)) ?? false
        when = (try? c.decodeIfPresent(String.self, forKey: .when)) ?? ""
        days = try? c.decodeIfPresent([Int].self, forKey: .days)
        time = try? c.decodeIfPresent(String.self, forKey: .time)
        timeZone = try? c.decodeIfPresent(String.self, forKey: .timeZone)
        lastRanAt = try? c.decodeIfPresent(String.self, forKey: .lastRanAt)
    }

    /// The muted line under the "Checkup" switch.
    public var line: String { when.isEmpty ? "Ask the Chief to change it." : "\(when). Ask the Chief to change it." }
}

extension Store {
    /// Reads the checkup's setting. A server without `checkup` in its `features` has none, and one
    /// that didn't answer leaves what is held.
    func loadCheckup() async {
        guard let api, has(.checkup) else { checkup = nil; return }
        struct Answer: Decodable { let checkup: CheckupSetting }
        guard let a: Answer = try? await api.get("settings/checkup"), self.api?.base == api.base else { return }
        checkup = a.checkup
    }

    /// The "Checkup" switch.
    public func setCheckup(on: Bool) async { await changeCheckup(["on": on]) { $0.on = on } }

    /// The "Web search" switch.
    public func setCheckup(webSearch: Bool) async { await changeCheckup(["webSearch": webSearch]) { $0.webSearch = webSearch } }

    /// Changes what is named: the switch moves at once, the server's answer is what stays, and a
    /// change it refused or that didn't arrive puts the setting back and says why (`problem`).
    func changeCheckup(_ values: [String: Any], shown: (inout CheckupSetting) -> Void = { _ in }) async {
        guard let api, let before = checkup else { return }
        var now = before
        shown(&now)
        checkup = now
        struct Answer: Decodable { let checkup: CheckupSetting }
        do {
            let data = try await api.sendJSON("settings/checkup", method: "PUT", body: try JSONSerialization.data(withJSONObject: values))
            let saved = try JSON.decoder.decode(Answer.self, from: data).checkup
            if self.api?.base == api.base { checkup = saved }
        } catch {
            // Only what this change showed is put back: the feed may have brought something newer.
            if self.api?.base == api.base, checkup == now { checkup = before }
            problem = error.localizedDescription
        }
    }

    /// The feed's `checkup`: the setting changed, in another app or by the Chief in a chat.
    func checkupChanged(_ data: Data) {
        guard has(.checkup), let now = try? JSON.decoder.decode(CheckupSetting.self, from: data) else { return }
        checkup = now
    }
}
