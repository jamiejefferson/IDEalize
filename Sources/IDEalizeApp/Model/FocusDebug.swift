import AppKit

/// Temporary instrumentation for the new-chat focus investigation. Enabled only
/// when IDEALIZE_FOCUS_DEBUG is set in the app's environment, so a normal build
/// is silent.
enum FocusDebug {
    static let on = ProcessInfo.processInfo.environment["IDEALIZE_FOCUS_DEBUG"] != nil

    static func log(_ message: @autoclosure () -> String) {
        guard on else { return }
        let r = NSApp?.keyWindow?.firstResponder
        let responder = r.map { String(describing: type(of: $0)) } ?? "nil"
        let sheets = NSApp?.keyWindow?.sheets.count ?? -1
        NSLog("[FOCUSDBG] %@ | responder=%@ sheets=%d", message(), responder, sheets)
    }
}
