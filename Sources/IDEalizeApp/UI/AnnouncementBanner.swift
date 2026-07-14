import SwiftUI
import AppKit

/// One announcement served from Supabase — the "update message" pushed to users
/// (e.g. "v0.1.1 is ready — here's what your feedback fixed"). Decoded straight
/// from the REST row.
struct Announcement: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let body: String
    let ctaLabel: String?
    let ctaURL: String?
    let minAppVersion: String?
    let maxAppVersion: String?

    enum CodingKeys: String, CodingKey {
        case id, title, body
        case ctaLabel = "cta_label"
        case ctaURL = "cta_url"
        case minAppVersion = "min_app_version"
        case maxAppVersion = "max_app_version"
    }
}

/// Fetches the latest active announcement on launch and decides whether to show
/// it: it's held back if the user already dismissed this exact one, or if their
/// app version is outside the announcement's target range. The counterpart to the
/// insert-only `Feedback` uploader — this is the read-only download channel.
@MainActor
final class AnnouncementStore: ObservableObject {
    static let shared = AnnouncementStore()

    /// The announcement to show right now, or nil (nothing new / already seen).
    @Published var current: Announcement?

    // Same Supabase project as feedback. The publishable key is safe to embed: a
    // row-level-security policy allows SELECT of active rows only — no writes.
    private static let endpoint = "https://xlswtyprnmiymfjdbaez.supabase.co/rest/v1/idealize_announcements"
    private static let publishableKey = "sb_publishable_ISmJRrzDN3Z6OEdEEZe2Cw_5YvSDGkt"

    private init() {}

    /// The running app's marketing version ("0.1.0"), or nil under `swift run`
    /// (no bundle) — in which case version filters are ignored so dev always sees
    /// announcements for testing.
    private var appVersion: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    /// Pull the newest active announcement and publish it if it's unseen and in
    /// range. Silent on any failure — an announcement is never worth an error.
    func refresh() {
        let query = "?select=*&active=eq.true&order=created_at.desc&limit=1"
        guard let url = URL(string: Self.endpoint + query) else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        req.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(Self.publishableKey)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error {
                NSLog("IDEalize announcements: fetch failed — \(error.localizedDescription)")
                return
            }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let data, let rows = try? JSONDecoder().decode([Announcement].self, from: data),
                  let latest = rows.first else { return }
            Task { @MainActor in self.consider(latest) }
        }.resume()
    }

    /// Decide whether `a` should surface: skip if already dismissed or if the
    /// app's version falls outside its [min, max] target range.
    private func consider(_ a: Announcement) {
        guard a.id != AppSettings.shared.lastSeenAnnouncementID else { return }
        guard versionInRange(min: a.minAppVersion, max: a.maxAppVersion) else { return }
        current = a
    }

    /// Dismiss the current banner and remember it so it never reappears.
    func dismiss() {
        if let id = current?.id { AppSettings.shared.lastSeenAnnouncementID = id }
        current = nil
    }

    // MARK: Version gating

    /// Is the running app within the announcement's target range? A nil bound is
    /// open. If the app version can't be read (dev / `swift run`) we fail open so
    /// announcements are always testable.
    private func versionInRange(min: String?, max: String?) -> Bool {
        guard let v = appVersion, let vc = SemVer(v) else { return true }
        if let min, let mc = SemVer(min), vc < mc { return false }   // too old
        if let max, let xc = SemVer(max), vc > xc { return false }   // already updated past it
        return true
    }
}

/// A minimal dotted-numeric version ("0.1.0") comparable component-by-component.
/// Missing components read as 0, so "0.1" == "0.1.0".
private struct SemVer: Comparable {
    let parts: [Int]

    init?(_ s: String) {
        let nums = s.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        guard !nums.isEmpty else { return nil }
        parts = nums
    }

    static func < (a: SemVer, b: SemVer) -> Bool {
        let n = Swift.max(a.parts.count, b.parts.count)
        for i in 0..<n {
            let l = i < a.parts.count ? a.parts[i] : 0
            let r = i < b.parts.count ? b.parts[i] : 0
            if l != r { return l < r }
        }
        return false
    }
}

/// A dismissible strip pinned under the title bar carrying the current
/// announcement. Non-modal on purpose — the user reads it without losing their
/// place, unlike the first-run tour sheet.
struct AnnouncementBanner: View {
    @ObservedObject var store = AnnouncementStore.shared
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        if let a = store.current {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    .foregroundStyle(settings.actionStyle.color)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.title).font(settings.ui(12, .semibold))
                        .foregroundStyle(Color(theme.foreground))
                    Text(a.body).font(settings.ui(11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if let label = a.ctaLabel, let urlString = a.ctaURL, let url = URL(string: urlString) {
                    Button(action: { NSWorkspace.shared.open(url) }) {
                        Text(label).font(settings.ui(11, .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 11).padding(.vertical, 5)
                            .background(Capsule().fill(settings.actionStyle.fill))
                    }
                    .buttonStyle(.plain)
                }
                Button(action: { store.dismiss() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .help("Dismiss")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color(theme.surface))
            .overlay(alignment: .bottom) { Rectangle().fill(Color(theme.border)).frame(height: 1) }
        }
    }
}
