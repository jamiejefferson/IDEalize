import XCTest
@testable import IDEalizeApp

final class FlowModelTests: XCTestCase {

    // MARK: - Metadata + stage serialization

    func testFlowWithMetadataRoundTrips() throws {
        let metadata = FlowMetadata(description: "Test flow", createdBy: "JJ", lastEdited: "2026-07-17T00:00:00Z", tags: ["test", "demo"], version: 3)
        let stage = FlowStage(id: "s1", title: "Research", text: "Find out the facts", definitionOfDone: "Facts are listed", children: nil)
        let graph = Flow.Graph(blocks: [], connections: [], stages: [stage])
        let flow = Flow(title: "Demo", flow: graph, review: nil, run: nil, metadata: metadata)

        let data = try JSONEncoder().encode(flow)
        let decoded = try JSONDecoder().decode(Flow.self, from: data)

        XCTAssertEqual(decoded.title, flow.title)
        XCTAssertEqual(decoded.metadata, flow.metadata)
        XCTAssertEqual(decoded.flow.stages, flow.flow.stages)
    }

    func testOldFlowWithoutMetadataDecodesWithDefaults() throws {
        // Simulate a legacy flow.json that has no metadata or stages.
        let json = """
        {
          "title": "Legacy",
          "flow": { "blocks": [], "connections": [] }
        }
        """.data(using: .utf8)!
        let flow = try JSONDecoder().decode(Flow.self, from: json)
        XCTAssertNil(flow.metadata)
        XCTAssertNil(flow.flow.stages)
        XCTAssertEqual(flow.resolvedMetadata.version, 1)
        XCTAssertEqual(flow.resolvedMetadata.tags, [])
    }

    func testStageToBlockConversionProducesRunnableGraph() {
        let stages = [
            FlowStage(id: "s1", title: "Planning", text: "Plan the work", definitionOfDone: "Plan is written"),
            FlowStage(id: "s2", title: "Execution", text: "Do the work", definitionOfDone: "Work is complete"),
        ]
        let (blocks, connections) = Flow.Graph.blocksFromStages(stages, title: "Test")

        XCTAssertEqual(blocks.count, 4) // start + 2 stages + end
        XCTAssertEqual(blocks.first?.type, .start)
        XCTAssertEqual(blocks.last?.type, .end)
        XCTAssertEqual(connections.count, 3)
        XCTAssertEqual(connections[0].from, "b1")
        XCTAssertEqual(connections[0].to, "b2")
    }

    func testStagesFromBlocksDerivesDisplayStages() {
        let blocks = [
            FlowBlock(id: "b1", type: .start, text: "Begin", hint: nil),
            FlowBlock(id: "b2", type: .tool, text: "Do something", hint: nil),
            FlowBlock(id: "b3", type: .end, text: "Done", hint: nil),
        ]
        let graph = Flow.Graph(blocks: blocks, connections: [])
        let stages = graph.stagesFromBlocks()
        XCTAssertEqual(stages.count, 3)
        XCTAssertEqual(stages[1].title, "Action")
        XCTAssertEqual(stages[1].text, "Do something")
    }

    // MARK: - Interview engine

    @MainActor
    func testInterviewBuildsStagesFromAnswers() {
        let interview = FlowsInterview()
        interview.submit("Design a new logo")
        interview.submit("I have three concepts to choose from")
        interview.submit("My manager")
        interview.choose("Yes")
        interview.submit("We try again")
        interview.submit("No")

        XCTAssertFalse(interview.stages.isEmpty)
        XCTAssertEqual(interview.outcome, "Design a new logo")
        XCTAssertEqual(interview.successCriteria, "I have three concepts to choose from")
    }

    @MainActor
    func testInterviewSynthesizesRunnableFlow() {
        let interview = FlowsInterview()
        interview.submit("Launch a website")
        interview.submit("The site is live")
        interview.submit("The dev team")
        interview.choose("Yes")
        interview.submit("Escalate to the lead")
        interview.submit("No")

        let flow = interview.flow
        XCTAssertEqual(flow.title, "Launch a website")
        XCTAssertFalse(flow.flow.blocks.isEmpty)
        XCTAssertEqual(flow.flow.blocks.first?.type, .start)
        XCTAssertEqual(flow.flow.blocks.last?.type, .end)
        XCTAssertEqual(flow.flow.stages?.count, interview.stages.count)
    }

    // MARK: - Library actions

    @MainActor
    func testDuplicateSavedCreatesCopy() throws {
        let store = FlowStore()
        store.flow.title = "Original"
        store.flow.flow.blocks = [FlowBlock(id: "b1", type: .start, text: "Begin", hint: nil)]
        guard let saved = store.saveCurrent(named: "Original") else {
            XCTFail("save failed")
            return
        }
        defer { store.deleteSaved(saved) }

        guard let copy = store.duplicateSaved(saved) else {
            XCTFail("duplicate failed")
            return
        }
        defer { store.deleteSaved(copy) }

        XCTAssertEqual(copy.title, "Original copy")
        let data = try Data(contentsOf: copy.url)
        let decoded = try JSONDecoder().decode(Flow.self, from: data)
        XCTAssertEqual(decoded.title, "Original copy")
        XCTAssertEqual(decoded.resolvedMetadata.version, 1)
    }

    @MainActor
    func testArchiveSavedMovesFile() throws {
        let store = FlowStore()
        store.flow.title = "To archive"
        store.flow.flow.blocks = [FlowBlock(id: "b1", type: .start, text: "Begin", hint: nil)]
        guard let saved = store.saveCurrent(named: "To archive") else {
            XCTFail("save failed")
            return
        }
        store.archiveSaved(saved)
        XCTAssertFalse(FileManager.default.fileExists(atPath: saved.url.path))
        let archiveDir = FlowStore.flowsDir(create: false)
            .deletingLastPathComponent()
            .appendingPathComponent("flows-archive")
        let archived = archiveDir.appendingPathComponent(saved.url.lastPathComponent)
        XCTAssertTrue(FileManager.default.fileExists(atPath: archived.path))
        try? FileManager.default.removeItem(at: archived)
    }

    // MARK: - Version history

    @MainActor
    func testVersionSaveAndRestore() {
        let store = FlowStore()
        store.flow.title = "Versioned"
        let v = store.saveVersion(note: "first")
        XCTAssertEqual(v.note, "first")
        XCTAssertEqual(v.snapshot.title, "Versioned")

        store.flow.title = "Changed"
        store.restore(version: v)
        XCTAssertEqual(store.flow.title, "Versioned")
    }

    @MainActor
    func testVersionListAndDelete() {
        let store = FlowStore()
        store.flow.title = "History"
        let v1 = store.saveVersion(note: "one")
        let v2 = store.saveVersion(note: "two")
        let all = store.versions()
        XCTAssertTrue(all.contains { $0.id == v1.id })
        XCTAssertTrue(all.contains { $0.id == v2.id })

        store.deleteVersion(id: v1.id)
        let remaining = store.versions()
        XCTAssertFalse(remaining.contains { $0.id == v1.id })
        XCTAssertTrue(remaining.contains { $0.id == v2.id })
        store.deleteVersion(id: v2.id)
    }

    // MARK: - Model-agnostic session protocol

    @MainActor
    func testSessionSnapshotRoundTrips() throws {
        let interview = FlowsInterview()
        interview.submit("Design a logo")
        interview.submit("Three concepts ready")
        let session = interview.sessionSnapshot()

        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(FlowsSession.self, from: data)

        XCTAssertEqual(decoded.outcome, session.outcome)
        XCTAssertEqual(decoded.successCriteria, session.successCriteria)
        XCTAssertEqual(decoded.turns.count, session.turns.count)
        XCTAssertEqual(decoded.stages.count, session.stages.count)
    }
}
