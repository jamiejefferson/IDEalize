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

    func testResponseRoundTrip() throws {
        let info = IPCSessionInfo(id: "1", title: "t", projectPath: "/p", processName: "zsh", status: "idle", unread: 2)
        let resp = IPCResponse(ok: true, sessions: [info])
        let data = try IPC.makeEncoder().encode(resp)
        let decoded = try IPC.makeDecoder().decode(IPCResponse.self, from: data)
        XCTAssertTrue(decoded.ok)
        XCTAssertEqual(decoded.sessions?.first?.processName, "zsh")
        XCTAssertEqual(decoded.sessions?.first?.unread, 2)
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
