import Foundation
import UserNotifications
import AppKit

/// Wraps the system notification center so Claude Code (via `idealize notify`)
/// can raise clear, native macOS notifications.
final class NotificationManager: NSObject {
    static let shared = NotificationManager()

    private var authorized = false
    private var usingUNCenter = false

    func requestAuthorization() {
        // UNUserNotificationCenter requires a bundled, signed app. When running
        // unbundled (dev), fall back to NSUserNotification-style delivery.
        guard Bundle.main.bundleIdentifier != nil else {
            usingUNCenter = false
            return
        }
        usingUNCenter = true
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            self?.authorized = granted
        }
    }

    func notify(title: String, body: String, sound: Bool) {
        // Play our own completion chime (at a gentle level) rather than the
        // system notification sound, so we control the tone and its volume.
        if sound { DoneSound.play() }
        if usingUNCenter {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: content,
                trigger: nil)
            UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
        } else {
            // Fallback for unbundled runs: bounce the dock + log. (Visible signal
            // without requiring notification entitlements.)
            DispatchQueue.main.async {
                NSApp.requestUserAttention(.criticalRequest)
            }
            NSLog("IDEalize notify: \(title) — \(body)")
        }
    }
}

extension NotificationManager: UNUserNotificationCenterDelegate {
    // Show notifications even when IDEalize is frontmost.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler:
                                @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }
}
