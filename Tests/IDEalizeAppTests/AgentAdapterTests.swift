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
}
