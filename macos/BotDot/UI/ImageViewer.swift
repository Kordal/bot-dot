import SwiftUI
import AppKit
import BotDotKit

extension EnvironmentValues {
    @Entry var openChatImage: ((FileRef) -> Void)? = nil
}

/// One ordered gallery for the whole chat, including images in folded or off-screen messages.
/// Snapshot it on opening so arriving replies cannot move the selected image beneath the user.
struct ChatImageGallery: ViewModifier {
    let files: [FileRef]
    @State private var selection: ImageSelection?

    func body(content: Content) -> some View {
        content
            .environment(\.openChatImage, { selected in
                var seen = Set<String>()
                let images = (files + [selected]).filter { $0.isImage && seen.insert($0.file).inserted }
                guard let index = images.firstIndex(where: { $0.file == selected.file }) else { return }
                selection = ImageSelection(files: images, index: index)
            })
            .sheet(item: $selection) { selection in
                ChatImageViewer(files: selection.files, initialIndex: selection.index)
            }
    }
}

private struct ImageSelection: Identifiable {
    let id = UUID()
    let files: [FileRef]
    let index: Int
}

/// Both previews and full images use the authenticated download path (with the session behind a front door).
struct ChatImage: View {
    let file: FileRef
    var thumbnail = false
    @Environment(Store.self) private var store
    @State private var image: NSImage?
    @State private var failure: String?
    @State private var retry = 0

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFit().accessibilityLabel(file.name)
            } else if let failure {
                VStack(spacing: 8) {
                    Image(systemName: "photo.badge.exclamationmark")
                    Text(thumbnail ? "Preview unavailable" : failure)
                        .multilineTextAlignment(.center)
                    if !thumbnail { Button("Retry") { retry += 1 } }
                }
                .font(.geist(size: 12))
                .foregroundStyle(.secondary)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel("Loading image")
            }
        }
        .frame(minWidth: thumbnail ? 160 : nil, minHeight: thumbnail ? 110 : nil)
        .task(id: "\(file.file):\(retry)") {
            image = nil
            failure = nil
            do {
                let data = try await store.download(file)
                try Task.checkCancellation()
                guard let decoded = NSImage(data: data), decoded.isValid else {
                    failure = "This file could not be displayed as an image."
                    return
                }
                image = decoded
            } catch {
                guard !Task.isCancelled else { return }
                failure = error.localizedDescription
            }
        }
    }
}

struct ChatImageViewer: View {
    let files: [FileRef]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    init(files: [FileRef], initialIndex: Int) {
        self.files = files
        _index = State(initialValue: initialIndex)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(files[index].name).font(.geist(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                    Text("\(index + 1) of \(files.count)").font(.geist(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .keyboardShortcut(.cancelAction)
                    .help("Close (Escape)")
            }
            .padding()
            Divider()
            HStack(spacing: 12) {
                Button { move(-1) } label: { Image(systemName: "chevron.left").frame(width: 28, height: 40) }
                    .keyboardShortcut(.leftArrow, modifiers: [])
                    .disabled(index == 0)
                    .accessibilityLabel("Previous image")
                    .help("Previous image (←)")
                ChatImage(file: files[index])
                    .id(files[index].file)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 40).onEnded { value in
                        if abs(value.translation.width) > abs(value.translation.height) {
                            move(value.translation.width < 0 ? 1 : -1)
                        }
                    })
                Button { move(1) } label: { Image(systemName: "chevron.right").frame(width: 28, height: 40) }
                    .keyboardShortcut(.rightArrow, modifiers: [])
                    .disabled(index == files.count - 1)
                    .accessibilityLabel("Next image")
                    .help("Next image (→)")
            }
            .padding()
            .background(ImageSwipeInput(move: move))
        }
        .frame(minWidth: 540, idealWidth: 900, maxWidth: .infinity,
               minHeight: 360, idealHeight: 650, maxHeight: .infinity)
    }

    private func move(_ delta: Int) {
        index = min(max(index + delta, 0), files.count - 1)
    }
}

/// SwiftUI's drag gesture handles a mouse drag; trackpad swipes arrive as AppKit events.
/// One transition per gesture, with momentum ignored, scoped to this sheet's window.
private struct ImageSwipeInput: NSViewRepresentable {
    let move: (Int) -> Void
    func makeNSView(context: Context) -> SwipeView { SwipeView(move: move) }
    func updateNSView(_ view: SwipeView, context: Context) { view.move = move }
    static func dismantleNSView(_ view: SwipeView, coordinator: ()) { view.stop() }

    final class SwipeView: NSView {
        var move: (Int) -> Void
        private var monitor: Any?
        private var horizontal: CGFloat = 0
        private var vertical: CGFloat = 0
        private var moved = false

        init(move: @escaping (Int) -> Void) {
            self.move = move
            super.init(frame: .zero)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.swipe, .scrollWheel]) { [weak self] event in
                guard let self, let window = self.window, event.window === window, window.isKeyWindow else { return event }
                if event.type == .swipe {
                    if abs(event.deltaX) > abs(event.deltaY), event.deltaX != 0 {
                        self.move(event.deltaX > 0 ? -1 : 1)
                        return nil
                    }
                } else if event.hasPreciseScrollingDeltas && event.momentumPhase.isEmpty {
                    if event.phase.contains(.began) {
                        self.horizontal = 0
                        self.vertical = 0
                        self.moved = false
                    }
                    self.horizontal += event.scrollingDeltaX
                    self.vertical += event.scrollingDeltaY
                    if !self.moved, abs(self.horizontal) > 60, abs(self.horizontal) > abs(self.vertical) * 1.5 {
                        self.moved = true
                        self.move(self.horizontal < 0 ? 1 : -1)
                    }
                    if abs(self.horizontal) > abs(self.vertical) { return nil }
                }
                return event
            }
        }
        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}
