import Foundation
import IDEalizeCore
#if canImport(AppKit)
import AppKit
import UniformTypeIdentifiers
#endif

/// Load an image file and re-encode it as PNG so the Kitty protocol (f=100)
/// can render it regardless of the source format (jpg, gif, heic, …).
func pngData(forFileAt path: String) -> Data? {
    let url = URL(fileURLWithPath: path)
    guard let raw = try? Data(contentsOf: url) else { return nil }
    #if canImport(AppKit)
    // Already PNG? pass through.
    if (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType == .png { return raw }
    guard let image = NSImage(data: raw),
          let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        return raw // last resort: hand over original bytes
    }
    return png
    #else
    return raw
    #endif
}

// MARK: - idealize CLI
//
// A tiny helper that runs *inside* an IDEalize terminal and lets command-line
// agents (Claude Code, pi, scripts) talk to the app and to each other:
//
//   idealize notify "Build finished" --title "claude" --sound
//   idealize send <session> "your turn"          # message another terminal
//   idealize broadcast "deploying in 5"          # message all terminals
//   idealize inbox [--wait] [--timeout S]      # read messages sent to me
//   idealize list                                # list active sessions
//   idealize spawn "build the hero section"      # start a new chat with an opening task
//   idealize spawn "redo the nav" --isolated     # …in its own separate copy of the folder
//   idealize spawn "<brief>" --name "Nav bar"     # …with a short tab label for the sidebar
//   idealize diff <session>                      # what a chat has changed
//   idealize survey                              # all chats' changes + copies touching the same files
//   idealize verify <session>                    # run the folder's build/check; honest pass/fail
//   idealize combine plan                        # a safe order to combine copies (read-only)
//   idealize combine apply <session>             # bring one copy's work into the main version
//   idealize transcript <session> [--last N]     # read a chat's recent Q&A
//   idealize image path/to/file.png [--width 60] # render an image inline
//   idealize reveal src/App.swift --open         # point the human at a file
//   idealize status "running tests"              # set this tab's status text
//   idealize note                                # read the project's shared note + what each chat is doing
//   idealize note --set "use blue, not teal"     # set the shared brief (human-authored)
//   idealize note --mine "building the hero"     # post what THIS chat is working on
//   idealize whoami                              # print my session id
//
// Identity comes from the IDEALIZE_SESSION_ID env var that the app injects into
// every shell it spawns.

let args = Array(CommandLine.arguments.dropFirst())
let env = ProcessInfo.processInfo.environment
let mySession = env[IPC.sessionEnvKey]
/// Capability token authorizing mutating commands: from the environment the app
/// injected into this shell, else the app's token file (mode 0600).
let ipcToken = IPC.loadToken()
let client = IPCClient()

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data(("idealize: " + message + "\n").utf8))
    exit(code)
}

func out(_ s: String) { print(s) }

/// Pull `--flag value` and boolean `--flag` out of an argument list.
struct Flags {
    var values: [String: String] = [:]
    var bools: Set<String> = []
    var positionals: [String] = []

    init(_ raw: [String], boolFlags: Set<String> = []) {
        var i = 0
        while i < raw.count {
            let a = raw[i]
            if a.hasPrefix("--") {
                let key = String(a.dropFirst(2))
                if boolFlags.contains(key) {
                    bools.insert(key)
                } else if i + 1 < raw.count {
                    values[key] = raw[i + 1]
                    i += 1
                } else {
                    bools.insert(key)
                }
            } else {
                positionals.append(a)
            }
            i += 1
        }
    }
}

func requireApp() {
    guard client.isAppRunning else {
        fail("IDEalize app is not running (no socket at \(client.socketPath)).")
    }
}

func sendRequest(_ req: IPCRequest) -> IPCResponse {
    requireApp()
    var req = req
    if req.token == nil { req.token = ipcToken }
    do {
        return try client.send(req)
    } catch {
        fail("\(error)")
    }
}

func printUsage() {
    out("""
    idealize — control & message IDEalize terminals

    USAGE:
      idealize <command> [args]

    COMMANDS:
      notify <text> [--title T] [--sound]   show a system notification
      send <session> <text>                 message another terminal's inbox
      broadcast <text>                      message every other terminal
      inbox [--wait] [--json] [--timeout S]  read & clear my messages
      peek [--json]                         read my messages without clearing
      list [--json]                         list active terminals
      spawn <task> [--name LABEL] [--path DIR] [--isolated]  start a new chat (in DIR, else my project) with an opening task; prints its id. --name labels its tab (else one is read off the task). --isolated gives it its own separate copy of the folder
      spawn --coordinator [--path DIR]      start (or surface) DIR's project agent instead of a worker; prints its id
      diff [session] [--base REF] [--json]  what a chat has changed (vs its copy's start, or REF)
      survey [--path DIR] [--json]          every chat's changes + which copies touch the same files (--path: lead agent only)
      verify [session] [--json]             run the folder's build/check for a chat; honest pass/fail
      combine plan [--path DIR] [--into DIR] [--json]  read-only: a safe order to combine copies (changes nothing; --path: lead agent only)
      combine apply <session> [--into DIR]  bring ONE copy's work into the main version (gated, reversible)
      blocks [session] [--json]             list recorded command blocks
      transcript <session> [--last N] [--json]  read a chat's recent Q&A
      reveal <path> [--open]                show a file in the app's file explorer
      exec <session> <command>              run a command in another terminal
      type <session> <text>                 type text into another terminal
      image <path> [--width W] [--height H] render an image inline
      status <text>                         set this tab's status label
      note [--set <text>] [--mine <text>] [--path DIR]  read the shared note; --set the brief, --mine this chat's status; --path reads another project's (lead agent only)
      agent-hello --name <n> --format <f>   introduce a coding agent to IDEalize (handshake);
                format: claude-jsonl|kimi-wire|none  [--transcript <path template>]
                [--nonce <n>] [--working-patterns "esc to interrupt,…"]
      whoami                                print my session id
      ping                                  check the app is reachable

    Identity is taken from $\(IPC.sessionEnvKey); authorization from
    $\(IPC.tokenEnvKey) (or the app's ipc.token file).

    ADDRESSING: a <session> is a t-… id, a tab label, or a project folder name.
    Aliases: `coordinator` / `project-agent` → your own project's coordinating
    chat ($IDEALIZE_PROJECT_AGENT also carries its id); `lead` / `lead-agent` →
    the workspace's lead agent ($IDEALIZE_LEAD_AGENT likewise).
    """)
}

guard let command = args.first else {
    printUsage()
    exit(0)
}

let rest = Array(args.dropFirst())

switch command {
case "help", "-h", "--help":
    printUsage()

case "whoami":
    out(mySession ?? "(not inside an IDEalize terminal)")

case "ping":
    let resp = sendRequest(IPCRequest(command: .ping))
    out(resp.ok ? "pong" : "error: \(resp.error ?? "unknown")")

case "notify":
    let flags = Flags(rest, boolFlags: ["sound"])
    guard let text = flags.positionals.first else { fail("notify needs a message") }
    let resp = sendRequest(IPCRequest(command: .notify,
                                      from: mySession,
                                      body: text,
                                      title: flags.values["title"] ?? "IDEalize",
                                      sound: flags.bools.contains("sound")))
    if !resp.ok { fail(resp.error ?? "notify failed") }

case "send":
    guard rest.count >= 2 else { fail("usage: idealize send <session> <text>") }
    let target = rest[0]
    let body = rest.dropFirst().joined(separator: " ")
    let resp = sendRequest(IPCRequest(command: .send, from: mySession, target: target, body: body))
    if !resp.ok { fail(resp.error ?? "send failed") }
    out(resp.info ?? "sent")

case "broadcast":
    guard !rest.isEmpty else { fail("usage: idealize broadcast <text>") }
    let body = rest.joined(separator: " ")
    let resp = sendRequest(IPCRequest(command: .broadcast, from: mySession, body: body))
    if !resp.ok { fail(resp.error ?? "broadcast failed") }
    out(resp.info ?? "broadcast")

case "inbox", "peek":
    let flags = Flags(rest, boolFlags: ["wait", "json"])
    let cmd: IPCRequest.Command = command == "inbox" ? .inbox : .peek
    let wantWait = flags.bools.contains("wait")
    // --timeout SECS bounds --wait (0/absent = wait forever, as before).
    var timeout: Double = 0
    if let raw = flags.values["timeout"] {
        guard let t = Double(raw), t >= 0 else { fail("invalid --timeout '\(raw)' (expected seconds)") }
        timeout = t
    }
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        let resp = sendRequest(IPCRequest(command: cmd, from: mySession))
        if !resp.ok { fail(resp.error ?? "inbox failed") }
        let messages = resp.messages ?? []
        if messages.isEmpty && wantWait {
            if timeout > 0, Date() >= deadline {
                fail("timed out after \(Int(timeout))s waiting for messages", code: 2)
            }
            Thread.sleep(forTimeInterval: 0.5)
            continue
        }
        if flags.bools.contains("json") {
            let data = try IPC.makeEncoder().encode(messages)
            out(String(decoding: data, as: UTF8.self))
        } else {
            if messages.isEmpty {
                out("(no messages)")
            } else {
                let fmt = DateFormatter()
                fmt.dateFormat = "HH:mm:ss"
                for m in messages {
                    let label = m.fromLabel ?? m.from
                    out("[\(fmt.string(from: m.timestamp))] \(label): \(m.body)")
                }
            }
        }
        break
    } while wantWait

case "reveal":
    let flags = Flags(rest, boolFlags: ["open"])
    guard let path = flags.positionals.first else { fail("usage: idealize reveal <path> [--open]") }
    // Resolve here, not in the app: we share the caller's working directory, so
    // `idealize reveal src/main.swift` means what the agent expects it to.
    let abs = URL(fileURLWithPath: path).standardizedFileURL.path
    let resp = sendRequest(IPCRequest(command: .reveal,
                                      from: mySession,
                                      target: abs,
                                      open: flags.bools.contains("open")))
    if !resp.ok { fail(resp.error ?? "reveal failed") }
    out(resp.info ?? "revealed")

case "exec":
    guard rest.count >= 2 else { fail("usage: idealize exec <session> <command>") }
    let target = rest[0]
    let cmd = rest.dropFirst().joined(separator: " ")
    let resp = sendRequest(IPCRequest(command: .input, from: mySession, target: target, body: cmd + "\n"))
    if !resp.ok { fail(resp.error ?? "exec failed") }
    out(resp.info ?? "sent")

case "type":
    guard rest.count >= 2 else { fail("usage: idealize type <session> <text>") }
    let target = rest[0]
    let body = rest.dropFirst().joined(separator: " ")
    let resp = sendRequest(IPCRequest(command: .input, from: mySession, target: target, body: body))
    if !resp.ok { fail(resp.error ?? "type failed") }

case "blocks":
    let flags = Flags(rest, boolFlags: ["json"])
    let target = flags.positionals.first ?? mySession
    let resp = sendRequest(IPCRequest(command: .blocks, from: mySession, target: target))
    if !resp.ok { fail(resp.error ?? "blocks failed") }
    let blocks = resp.blocks ?? []
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(blocks)
        out(String(decoding: data, as: UTF8.self))
    } else if blocks.isEmpty {
        out("(no commands recorded)")
    } else {
        for b in blocks {
            let status = b.running ? "…" : (b.exitCode == 0 ? "✓" : "✗ \(b.exitCode ?? -1)")
            let dur = b.durationMs.map { " (\($0)ms)" } ?? ""
            out("\(status)  \(b.command)\(dur)")
        }
    }

case "transcript":
    let flags = Flags(rest, boolFlags: ["json"])
    guard let target = flags.positionals.first else { fail("usage: idealize transcript <session> [--last N] [--json]") }
    var limit = 10
    if let raw = flags.values["last"] {
        guard let n = Int(raw), n > 0 else { fail("invalid --last '\(raw)' (expected a positive number)") }
        limit = n
    }
    let resp = sendRequest(IPCRequest(command: .transcript, from: mySession, target: target, limit: limit))
    if !resp.ok { fail(resp.error ?? "transcript failed") }
    let exchanges = resp.exchanges ?? []
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(exchanges)
        out(String(decoding: data, as: UTF8.self))
    } else if exchanges.isEmpty {
        out("(no exchanges yet)")
    } else {
        for e in exchanges {
            out("Q: \(e.question)")
            if let a = e.answer { out("A: \(a)") }
            out("")
        }
    }

case "list":
    let flags = Flags(rest, boolFlags: ["json"])
    let resp = sendRequest(IPCRequest(command: .list, from: mySession))
    if !resp.ok { fail(resp.error ?? "list failed") }
    let sessions = resp.sessions ?? []
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(sessions)
        out(String(decoding: data, as: UTF8.self))
    } else if sessions.isEmpty {
        out("(no active sessions)")
    } else {
        for s in sessions {
            let me = s.id == mySession ? " *" : "  "
            let proj = s.projectPath.map { " — " + ($0 as NSString).lastPathComponent } ?? ""
            let proc = s.processName.map { " [\($0)]" } ?? ""
            let unread = s.unread > 0 ? " (\(s.unread) unread)" : ""
            out("\(me)\(s.id)  \(s.title)\(proj)\(proc)\(unread)")
        }
    }

case "spawn":
    // Start a new chat and hand it an opening task. The project agent uses this
    // to delegate work to a fresh worker chat while the user keeps talking to
    // just the agent. Defaults to the caller's own project; --path targets
    // another folder. On success, prints the new chat's session id so the caller
    // can then watch it (`idealize transcript <id>`, `idealize list`).
    // --isolated gives the new chat its own separate copy of the folder so it
    // can't collide with other chats (a git worktree, under the hood).
    // --name labels the new chat's tab. Worth passing: a task is usually a full
    // brief, so a name read off its opening words is a poorer label than the one
    // the caller could give it. Without it the app derives one from the task.
    // --coordinator starts the project's *coordinating agent* rather than a
    // worker — the lead agent uses this to watch a project that has no agent
    // yet (or whose agent died). Idempotent: one coordinator per project.
    let flags = Flags(rest, boolFlags: ["isolated", "coordinator"])   // --path DIR, --name LABEL; positionals join into the task
    let task = flags.positionals.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    let coordinator = flags.bools.contains("coordinator")
    guard !task.isEmpty || flags.values["path"] != nil || coordinator else {
        fail("usage: idealize spawn <task> [--name LABEL] [--path DIR] [--isolated] | idealize spawn --coordinator [--path DIR]")
    }
    let resp = sendRequest(IPCRequest(command: .spawn, from: mySession,
                                      target: flags.values["path"],
                                      body: task.isEmpty ? nil : task,
                                      isolated: flags.bools.contains("isolated") ? true : nil,
                                      name: flags.values["name"],
                                      coordinator: coordinator ? true : nil))
    if !resp.ok { fail(resp.error ?? "spawn failed") }
    out(resp.info ?? "spawned")   // info carries the new chat's session id

case "diff":
    // Read-only: what a chat has changed. An isolated chat is compared against
    // its safe copy's starting point; a shared-tree chat against `--base REF`
    // (default origin/main). Session defaults to me.
    let flags = Flags(rest, boolFlags: ["json"])
    let target = flags.positionals.first ?? mySession
    let resp = sendRequest(IPCRequest(command: .gitDiff, from: mySession,
                                      target: target, body: flags.values["base"]))
    if !resp.ok { fail(resp.error ?? "diff failed") }
    guard let d = resp.diff else { fail("diff returned nothing") }
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(d)
        out(String(decoding: data, as: UTF8.self))
    } else {
        out(d.summary)
        for f in d.files {
            let counts = (f.added != nil && f.deleted != nil) ? "  (+\(f.added!) -\(f.deleted!))" : ""
            out("  \(f.change.padding(toLength: 8, withPad: " ", startingAt: 0)) \(f.path)\(counts)")
        }
    }

case "survey":
    // Read-only: every chat's change summary, plus which separate copies are
    // changing the same files — the overlap check to run before combining.
    // --path surveys another project — honoured only for the lead agent; every
    // other chat is scoped to its own project.
    let flags = Flags(rest, boolFlags: ["json"])
    let resp = sendRequest(IPCRequest(command: .survey, from: mySession,
                                      target: flags.values["path"]))
    if !resp.ok { fail(resp.error ?? "survey failed") }
    guard let s = resp.survey else { fail("survey returned nothing") }
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(s)
        out(String(decoding: data, as: UTF8.self))
    } else {
        out(s.summary)
        for c in s.copies {
            out("  \(c.label) (\(c.id))  — \(c.changedFiles) changed [\(c.isolated ? "own copy" : "shared")]")
        }
        if !s.overlaps.isEmpty {
            out("  ⚠ same file in more than one copy:")
            for o in s.overlaps { out("    \(o.path) — \(o.ids.joined(separator: ", "))") }
        }
    }

case "verify":
    // Run the folder's build/check for a chat and report honestly (says so when
    // there's no known check rather than faking a pass). Session defaults to me.
    let flags = Flags(rest, boolFlags: ["json"])
    let target = flags.positionals.first ?? mySession
    let resp = sendRequest(IPCRequest(command: .verify, from: mySession, target: target))
    if !resp.ok { fail(resp.error ?? "verify failed") }
    guard let v = resp.verify else { fail("verify returned nothing") }
    if flags.bools.contains("json") {
        let data = try IPC.makeEncoder().encode(v)
        out(String(decoding: data, as: UTF8.self))
    } else {
        out(v.summary)
        if v.ran, v.passed == false, !v.tail.isEmpty { out(""); out(v.tail) }
    }

case "combine":
    // Two shapes, deliberately separated so applying is never accidental:
    //   idealize combine plan [--into DIR]            # read-only proposal, changes nothing
    //   idealize combine apply <session> [--into DIR] # bring ONE copy in (gated, reversible)
    let flags = Flags(rest, boolFlags: ["json"])
    switch flags.positionals.first {
    case "plan":
        // --path plans another project's combine — lead agent only, like survey.
        let resp = sendRequest(IPCRequest(command: .combinePlan, from: mySession,
                                          target: flags.values["path"],
                                          body: flags.values["into"]))
        if !resp.ok { fail(resp.error ?? "combine plan failed") }
        guard let p = resp.combinePlan else { fail("plan returned nothing") }
        if flags.bools.contains("json") {
            let data = try IPC.makeEncoder().encode(p)
            out(String(decoding: data, as: UTF8.self))
        } else {
            out(p.summary)
            for (i, item) in p.order.enumerated() {
                let warn = item.hasUnsavedWork ? " (needs saving)" : ""
                out("  \(i + 1). \(item.label) (\(item.id))  \(item.changedFiles) files — \(item.trialResult)\(warn)")
            }
            if !p.overlaps.isEmpty {
                out("  ⚠ review first (same file, more than one copy):")
                for o in p.overlaps { out("    \(o.path)") }
            }
        }
    case "apply":
        guard flags.positionals.count >= 2 else {
            fail("usage: idealize combine apply <session> [--into DIR]")
        }
        let resp = sendRequest(IPCRequest(command: .combineApply, from: mySession,
                                          target: flags.positionals[1], body: flags.values["into"]))
        if !resp.ok { fail(resp.error ?? "combine failed") }
        guard let r = resp.combineResult else { fail("combine returned nothing") }
        if flags.bools.contains("json") {
            let data = try IPC.makeEncoder().encode(r)
            out(String(decoding: data, as: UTF8.self))
        } else {
            out(r.summary)
            if !r.conflicts.isEmpty {
                out("  clashing files:")
                for c in r.conflicts { out("    \(c)") }
            }
        }
    default:
        fail("usage: idealize combine plan [--into DIR]  |  idealize combine apply <session> [--into DIR]")
    }

case "status":
    guard !rest.isEmpty else { fail("usage: idealize status <text>") }
    let resp = sendRequest(IPCRequest(command: .setStatus, from: mySession, body: rest.joined(separator: " ")))
    if !resp.ok { fail(resp.error ?? "status failed") }

case "focus":
    guard let target = rest.first else { fail("usage: idealize focus <session>") }
    let resp = sendRequest(IPCRequest(command: .focus, from: mySession, target: target))
    if !resp.ok { fail(resp.error ?? "focus failed") }

case "note":
    // `--set`/`--mine` take ALL the remaining words as their value (so unquoted
    // prose isn't silently truncated to the first word). No value → usage error,
    // not a destructive clear.
    if rest.first == "--set" || rest.first == "--mine" {
        let mine = rest.first == "--mine"
        let text = rest.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            fail("usage: idealize note \(rest.first!) <text>")
        }
        let resp = sendRequest(IPCRequest(command: .note, from: mySession,
                                          target: mine ? "mine" : nil, body: text))
        if !resp.ok { fail(resp.error ?? "note failed") }
        out(resp.info ?? (mine ? "noted" : "note updated"))
    } else if rest.first == "--path", rest.count >= 2 {
        // Read another project's shared note — honoured only for the lead agent.
        let resp = sendRequest(IPCRequest(command: .note, from: mySession, target: rest[1]))
        if !resp.ok { fail(resp.error ?? "note failed") }
        let note = resp.info ?? ""
        out(note.isEmpty ? "(no project note yet)" : note)
    } else if rest.isEmpty {
        let resp = sendRequest(IPCRequest(command: .note, from: mySession))
        if !resp.ok { fail(resp.error ?? "note failed") }
        let note = resp.info ?? ""
        out(note.isEmpty ? "(no project note yet)" : note)
    } else {
        fail("usage: idealize note [--set <text>] [--mine <text>] [--path DIR]")
    }

case "agent-hello":
    // The handshake: a coding agent (running inside an IDEalize terminal)
    // introduces itself — its name, where its transcript lives, and how to
    // read it — so the app saves an agent profile and renders its conversation
    // as chat bubbles. Typically run BY the agent, prompted by IDEalize's
    // first-run introduction. The app derives the binary name from what the
    // pane is running and verifies the transcript path before trusting it.
    let flags = Flags(rest)
    guard let name = flags.values["name"], !name.isEmpty else {
        fail("agent-hello needs --name <agent name>")
    }
    // Transcript format: claude-jsonl (Claude-Code-style records), kimi-wire
    // (Kimi wire.jsonl), or none (no readable transcript — screen-only chat).
    let format = (flags.values["format"] ?? "none").lowercased()
    guard ["claude-jsonl", "kimi-wire", "none"].contains(format) else {
        fail("--format must be claude-jsonl, kimi-wire, or none")
    }
    var payload: [String: Any] = ["name": name, "format": format]
    if let t = flags.values["transcript"] { payload["transcript"] = t }
    if let n = flags.values["nonce"] { payload["nonce"] = n }
    if let p = flags.values["working-patterns"] {
        // Comma-separated screen substrings that mean "working" (e.g. a
        // spinner label or "esc to interrupt").
        payload["workingPatterns"] = p.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
    guard let bodyData = try? JSONSerialization.data(withJSONObject: payload),
          let body = String(data: bodyData, encoding: .utf8) else {
        fail("could not encode the hello payload")
    }
    let resp = sendRequest(IPCRequest(command: .agentHello, from: mySession, body: body))
    if !resp.ok { fail(resp.error ?? "agent-hello failed") }
    out(resp.info ?? "hello received — IDEalize can read this agent now")

case "image":
    // Inline images are emitted directly to our own stdout; no socket needed.
    let flags = Flags(rest)
    guard let path = flags.positionals.first else { fail("usage: idealize image <path> [--width W] [--height H]") }
    guard let png = pngData(forFileAt: path) else { fail("cannot read image at \(path)") }
    let cols = flags.values["width"].flatMap { Int($0) }
    let rows = flags.values["height"].flatMap { Int($0) }
    let seq = KittyGraphics.sequence(png: png, cols: cols, rows: rows)
    FileHandle.standardOutput.write(Data(seq.utf8))
    FileHandle.standardOutput.write(Data("\n".utf8))

default:
    fail("unknown command '\(command)'. Run `idealize help`.")
}
