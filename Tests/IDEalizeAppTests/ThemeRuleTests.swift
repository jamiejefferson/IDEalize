import AppKit
import XCTest
@testable import IDEalizeApp

/// An agent's prompt-box rules should read at the same weight whichever terminal
/// theme is on — which means matching contrast, not a blend fraction. Linen's
/// rule is placed by hand and the rest solve for it.
final class ThemeRuleTests: XCTestCase {
    /// Linen's `#E2E2E0` on its paper, the weight everything else aims at.
    private let target: CGFloat = 1.19

    func testEveryTerminalThemeRulesAtTheSameWeight() {
        for theme in Theme.terminalThemes {
            let contrast = Theme.contrast(theme.ruleColor, theme.background)
            XCTAssertEqual(contrast, target, accuracy: 0.02,
                           "\(theme.name) rules at \(contrast), off Linen's \(target)")
        }
    }

    func testLinenKeepsItsHandPlacedRule() {
        let rule = Theme.linen.ruleColor.usingColorSpace(.sRGB)!
        XCTAssertEqual(Int(round(rule.redComponent * 255)), 0xE2)
        XCTAssertEqual(Int(round(rule.greenComponent * 255)), 0xE2)
        XCTAssertEqual(Int(round(rule.blueComponent * 255)), 0xE0)
    }

    func testRulesAreLighterThanTheFaintestTextOnLightGrounds() {
        // A rule is solid ink for its whole length, so it must sit below the
        // secondary text it frames or it reads as the heavier element.
        for theme in Theme.terminalThemes where !theme.isDark {
            XCTAssertLessThan(Theme.contrast(theme.ruleColor, theme.background),
                              Theme.contrast(theme.secondaryForeground, theme.background),
                              "\(theme.name) rules heavier than its own secondary text")
        }
    }
}
