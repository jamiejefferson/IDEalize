import XCTest
@testable import IDEalizeApp

final class AgentAdapterTests: XCTestCase {

    // MARK: - Kimi wire parsing

    private func writeTempWire(_ contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("wire.jsonl")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func testKimiWireParsesTurnPromptAndAssistantText() throws {
        let wire = """
        {"type":"turn.prompt","input":[{"type":"text","text":"hello"}],"origin":{"kind":"user"},"time":1}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"Hi there!"}},"time":2}
        {"type":"turn.prompt","input":[{"type":"text","text":"how are you?"}],"origin":{"kind":"user"},"time":3}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"I'm doing well."}},"time":4}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"Thanks for asking."}},"time":5}
        """
        let url = try writeTempWire(wire)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let exchanges = KimiTranscript.allExchanges(in: url)
        XCTAssertEqual(exchanges.count, 2)
        XCTAssertEqual(exchanges[0].question, "hello")
        XCTAssertEqual(exchanges[0].answer, "Hi there!")
        XCTAssertEqual(exchanges[1].question, "how are you?")
        XCTAssertEqual(exchanges[1].answer, "I'm doing well.\nThanks for asking.")
    }

    func testKimiWireLastExchangeHasNoAnswerWhileWorking() throws {
        let wire = """
        {"type":"turn.prompt","input":[{"type":"text","text":"hello"}],"origin":{"kind":"user"},"time":1}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"Hi there!"}},"time":2}
        {"type":"turn.prompt","input":[{"type":"text","text":"still thinking?"}],"origin":{"kind":"user"},"time":3}
        """
        let url = try writeTempWire(wire)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let last = KimiTranscript.lastExchange(in: url)
        XCTAssertEqual(last?.question, "still thinking?")
        XCTAssertNil(last?.answer)
    }

    func testKimiWireIgnoresNonTextParts() throws {
        let wire = """
        {"type":"turn.prompt","input":[{"type":"text","text":"run this"}],"origin":{"kind":"user"},"time":1}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"think","think":"thinking…"}},"time":2}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"Done."}},"time":3}
        """
        let url = try writeTempWire(wire)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let exchanges = KimiTranscript.allExchanges(in: url)
        XCTAssertEqual(exchanges.count, 1)
        XCTAssertEqual(exchanges[0].answer, "Done.")
    }

    // MARK: - Claude transcript incremental follow

    private func writeTempTranscript(_ contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("session.jsonl")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    private func append(to url: URL, _ text: String) throws {
        let fh = try FileHandle(forWritingTo: url)
        _ = fh.seekToEndOfFile()
        fh.write(Data(text.utf8))
        try fh.close()
    }

    func testClaudeFollowerParsesIncrementally() throws {
        let url = try writeTempTranscript("")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let follower = ClaudeTranscript.Follower(url: url)

        // Empty file: nothing to parse.
        XCTAssertFalse(follower.poll())
        XCTAssertEqual(follower.exchanges.count, 0)

        try append(to: url, #"{"type":"user","message":{"content":"first question"}}"# + "\n")
        XCTAssertTrue(follower.poll())
        XCTAssertEqual(follower.exchanges.map(\.question), ["first question"])
        XCTAssertNil(follower.exchanges.last?.answer)

        // No new bytes → no change.
        XCTAssertFalse(follower.poll())

        // Append the answer plus a new question; only the tail is parsed.
        try append(to: url, """
        {"type":"assistant","message":{"content":[{"type":"text","text":"first answer"}]}}
        {"type":"user","message":{"content":"second question"}}

        """)
        XCTAssertTrue(follower.poll())
        XCTAssertEqual(follower.exchanges.count, 2)
        XCTAssertEqual(follower.exchanges[0].question, "first question")
        XCTAssertEqual(follower.exchanges[0].answer, "first answer")
        XCTAssertEqual(follower.exchanges[1].question, "second question")
        XCTAssertNil(follower.exchanges[1].answer)
    }

    func testClaudeFollowerWaitsForCompleteLine() throws {
        // A line split mid-write is held back until its newline arrives.
        let url = try writeTempTranscript("")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let full = #"{"type":"user","message":{"content":"split question"}}"#
        let cut = full.index(full.startIndex, offsetBy: 20)
        try String(full[..<cut]).write(to: url, atomically: true, encoding: .utf8)
        let follower = ClaudeTranscript.Follower(url: url)
        XCTAssertFalse(follower.poll())
        XCTAssertEqual(follower.exchanges.count, 0)

        try append(to: url, String(full[cut...]) + "\n")
        XCTAssertTrue(follower.poll())
        XCTAssertEqual(follower.exchanges.map(\.question), ["split question"])
    }

    func testClaudeFollowerHandlesTruncation() throws {
        let initial = """
        {"type":"user","message":{"content":"old question"}}
        {"type":"assistant","message":{"content":[{"type":"text","text":"old answer"}]}}

        """
        let url = try writeTempTranscript(initial)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let follower = ClaudeTranscript.Follower(url: url)
        XCTAssertTrue(follower.poll())
        XCTAssertEqual(follower.exchanges.count, 1)

        // File replaced by a shorter one (rotation/truncation) → re-parse.
        try """
        {"type":"user","message":{"content":"new question"}}

        """.write(to: url, atomically: true, encoding: .utf8)
        XCTAssertTrue(follower.poll())
        XCTAssertEqual(follower.exchanges.map(\.question), ["new question"])
        XCTAssertNil(follower.exchanges.last?.answer)
    }

    func testClaudeAllExchangesFiltersAndJoins() throws {
        let transcript = """
        {"type":"user","message":{"content":"<system-reminder>ignore me</system-reminder>"}}
        {"type":"user","message":{"content":"real question"}}
        {"type":"assistant","message":{"content":[{"type":"text","text":"answer one"},{"type":"text","text":"answer two"}]}}

        """
        let url = try writeTempTranscript(transcript)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let all = ClaudeTranscript.allExchanges(in: url)
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all[0].question, "real question")
        XCTAssertEqual(all[0].answer, "answer one\n\nanswer two")
    }

    // MARK: - Agent detection

    func testClaudeAdapterMatchesClaudeCommand() {
        let adapter = ClaudeAgentAdapter()
        XCTAssertTrue(adapter.matches(command: "claude"))
        XCTAssertTrue(adapter.matches(command: "claude --dangerously-skip-permissions"))
        XCTAssertTrue(adapter.matches(command: "claude && ls"))
        XCTAssertTrue(adapter.matches(command: "ls && claude"))
        XCTAssertFalse(adapter.matches(command: "kimi"))
        XCTAssertFalse(adapter.matches(command: "vim"))
    }

    func testKimiAdapterMatchesKimiCommand() {
        let adapter = KimiAgentAdapter()
        XCTAssertTrue(adapter.matches(command: "kimi"))
        XCTAssertTrue(adapter.matches(command: "kimi --yolo"))
        XCTAssertTrue(adapter.matches(command: "ls && kimi"))
        XCTAssertFalse(adapter.matches(command: "claude"))
    }

    // MARK: - Pi adapter

    func testPiAdapterMatchesPiCommand() {
        let adapter = PiAgentAdapter()
        XCTAssertTrue(adapter.matches(command: "pi"))
        XCTAssertTrue(adapter.matches(command: "pi 'do the thing'"))
        XCTAssertTrue(adapter.matches(command: "/usr/local/bin/pi --continue"))
        XCTAssertTrue(adapter.matches(command: "ls && pi"))
        XCTAssertFalse(adapter.matches(command: "pip install requests"))
        XCTAssertFalse(adapter.matches(command: "spin"))
        XCTAssertFalse(adapter.matches(command: "claude"))
    }

    func testPiRegistryResolvesPiBeforeGenericFallback() {
        XCTAssertEqual(AgentRegistry.adapter(forCommand: "pi")?.binaryName, "pi")
        XCTAssertEqual(AgentRegistry.adapter(forBinary: "pi")?.name, "Pi")
    }

    func testPiEncodedDirMatchesPiScheme() {
        // Pi drops the leading slash, replaces / \ : with '-', keeps everything
        // else (including spaces), and wraps in double dashes.
        XCTAssertEqual(PiTranscript.encodedDir(for: "/Users/jj"), "--Users-jj--")
        XCTAssertEqual(PiTranscript.encodedDir(for: "/Users/jj/My Dir/_App"),
                       "--Users-jj-My Dir-_App--")
    }

    func testPiSessionIdReadFromTranscriptURL() {
        let adapter = PiAgentAdapter()
        let url = URL(fileURLWithPath:
            "/Users/jj/.pi/agent/sessions/--Users-jj--/2026-07-31T09-37-53-984Z_019fb789-9140-74ed-a2f2-9c81ff5a7755.jsonl")
        XCTAssertEqual(adapter.sessionId(fromTranscriptURL: url),
                       "019fb789-9140-74ed-a2f2-9c81ff5a7755")
        XCTAssertEqual(adapter.resumeCommand(sessionId: "abc-123"), "pi --session abc-123")
    }

    private func writeTempPiSession(_ contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("2026-01-01T00-00-00-000Z_test-session.jsonl")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func testPiTranscriptParsesUserAndAssistantTurns() throws {
        let session = """
        {"type":"session","version":3,"id":"x","timestamp":"t","cwd":"/Users/jj"}
        {"type":"model_change","id":"a","parentId":null,"timestamp":"t","provider":"p","modelId":"m"}
        {"type":"message","id":"b","parentId":"a","timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
        {"type":"message","id":"c","parentId":"b","timestamp":"t","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"Hi there!"}]}}
        {"type":"message","id":"d","parentId":"c","timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"and now?"}]}}
        {"type":"message","id":"e","parentId":"d","timestamp":"t","message":{"role":"toolResult","content":[{"type":"text","text":"raw tool output"}]}}
        {"type":"message","id":"f","parentId":"e","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"Part one."},{"type":"text","text":"Part two."}]}}
        """
        let url = try writeTempPiSession(session)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let exchanges = PiTranscript.allExchanges(in: url)
        XCTAssertEqual(exchanges.count, 2)
        XCTAssertEqual(exchanges[0].question, "hello")
        XCTAssertEqual(exchanges[0].answer, "Hi there!")
        XCTAssertEqual(exchanges[1].question, "and now?")
        XCTAssertEqual(exchanges[1].answer, "Part one.\nPart two.")
    }

    func testPiTranscriptLastExchangeHasNoAnswerWhileWorking() throws {
        let session = """
        {"type":"message","id":"b","parentId":null,"timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"still thinking?"}]}}
        """
        let url = try writeTempPiSession(session)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        let last = PiTranscript.lastExchange(in: url)
        XCTAssertEqual(last?.question, "still thinking?")
        XCTAssertNil(last?.answer)
    }

    func testPiWorkingStateDetection() {
        let adapter = PiAgentAdapter()
        XCTAssertTrue(adapter.detectWorkingState(lines: ["⠋ Working... (esc to interrupt)"]).isWorking)
        XCTAssertTrue(adapter.detectWorkingState(lines: ["Working..."]).isWorking)
        // The idle welcome's key hints ("escape interrupt") must not read as busy.
        XCTAssertFalse(adapter.detectWorkingState(
            lines: ["escape interrupt · ctrl+c/ctrl+d clear/exit · / commands"]).isWorking)
        XCTAssertFalse(adapter.detectWorkingState(lines: ["$0.000 (sub) 0.0%/262k (auto)"]).isWorking)
    }
}
