import SwiftUI
import AuthenticationServices
import BotDotKit

/// The front door asks for a sign-in (ADR 028): the passkey signs this Mac in on the front door's own page, in a
/// browser sheet, which hands the sign-in back to the app (`Handoff`). For botdot on this Mac the first time, the
/// same sheet makes the passkey of its one account with the setup key only this app holds.
struct SignInView: View {
    let base: URL
    @Environment(Store.self) private var store
    @Environment(LocalServer.self) private var local
    @Environment(\.webAuthenticationSession) private var sheet
    @State private var busy = false
    @State private var problem: String?
    /// botdot on this Mac whose account has no passkey yet: the sheet makes it.
    @State private var makes = false

    private var isLocal: Bool { SavedServer.isLocal && base.host() == "localhost" }

    var body: some View {
        VStack(spacing: 18) {
            Brand(size: 34)
            Text(makes ? "Make your passkey" : "Sign in with your passkey").font(.geist(size: 15, weight: .semibold))
            Text(makes ? "botdot on this Mac is yours alone: your passkey is what lets you in, here and in a browser on this Mac."
                       : "botdot at \(base.host(percentEncoded: false) ?? base.absoluteString) asks for your passkey.")
                .font(.geist(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).frame(width: 340)
            if let problem {
                Text(problem).font(.geist(size: 12)).foregroundStyle(Theme.err).multilineTextAlignment(.center).frame(width: 340)
            }
            Button(action: signIn) {
                if busy { ProgressView().controlSize(.small) } else { Text(makes ? "Make my passkey" : "Sign in") }
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(busy)
            .keyboardShortcut(.defaultAction)
            Button("Use another botdot server") {
                SavedServer.isLocal = false
                store.stopSigningIn()
            }
            .buttonStyle(.textLink).foregroundStyle(Theme.muted)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: base) {
            if isLocal, let key = local.setupKey { makes = await store.signUpOpens(at: base, setupKey: key) } else { makes = false }
        }
    }

    private func signIn() {
        guard !busy else { return }
        busy = true
        problem = nil
        Task {
            defer { busy = false }
            let handoff = Handoff()
            let setupKey = makes ? local.setupKey : nil
            do {
                let callback = try await sheet.authenticate(using: handoff.page(at: base, setupKey: setupKey),
                                                            callback: .customScheme(Handoff.callbackScheme),
                                                            preferredBrowserSession: .ephemeral,
                                                            additionalHeaderFields: [:])
                try await store.signIn(at: base, handoff: handoff, callback: callback)
                if setupKey != nil { local.passkeyMade(); makes = false }
            } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
                // Closed by the person: nothing to say.
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}
