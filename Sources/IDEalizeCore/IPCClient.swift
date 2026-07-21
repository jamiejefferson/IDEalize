import Foundation

/// Synchronous client used by the `idealize` CLI to talk to the running app.
public struct IPCClient {
    public let socketPath: String

    /// Shared coders. JSONEncoder/JSONDecoder are safe to call concurrently
    /// (their configuration is never mutated after creation), so one pair
    /// serves every send.
    private static let encoder = IPC.makeEncoder()
    private static let decoder = IPC.makeDecoder()

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

        // Write the encoded bytes straight out (no String round-trip).
        var data = try Self.encoder.encode(request)
        data.append(0x0A)
        try UnixSocket.writeAll(fd, data)

        guard let responseData = try UnixSocket.readLineBytes(fd) else {
            throw SocketError.io("no response from app")
        }
        return try Self.decoder.decode(IPCResponse.self, from: responseData)
    }
}
