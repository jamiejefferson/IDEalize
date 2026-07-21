import Foundation
import os
import IDEalizeCore

/// In-app Unix-socket server. Accepts connections from the `idealize` CLI,
/// decodes one request per connection, hands it to a handler, and writes back
/// the response. Each connection is handled on a background queue.
final class IPCHub {
    typealias Handler = (IPCRequest) -> IPCResponse

    /// Shared coders. JSONEncoder/JSONDecoder are safe to call concurrently
    /// (their configuration is never mutated after creation), so one pair
    /// serves all connection workers.
    private static let encoder = IPC.makeEncoder()
    private static let decoder = IPC.makeDecoder()

    private let handler: Handler
    private let acceptQueue = DispatchQueue(label: "com.idealize.ipc.accept")
    private let workQueue = DispatchQueue(label: "com.idealize.ipc.work", attributes: .concurrent)
    /// Bounds concurrent in-flight connections so a local process can't flood
    /// the GCD pool; accepted sockets beyond the limit are briefly waited on,
    /// then rejected.
    private let connectionSlots = DispatchSemaphore(value: 32)
    /// Tracks in-flight workers so `stop()` can drain them before teardown.
    private let workGroup = DispatchGroup()

    private struct State {
        var running = false
        var listenFD: Int32 = -1
    }
    /// Guards `running`/`listenFD`, which are read on the accept queue and
    /// written from `stop()` on another thread.
    private let state = OSAllocatedUnfairLock(initialState: State())

    init(handler: @escaping Handler) {
        self.handler = handler
    }

    func start() throws {
        let path = IPC.socketPath
        let fd = try UnixSocket.listen(at: path)
        state.withLock {
            $0.listenFD = fd
            $0.running = true
        }
        acceptQueue.async { [weak self] in self?.acceptLoop() }
        NSLog("IDEalize: IPC hub listening at \(path)")
    }

    func stop() {
        let fd = state.withLock { s -> Int32 in
            s.running = false
            let fd = s.listenFD
            s.listenFD = -1
            return fd
        }
        if fd >= 0 {
            // Wake the blocked accept() before closing — closing alone leaves
            // accept parked on an fd number that could be reused (fd-reuse race).
            shutdown(fd, SHUT_RDWR)
            UnixSocket.closeFD(fd)
        }
        unlink(IPC.socketPath)
        // Give in-flight workers a brief, bounded window to finish.
        _ = workGroup.wait(timeout: .now() + 2)
    }

    private var isRunning: Bool { state.withLock { $0.running } }

    private func acceptLoop() {
        while isRunning {
            let listenFD = state.withLock { $0.listenFD }
            guard listenFD >= 0 else { break }
            let client = UnixSocket.accept(listenFD)
            if client < 0 {
                if !isRunning { break }
                // accept() failed while we're still meant to be serving — e.g.
                // transient FD exhaustion (EMFILE). Back off briefly so we don't
                // pin a CPU core spinning on the same error.
                usleep(10_000) // 10ms
                continue
            }
            // Briefly wait for a connection slot; reject if all stay busy.
            guard connectionSlots.wait(timeout: .now() + 0.5) == .success else {
                UnixSocket.closeFD(client)
                continue
            }
            workGroup.enter()
            workQueue.async { [weak self] in
                defer { self?.connectionSlots.signal(); self?.workGroup.leave() }
                self?.serve(client)
            }
        }
    }

    private func serve(_ fd: Int32) {
        defer { UnixSocket.closeFD(fd) }
        do {
            guard let line = try UnixSocket.readLineBytes(fd) else { return }
            let request = try Self.decoder.decode(IPCRequest.self, from: line)
            let response = handler(request)
            var data = try Self.encoder.encode(response)
            data.append(0x0A)
            try UnixSocket.writeAll(fd, data)
        } catch {
            // Don't leak internal error strings (paths, errno, decode details)
            // to whatever is on the other end of the socket.
            NSLog("IDEalize: IPC request failed: \(error)")
            let resp = IPCResponse.failure("invalid request")
            if var data = try? Self.encoder.encode(resp) {
                data.append(0x0A)
                try? UnixSocket.writeAll(fd, data)
            }
        }
    }
}
