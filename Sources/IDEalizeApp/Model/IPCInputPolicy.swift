/// Pure validation gate for local IPC requests that inject terminal input.
/// The presented session-ID membership check rejects stale/malformed requests;
/// it is defense-in-depth, not client authentication.
enum IPCInputPolicy {
    enum DenialReason: Equatable {
        case disabled
        case missingSource
        case staleSource
        case missingBody
    }

    enum Decision: Equatable {
        case allowed(body: String)
        case denied(DenialReason)
    }

    static func evaluate(
        isEnabled: Bool,
        sourceSessionID: String?,
        liveSessionIDs: Set<String>,
        body: String?
    ) -> Decision {
        guard isEnabled else { return .denied(.disabled) }
        guard let sourceSessionID else { return .denied(.missingSource) }
        guard liveSessionIDs.contains(sourceSessionID) else { return .denied(.staleSource) }
        guard let body else { return .denied(.missingBody) }
        return .allowed(body: body)
    }
}
