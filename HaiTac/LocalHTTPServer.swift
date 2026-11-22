import Foundation
import Network

/// Web server mini chạy trong app (chỉ 127.0.0.1).
/// Lý do phải có: game dùng ES module + WebAssembly + Worker + fetch().
/// Nếu mở file:// thì iOS chặn hết (CORS / origin null) -> phải phục vụ qua http.
final class LocalHTTPServer {

    static let shared = LocalHTTPServer()

    private let queue = DispatchQueue(label: "haitac.http", qos: .userInitiated, attributes: .concurrent)
    private var listener: NWListener?
    private var rootPath: String = ""
    private(set) var port: UInt16 = 0

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "htm":  "text/html; charset=utf-8",
        "js":   "text/javascript; charset=utf-8",
        "mjs":  "text/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
        "css":  "text/css; charset=utf-8",
        "wasm": "application/wasm",
        "jar":  "application/java-archive",
        "zip":  "application/zip",
        "png":  "image/png",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "gif":  "image/gif",
        "svg":  "image/svg+xml",
        "ico":  "image/x-icon",
        "txt":  "text/plain; charset=utf-8",
        "mp3":  "audio/mpeg",
        "ogg":  "audio/ogg",
        "wav":  "audio/wav",
        "ttf":  "font/ttf",
        "woff": "font/woff",
        "woff2": "font/woff2"
    ]

    func start(root: URL, completion: @escaping (Result<UInt16, Error>) -> Void) {
        rootPath = root.standardizedFileURL.path
        var candidates: [UInt16] = []
        for p in UInt16(8787)...UInt16(8810) { candidates.append(p) }
        tryNext(candidates, index: 0, completion: completion)
    }

    private func tryNext(_ ports: [UInt16], index: Int, completion: @escaping (Result<UInt16, Error>) -> Void) {
        guard index < ports.count else {
            completion(.failure(NSError(domain: "haitac.http", code: -1,
                                        userInfo: [NSLocalizedDescriptionKey: "no free port"])))
            return
        }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.acceptLocalOnly = true

        guard let nwPort = NWEndpoint.Port(rawValue: ports[index]),
              let l = try? NWListener(using: params, on: nwPort) else {
            tryNext(ports, index: index + 1, completion: completion)
            return
        }

        var done = false
        l.stateUpdateHandler = { [weak self] state in
            guard let self = self, !done else { return }
            switch state {
            case .ready:
                done = true
                self.listener = l
                self.port = l.port?.rawValue ?? ports[index]
                completion(.success(self.port))
            case .failed, .cancelled:
                done = true
                self.tryNext(ports, index: index + 1, completion: completion)
            default:
                break
            }
        }
        l.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }
        l.start(queue: queue)
    }

    // MARK: - Connection

    private func accept(_ conn: NWConnection) {
        conn.stateUpdateHandler = { state in
            switch state {
            case .failed, .cancelled:
                conn.cancel()
            default:
                break
            }
        }
        conn.start(queue: queue)
        receiveRequest(conn, buffer: Data())
    }

    private func receiveRequest(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { conn.cancel(); return }
            var buf = buffer
            if let d = data { buf.append(d) }

            let terminator = Data("\r\n\r\n".utf8)
            if let range = buf.range(of: terminator) {
                let head = String(decoding: buf[buf.startIndex..<range.lowerBound], as: UTF8.self)
                self.respond(conn, requestHead: head)
                return
            }
            if isComplete || error != nil || buf.count > 262_144 {
                conn.cancel()
                return
            }
            self.receiveRequest(conn, buffer: buf)
        }
    }

    // MARK: - Response

    private func respond(_ conn: NWConnection, requestHead: String) {
        let lines = requestHead.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { conn.cancel(); return }
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else { conn.cancel(); return }

        let method = parts[0].uppercased()
        var rawPath = parts[1]
        if let q = rawPath.firstIndex(of: "?") { rawPath = String(rawPath[..<q]) }
        if let h = rawPath.firstIndex(of: "#") { rawPath = String(rawPath[..<h]) }

        var rel = rawPath.removingPercentEncoding ?? rawPath
        while rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "index.html" }
        if rel.hasSuffix("/") { rel += "index.html" }

        let rootURL = URL(fileURLWithPath: rootPath).standardizedFileURL
        let target = rootURL.appendingPathComponent(rel).standardizedFileURL

        guard target.path == rootURL.path || target.path.hasPrefix(rootURL.path + "/") else {
            sendSimple(conn, status: "403 Forbidden", body: "403")
            return
        }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: target.path, isDirectory: &isDir) else {
            sendSimple(conn, status: "404 Not Found", body: "404")
            return
        }

        var fileURL = target
        if isDir.boolValue { fileURL = target.appendingPathComponent("index.html") }
        guard let fh = try? FileHandle(forReadingFrom: fileURL) else {
            sendSimple(conn, status: "500 Internal Server Error", body: "500")
            return
        }

        let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attrs?[.size] as? NSNumber)?.uint64Value ?? 0
        let mime = Self.mimeTypes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"

        var header = "HTTP/1.1 200 OK\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(size)\r\n"
        header += "Cache-Control: no-cache\r\n"
        header += "Accept-Ranges: none\r\n"
        header += "Connection: close\r\n\r\n"

        if method == "HEAD" {
            conn.send(content: Data(header.utf8), completion: .contentProcessed { _ in
                fh.closeFile()
                conn.cancel()
            })
            return
        }

        let headerData = Data(header.utf8)
        conn.send(content: headerData, completion: .contentProcessed { [weak self] err in
            if err != nil {
                fh.closeFile()
                conn.cancel()
                return
            }
            self?.streamFile(conn, handle: fh)
        })
    }

    private func streamFile(_ conn: NWConnection, handle: FileHandle) {
        let chunk = handle.readData(ofLength: 262_144)
        if chunk.isEmpty {
            handle.closeFile()
            conn.send(content: nil,
                      contentContext: .finalMessage,
                      isComplete: true,
                      completion: .contentProcessed { _ in conn.cancel() })
            return
        }
        conn.send(content: chunk, completion: .contentProcessed { [weak self] err in
            if err != nil {
                handle.closeFile()
                conn.cancel()
                return
            }
            self?.streamFile(conn, handle: handle)
        })
    }

    private func sendSimple(_ conn: NWConnection, status: String, body: String) {
        let payload = Data(body.utf8)
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: text/plain; charset=utf-8\r\n"
        header += "Content-Length: \(payload.count)\r\n"
        header += "Connection: close\r\n\r\n"
        var out = Data(header.utf8)
        out.append(payload)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }
}
