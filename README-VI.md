# Hải Tặc Tí Hon — bản IPA (iOS)

Bộ này là **project iOS hoàn chỉnh**: app bọc bản web J2ME (bản mới nhất, đã tối ưu cho iPhone)
thành app thật, có icon riêng, chạy toàn màn hình, không có thanh địa chỉ Safari.

Máy của mình không có macOS/Xcode nên mình không build trực tiếp .ipa tại đây được.
Cách gọn nhất, **không cần máy Mac**: để GitHub Actions build hộ (miễn phí với repo Public).

---

## 1. Đưa bộ này lên GitHub

1. Tạo repo mới trên GitHub, để **Public**.
2. Giải nén file zip này, **kéo thả TẤT CẢ** file/thư mục bên trong vào repo → Commit.
   Trong đó phải thấy: `project.yml`, `HaiTac/`, `Web/` và thư mục `.github/` (thư mục ẩn, nhớ đừng bỏ).

   > Cách chắc ăn nhất: dùng Git trên máy bạn
   > `git init && git add -A && git commit -m "ipa" && git remote add origin <link-repo> && git push -u origin main`

   ⚠️ **Lưu ý khi up bằng web (kéo thả)**: GitHub web **không nhận thư mục ẩn `.github`**.
   Nếu bạn up bằng web thì làm thêm bước này:
   - Bấm **Add file → Create new file**
   - Ô tên file, gõ đúng: `.github/workflows/build-ipa.yml`
   - Mở file `build-ipa.yml.txt` (có sẵn ở thư mục gốc), copy toàn bộ nội dung dán vào → Commit.
   
   (Nếu bạn dùng git push thì bỏ qua, thư mục `.github` đã có sẵn trong zip.)

## 2. Bấm build

1. Vào repo → tab **Actions**.
2. Nếu GitHub hỏi "I understand my workflows, go ahead and enable them" → bấm Enable.
3. Chọn workflow **Build IPA** → **Run workflow** → Run.
4. Đợi ~6–12 phút (lần đầu lâu hơn vì tải Xcode toolchain).

## 3. Tải .ipa

1. Vào lại tab **Actions** → bấm vào lần chạy vừa xong (dấu ✅).
2. Kéo xuống mục **Artifacts** → tải **HaiTac-ipa**.
3. Giải nén file vừa tải → được **HaiTac.ipa**.

> Nếu job có dấu ❌: bấm vào → mở bước bị đỏ → copy đoạn lỗi gửi mình, mình sửa.

## 4. Cài lên iPhone

File IPA này **chưa ký** (giống bản gốc bạn tự làm). Chọn 1 trong các cách:

| Cách | Ưu điểm | Lưu ý |
|---|---|---|
| **TrollStore** | Cài vĩnh viễn, không hết hạn, không cần máy tính | Chỉ máy trong dải hỗ trợ (thường iOS 14.0–16.x và một số bản 17.0) — kiểm tra theo máy bạn |
| **ESign / Feather (trên máy)** | Không cần máy tính, ký ngay trên iPhone | Cần chứng chỉ (cert) hoặc Apple ID |
| **Sideloadly / AltStore (cần máy tính)** | Dùng Apple ID free | Hết hạn sau **7 ngày**, tối đa 3 app, phải ký lại |

Cài xong: mở app → game tự chạy.

---

## Cần biết trước khi cài

- **Lần đầu mở cần mạng**: phần lõi chạy Java trong trình duyệt (JVM WebAssembly) tải runtime từ CDN
  của hãng (khoảng vài MB) rồi cache lại. Từ lần sau mở nhanh hơn nhiều.
  File game (`game.jar` 19MB, `init.zip`, các `.wasm`) thì đã nằm sẵn trong app — không tải lại.
- **Âm thanh**: iOS chặn tự phát → chạm vào màn hình 1 lần là có tiếng.
- **Cần iOS 14 trở lên** (WebAssembly + WebGL).
- Nếu máy yếu mà vẫn giật: bấm nút **⚙** (góc dưới phải) → **Độ chi tiết** hạ xuống, **FPS** 20–24.

## Muốn app mở thẳng web online (không dùng file trong app)?

Mở `HaiTac/App.swift`, sửa dòng:

```swift
static let remoteStartURL: String = ""
```

thành link web của bạn, ví dụ:

```swift
static let remoteStartURL: String = "https://ten-ban.github.io/ten-repo/"
```

rồi build lại. Khi đó app chỉ là cái vỏ mở web — nhẹ, nhưng phải có mạng.

## Cấu trúc

```
project.yml                      # khai báo project cho XcodeGen
HaiTac/
  App.swift                      # app + WKWebView
  LocalHTTPServer.swift          # web server nội bộ (127.0.0.1) phục vụ file game
  Assets.xcassets/AppIcon...     # icon app
Web/                             # toàn bộ bản web game (28MB, 30 file)
.github/workflows/build-ipa.yml   # workflow build ra .ipa
```

## Vì sao phải có "web server nội bộ"?

Game dùng ES module, `fetch()`, `WebAssembly.compileStreaming()` và `Worker`.
Mở bằng `file://` trên iOS là chặn sạch (origin null / CORS) → trắng màn hình.
Nên app tự chạy 1 server nhỏ ở `127.0.0.1` rồi trỏ WKWebView vào đó — chạy y như trên web thật.
