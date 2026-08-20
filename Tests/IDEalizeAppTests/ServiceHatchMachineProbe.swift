import XCTest
@testable import IDEalizeApp

/// Not an assertion about this machine — a probe that prints what discovery resolves
/// to here, so the auto-setup can be checked against a real disk rather than only
/// against synthetic trees. Kept skipped unless explicitly asked for.
final class ServiceHatchMachineProbe: XCTestCase {
    func testPrintWhatThisMachineResolvesTo() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["HATCH_PROBE"] == "1",
                          "set HATCH_PROBE=1 to run")
        let all = ServiceHatch.discover()
        print("discover() → \(all.count) candidate(s):")
        for p in all {
            print("  \(ServiceHatch.hasIDEalizeOrigin(p) ? "origin✓" : "origin✗")  \(p)")
        }
        let confident = all.filter(ServiceHatch.hasIDEalizeOrigin)
        print("confident: \(confident.count) → \(confident.count == 1 ? "adopts \(confident[0])" : "asks the user")")
    }
}
