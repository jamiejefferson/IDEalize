import XCTest
@testable import IDEalizeApp

/// The agent-agnostic archive/restore lifecycle: snapshots persist which agent
/// a chat ran (with legacy wasClaude migration), and adapters supply the
/// launch/resume commands and transcript-derived session ids.
final class AgentLifecycleTests: XCTestCase {

    // MARK: - Legacy snapshot migration

    func testLegacyPersistedChatDecodesAsClaude() throws {
        let legacy = #"{"wasClaude":true}"#.data(using: .utf8)!
        let chat = try JSONDecoder().decode(PersistedChat.self, from: legacy)
        XCTAssertEqual(chat.effectiveAgentBinary, "claude")
    }

    func testLegacyPersistedShellChatDecodesAsShell() throws {
        let legacy = #"{"wasClaude":false}"#.data(using: .utf8)!
        let chat = try JSONDecoder().decode(PersistedChat.self, from: legacy)
        XCTAssertNil(chat.effectiveAgentBinary)
    }

    func testAgentBinaryWinsOverLegacyFlag() throws {
        let mixed = #"{"wasClaude":false,"agentBinary":"kimi"}"#.data(using: .utf8)!
        let chat = try JSONDecoder().decode(PersistedChat.self, from: mixed)
        XCTAssertEqual(chat.effectiveAgentBinary, "kimi")
    }

    func testLegacyPersistedChatWithoutVerifyCommandDecodes() throws {
        let legacy = #"{"wasClaude":true}"#.data(using: .utf8)!
        let chat = try JSONDecoder().decode(PersistedChat.self, from: legacy)
        XCTAssertNil(chat.verifyCommand)
    }

    func testPersistedChatVerifyCommandRoundTrips() throws {
        let original = PersistedChat(customName: "Footer", wasClaude: true,
                                     agentBinary: "claude", verifyCommand: "npm test")
        let data = try JSONEncoder().encode(original)
        let chat = try JSONDecoder().decode(PersistedChat.self, from: data)
        XCTAssertEqual(chat.verifyCommand, "npm test")
    }

    func testLegacyArchivedChatDecodesAndMigrates() throws {
        let legacy = """
        {"id":"6F1E9C9E-2C1B-4A5B-9AAA-000000000001","projectPath":"/tmp/p",
         "name":"Chat 1","wasClaude":true,"sessionId":"abc-123",
         "archivedAt":700000000}
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let chat = try decoder.decode(ArchivedChat.self, from: legacy)
        XCTAssertEqual(chat.effectiveAgentBinary, "claude")
        XCTAssertEqual(chat.sessionId, "abc-123")
    }

    // MARK: - Adapter launch / resume commands

    func testClaudeResumeCommand() {
        let claude = ClaudeAgentAdapter()
        XCTAssertEqual(claude.resumeCommand(sessionId: "abc-123"),
                       "claude --dangerously-skip-permissions --resume abc-123")
        XCTAssertNotNil(claude.launchCommand)
    }

    func testKimiResumeCommand() {
        let kimi = KimiAgentAdapter()
        XCTAssertEqual(kimi.resumeCommand(sessionId: "session_2a46df3c-e605-4f64-a8fc-1b671372718f"),
                       "kimi -S session_2a46df3c-e605-4f64-a8fc-1b671372718f")
        XCTAssertEqual(kimi.launchCommand, "kimi")
    }

    func testRegistryLooksUpAdapterByBinary() {
        XCTAssertEqual(AgentRegistry.adapter(forBinary: "kimi")?.name, "Kimi")
        XCTAssertEqual(AgentRegistry.adapter(forBinary: "claude")?.name, "Claude")
        XCTAssertNil(AgentRegistry.adapter(forBinary: nil))
        XCTAssertNil(AgentRegistry.adapter(forBinary: ""))   // GenericAgentAdapter must not match
    }

    // MARK: - Session ids from transcript locations

    func testClaudeSessionIdFromTranscriptURL() {
        let url = URL(fileURLWithPath:
            "/Users/x/.claude/projects/-Users-x-proj/9a1b2c3d-1111-2222-3333-444455556666.jsonl")
        XCTAssertEqual(ClaudeAgentAdapter().sessionId(fromTranscriptURL: url),
                       "9a1b2c3d-1111-2222-3333-444455556666")
    }

    func testKimiSessionIdFromWireURL() {
        let url = URL(fileURLWithPath:
            "/Users/x/.kimi-code/sessions/wd_p_123/session_2a46df3c-e605-4f64-a8fc-1b671372718f/agents/main/wire.jsonl")
        XCTAssertEqual(KimiAgentAdapter().sessionId(fromTranscriptURL: url),
                       "session_2a46df3c-e605-4f64-a8fc-1b671372718f")
    }

    func testKimiSessionIdRejectsForeignURL() {
        let url = URL(fileURLWithPath: "/tmp/whatever/wire.jsonl")
        XCTAssertNil(KimiAgentAdapter().sessionId(fromTranscriptURL: url))
    }

    // MARK: - On-screen session binding

    func testKimiDetectsSessionIdFromWelcomeBox() {
        let lines = [
            "  Welcome to Kimi Code!",
            "  Directory:  /Users/x/proj",
            "  Session:    session_2a46df3c-e605-4f64-a8fc-1b671372718f",
            "  Model:      K3",
        ]
        XCTAssertEqual(KimiAgentAdapter().detectSessionId(lines: lines),
                       "session_2a46df3c-e605-4f64-a8fc-1b671372718f")
        XCTAssertNil(KimiAgentAdapter().detectSessionId(lines: ["no banner here"]))
    }

    // MARK: - Injected harness events stay out of the chat

    func testKimiWireFiltersInjectedNotifications() throws {
        let wire = """
        {"type":"turn.prompt","input":[{"type":"text","text":"real question"}]}
        {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"real answer"}}}
        {"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"<notification id=\\"task:x\\">Background process completed</notification>"}]}}
        """
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("wire.jsonl")
        try wire.write(to: url, atomically: true, encoding: .utf8)

        let exchanges = KimiTranscript.allExchanges(in: url)
        XCTAssertEqual(exchanges.count, 1)
        XCTAssertEqual(exchanges.last?.question, "real question")
    }
}
