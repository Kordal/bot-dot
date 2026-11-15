import SwiftUI
import UIKit
import BotdotShared

extension EnvironmentValues {
    /// A tap on a file under a reply: the chat opens it in the viewer.
    @Entry var openReplyFile: ((Attachment) -> Void)? = nil
    /// Where the pictures under replies are downloaded and kept.
    @Entry var replyPictures: ReplyPictures? = nil
}

extension View {
    /// The chat's files under replies: pictures saved in the app's caches, a tap opens one in the viewer ([opening]).
    func replyFiles(api: Api, from: String, opening: Binding<DocumentView.Opening?>) -> some View {
        environment(\.replyPictures, ReplyPictures(api: api, root: ReplyPictures.cache.path))
            .environment(\.openReplyFile) { opening.wrappedValue = ReplyFiles.shared.opening(f: $0, from: from) }
    }
}

extension ReplyPictures {
    /// Where the pictures under replies are kept: a folder per botdot and session inside (ReplyPictures.place).
    static let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("reply-pictures")

    /// Signed out, or in (another account may be next): every picture gone.
    static func forgetAll() { ReplyPictures.companion.forget(root: cache.path) }
}

/// The files under a reply (ReplyFiles): pictures as themselves, the rest as chips; a tap opens one in the viewer.
struct ReplyFilesView: View {
    let files: [Attachment]
    @Environment(\.openReplyFile) private var open

    var body: some View {
        if !files.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(ReplyFiles.shared.pictures(files: files), id: \.file) { ReplyPicture(file: $0) }
                ForEach(ReplyFiles.shared.others(files: files), id: \.self) { f in
                    if ReplyFiles.shared.opens(f: f), let open {
                        Button { open(f) } label: { Label(f.name, systemImage: "doc").font(.callout) }
                    } else {
                        Label(f.name, systemImage: "doc").font(.callout)
                    }
                }
            }
        }
    }
}

/// A picture under a reply, drawn at the size it is shown; its name until it has come.
struct ReplyPicture: View {
    let file: Attachment
    @Environment(\.replyPictures) private var pictures
    @Environment(\.openReplyFile) private var open
    @State private var image: UIImage?

    var body: some View {
        Button { open?(file) } label: {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: 300, maxHeight: 360, alignment: .leading)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel(file.name)
            } else {
                Label(file.name, systemImage: "photo").font(.callout)
            }
        }
        .buttonStyle(.plain)
        .task(id: file.file) {
            guard image == nil, let pictures, let path = try? await pictures.picture(f: file) else { return }
            image = await Task.detached { UIImage(contentsOfFile: path)?.preparingThumbnail(of: CGSize(width: 600, height: 720)) }.value
        }
    }
}
