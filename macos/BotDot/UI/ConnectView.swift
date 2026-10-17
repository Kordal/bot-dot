import SwiftUI
import BotDotKit

/// The first start: connect to a botdot server, or run botdot on this Mac. Two equal choices.
struct ConnectView: View {
    enum Choice { case none, connect, local }
    @Environment(Store.self) private var store
    @State var choice: Choice = SavedServer.isLocal ? .local : SavedServer.address == nil ? .none : .connect
    @State var problem: String?

    var body: some View {
        Group {
            switch choice {
            case .none: choices
            case .connect: ConnectForm(problem: problem, back: { choice = .none })
            case .local: LocalSetupView(back: { choice = .none })
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var choices: some View {
        VStack(spacing: 28) {
            Brand(size: 40)
            HStack(alignment: .top, spacing: 16) {
                ChoiceCard(icon: "network", title: "Connect to a botdot server", text: "botdot already runs on another computer.") { choice = .connect }
                ChoiceCard(icon: "desktopcomputer", title: "Run botdot on this Mac", text: "Set it up here, in Docker.") { choice = .local }
            }
        }
    }
}

struct ChoiceCard: View {
    let icon: String
    let title: String
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon).font(.geist(size: 28, weight: .light))
                Text(title).font(.geist(size: 15, weight: .semibold)).multilineTextAlignment(.center)
                Text(text).font(.geist(size: 12.5)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            }
            .padding(22)
            .frame(width: 230, height: 170)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 22))
    }
}

/// Which botdot server to connect to.
struct ConnectForm: View {
    @Environment(Store.self) private var store
    @State private var address = SavedServer.isLocal ? "" : SavedServer.address ?? ""
    @State private var connecting = false
    @State var problem: String?
    let back: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Brand(size: 34)
            Text("Connect to a botdot server").font(.geist(size: 15, weight: .semibold))
            TextField("localhost:4747 or its tailnet address", text: $address)
                .webField()
                .frame(width: 320)
                .onSubmit(connect)
            if let problem {
                Text(problem).font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            Button(action: connect) {
                if connecting { ProgressView().controlSize(.small) } else { Text("Connect") }
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(connecting || address.trimmingCharacters(in: .whitespaces).isEmpty)
            .keyboardShortcut(.defaultAction)
            Button("Back", action: back).buttonStyle(.textLink).foregroundStyle(Theme.muted)
        }
    }

    private func connect() {
        guard !connecting else { return }
        connecting = true
        problem = nil
        Task {
            do {
                try await store.connect(to: address)
                SavedServer.address = address.trimmingCharacters(in: .whitespacesAndNewlines)
                SavedServer.isLocal = false
            } catch {
                problem = error.localizedDescription
            }
            connecting = false
        }
    }
}

/// Setting up botdot on this Mac (a local botdot server): Docker, the images, starting it. Then the
/// app connects, and Setup asks for the Claude sign-in.
struct LocalSetupView: View {
    let back: () -> Void
    @Environment(Store.self) private var store
    @Environment(LocalServer.self) private var local
    @Environment(ThisMac.self) private var thisMac
    @Environment(\.openURL) private var openURL
    @State private var problem: LocalServer.Problem?
    @State private var running = false
    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Brand(size: 30); Spacer() }
            Text("Run botdot on this Mac").font(.geist(size: 15, weight: .semibold))
            VStack(alignment: .leading, spacing: 12) {
                row(.docker, "Docker")
                row(.download, "Download botdot")
                row(.start, "Start botdot")
            }
            if running, !local.status.isEmpty {
                Text(local.status).font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            if let problem { problemView(problem) }
            HStack {
                Button("Back") { back() }.buttonStyle(.textLink).foregroundStyle(Theme.muted).disabled(running)
                Spacer()
                if problem == nil && !running { Button("Set up", action: { go() }).buttonStyle(.glassProminent).controlSize(.large).keyboardShortcut(.defaultAction) }
            }
        }
        .frame(width: 440)
        .task(id: problem) {
            // Docker isn't there or not running yet: go on by itself once it runs.
            guard problem == .noDocker || problem == .dockerStopped else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if await local.dockerRunning() == true { go(); return }
            }
        }
        .onAppear { if local.installed { go() } }
    }

    private func row(_ step: LocalServer.Step, _ title: String) -> some View {
        let done = local.step > step
        let now = local.step == step && (running || problem != nil)
        return HStack(spacing: 10) {
            ZStack {
                if done { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok) }
                else if now && running { ProgressView().controlSize(.small) }
                else if now { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.warnText) }
                else { Image(systemName: "circle").foregroundStyle(Theme.faint) }
            }
            .frame(width: 18)
            Text(title).foregroundStyle(done || now ? Theme.text : Theme.muted)
        }
        .font(.geist(size: 14))
    }

    @ViewBuilder
    private func problemView(_ p: LocalServer.Problem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            switch p {
            case .noDocker:
                Text("botdot runs in Docker. Install Docker Desktop (OrbStack or Colima work too), start it, and setup goes on by itself.")
                Button("Get Docker Desktop") { openURL(LocalServer.dockerDownload) }
            case .dockerStopped:
                Text(p.localizedDescription)
            case .needsToken, .badToken:
                Text(p.localizedDescription)
                Text("github.com → Settings → Developer settings → Tokens (classic) → scope: read:packages. It stays on this Mac.")
                    .font(.geist(size: 12)).foregroundStyle(Theme.muted)
                HStack {
                    SecureField("GitHub token", text: $token).webField().onSubmit { go() }
                    Button("Continue") { go() }.disabled(token.isEmpty)
                }
            case .failed(let m):
                Text(m).textSelection(.enabled)
                Button("Try again") { go() }
            }
        }
        .font(.geist(size: 13))
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.warnSoft))
    }

    /// botdot runs here: connect (its front door then asks for the passkey, made the first time), and from now on
    /// start with this Mac.
    private func connect() {
        running = true
        Task {
            do {
                try await store.connect(to: local.address)
                SavedServer.address = local.address
                SavedServer.isLocal = true
                thisMac.apply()
            } catch { problem = .failed(error.localizedDescription) }
            running = false
        }
    }

    private func go() {
        guard !running else { return }
        running = true
        let t = token.isEmpty ? nil : token
        token = ""
        problem = nil
        Task {
            do {
                if local.installed, t == nil {
                    try await local.start()
                    running = false
                    connect()
                    return
                }
                try await local.install(token: t)
                // Set up here: open at login, hidden, so botdot's menu-bar dot is there after a restart.
                if !thisMac.openAtLogin { thisMac.openAtLogin = true }
                running = false
                connect()
                return
            } catch let p as LocalServer.Problem {
                problem = p
            } catch {
                problem = .failed(error.localizedDescription)
            }
            running = false
        }
    }
}

/// The logo: "bot" and a big coral dot, which pulses softly while the Chief or a bot is working.
struct Brand: View {
    var size: CGFloat = 22
    var busy = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.07) {
            Text("bot").font(.geist(size: size, weight: .semibold)).kerning(-size * 0.04)
            ZStack {
                if busy && !reduceMotion {
                    TimelineView(.animation) { context in
                        let p = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                        Circle().fill(Theme.dot).scaleEffect(1 + 0.8 * p).opacity(0.45 * (1 - p))
                    }
                }
                Circle().fill(Theme.dot)
            }
            .frame(width: size * 0.44, height: size * 0.44)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("botdot")
    }
}
