import AppKit
@preconcurrency import UserNotifications
import BotDotKit

/// Mac notifications, like the Android app's: a new reply of a bot or the Chief, which goes when its
/// chat is read in any app, and always what needs you, with Approve and Decline where a card has
/// them (Decline alone for a tool from a link, which is installed on its card), which goes once
/// answered, here or anywhere else. The Dock icon shows a dot while something
/// waits for your OK; a new reply makes no badge. Each is tagged with what it's about: "bot:<id>",
/// "chief:<chatId>" or "need:<key>".
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private weak var store: Store?
    private weak var nav: Navigation?
    private var shownNotices: [String: NeedNotice] = [:]
    private var started = false
    /// The reply notifications may not match the server's new replies: the app just started, or the
    /// feed could not replay what was missed (`reset`). The next catch-up posts what is missing.
    private var owes = true
    private var catchingUp = false
    /// Another catch-up was asked for while one was going on: it runs after it.
    private var again = false
    /// The chats an event said something about since the catch-up asked the server: the event is
    /// newer than the answer, so the catch-up leaves those alone.
    private var touched: Set<String> = []
    /// When this Mac app was last used. On a botdot server from before new replies: while it is, the
    /// web's "someone's looking" doesn't silence it.
    var lastUsed = Date.distantPast
    private var center: UNUserNotificationCenter { .current() }
    /// The buttons every notification can have, and the ids of those made for cards whose buttons
    /// read the server's words (`NeedNotice.category`).
    private var categories: Set<UNNotificationCategory> = []
    private var worded: Set<String> = []

    func start(store: Store, nav: Navigation) {
        self.store = store
        self.nav = nav
        guard !started else { return }
        started = true
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        let approve = UNNotificationAction(identifier: "yes", title: "Approve")
        let decline = UNNotificationAction(identifier: "no", title: "Decline", options: .destructive)
        let allow = UNNotificationAction(identifier: "yes", title: "Allow")
        let install = UNNotificationAction(identifier: "yes", title: "Install")
        categories = [
            UNNotificationCategory(identifier: "approve", actions: [approve, decline], intentIdentifiers: []),
            UNNotificationCategory(identifier: "allow", actions: [allow, decline], intentIdentifiers: []),
            UNNotificationCategory(identifier: "install", actions: [install, decline], intentIdentifiers: []),
            // An ask whose yes is given on its card (a tool from a link): a click opens Needs you.
            UNNotificationCategory(identifier: "decline", actions: [decline], intentIdentifiers: []),
        ]
        center.setNotificationCategories(categories)
        worded = [] // the next `sync` adds those of the cards that wait
        store.onEvent = { [weak self] name, data in
            Task { @MainActor in self?.handle(name, data) }
        }
        catchUp() // read elsewhere, or new, while this app was closed
    }

    // MARK: runs and replies

    /// Which replies notify and when a chat's notifications go is decided in BotDotKit
    /// (`ReplyNotifications`): by the botdot server's new replies, or as before on a server without them.
    private func handle(_ event: String, _ data: Data) {
        let usedLately = Date().timeIntervalSince(lastUsed) <= 5 * 60
        switch store?.notificationStep(event, data, watching: watching, usedLately: usedLately) {
        case .post(let n):
            touched.insert(n.chat)
            post(tag: n.chat, id: n.id, title: n.title, body: n.body)
        case .remove(let chat):
            touched.insert(chat)
            remove { $0 == chat }
        case .catchUp(let rebuild):
            if rebuild { owes = true }
            catchUp()
        case nil: break
        }
    }

    /// The chat this app shows while it is in front.
    private var watching: String? { NSApp.isActive ? nav?.chatOnScreen : nil }

    /// Brings the reply notifications in line with the server's new replies, as the Android app does.
    /// Those of chats that were read while this app wasn't listening (it was closed, or its live feed
    /// was down) go; only those delivered before the server was asked: a reply that arrives meanwhile
    /// keeps its own. After the app started, and when the feed could not replay what was missed, a
    /// chat with new replies and no notification gets one again, quietly, showing its first new reply.
    private func catchUp() {
        guard !catchingUp else { again = true; return }
        catchingUp = true
        touched = []
        let center = center
        Task { @MainActor [weak self] in
            defer {
                self?.catchingUp = false
                if self?.again == true { self?.again = false; self?.catchUp() }
            }
            let asked = Date()
            let tags = Set(await center.deliveredNotifications().compactMap { $0.request.content.userInfo["tag"] as? String })
            guard let self, let store = self.store else { return }
            // Taken now: a `reset` that arrives while the server is asked owes a catch-up of its own.
            let rebuild = self.owes
            self.owes = false
            // Not answered: what is owed stays owed, for the next time the feed starts.
            guard let plan = await store.notificationCatchUp(showing: Array(tags), rebuild: rebuild, watching: self.watching) else {
                if rebuild { self.owes = true }
                return
            }
            let read = Set(plan.remove).subtracting(self.touched)
            if !read.isEmpty { self.remove(before: asked) { read.contains($0) } }
            for n in plan.post where !self.touched.contains(n.chat) && n.chat != self.watching {
                self.post(tag: n.chat, id: n.id, title: n.title, body: n.body, quiet: true)
            }
        }
    }

    // MARK: what needs you

    /// Called whenever what waits for you changes: new cards notify, answered ones go away. What each
    /// notification says is decided in BotDotKit (`Store.needNotices`): a card whose notification
    /// still waits for its text is in `needs` and not yet in `notices`. One whose text changed (a
    /// tool's line arrived after its card was announced by its title) is replaced in the list, quietly.
    func sync(_ needs: [NeedItem], notices: [NeedNotice]) {
        let keys = Set(notices.map(\.key))
        word(notices)
        for n in notices where shownNotices[n.key] != n {
            let new = shownNotices[n.key] == nil
            post(tag: "need:\(n.key)", id: "need:\(n.key)", title: n.title, body: n.body, category: n.category, urgent: new, quiet: !new)
        }
        let gone = Set(shownNotices.keys).subtracting(keys)
        if !gone.isEmpty { remove { tag in gone.contains { "need:\($0)" == tag } } }
        shownNotices = Dictionary(notices.map { ($0.key, $0) }, uniquingKeysWith: { $1 })
        // The Dock icon shows a dot while something waits (no number: the small heads in the app show it).
        NSApp.dockTile.badgeLabel = needs.isEmpty ? nil : "●"
    }

    /// The buttons of the cards whose words are the server's ("Decline and remove", "Keep as it is",
    /// "Approve the change"): a category each, beside the fixed ones, made before its notification is
    /// posted. A no that removes is drawn as destructive; one that keeps is not.
    private func word(_ notices: [NeedNotice]) {
        let own = notices.filter { $0.category != $0.actions.rawValue }
        guard Set(own.map(\.category)) != worded else { return }
        worded = Set(own.map(\.category))
        center.setNotificationCategories(categories.union(own.map { n in
            let yes = n.actions == .decline ? [] : [UNNotificationAction(identifier: "yes", title: n.yes ?? "Approve")]
            let no = UNNotificationAction(identifier: "no", title: n.no ?? "Decline", options: n.keeps ? [] : .destructive)
            return UNNotificationCategory(identifier: n.category, actions: yes + [no], intentIdentifiers: [])
        }))
    }

    /// `quiet`: it says what was already there (a catch-up), so it goes to the list without a banner.
    private func post(tag: String, id: String, title: String, body: String, category: String = "", urgent: Bool = false, quiet: Bool = false) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = String(Format.plain(body).prefix(400))
        c.threadIdentifier = tag
        c.categoryIdentifier = category
        c.userInfo = quiet ? ["tag": tag, "quiet": true] : ["tag": tag]
        if quiet { c.interruptionLevel = .passive }
        c.sound = urgent ? .default : nil
        if urgent { c.interruptionLevel = .timeSensitive }
        center.add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    /// Removes the delivered notifications with a matching tag; with `before`, only those from before then.
    private func remove(before: Date? = nil, where match: @escaping @Sendable (String) -> Bool) {
        let center = center
        center.getDeliveredNotifications { list in
            let ids = list.filter { n in match(n.request.content.userInfo["tag"] as? String ?? "") && before.map { n.date <= $0 } != false }.map(\.request.identifier)
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    // Shown even while the app is open (a reply to the chat on screen in front never gets here). One
    // posted again by a catch-up only joins the list.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        notification.request.content.userInfo["quiet"] as? Bool == true ? [.list] : [.banner, .list, .sound]
    }

    // A click opens what it's about; Approve and Decline answer it right there.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let tag = response.notification.request.content.userInfo["tag"] as? String ?? ""
        let action = response.actionIdentifier
        await MainActor.run { self.act(tag: tag, action: action) }
    }

    private func act(tag: String, action: String) {
        guard let store, let nav else { return }
        if tag.hasPrefix("need:"), let item = store.needs.first(where: { "need:\($0.key)" == tag }) {
            if action == "yes" || action == "no" {
                Task {
                    do { try await store.decide(item, yes: action == "yes") } catch { store.problem = error.localizedDescription }
                }
                return
            }
            NSApp.activate()
            // A card asked in a group stands at the end of that group's chat: its notification opens the group.
            if let group = item.group { nav.page = .group(group.id) } else { nav.open(item, store: store) }
            return
        }
        NSApp.activate()
        if tag.hasPrefix("bot:") { nav.page = .bot(String(tag.dropFirst(4))) }
        if tag.hasPrefix("chief:") { nav.openChief(String(tag.dropFirst(6)), store: store) }
        if let group = Groups.of(chat: tag) { nav.page = .group(group) }
    }
}
