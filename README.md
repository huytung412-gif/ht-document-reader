# HT Document Reader

Đọc tài liệu kỹ thuật tiếng Anh cạnh bản dịch tiếng Việt. Màn hình chia đôi:
**trái = bản gốc, phải = bản dịch**. Cuộn một bên, bên kia bám theo đúng đoạn.

- **PDF**: mở tức thì, xem **ảnh nguyên trang gốc** (giữ hình, bảng, bố cục) hoặc chế độ **chỉ chữ**.
- Chọn **dải trang** muốn dịch (vd trang 5–12) — không phải chờ cả file.
- **PDF scan**: tự nhận dạng chữ (OCR) cho dải trang đang xem.
- **Word .docx**, **.txt**, **.md**: hiển thị dạng chữ.
- Dịch miễn phí (Google → tự chuyển MyMemory khi lỗi); tuỳ chọn dán key **DeepL / Claude / OpenAI**.
- Bản dịch được **lưu đệm** → mở lại là hiện ngay.
- Cài được như **app** (PWA): điện thoại "Thêm vào màn hình chính", PC bấm "Cài đặt" trên Chrome/Edge.

## Chạy trên máy (Windows)

1. Cài **Node.js** bản LTS: https://nodejs.org
2. Nháy đúp **`start.bat`**. Lần đầu tự tải thư viện (~1–2 phút), rồi mở trình duyệt.
3. Nếu không tự mở: vào `http://localhost:8756`.

Cửa sổ đen phải để mở suốt lúc dùng. Đóng nó = tắt phần mềm.

**Chạy thủ công (xem lỗi):** mở PowerShell trong thư mục này → `npm install` → `npm start`.

## Dùng từ thiết bị khác trong cùng WiFi

Trong cửa sổ đen có dòng `Thiết bị cùng mạng: http://192.168.x.x:8756` — gõ địa chỉ đó
vào trình duyệt điện thoại/laptop khác. Lần đầu Windows hỏi Firewall → **Allow access**.

## Dùng mọi thiết bị, mọi mạng (đưa lên web miễn phí)

Xem **[DEPLOY.md](DEPLOY.md)** — hướng dẫn đưa lên Render.com (gói Free) để có địa chỉ
web cố định, chạy 24/7, mở từ bất kỳ đâu.

## Cách dùng nhanh

| Thao tác | |
|---|---|
| Mở file | Kéo thả, hoặc nút **Mở tài liệu** |
| PDF: chọn trang | Ô **Trang [ ]–[ ]** + **Xem**; nút ◀ ▶ để sang dải trước/sau |
| Đổi kiểu xem PDF | **🖼 Ảnh gốc** / **📝 Chỉ chữ** |
| Phóng to ảnh trang | **🔍− 🔍+** |
| Dịch phần đang xem | **⚡ Dịch dải trang này** |
| Dịch cả file (chạy nền) | **📦 Dịch toàn bộ** — mở xem bản gốc trước, khi cần thì bấm để dịch hết |
| Lưu bản dịch ra file | **💾 Lưu file ▾** → **Song ngữ (.html)** hoặc **Chỉ bản dịch (.txt)**. Nếu đã bấm *Dịch toàn bộ* thì lưu cả file, chưa thì lưu phần đang xem |
| Cỡ chữ bản dịch | **A− A+** |
| Cuộn 2 bên rời nhau | bỏ tick **Cuộn đồng bộ** |
| Kéo đường giữa | đổi tỉ lệ 2 cột |
| Bấm 1 đoạn | tô sáng đoạn tương ứng bên kia |
| Đoạn dịch lỗi (đỏ) | bấm vào để dịch lại |
| **💾 Lưu .html** | xuất bản song ngữ (gốc \| dịch) của dải trang đang xem |

## Ghi chú kỹ thuật

| Việc | Thư viện |
|---|---|
| Đọc chữ PDF + render ảnh trang | `mupdf` (WASM) |
| OCR trang scan | `tesseract.js` (tải dữ liệu tiếng Anh lần đầu) |
| Đọc Word .docx | `mammoth` |
| Máy chủ | `express` + `multer` |

- `uploads/` giữ file PDF gốc (theo mã băm nội dung) để render ảnh trang khi cần.
- `cache/img`, `cache/txt`, `cache/translations.json` là bộ nhớ đệm — xoá lúc nào cũng được.
- File **.doc** (Word cũ): mở bằng Word, lưu lại thành `.docx`.
- Đổi cổng: đặt biến môi trường `PORT`.
