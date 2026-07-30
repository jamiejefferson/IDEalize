import Foundation

/// Pre-seeds Claude Code's one-time "Bypass Permissions mode" acceptance so a fresh
/// machine can launch Claude without stalling.
///
/// IDEalize launches Claude with `--dangerously-skip-permissions` (permission mode
/// `.yolo`) by default. The first time Claude Code sees that flag on a machine it shows
/// a *blocking* dialog — "WARNING: Claude Code running in Bypass Permissions mode …
/// 1. No, exit  2. Yes, I accept" — until acceptance is recorded. Because we start a
/// login shell and *type* the `claude …` line into it (then only watch the terminal),
/// nothing ever answers that dialog, so on a never-accepted machine the session hangs
/// forever and no chat can start.
///
/// Claude Code records acceptance as the top-level `bypassPermissionsModeAccepted`
/// flag in `~/.claude.json` (verified against the shipped CLI binary; distinct from the
/// per-project `hasTrustDialogAccepted`, which bypass mode already skips). Setting it up
/// front — the same intent the user already expressed by using the app's default bypass
/// command — lets Claude boot straight to its prompt.
///
/// Mirrors `FlowSkillInstaller`: app machinery pushed into the user's `~/.claude` on
/// startup, idempotently. The merge is deliberately conservative — it only ever *adds*
/// the one key and never rewrites a config it can't parse, so Claude Code's own state
/// (which it writes to the same file continuously) is never clobbered.
enum ClaudeConfigBootstrap {
    private static let acceptanceKey = "bypassPermissionsModeAccepted"

    private static var configURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude.json")
    }

    /// Ensure `~/.claude.json` records that bypass-permissions mode is accepted.
    /// Safe to call on every launch: it's idempotent and a no-op once the flag is set.
    static func ensureBypassPermissionsAccepted() {
        let url = configURL

        // No config yet → write a minimal one. Claude Code fills in the rest on first run.
        guard let data = try? Data(contentsOf: url) else {
            writeMinimalConfig(to: url)
            return
        }

        // Config exists → only touch it if we can parse it as a JSON object. If it's
        // corrupt or an unexpected shape, leave it alone rather than risk clobbering the
        // user's real Claude config.
        guard var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return
        }

        // Already accepted → don't rewrite (avoids needlessly racing Claude's own writer).
        if obj[acceptanceKey] as? Bool == true { return }

        obj[acceptanceKey] = true
        guard let merged = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else {
            return
        }
        try? merged.write(to: url, options: .atomic)
    }

    private static func writeMinimalConfig(to url: URL) {
        guard let data = try? JSONSerialization.data(
            withJSONObject: [acceptanceKey: true], options: [.sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
