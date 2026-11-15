import SwiftUI
import AuthenticationServices
import BotdotShared

/// The app's screens: the address, the sign-in, and Home once signed in. Dark, as the Android app (#14).
struct RootView: View {
    let model: AppModel
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            switch model.screen {
            case .starting: ProgressView()
            case .address: AddressView(model: model)
            case .signIn(let server): SignInView(model: model, server: server)
            case .signedIn(let server):
                // Nothing goes to the bots before the notice that it goes to Anthropic was accepted (AiNotice).
                if model.showsNotice {
                    AiNoticeView { Task { await model.acceptNotice() } }
                } else {
                    HomeView(model: model, server: server, api: model.api(server)).id(server)
                }
            case .paused(let server): PausedView(model: model, server: server)
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.start() }
        .onChange(of: phase, initial: true) { _, now in if now == .active { Notifications.shared.appOpened() } }
    }
}

/// The notice before anything goes to the bots (App Store guideline 5.1.2(i)): the whole screen, until Continue.
struct AiNoticeView: View {
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text(AiNotice.shared.text).font(.title3).multilineTextAlignment(.center)
            Spacer()
            Button(action: onContinue) { Text(AiNotice.shared.go).frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("ai-notice-continue")
        }
        .padding(24)
    }
}

/// Where's your botdot? HTTPS only; a botdot on a computer itself is explained, not tried.
struct AddressView: View {
    let model: AppModel
    @State private var typed = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("botdot").font(.largeTitle.bold())
            Text(tr("Your botdot's address, the one you open in the browser. The phone reaches it through Tailscale, so keep Tailscale on."))
                .foregroundStyle(.secondary)
            TextField("my-vm.my-tailnet.ts.net", text: $typed)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit(connect)
                .padding(12)
                .background(.quaternary, in: .rect(cornerRadius: 12))
                .accessibilityLabel(tr("Address"))
                .accessibilityIdentifier("address")
            if let error = model.error {
                Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
            }
            Button(action: connect) {
                Text(model.busy ? tr("Connecting…") : tr("Connect")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.busy || typed.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(24)
        .frame(maxHeight: .infinity)
    }

    private func connect() {
        Task { await model.connect(typed) }
    }
}

/// The passkey, in the front door's own page in the Safari sheet (the system's passkeys and password managers answer it).
struct SignInView: View {
    let model: AppModel
    let server: String
    @Environment(\.webAuthenticationSession) private var web

    var body: some View {
        VStack(spacing: 16) {
            Text("botdot").font(.largeTitle.bold())
            Text(server).font(.body.monospaced()).foregroundStyle(.secondary)
            if let notice = model.notice {
                Text(notice).foregroundStyle(.secondary).accessibilityIdentifier("notice")
            }
            if let error = model.error {
                Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
            }
            Button {
                Task {
                    await model.signIn(server) { url in
                        try await web.authenticate(using: url, callbackURLScheme: "botdot", preferredBrowserSession: .shared)
                    }
                }
            } label: {
                Text(model.busy ? tr("Signing in…") : tr("Sign in with your passkey")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.busy)
            Button(tr("Change botdot's address")) { model.otherAddress() }
        }
        .padding(24)
    }
}
