import XCTest
@testable import IDEalizeCore

final class IDEalizeCoreTests: XCTestCase {
    func testRequestRoundTrip() throws {
        let req = IPCRequest(command: .send, from: "a", target: "b", body: "hello")
        let data = try IPC.makeEncoder().encode(req)
        let decoded = try IPC.makeDecoder().decode(IPCRequest.self, from: data)
        XCTAssertEqual(decoded.command, .send)
        XCTAssertEqual(decoded.from, "a")
        XCTAssertEqual(decoded.target, "b")
        XCTAssertEqual(decoded.body, "hello")
    }

    func testRequestTokenRoundTrip() throws {
        let req = IPCRequest(command: .input, from: "a", token: "secret-token", target: "b", body: "ls\n")
        let data = try IPC.makeEncoder().encode(req)
        let decoded = try IPC.makeDecoder().decode(IPCRequest.self, from: data)
        XCTAssertEqual(decoded.token, "secret-token")
    }

    func testRequestWithoutTokenDecodes() throws {
        // Older clients (no token field) must still decode — token stays nil.
        let json = #"{"command":"ping"}"#.data(using: .utf8)!
        let decoded = try IPC.makeDecoder().decode(IPCRequest.self, from: json)
        XCTAssertEqual(decoded.command, .ping)
        XCTAssertNil(decoded.token)
    }

    // MARK: - Capability token loading

    /// Save/restore the two env vars `loadToken` consults (process-wide state).
    private func withTokenEnv<T>(_ body: () throws -> T) rethrows -> T {
        let oldToken = getenv(IPC.tokenEnvKey).map { String(cString: $0) }
        let oldSock = getenv("IDEALIZE_SOCK").map { String(cString: $0) }
        defer {
            if let v = oldToken { setenv(IPC.tokenEnvKey, v, 1) } else { unsetenv(IPC.tokenEnvKey) }
            if let v = oldSock { setenv("IDEALIZE_SOCK", v, 1) } else { unsetenv("IDEALIZE_SOCK") }
        }
        return try body()
    }

    func testLoadTokenPrefersEnvironment() throws {
        try withTokenEnv {
            setenv(IPC.tokenEnvKey, "env-token", 1)
            XCTAssertEqual(IPC.loadToken(), "env-token")
        }
    }

    func testLoadTokenFallsBackToFile() throws {
        try withTokenEnv {
            let dir = NSTemporaryDirectory() + "idealize-tok-\(UUID().uuidString)"
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(atPath: dir) }
            setenv("IDEALIZE_SOCK", dir + "/ipc.sock", 1)
            unsetenv(IPC.tokenEnvKey)
            // Written with surrounding whitespace — loading must trim it.
            try "file-token\n".write(toFile: dir + "/ipc.token", atomically: true, encoding: .utf8)
            XCTAssertEqual(IPC.loadToken(), "file-token")
        }
    }

    func testLoadTokenMissingEverywhereIsNil() throws {
        try withTokenEnv {
            let dir = NSTemporaryDirectory() + "idealize-tok-\(UUID().uuidString)"
            setenv("IDEALIZE_SOCK", dir + "/ipc.sock", 1)   // no ipc.token beside it
            unsetenv(IPC.tokenEnvKey)
            XCTAssertNil(IPC.loadToken())
        }
    }

    // MARK: - Socket hardening

    func testWriteAllEmptyDataIsNoOp() throws {
        let path = NSTemporaryDirectory() + "idealize-empty-\(getpid()).sock"
        let listenFD = try UnixSocket.listen(at: path)
        defer { UnixSocket.closeFD(listenFD); unlink(path) }

        let serverDone = expectation(description: "server handled")
        DispatchQueue(label: "test.empty.server").async {
            let client = UnixSocket.accept(listenFD)
            if client >= 0 {
                if let line = try? UnixSocket.readLine(client) {
                    try? UnixSocket.writeLine(client, "echo:" + line)
                }
                UnixSocket.closeFD(client)
            }
            serverDone.fulfill()
        }

        let fd = try UnixSocket.connect(to: path)
        // Empty Data has no base address — must be a no-op, not a crash.
        try UnixSocket.writeAll(fd, Data())
        try UnixSocket.writeLine(fd, "ping")
        let reply = try UnixSocket.readLine(fd)
        UnixSocket.closeFD(fd)
        XCTAssertEqual(reply, "echo:ping")
        wait(for: [serverDone], timeout: 5)
    }

    func testSocketsHaveNoSigPipe() throws {
        let path = NSTemporaryDirectory() + "idealize-nsp-\(getpid()).sock"
        let listenFD = try UnixSocket.listen(at: path)
        defer { UnixSocket.closeFD(listenFD); unlink(path) }

        func noSigPipe(_ fd: Int32) -> Int32 {
            var value: Int32 = 0
            var len = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &value, &len)
            return value
        }

        let accepted = expectation(description: "accepted")
        DispatchQueue(label: "test.nsp.server").async {
            let client = UnixSocket.accept(listenFD)
            XCTAssertEqual(noSigPipe(client), 1, "accepted fd must have SO_NOSIGPIPE")
            UnixSocket.closeFD(client)
            accepted.fulfill()
        }

        XCTAssertEqual(noSigPipe(listenFD), 1, "listening fd must have SO_NOSIGPIPE")
        let fd = try UnixSocket.connect(to: path)
        XCTAssertEqual(noSigPipe(fd), 1, "connected fd must have SO_NOSIGPIPE")
        UnixSocket.closeFD(fd)
        wait(for: [accepted], timeout: 5)
    }

    func testResponseRoundTrip() throws {
        let info = IPCSessionInfo(id: "1", title: "t", projectPath: "/p", processName: "zsh", status: "idle", unread: 2)
        let resp = IPCResponse(ok: true, sessions: [info])
        let data = try IPC.makeEncoder().encode(resp)
        let decoded = try IPC.makeDecoder().decode(IPCResponse.self, from: data)
        XCTAssertTrue(decoded.ok)
        XCTAssertEqual(decoded.sessions?.first?.processName, "zsh")
        XCTAssertEqual(decoded.sessions?.first?.unread, 2)
    }

    func testTranscriptRequestRoundTrip() throws {
        let req = IPCRequest(command: .transcript, from: "a", target: "t-123", limit: 25)
        let data = try IPC.makeEncoder().encode(req)
        let decoded = try IPC.makeDecoder().decode(IPCRequest.self, from: data)
        XCTAssertEqual(decoded.command, .transcript)
        XCTAssertEqual(decoded.target, "t-123")
        XCTAssertEqual(decoded.limit, 25)
    }

    func testTranscriptRequestWithoutLimitDecodes() throws {
        // Clients that predate the limit field must still decode — limit stays nil.
        let json = #"{"command":"transcript","target":"t-123"}"#.data(using: .utf8)!
        let decoded = try IPC.makeDecoder().decode(IPCRequest.self, from: json)
        XCTAssertEqual(decoded.command, .transcript)
        XCTAssertNil(decoded.limit)
    }

    func testTranscriptResponseRoundTrip() throws {
        let exchanges = [
            IPCExchange(index: 3, question: "make a menu", answer: "done, top bar"),
            IPCExchange(index: 4, question: "now the footer", answer: nil),
        ]
        let resp = IPCResponse(ok: true, exchanges: exchanges)
        let data = try IPC.makeEncoder().encode(resp)
        let decoded = try IPC.makeDecoder().decode(IPCResponse.self, from: data)
        XCTAssertTrue(decoded.ok)
        XCTAssertEqual(decoded.exchanges?.count, 2)
        XCTAssertEqual(decoded.exchanges?.first?.index, 3)
        XCTAssertNil(decoded.exchanges?.last?.answer)
    }

    func testInlineGraphicsSequence() {
        let data = Data([0x01, 0x02, 0x03, 0x04])
        let seq = InlineGraphics.sequence(for: data, options: .init(width: "40", name: "x.png"))
        XCTAssertTrue(seq.hasPrefix("\u{1B}]1337;File="))
        XCTAssertTrue(seq.hasSuffix("\u{07}"))
        XCTAssertTrue(seq.contains("size=4"))
        XCTAssertTrue(seq.contains("width=40"))
    }

    func testInlineGraphicsParseArgs() {
        let args = InlineGraphics.parseArgs("inline=1;size=4;width=40")
        XCTAssertEqual(args["inline"], "1")
        XCTAssertEqual(args["size"], "4")
        XCTAssertEqual(args["width"], "40")
    }

    func testSocketIsOwnerOnly() throws {
        let path = NSTemporaryDirectory() + "idealize-perm-\(getpid()).sock"
        let listenFD = try UnixSocket.listen(at: path)
        defer { UnixSocket.closeFD(listenFD); unlink(path) }

        let attrs = try FileManager.default.attributesOfItem(atPath: path)
        let mode = (attrs[.posixPermissions] as? NSNumber)?.intValue ?? -1
        // Only the owner may read/write the socket node (no group/other access).
        XCTAssertEqual(mode & 0o777, 0o600, "socket must be owner-only")
    }

    func testReadLineRejectsOverlongLine() throws {
        let path = NSTemporaryDirectory() + "idealize-cap-\(getpid()).sock"
        let listenFD = try UnixSocket.listen(at: path)
        defer { UnixSocket.closeFD(listenFD); unlink(path) }

        let serverDone = expectation(description: "server rejected overlong line")
        DispatchQueue(label: "test.cap.server").async {
            let client = UnixSocket.accept(listenFD)
            // A 64-byte cap with no newline in sight must throw, not buffer forever.
            var threw = false
            do { _ = try UnixSocket.readLine(client, maxBytes: 64) }
            catch { threw = true }
            XCTAssertTrue(threw, "overlong line should be rejected")
            UnixSocket.closeFD(client)
            serverDone.fulfill()
        }

        let fd = try UnixSocket.connect(to: path)
        try UnixSocket.writeAll(fd, Data(repeating: 0x41, count: 4096)) // no '\n'
        UnixSocket.closeFD(fd)
        wait(for: [serverDone], timeout: 5)
    }

    // MARK: - readLine

    /// Create a connected fd over a temp Unix socket; `server` runs on a
    /// background queue with the accepted fd (and must close it).
    private func socketPair(_ name: String, server: @escaping (Int32) -> Void) throws -> Int32 {
        // Keep the path short — sun_path is only ~104 bytes.
        let suffix = String(UUID().uuidString.prefix(8))
        let path = NSTemporaryDirectory() + "idz-\(name)-\(suffix).sock"
        let listenFD = try UnixSocket.listen(at: path)
        DispatchQueue(label: "test.\(name).server").async {
            let accepted = UnixSocket.accept(listenFD)
            UnixSocket.closeFD(listenFD)
            unlink(path)
            if accepted >= 0 { server(accepted) }
        }
        return try UnixSocket.connect(to: path)
    }

    func testReadLineMultiKBAcrossWrites() throws {
        let line = String(repeating: "x", count: 100_000) + "é😀"
        let fd = try socketPair("big") { server in
            // Write in odd-sized pieces so the line spans many read() calls.
            var rest = Array((line + "\n").utf8)
            while !rest.isEmpty {
                let n = min(997, rest.count)
                try? UnixSocket.writeAll(server, Data(rest.prefix(n)))
                rest.removeFirst(n)
            }
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertEqual(try UnixSocket.readLine(fd), line)
    }

    func testReadLineNewlineInSeparateWrite() throws {
        let fd = try socketPair("split") { server in
            try? UnixSocket.writeAll(server, Data("hello".utf8))
            // Make sure the newline arrives in its own read() call.
            Thread.sleep(forTimeInterval: 0.1)
            try? UnixSocket.writeAll(server, Data("\n".utf8))
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertEqual(try UnixSocket.readLine(fd), "hello")
    }

    func testReadLineEOFMidLineThrows() throws {
        let fd = try socketPair("eofmid") { server in
            try? UnixSocket.writeAll(server, Data("partial".utf8))
            UnixSocket.closeFD(server)   // EOF without a newline
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertThrowsError(try UnixSocket.readLine(fd))
    }

    func testReadLineCleanEOFReturnsNil() throws {
        let fd = try socketPair("eofclean") { server in
            UnixSocket.closeFD(server)   // EOF before any byte arrives
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertNil(try UnixSocket.readLine(fd))
    }

    func testReadLineEmptyLine() throws {
        let fd = try socketPair("emptyline") { server in
            try? UnixSocket.writeAll(server, Data("\n".utf8))
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertEqual(try UnixSocket.readLine(fd), "")
    }

    func testReadLineCapBoundary() throws {
        // Exactly maxBytes followed by a newline is allowed...
        let fd = try socketPair("capok") { server in
            try? UnixSocket.writeAll(server, Data(repeating: 0x41, count: 64))
            try? UnixSocket.writeAll(server, Data("\n".utf8))
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertEqual(try UnixSocket.readLine(fd, maxBytes: 64), String(repeating: "A", count: 64))

        // ...one byte past it throws (line would EXCEED the cap).
        let fd2 = try socketPair("capover") { server in
            try? UnixSocket.writeAll(server, Data(repeating: 0x41, count: 65))
            try? UnixSocket.writeAll(server, Data("\n".utf8))
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd2) }
        XCTAssertThrowsError(try UnixSocket.readLine(fd2, maxBytes: 64))
    }

    func testReadLineTimeout() throws {
        let fd = try socketPair("timeout") { server in
            // Hold the connection open without writing past the timeout.
            Thread.sleep(forTimeInterval: 2)
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        XCTAssertThrowsError(try UnixSocket.readLine(fd, timeout: 0.2)) { error in
            guard case SocketError.timeout = error else {
                return XCTFail("expected SocketError.timeout, got \(error)")
            }
        }
    }

    func testReadLineBytesRoundTrip() throws {
        let fd = try socketPair("bytes") { server in
            try? UnixSocket.writeAll(server, Data("{\"ok\":true}\n".utf8))
            UnixSocket.closeFD(server)
        }
        defer { UnixSocket.closeFD(fd) }
        let data = try UnixSocket.readLineBytes(fd)
        XCTAssertEqual(data.map { String(decoding: $0, as: UTF8.self) }, "{\"ok\":true}")
    }

    // MARK: - Kitty graphics chunking

    func testKittySequenceMatchesReference() {
        // Old format: whole-image base64 as a single ≤4096-char chunk.
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG magic
        let expected = "\u{1B}_Ga=T,f=100,m=0;\(png.base64EncodedString())\u{1B}\\"
        XCTAssertEqual(KittyGraphics.sequence(png: png), expected)
    }

    func testKittySequenceWithColsRows() {
        let png = Data([0x01, 0x02, 0x03])
        let expected = "\u{1B}_Ga=T,f=100,c=60,r=20,m=0;\(png.base64EncodedString())\u{1B}\\"
        XCTAssertEqual(KittyGraphics.sequence(png: png, cols: 60, rows: 20), expected)
    }

    func testKittySequenceEmpty() {
        XCTAssertEqual(KittyGraphics.sequence(png: Data()), "")
    }

    func testKittySequenceChunksLargeInput() throws {
        let png = Data((0..<10_000).map { UInt8($0 & 0xFF) })
        let seq = KittyGraphics.sequence(png: png)
        // Split into chunks: each is `ESC _ G <control> ; <payload> ESC \`.
        let pieces = seq.components(separatedBy: "\u{1B}\\").dropLast()
        // 10_000 raw bytes at 3072 bytes/chunk → 4 chunks.
        XCTAssertEqual(pieces.count, 4)
        var joined = ""
        for (i, piece) in pieces.enumerated() {
            XCTAssertTrue(piece.hasPrefix("\u{1B}_G"))
            let parts = piece.dropFirst(3).split(separator: ";", maxSplits: 1)
            XCTAssertEqual(parts.count, 2)
            let control = String(parts[0])
            let payload = String(parts[1])
            XCTAssertLessThanOrEqual(payload.count, 4096)
            if i == 0 {
                XCTAssertTrue(control.contains("a=T"))
                XCTAssertTrue(control.contains("f=100"))
            } else {
                XCTAssertFalse(control.contains("a=T"))
            }
            XCTAssertTrue(control.contains(i == pieces.count - 1 ? "m=0" : "m=1"))
            joined += payload
        }
        // Chunk boundaries land on 3-byte groups, so the concatenated payloads
        // equal the whole-image base64 (the old format's content).
        XCTAssertEqual(joined, png.base64EncodedString())
    }

    func testInlineGraphicsFileTooLargeThrows() throws {
        let path = NSTemporaryDirectory() + "idealize-big-\(UUID().uuidString).png"
        _ = FileManager.default.createFile(atPath: path, contents: nil)
        defer { try? FileManager.default.removeItem(atPath: path) }
        let fh = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        fh.truncateFile(atOffset: UInt64(InlineGraphics.maxFileBytes + 1)) // sparse
        try fh.close()
        XCTAssertThrowsError(try InlineGraphics.sequence(forFileAt: path)) { error in
            guard case InlineGraphics.GraphicsError.fileTooLarge = error else {
                return XCTFail("expected fileTooLarge, got \(error)")
            }
        }
    }

    func testInlineGraphicsFileSequenceSmall() throws {
        let path = NSTemporaryDirectory() + "idealize-small-\(UUID().uuidString).png"
        try Data([0x89, 0x50, 0x4E, 0x47]).write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        let seq = try InlineGraphics.sequence(forFileAt: path)
        XCTAssertNotNil(seq)
        XCTAssertTrue(seq?.hasPrefix("\u{1B}]1337;File=") ?? false)
        XCTAssertTrue(seq?.contains("size=4") ?? false)
    }

    func testSocketRoundTrip() throws {
        let path = NSTemporaryDirectory() + "idealize-test-\(getpid()).sock"
        let listenFD = try UnixSocket.listen(at: path)
        defer { UnixSocket.closeFD(listenFD); unlink(path) }

        let serverExpectation = expectation(description: "server handled")
        let queue = DispatchQueue(label: "test.server")
        queue.async {
            let client = UnixSocket.accept(listenFD)
            if client >= 0 {
                if let line = try? UnixSocket.readLine(client) {
                    try? UnixSocket.writeLine(client, "echo:" + line)
                }
                UnixSocket.closeFD(client)
            }
            serverExpectation.fulfill()
        }

        let fd = try UnixSocket.connect(to: path)
        try UnixSocket.writeLine(fd, "ping")
        let reply = try UnixSocket.readLine(fd)
        UnixSocket.closeFD(fd)
        XCTAssertEqual(reply, "echo:ping")
        wait(for: [serverExpectation], timeout: 5)
    }
}
