import SwiftUI
import WebKit
import BotdotShared

/// A bot's computer screen, as the Android app's: botdot's own screen page (noVNC) in a web view with the phone's
/// session. Watching only, unless you take control; then "I'm done" hands the screen back and the bot carries on.
struct ScreenView: View {
    let home: HomeStore
    let botId: String
    let name: String
    @State private var model: ScreenModel?
    @State private var notice: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let model, let state = model.state {
                content(model, state)
            } else {
                ProgressView().tint(.white)
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let model, let state = model.state {
                if state.handBack {
                    Button(state.doneLabel) { Task { _ = await model.done() } }
                        .accessibilityIdentifier("screen-done")
                }
                if state.canControl {
                    Button(state.controlLabel) { model.control() }
                        .tint(state.control ? .red : nil)
                        .accessibilityIdentifier("screen-control")
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16)
                    .accessibilityIdentifier("notice")
            }
        }
        .task {
            if model == nil {
                let made = ScreenModel(home: home, botId: botId)
                made.start()
                model = made
            }
        }
        .onDisappear { model?.stop(); model = nil }
        // Handed back to the bot: the screen closes (ADR 225).
        .onChange(of: model?.state?.closed) { _, closed in if closed == true { dismiss() } }
        .task(id: model?.state?.noticeId) {
            guard let text = model?.state?.notice else { return }
            notice = text
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    @ViewBuilder
    private func content(_ model: ScreenModel, _ state: ScreenState) -> some View {
        if let page = state.url.flatMap(URL.init(string:)) {
            ScreenPage(url: page, cookie: model.cookie(for: page)).ignoresSafeArea(edges: .bottom)
        } else if state.off {
            VStack(spacing: 12) {
                Text(state.offLine).foregroundStyle(.white).multilineTextAlignment(.center)
                Button(state.startLabel) { model.startScreen() }.tint(.white)
            }
            .padding(24)
        } else if state.failed {
            Text(state.errorLine).foregroundStyle(.white).padding(24).accessibilityIdentifier("screen-error")
        } else {
            VStack(spacing: 12) {
                ProgressView().tint(.white)
                Text(state.waitLine).foregroundStyle(.white)
            }
        }
    }
}

/// The screen's page in a WKWebView that keeps nothing after it closes. The session's cookie is set before the page
/// loads, so the page and its WebSocket pass the front door (ADR 028), as Android's WebView does.
struct ScreenPage: UIViewRepresentable {
    let url: URL
    let cookie: HTTPCookie?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        #if DEBUG
        view.isInspectable = true
        #endif
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // Taking or giving up control is another address: the page loads again, as on Android.
        guard view.url != url, context.coordinator.loading != url else { return }
        context.coordinator.loading = url
        let request = URLRequest(url: url)
        // Only the latest address loads: a quick second toggle cancels the first before its page loads.
        context.coordinator.task?.cancel()
        context.coordinator.task = Task { @MainActor in
            if let cookie { await view.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
            guard !Task.isCancelled else { return }
            view.load(request)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loading: URL?
        var task: Task<Void, Never>?
    }
}
