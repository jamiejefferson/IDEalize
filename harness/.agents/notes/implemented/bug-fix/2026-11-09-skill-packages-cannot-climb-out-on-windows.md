# Agent Note: skill packages cannot climb out of their folder on Windows

Status: implemented

## Problem

`packageFiles` in `packages/idealize/skills` drops any zip entry with a `..`, `.` or empty segment between `/` separators, then joins the rest with the platform separator. Zip names use `/` only, but Windows also reads `\` as a separator. A name such as `ok/..\..\..\planted.md` therefore holds one `/` segment that passes the check. On Windows, `join` resolves it above the package's unpack folder, and `syncPackages` writes the file there.

The skills folder is the person's own folder of `.skill` packages, so a package downloaded from anywhere and dropped in could write any file the user can write. That includes the Startup folder, which runs at the next sign-in. On 9 Nov 2026 a test on Windows 11 wrote such an entry into `%TEMP%`.

## Decision

`packageFiles` drops every entry whose name contains `\`, before it splits on `/`. No legitimate entry is lost: the zip format separates with `/` only, and a `\` inside a single file or folder name is not portable to Windows anyway.

The parser is the only check. `syncPackages` writes exactly the map `packageFiles` returns, so the write loop does not re-validate the joined paths.

## Alternatives considered

**Split on both `/` and `\`, then keep the existing segment check.** That would also stop the climb. But it would accept `\` as a separator in names the format never defines it for, and on macOS and Linux it would turn a file legitimately named `a\b` into two folders.

**Also check each joined path against the package folder at write time.** This guards against the same input twice in one process. The repository's rules put validation at the parse boundary and keep it out of typed same-process calls, and the extra branch has no reachable failure for the coverage gate to exercise.

## Consequences

A package with `\` in any entry name unpacks without those entries, on every platform. Nothing else changes for packages built by ordinary zip tools.

## Testing

`tests/skills.spec.ts`:
- The `packageFiles` case drops `..\`, `ok/..\..\`, `ok\..\..\`, `C:\` and `\\server\share\` names.
- A `syncPackages` case unpacks a package with a backslash climb, and checks that nothing lands in the test root or the unpack folder, while the legitimate `references/fine.md` still unpacks.
