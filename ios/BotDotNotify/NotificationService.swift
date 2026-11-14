import UserNotifications

/// The notification extension, empty for now: it hands a push on as it came. Phase 1 reads its content with the
/// shared data layer, from the App Group the app shares with it.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        contentHandler(request.content)
    }
}
