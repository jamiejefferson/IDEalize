import Foundation
import XCTest
@testable import IDEalizeApp

final class AppSettingsPersistenceTests: XCTestCase {
    func testCrossSessionControlDefaultsToFalseWhenKeyIsAbsent() throws {
        let (defaults, suiteName) = try isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertFalse(AppSettings.loadAllowCrossSessionControl(from: defaults))
    }

    func testCrossSessionControlLoadsPersistedTrueAndFalse() throws {
        let (defaults, suiteName) = try isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set(true, forKey: AppSettings.allowCrossSessionControlKey)
        XCTAssertTrue(AppSettings.loadAllowCrossSessionControl(from: defaults))

        defaults.set(false, forKey: AppSettings.allowCrossSessionControlKey)
        XCTAssertFalse(AppSettings.loadAllowCrossSessionControl(from: defaults))
    }

    private func isolatedDefaults() throws -> (UserDefaults, String) {
        let suiteName = "IDEalizeAppTests.AppSettings.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        return (defaults, suiteName)
    }
}
