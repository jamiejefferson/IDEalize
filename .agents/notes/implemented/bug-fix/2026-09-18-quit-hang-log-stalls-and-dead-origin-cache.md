# Agent Note: a bounded native exit, coalesced log appends, and an HTTP cache cleared at launch

Status: implemented

JJ, 18 Sep 2026: "getting lots of crashes and also very slow restart", where the crashes are beachballs.

## Problem

Three defects were measured on JJ's machine, read-only, against the running 1.0.1 build and its logs.

The quit hangs. macOS wrote `/Library/Logs/DiagnosticReports/IDEalize V1_2026-09-18-084133_GLW-DES-JAMIE.hang`: the main thread sat unresponsive for 79 s in `node::FreeEnvironment` → `Environment::RunCleanup` → `Environment::CleanupHandles` → `uv_run` → `kevent`, using 0.002 s of CPU. Every renderer had already gone, so this is the exit after `app.exit`. Node's cleanup loops until every libuv handle and request has closed and has no deadline; which handle stayed open is not identified by the stackshot (all four libuv workers were idle). While the old process hangs it holds the single-instance lock, so a relaunch hands off to a process that cannot answer: this is the "very slow restart". The run marker in `crash-evidence/active-run.json` is cleared before `app.exit`, so the log records such a quit as clean and gives no count of how often it happens.

The log sink blocks the main thread. `LogFileSink.append` ran `existsSync`, `lstatSync` and `appendFileSync` per line, and a warning goes to two files. Consecutive warning timestamps are a median 8 ms apart (n = 1,485). A 58-60 line skill-catalogue burst held the main thread for 0.8-3.8 s, 13 times on 17 Sep. The machine runs Microsoft Defender, which inspects files on close; its share of the 8 ms was not measured.

The HTTP cache never hits. The Host listens on a new loopback port at each launch (74 launches in eight days), so every cached response belongs to a dead origin. `Cache/Cache_Data` held 10,445 entries and 1.1 GB, including one 1 MB interface bundle per launch.

## Decision

`createDesktopExitCoordinator` arms an exit watchdog immediately before `native.exit`. `armDesktopExitWatchdog` spawns a detached `/bin/sh -c 'sleep 10; kill -9 <pid>'` and unrefs it. It runs outside the process because no JavaScript runs once `FreeEnvironment` starts, so an in-process timer cannot fire. It kills only the application's process id, never the process group, because the helper that performs `app.relaunch()` shares that group. Windows starts no watchdog.

`LogFileSink` takes `coalesceMs` (the app passes 100). `info`, `warn` and `debug` lines queue and land as one append per file; rotation still falls on the line it would with one append per line. An `error` line writes everything waiting and itself synchronously, because it may be the last line before the process dies. `flush()` runs on `close()`, before a header, and in the exit coordinator's `beforeExit`. Without the option the sink appends per line as before.

`clearPreviousLaunchHttpCache` calls `session.defaultSession.clearCache()` once after `app.whenReady()`, detached from the boot sequence; a rejection is logged and startup continues.

## Alternatives considered

**Find and close the open handle.** That is the root fix and is still wanted, but it needs a reproduction under a debugger and the stackshot does not name the handle. The watchdog bounds every present and future cause at 10 s.

**`process.kill(process.pid, 'SIGKILL')` in place of `app.exit`.** It never hangs, and it skips Chromium's teardown, which flushes Local Storage, cookies and preferences.

**An in-process timer around `app.exit`.** Node stops running JavaScript during environment cleanup, so the timer never fires.

**Killing the process group.** It would also reap an orphaned free-tokens sidecar, and it would kill Electron's relaunch helper, so a settings-driven restart would not come back.

**Asynchronous log appends (`fs.promises` or a write stream).** Lines still in flight are lost on a crash, and ordering across the two files and rotation needs a queue anyway. Coalescing keeps synchronous durability at a 100 ms horizon and writes errors at once.

**A fixed Host port so the cache hits.** It would make the cache useful and keep Local Storage under one origin. The port belongs to the harness web server, a second instance or a stale process would collide, and a cache hit saves little against a loopback server. Clearing is the smaller change.

## Consequences

A hung exit now ends within 10 s, and the next launch is no longer blocked by the old process. A hang is still not recorded anywhere; moving `markClean` after the native exit is impossible (no code runs after it), so counting needs the watchdog to leave evidence, which it does not do yet. If Host disposal timed out and the process is then killed, the free-tokens sidecar can outlive it and hold its fixed port; the log shows one such "exited (code 1) 5 times quickly; giving up" on 11 Sep. Up to 100 ms of non-error log lines can be lost on a hard crash. The first launch after this change deletes 1.1 GB of cache on Chromium's cache thread. Local Storage has the same per-port origin problem (102 dead origins, 676 KB) and is left alone because the interface may read it within a launch.

## Evidence

`sample` of the live main process (5 s): about 10 % of main-thread samples inside `uv_run`, the rest idle; no busy loop at the time of sampling. Host boot, from the log header to the first Host line: 1.6-3.4 s when relaunched within a few minutes, 11-43 s otherwise (runs whose first Host line came minutes later are excluded), 35 s on 18 Sep after a night asleep; the renderer process started 30 s after the main process that day. The installed bundle is 809 MB with 21,303 files under `app.asar.unpacked`; a cold start that re-reads them under Defender is the suspected cause and was not measured directly. Tests: `tests/shutdown.spec.ts`, `tests/log-files.spec.ts`, `tests/http-cache.spec.ts`.
