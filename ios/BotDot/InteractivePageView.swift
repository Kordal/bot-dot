import SwiftUI
import UIKit
import WebKit
import BotdotShared

extension ViewerView {
    /// A bot's interactive page (#399): the line that says it is isolated, Full screen, Versions and Download, a
    /// notice over an older version shown, then the page in its own frame.
    @ViewBuilder
    func interactive(_ site: InteractiveView) -> some View {
        VStack(spacing: 0) {
            if !full {
                VStack(alignment: .leading, spacing: 8) {
                    Label(InteractivePages.shared.ISOLATED, systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button(tr("Full screen")) { full = true }
                        Button(tr("Versions")) { versions = true }
                        Button(tr("Download")) { Task { if let url = await model.fetch() { sharing = SharedFile(url: url) } } }
                    }
                    .buttonStyle(.bordered).font(.subheadline)
                    if site.shown != site.current {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(InteractivePages.shared.olderShown(shown: site.shown, current: site.current)).font(.subheadline)
                            HStack {
                                Button(tr("Go back to this version")) { Task { await model.setVersion(Int(site.shown)) } }.buttonStyle(.borderedProminent)
                                Button(tr("Show the current one")) { Task { await model.show(version: nil) } }
                            }
                        }
                        .padding(12).background(.orange.opacity(0.15), in: .rect(cornerRadius: 10))
                    }
                }
                .padding(.horizontal).padding(.vertical, 8)
            }
            if let frame = site.frame {
                InteractiveFrame(frame: frame, values: site.values, go: { model.viewer.go(frame: frame, url: $0) })
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .topTrailing) {
                        if full {
                            Button { full = false } label: { Image(systemName: "arrow.down.right.and.arrow.up.left").padding(10) }
                                .buttonStyle(.bordered).clipShape(Circle()).padding()
                                .accessibilityLabel(tr("Full screen"))
                        }
                    }
            } else {
                ContentUnavailableView(tr("This machine can't show interactive pages yet"), systemImage: "lock.rectangle")
            }
        }
    }
}

/// An interactive page's frame: JavaScript for the page and nothing else, nothing kept, no new windows, no bridge to
/// the app. Its own files load; a link out, or the page's own request for one, asks first and opens in the browser.
struct InteractiveFrame: UIViewRepresentable {
    let frame: String
    let values: [String: Kotlinx_serialization_jsonJsonElement]?
    let go: (String) -> InteractivePagesGo

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        if let url = URL(string: frame) { web.load(URLRequest(url: url)) }
        context.coordinator.loaded = frame
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        // Another version or a new publish is another address: loaded anew, so what it may load is checked against it.
        if context.coordinator.loaded != frame, let url = URL(string: frame) {
            context.coordinator.loaded = frame
            web.load(URLRequest(url: url))
        } else if let values {
            // The page's live values, handed to it once each time they change.
            let script = InteractivePages.shared.valuesScript(values: values)
            if context.coordinator.sent != script {
                context.coordinator.sent = script
                web.evaluateJavaScript(script)
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: InteractiveFrame
        var loaded: String?
        var sent: String?
        init(_ parent: InteractiveFrame) { self.parent = parent }

        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url?.absoluteString else { return decisionHandler(.cancel) }
            switch onEnum(of: parent.go(url)) {
            case .stay: decisionHandler(.allow)
            case .ask(let ask):
                decisionHandler(.cancel)
                askOut(ask.url, from: web)
            case .block: decisionHandler(.cancel)
            }
        }

        func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
            web.evaluateJavaScript(InteractivePages.shared.LISTENER)
            if let values = parent.values {
                let script = InteractivePages.shared.valuesScript(values: values)
                sent = script
                web.evaluateJavaScript(script)
            }
        }

        /// A link out of the page: where it leads, before it opens in the browser.
        private func askOut(_ link: String, from web: WKWebView) {
            guard let url = URL(string: link), let root = web.window?.rootViewController else { return }
            let alert = UIAlertController(title: tr("Open a link?"), message: tr("The page wants to open {host}:", ["host": url.host() ?? ""]) + "\n" + link, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: tr("Cancel"), style: .cancel))
            alert.addAction(UIAlertAction(title: tr("Open"), style: .default) { _ in UIApplication.shared.open(url) })
            var top = root
            while let shown = top.presentedViewController { top = shown }
            top.present(alert, animated: true)
        }
    }
}

/// The versions kept, newest first: show one, or make it the page again.
struct VersionsSheet: View {
    let title: String
    let site: InteractiveView
    let onShow: (Int) -> Void
    let onCurrent: (Int) -> Void

    var body: some View {
        NavigationStack {
            List(site.versions, id: \.n) { v in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(InteractivePages.shared.versionTitle(v: v, current: site.current)).foregroundStyle(v.n == site.current ? .green : .primary)
                        Text(InteractivePages.shared.versionLine(v: v)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(tr("Show")) { onShow(Int(v.n)) }.buttonStyle(.borderless)
                    if v.n != site.current { Button(tr("Go back to it")) { onCurrent(Int(v.n)) }.buttonStyle(.bordered) }
                }
            }
            .navigationTitle(tr("Versions of “{title}”", ["title": title]))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
