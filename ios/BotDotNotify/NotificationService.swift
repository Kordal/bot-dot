import UserNotifications

/// The notification extension (ADR 150): a push arrives as "botdot" / "New notification" with the seal, and this
/// opens the seal with the device's key (PushKey) and shows what botdot said, with the buttons it named. A seal it
/// can't open shows as it came: the text stays generic, and a tap still opens its thread (the target).
// iOS calls it on one queue at a time; the categories' callbacks only finish what it started.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    // What iOS shows if the time runs out: the opened text once it is there, else the push as it came.
    private var deliver: ((UNNotificationContent) -> Void)?
    private var best: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        deliver = contentHandler
        best = request.content
        guard let (content, payload) = PushPayload.opened(request.content) else { return finish() }
        best = content
        guard let category = payload.category else { return finish() }
        content.categoryIdentifier = category.identifier
        // The buttons are the server's: their category is registered beside the ones before it, then the notification
        // goes. Asking for the list again waits until the new one is in.
        nonisolated(unsafe) let added = category
        UNUserNotificationCenter.current().getNotificationCategories { have in
            guard !have.contains(where: { $0.identifier == added.identifier }) else { return self.finish() }
            UNUserNotificationCenter.current().setNotificationCategories(have.union([added]))
            UNUserNotificationCenter.current().getNotificationCategories { _ in self.finish() }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        finish()
    }

    private func finish() {
        guard let deliver, let best else { return }
        self.deliver = nil
        deliver(best)
    }
}
