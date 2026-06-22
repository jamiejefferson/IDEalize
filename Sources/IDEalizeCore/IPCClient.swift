import Foundation

/// Synchronous client used by the `idealize` CLI to talk to the running app.
public struct IPCClient {
    public let socketPath: String

    public init(socketPath: String = IPC.socketPath) {
        self.socketPath = socketPath
    }

    public var isAppRunning: Bool {
        FileManager.default.fileExists(atPath: socketPath)
    }

    /// Send a request and wait for the single-line response.
    public func send(_ request: IPCRequest) throws -> IPCResponse {
        let fd = try UnixSocket.connect(to: socketPath)
        defer { UnixSocket.closeFD(fd) }

        let data = try IPC.makeEncoder().encode(request)
        let line = String(decoding: data, as: UTF8.self)
        try UnixSocket.writeLine(fd, line)

        guard let responseLine = try UnixSocket.readLine(fd) else {
            throw SocketError.io("no response from app")
        }
        return try IPC.makeDecoder().decode(IPCResponse.self, from: Data(responseLine.utf8))
    }
}
