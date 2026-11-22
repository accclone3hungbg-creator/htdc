import SwiftUI
import WebKit
import AVFoundation

enum AppConfig {
    /// Để "" = app chạy hoàn toàn từ bộ file nhúng trong app (khuyên dùng).
    /// Muốn app mở thẳng bản web online thì dán link vào đây, ví dụ:
    /// "https://ten-ban.github.io/ten-repo/"
    static let remoteStartURL: String = ""

    /// Trang bắt đầu khi chạy offline (bỏ qua index.html cho khỏi nháy màn hình).
    static let startPage: String = "run.html?res=auto&jar=game.jar"
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            // không có âm thanh cũng không sao, game vẫn chạy
        }
        return true
    }
}

@main
struct HaiTacApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea(.all)
                .statusBarHidden(true)
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    @State private var startURL: URL?
    @State private var errorText: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let startURL = startURL {
                GameWebView(url: startURL)
                    .ignoresSafeArea(.all)
            } else if let errorText = errorText {
                VStack(spacing: 10) {
                    Text("Không mở được game")
                        .font(.headline)
                    Text(errorText)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .opacity(0.7)
                }
                .foregroundColor(.white)
                .padding(24)
            } else {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .scaleEffect(1.4)
            }
        }
        .onAppear(perform: boot)
    }

    private func boot() {
        if !AppConfig.remoteStartURL.isEmpty, let remote = URL(string: AppConfig.remoteStartURL) {
            startURL = remote
            return
        }

        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            errorText = "Thiếu thư mục Web trong app."
            return
        }

        LocalHTTPServer.shared.start(root: webRoot) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let port):
                    startURL = URL(string: "http://127.0.0.1:\(port)/\(AppConfig.startPage)")
                case .failure(let error):
                    errorText = error.localizedDescription
                }
            }
        }
    }
}

struct GameWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(.allow)
        }
    }
}
