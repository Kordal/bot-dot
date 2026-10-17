import SwiftUI
import WebKit
import BotDotKit

/// A bot's computer, live: botdot's own screen viewer (noVNC) in a web view. It connects again by
/// itself when the first try fails (the viewer only retries once it has been connected).
struct LiveScreen: NSViewRepresentable {
    let url: URL
    @Environment(Store.self) private var store

    func makeNSView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.setValue(false, forKey: "drawsBackground")
        // Behind a front door the screen wants this app's session (ADR 028), which a web view sends as a cookie.
        if let cookie = store.sessions.httpCookie(for: url) {
            web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [url] in web.load(URLRequest(url: url)) }
        } else {
            web.load(URLRequest(url: url))
        }
        context.coordinator.keep(web)
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {
        if web.url?.absoluteString != url.absoluteString && context.coordinator.loaded != url {
            context.coordinator.loaded = url
            web.load(URLRequest(url: url))
        }
    }

    static func dismantleNSView(_ web: WKWebView, coordinator: Coordinator) { coordinator.timer?.invalidate() }

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    @MainActor
    final class Coordinator {
        var loaded: URL
        var timer: Timer?
        init(url: URL) { loaded = url }

        func keep(_ web: WKWebView) {
            let check = """
            (() => { const d = document.getElementById('noVNC_connect_dlg');
              const t = document.body ? document.body.innerText : '';
              return (d && d.classList.contains('noVNC_open')) || /Failed to connect|Screen not available|connection is closed/i.test(t); })()
            """
            timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak web] _ in
                Task { @MainActor in
                    guard let web, let again = try? await web.evaluateJavaScript(check) as? Bool, again else { return }
                    web.reload()
                }
            }
        }
    }
}

/// A bot's computer in a window of its own: the live screen, Take control, on and off, Reset, and what
/// it's doing, as the web's screen pop-up.
struct ScreenWindow: View {
    let botId: String
    @Environment(Store.self) private var store
    @State private var control = false
    @State private var details: ComputerDetails?
    @State private var confirmReset = false
    @State private var busy = ""

    private var bot: Bot? { store.bots.first { $0.id == botId } }

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if details?.state == "running", let url = store.screenURL(botId, control: control) {
                    LiveScreen(url: url).id(control)
                } else {
                    VStack(spacing: 10) {
                        Text("🖥").font(.geist(size: 42))
                        Text(bot?.computerAlwaysOn == true ? "Starting its computer… It stays on all the time." : "The computer is off. It turns on by itself when the bot runs.")
                            .foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Color.black)
            // The run's one line, in the server's words; against a botdot server from before, the app's own words for its step.
            if let live = store.botChat.botId == botId ? store.botChat.live : nil, store.has(.workingLine) || !live.steps.isEmpty {
                HStack { Text("What it's doing: ").foregroundStyle(Theme.muted) + Text(store.workingLine(of: botId) ?? live.activity) ; Spacer() }
                    .font(.geist(size: 12.5)).padding(.horizontal, 14).padding(.top, 8)
            }
            if details?.outdated == true {
                Text("A newer desktop is available. This computer keeps running the version it was made with, so nothing installed on it is lost. Reset switches to the new desktop but erases its apps and files.")
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted).padding(.horizontal, 14).padding(.top, 8)
            }
            HStack(spacing: 8) {
                Text(stateText).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
                Spacer()
                Button(control ? "👁 Just watch" : "🖱 Take control") { control.toggle() }.disabled(details?.state != "running")
                if let url = store.screenURL(botId, control: control) { Link("⤢ Full screen", destination: url) }
                Button(bot?.computerAlwaysOn == true ? "Always on" : details?.state == "running" ? "Turn off" : "Turn on") {
                    act(details?.state == "running" ? "stop" : "start", details?.state == "running" ? "Turning off…" : "Turning on…")
                }
                .disabled(bot?.computerAlwaysOn == true || !busy.isEmpty)
                .help(bot?.computerAlwaysOn == true ? "Set to stay on. Change it in the bot settings." : "")
                Button("Reset", role: .destructive) { confirmReset = true }.help("Delete this computer. The next run starts from a fresh desktop.")
            }
            .controlSize(.small)
            .padding(12)
        }
        .frame(minWidth: 640, minHeight: 460)
        .navigationTitle("\(bot?.name ?? "A bot")'s computer")
        .task(id: botId) {
            // Its state, again every few seconds (it turns on and off with runs).
            while !Task.isCancelled {
                details = try? await store.computer(botId)
                try? await Task.sleep(for: .seconds(5))
            }
        }
        .confirmationDialog("Reset \(bot?.name ?? "its")'s computer?", isPresented: $confirmReset) {
            Button("Reset", role: .destructive) { act("reset", "Resetting…") }
        } message: {
            Text("Everything installed on it, its files and its browser logins are erased. The next run starts from a fresh desktop.")
        }
    }

    private var stateText: String {
        if !busy.isEmpty { return busy }
        let label = ["running": "on", "stopped": "off", "starting": "starting", "none": "not made yet"][details?.state ?? ""] ?? (details?.state ?? "…")
        var t = "Computer is \(label)."
        if bot?.running == true { t += " The bot is using it right now." }
        if let d = details?.diskBytes { t += " Uses \(d > 1e9 ? String(format: "%.1f GB", d / 1e9) : "\(max(1, Int((d / 1e6).rounded()))) MB") of disk." }
        return t
    }

    private func act(_ action: String, _ label: String) {
        busy = label
        Task {
            do { details = try await store.computer(botId, action) } catch { store.problem = error.localizedDescription }
            busy = ""
        }
    }
}

/// The small live view in the corner of a bot's chat while it uses its computer.
struct ScreenCorner: View {
    let botId: String
    @Environment(Store.self) private var store
    @Environment(\.openWindow) private var openWindow
    @AppStorage("botdot.pip.hidden") private var hidden = false

    var body: some View {
        if let url = store.screenURL(botId, control: false) {
            if hidden {
                Button { hidden = false } label: { Label("Live screen", systemImage: "display") }
                    .buttonStyle(.glass).controlSize(.small).padding(14)
            } else {
                ZStack(alignment: .topTrailing) {
                    LiveScreen(url: url)
                        .frame(width: 280, height: 175)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line2))
                        .overlay { Color.clear.contentShape(Rectangle()).onTapGesture { openWindow(id: "screen", value: botId) } }
                    HStack(spacing: 4) {
                        Button { openWindow(id: "screen", value: botId) } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.help("Open its screen")
                        Button { hidden = true } label: { Image(systemName: "xmark") }.help("Hide")
                    }
                    .buttonStyle(.glass).controlSize(.mini).padding(6)
                }
                .padding(14)
                .shadow(radius: 12, y: 4)
            }
        }
    }
}
