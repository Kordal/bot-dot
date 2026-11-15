import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// The share extension (#1373): Share → botdot in another app. What was shared (files, a link, words) goes to the bot
/// or the Chief picked, through the botdot this phone is signed in to, with the session the app keeps in their shared
/// Keychain group. The picker and the send are the shared layer's (Share), as Android's ShareScreen.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let context = extensionContext
        let host = UIHostingController(rootView: ShareView(
            items: (context?.inputItems as? [NSExtensionItem]) ?? [],
            done: { context?.completeRequest(returningItems: nil) },
            cancel: { context?.cancelRequest(withError: CocoaError(.userCancelled)) }
        ))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}

// What another app shares is read once, on the extension's main actor, and handed to the reads below.
extension NSExtensionItem: @retroactive @unchecked Sendable {}

/// What was shared, read from the extension's items: files copied where the shared layer may read them, and words
/// (a link, a page's address, some text).
struct Shared {
    var files: [(path: String, name: String)] = []
    var words = ""

    /// Reads [items]: a file (or picture, film) as a file, a web address or text as words.
    static func read(_ items: [NSExtensionItem], into dir: URL) async -> Shared {
        var got = Shared()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for provider in items.flatMap({ $0.attachments ?? [] }) {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                got.words = [got.words, url.absoluteString].filter { !$0.isEmpty }.joined(separator: "\n")
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                got.words = [got.words, text].filter { !$0.isEmpty }.joined(separator: "\n")
            } else if let type = provider.registeredTypeIdentifiers.first, let copy = await copy(provider, type, into: dir) {
                got.files.append(copy)
            }
        }
        return got
    }

    private static func copy(_ provider: NSItemProvider, _ type: String, into dir: URL) async -> (path: String, name: String)? {
        await withCheckedContinuation { done in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else { done.resume(returning: nil); return }
                let to = dir.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
                guard (try? FileManager.default.copyItem(at: url, to: to)) != nil else { done.resume(returning: nil); return }
                done.resume(returning: (to.path, provider.suggestedName.map { $0 + (url.pathExtension.isEmpty ? "" : "." + url.pathExtension) } ?? url.lastPathComponent))
            }
        }
    }
}

/// The picker: what goes (the words, editable), then the Chief and each bot; a tap sends it there.
struct ShareView: View {
    let items: [NSExtensionItem]
    let done: () -> Void
    let cancel: () -> Void
    @State private var shared: Shared?
    @State private var words = ""
    @State private var picks: [Share.Pick] = []
    @State private var sending: String?
    @State private var error: String?
    /// What this share has sent so far, and its message's key: a tap again after a failure uploads and makes nothing
    /// twice, and the same words keep their key (edited, they are a new message).
    @State private var pending = Share.Pending()
    private let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share").appendingPathComponent(UUID().uuidString)
    private let server = SharedAddress.read()

    var body: some View {
        NavigationStack {
            list
                .navigationTitle(Share.shared.title(files: Int32(shared?.files.count ?? 0)))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { forget(); cancel() } } }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var list: some View {
        if server == nil {
            Text(tr("Not signed in")).foregroundStyle(.secondary).padding()
        } else {
            List {
                Section { TextField(tr("Message"), text: $words, axis: .vertical).lineLimit(1...5) }
                if let error { Text(error).foregroundStyle(.red) }
                Section { ForEach(picks, id: \.id) { (p: Share.Pick) in row(p) } }
            }
        }
    }

    private func row(_ p: Share.Pick) -> some View {
        Button { send(to: p.id) } label: {
            HStack(spacing: 12) {
                Circle().fill(Color(hex: p.color)).frame(width: 28, height: 28)
                Text(p.name)
                Spacer(minLength: 0)
                if sending == p.id { ProgressView() }
            }
        }
        .disabled(sending != nil)
        .accessibilityIdentifier("share-\(p.id)")
    }

    /// The copies of what was shared, gone once it went or the share was cancelled.
    private func forget() { try? FileManager.default.removeItem(at: dir) }

    private var api: Api? {
        server.map { Api(baseUrl: $0, session: Session(keep: KeychainSessions()), quietMs: Api.companion.QUIET_MS) }
    }

    private func load() async {
        let got = await Shared.read(items, into: dir)
        shared = got
        words = got.words
        guard let api else { return }
        // Not read (offline, a session that ended, a paused account): botdot's sentence above the Chief.
        if let picker = try? await Share.shared.picker(api: api) {
            picks = picker.picks
            error = picker.failed
        }
    }

    private func send(to: String) {
        guard let api, sending == nil else { return }
        sending = to
        let files = (shared?.files ?? []).map { outgoingFile(path: $0.path, name: $0.name) }
        let text = words
        Task {
            let failed: String?
            do { failed = try await Share.shared.send(api: api, to: to, text: text, files: files, pending: pending) } catch { failed = error.localizedDescription }
            sending = nil
            // A failure keeps the files where they are, for a tap again from the picker still open.
            if let failed { error = failed } else { forget(); done() }
        }
    }
}

private extension Color {
    /// A colour as botdot writes it ("#7f77dd"); grey for none.
    init(hex: String?) {
        let h = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6, let v = Int(h, radix: 16) else { self = .gray; return }
        self = Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
