import Foundation
import Darwin

/// Resolves the foreground process running inside a pseudo-terminal so tabs can
/// show what's actually executing (e.g. "claude", "node", "vim") versus an idle
/// shell.
enum ProcessInspector {
    /// Returns the name of the foreground process group leader on the given
    /// pty primary fd, or nil if it can't be determined.
    static func foregroundProcessName(childfd: Int32, shellPid: pid_t) -> (name: String, isShell: Bool)? {
        guard childfd >= 0 else { return nil }
        let pgid = tcgetpgrp(childfd)
        guard pgid > 0 else { return nil }
        guard let name = processName(pid: pgid) else { return nil }
        return (name, pgid == shellPid)
    }

    /// Look up a process name by pid via libproc.
    static func processName(pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 256)
        let result = proc_name(pid, &buffer, UInt32(buffer.count))
        if result <= 0 { return nil }
        let name = String(cString: buffer)
        return name.isEmpty ? nil : name
    }
}
