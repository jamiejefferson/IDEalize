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
    case io(String)

    public var description: String {
        switch self {
        case .create(let e): return "socket() failed: \(String(cString: strerror(e)))"
        case .bind(let e): return "bind() failed: \(String(cString: strerror(e)))"
        case .listen(let e): return "listen() failed: \(String(cString: strerror(e)))"
        case .connect(let e): return "connect() failed: \(String(cString: strerror(e)))"
        case .pathTooLong: return "socket path is too long"
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
        return Foundation.accept(listenFD, nil, nil)
    }

    /// Connect to a Unix socket at `path`. Returns the connected fd.
    public static func connect(to path: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.create(errno) }
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
            var ptr = raw.baseAddress!
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

    /// Read a single newline-terminated line from the fd. Returns nil on EOF.
    /// Throws if the line exceeds `maxLineBytes` before a newline arrives.
    public static func readLine(_ fd: Int32, maxBytes: Int = maxLineBytes) throws -> String? {
        var buffer = Data()
        var byte: UInt8 = 0
        while true {
            let n = read(fd, &byte, 1)
            if n < 0 {
                if errno == EINTR { continue }
                throw SocketError.io("read() failed: \(String(cString: strerror(errno)))")
            }
            if n == 0 {
                return buffer.isEmpty ? nil : String(decoding: buffer, as: UTF8.self)
            }
            if byte == 0x0A { // newline
                return String(decoding: buffer, as: UTF8.self)
            }
            buffer.append(byte)
            if buffer.count >= maxBytes {
                throw SocketError.io("line exceeded \(maxBytes) bytes without a newline")
            }
        }
    }

    public static func closeFD(_ fd: Int32) {
        close(fd)
    }
}
