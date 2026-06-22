import Foundation
import IDEalizeCore

/// In-app Unix-socket server. Accepts connections from the `idealize` CLI,
/// decodes one request per connection, hands it to a handler, and writes back
/// the response. Each connection is handled on a background queue.
final class IPCHub {
    typealias Handler = (IPCRequest) -> IPCResponse

    private let handler: Handler
    private var listenFD: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "com.idealize.ipc.accept")
    private let workQueue = DispatchQueue(label: "com.idealize.ipc.work", attributes: .concurrent)
    private var running = false

    init(handler: @escaping Handler) {
        self.handler = handler
    }

    func start() throws {
        let path = IPC.socketPath
        listenFD = try UnixSocket.listen(at: path)
        running = true
        acceptQueue.async { [weak self] in self?.acceptLoop() }
        NSLog("IDEalize: IPC hub listening at \(path)")
    }

    func stop() {
        running = false
        if listenFD >= 0 { UnixSocket.closeFD(listenFD); listenFD = -1 }
        unlink(IPC.socketPath)
    }

    private func acceptLoop() {
        while running {
            let client = UnixSocket.accept(listenFD)
            if client < 0 {
                if !running { break }
                // accept() failed while we're still meant to be serving — e.g.
                // transient FD exhaustion (EMFILE). Back off briefly so we don't
                // pin a CPU core spinning on the same error.
                usleep(10_000) // 10ms
                continue
            }
            workQueue.async { [weak self] in self?.serve(client) }
        }
    }

    private func serve(_ fd: Int32) {
        defer { UnixSocket.closeFD(fd) }
        do {
            guard let line = try UnixSocket.readLine(fd) else { return }
            let request = try IPC.makeDecoder().decode(IPCRequest.self, from: Data(line.utf8))
            let response = handler(request)
            let data = try IPC.makeEncoder().encode(response)
            try UnixSocket.writeLine(fd, String(decoding: data, as: UTF8.self))
        } catch {
            let resp = IPCResponse.failure("\(error)")
            if let data = try? IPC.makeEncoder().encode(resp) {
                try? UnixSocket.writeLine(fd, String(decoding: data, as: UTF8.self))
            }
        }
    }
}
