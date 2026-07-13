import XCTest
@testable import IDEalizeApp

final class IPCInputPolicyTests: XCTestCase {
    func testDisabledPolicyDeniesEvenALiveSource() {
        XCTAssertEqual(
            IPCInputPolicy.evaluate(
                isEnabled: false,
                sourceSessionID: "live",
                liveSessionIDs: ["live"],
                body: "echo blocked"),
            .denied(.disabled))
    }

    func testEnabledPolicyDeniesMissingSource() {
        XCTAssertEqual(
            IPCInputPolicy.evaluate(
                isEnabled: true,
                sourceSessionID: nil,
                liveSessionIDs: ["live"],
                body: "echo blocked"),
            .denied(.missingSource))
    }

    func testEnabledPolicyDeniesStaleSource() {
        XCTAssertEqual(
            IPCInputPolicy.evaluate(
                isEnabled: true,
                sourceSessionID: "stale",
                liveSessionIDs: ["live"],
                body: "echo blocked"),
            .denied(.staleSource))
    }

    func testEnabledPolicyDeniesMissingBody() {
        XCTAssertEqual(
            IPCInputPolicy.evaluate(
                isEnabled: true,
                sourceSessionID: "live",
                liveSessionIDs: ["live"],
                body: nil),
            .denied(.missingBody))
    }

    func testEnabledPolicyAllowsBodyForCurrentlyPresentedSourceID() {
        XCTAssertEqual(
            IPCInputPolicy.evaluate(
                isEnabled: true,
                sourceSessionID: "live",
                liveSessionIDs: ["live"],
                body: "echo allowed"),
            .allowed(body: "echo allowed"))
    }
}
