import Foundation

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Errors thrown by the low-level socket helpers.
public enum SocketError: Error, CustomStringConvertible {
    case create(Int32)
    case bind(Int32)
    case listen(Int32)
    case connect(Int32)
    case pathTooLong
    case timeout(TimeInterval)
    case io(String)

    public var description: String {
        switch self {
        case .create(let e): return "socket() failed: \(String(cString: strerror(e)))"
        case .bind(let e): return "bind() failed: \(String(cString: strerror(e)))"
        case .listen(let e): return "listen() failed: \(String(cString: strerror(e)))"
        case .connect(let e): return "connect() failed: \(String(cString: strerror(e)))"
        case .pathTooLong: return "socket path is too long"
        case .timeout(let s): return "read timed out after \(Int(s))s"
        case .io(let m): return m
        }
    }
}

/// Minimal blocking helpers around `AF_UNIX` stream sockets. The CLI uses the
/// client side; the app uses `listen`/`accept` plus line read/write.
public enum UnixSocket {
    /// Fill a `sockaddr_un` for the given path. Returns the populated struct and
    /// the length to pass to bind/connect.
    private static func makeAddr(_ path: String) throws -> (sockaddr_un, socklen_t) {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
        let bytes = Array(path.utf8)
        guard bytes.count < maxLen else { throw SocketError.pathTooLong }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: maxLen) { cptr in
                for (i, b) in bytes.enumerated() { cptr[i] = CChar(bitPattern: b) }
                cptr[bytes.count] = 0
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        return (addr, len)
    }

    /// Prevent SIGPIPE when a peer closes early: writes then fail with EPIPE
    /// (surfaced as a thrown error) instead of killing the whole process.
    private static func setNoSigPipe(_ fd: Int32) {
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    }

    /// Create, bind and listen on a Unix socket at `path`. Removes any stale
    /// socket file first. Returns the listening file descriptor.
    ///
    /// Access control: the containing directory is created `0700` and the socket
    /// node is `chmod`ed to `0600` so that only the owning user can connect.
    /// Anyone who can connect can drive the `input`/`exec` IPC commands, which
    /// inject text into live terminals — so owner-only is the security boundary.
    public static func listen(at path: String, backlog: Int32 = 32) throws -> Int32 {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: dir,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        // Tighten the directory even if it already existed with looser perms.
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir)
        unlink(path)

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.create(errno) }
        setNoSigPipe(fd)

        // Constrain the socket node's mode at creation time so there is no window
        // in which it is world-connectable between bind() and chmod().
        let oldMask = umask(0o177)               // result: 0600
        defer { umask(oldMask) }

        var (addr, len) = try makeAddr(path)
        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Foundation.bind(fd, $0, len)
            }
        }
        guard bindResult == 0 else { let e = errno; close(fd); throw SocketError.bind(e) }
        // Belt-and-braces: explicitly enforce 0600 regardless of inherited umask.
        chmod(path, 0o600)
        guard Foundation.listen(fd, backlog) == 0 else { let e = errno; close(fd); throw SocketError.listen(e) }
        return fd
    }

    /// Accept a single connection on a listening fd. Returns the client fd.
    public static func accept(_ listenFD: Int32) -> Int32 {
        let fd = Foundation.accept(listenFD, nil, nil)
        // Belt-and-braces: Darwin inherits SO_NOSIGPIPE from the listener, but
        // the accepted fd is where the server actually writes responses.
        if fd >= 0 { setNoSigPipe(fd) }
        return fd
    }

    /// Connect to a Unix socket at `path`. Returns the connected fd.
    public static func connect(to path: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.create(errno) }
        setNoSigPipe(fd)
        var (addr, len) = try makeAddr(path)
        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Foundation.connect(fd, $0, len)
            }
        }
        guard result == 0 else { let e = errno; close(fd); throw SocketError.connect(e) }
        return fd
    }

    /// Write all bytes of `data` to the fd.
    public static func writeAll(_ fd: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            // Empty Data has no base address — nothing to write.
            guard let base = raw.baseAddress, !raw.isEmpty else { return }
            var ptr = base
            var remaining = raw.count
            while remaining > 0 {
                let n = write(fd, ptr, remaining)
                if n < 0 {
                    if errno == EINTR { continue }
                    throw SocketError.io("write() failed: \(String(cString: strerror(errno)))")
                }
                if n == 0 { throw SocketError.io("write() returned 0 (peer closed)") }
                ptr = ptr.advanced(by: n)
                remaining -= n
            }
        }
    }

    /// Write a single line (appends `\n`).
    public static func writeLine(_ fd: Int32, _ line: String) throws {
        try writeAll(fd, Data((line + "\n").utf8))
    }

    /// Maximum length of a single line we will buffer. A well-behaved client
    /// sends one short JSON request terminated by `\n`; anything past this is a
    /// misbehaving or hostile peer, so we refuse it rather than grow without
    /// bound (which would let one connection exhaust memory).
    public static let maxLineBytes = 8 * 1024 * 1024 // 8 MiB

    /// Default deadline for `readLine`/`readLineBytes`: a peer that stops
    /// sending mid-request must not pin a worker thread forever.
    public static let defaultReadTimeout: TimeInterval = 30

    /// Read a single newline-terminated line from the fd as raw bytes.
    /// Returns nil on clean EOF (peer closed before any byte of this line
    /// arrived). Throws on EOF mid-line, when the line would exceed
    /// `maxBytes`, or when the line is not completed within `timeout` seconds.
    public static func readLineBytes(_ fd: Int32,
                                     maxBytes: Int = maxLineBytes,
                                     timeout: TimeInterval = defaultReadTimeout) throws -> Data? {
        var line = Data()
        line.reserveCapacity(4096)
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            // Wait (bounded by the deadline) for the fd to become readable.
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else { throw SocketError.timeout(timeout) }
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let ready = withUnsafeMutablePointer(to: &pfd) { ptr in
                poll(ptr, 1, Int32(min(remaining * 1000, Double(Int32.max))))
            }
            if ready < 0 {
                if errno == EINTR { continue }
                throw SocketError.io("poll() failed: \(String(cString: strerror(errno)))")
            }
            if ready == 0 { throw SocketError.timeout(timeout) }

            let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n < 0 {
                if errno == EINTR { continue }
                throw SocketError.io("read() failed: \(String(cString: strerror(errno)))")
            }
            if n == 0 {
                // EOF: clean only when no partial line was buffered.
                if line.isEmpty { return nil }
                throw SocketError.io("connection closed mid-line (EOF before newline)")
            }
            let bytes = chunk.prefix(n)
            if let nl = bytes.firstIndex(of: 0x0A) { // newline
                guard line.count + bytes.distance(from: bytes.startIndex, to: nl) <= maxBytes else {
                    throw SocketError.io("line exceeded \(maxBytes) bytes without a newline")
                }
                line.append(contentsOf: bytes[..<nl])
                return line
            }
            line.append(contentsOf: bytes)
            if line.count > maxBytes {
                throw SocketError.io("line exceeded \(maxBytes) bytes without a newline")
            }
        }
    }

    /// Read a single newline-terminated line from the fd. Returns nil on clean
    /// EOF. See `readLineBytes` for the error cases.
    public static func readLine(_ fd: Int32,
                                maxBytes: Int = maxLineBytes,
                                timeout: TimeInterval = defaultReadTimeout) throws -> String? {
        try readLineBytes(fd, maxBytes: maxBytes, timeout: timeout)
            .map { String(decoding: $0, as: UTF8.self) }
    }

    public static func closeFD(_ fd: Int32) {
        close(fd)
    }
}
