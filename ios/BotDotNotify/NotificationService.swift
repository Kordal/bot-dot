import Foundation
import UserNotifications

/// The notification extension (ADR 150): a push arrives as "botdot" / "New notification" with the seal, and this
/// opens the seal with the device's key (PushKey) and shows what botdot said, with the buttons it named. A seal it
/// can't open shows as it came: the text stays generic, and a tap still opens its thread (the target).
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    // What iOS shows if the time runs out: the opened text once it is there, else the push as it came. Guarded by
    // `lock`: the categories' work and iOS's time-out may finish at once.
    private let lock = NSLock()
    private var deliver: ((UNNotificationContent) -> Void)?
    private var best: UNNotificationContent?

    /// One push's category at a time: each reads the list and writes it back with its own, so two at once would drop one.
    private static let categories = DispatchQueue(label: "app.botdot.notify.categories")

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.withLock {
            deliver = contentHandler
            best = request.content
        }
        guard let (content, payload) = PushPayload.opened(request.content) else { return finish() }
        lock.withLock { best = content }
        guard let category = payload.category else { return finish() }
        content.categoryIdentifier = category.identifier
        // The buttons are the server's: their category is registered beside the ones before it, then the notification
        // goes. Asking for the list again waits until the new one is in.
        nonisolated(unsafe) let added = category
        Self.categories.async {
            // No answer: nothing is written, so the categories there are kept (this one shows without its buttons).
            if let have = Self.categoriesNow(), !have.contains(where: { $0.identifier == added.identifier }) {
                UNUserNotificationCenter.current().setNotificationCategories(have.union([added]))
                _ = Self.categoriesNow()
            }
            self.finish()
        }
    }

    override func serviceExtensionTimeWillExpire() {
        finish()
    }

    private func finish() {
        let (deliver, best) = lock.withLock {
            defer { self.deliver = nil }
            return (self.deliver, self.best)
        }
        if let deliver, let best { deliver(best) }
    }

    /// The categories registered now, waited for on the categories' queue; nil when iOS did not answer in a few seconds.
    private static func categoriesNow() -> Set<UNNotificationCategory>? {
        final class Box: @unchecked Sendable { var value: Set<UNNotificationCategory> = [] }
        let box = Box()
        let done = DispatchSemaphore(value: 0)
        UNUserNotificationCenter.current().getNotificationCategories { box.value = $0; done.signal() }
        guard done.wait(timeout: .now() + 5) == .success else { return nil }
        return box.value
    }
}
