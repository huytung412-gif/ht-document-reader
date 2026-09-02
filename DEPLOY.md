# Đưa lên mạng để dùng mọi thiết bị (miễn phí)

Mục tiêu: có một địa chỉ web cố định (vd `https://doc-translator-xxx.onrender.com`),
mở được từ điện thoại / laptop bất kỳ, mọi mạng, không cần cài gì.
Dùng **Render.com** gói Free (không cần thẻ tín dụng).

> Đánh đổi khi chạy trên mạng:
> - Tài liệu bạn tải lên sẽ nằm trên máy chủ Render (của bạn).
> - Gói Free ngủ sau ~15 phút không dùng → lần mở kế tiếp chờ ~30–50 giây khởi động lại.
> - Bộ nhớ 512 MB: PDF scan quá nhiều trang cùng lúc có thể quá tải → chọn dải trang nhỏ.

---

## Bước 1 — Đưa mã nguồn lên GitHub

1. Tạo tài khoản GitHub (nếu chưa có): https://github.com/signup
2. Tạo repo mới trống: https://github.com/new
   - Repository name: `doc-translator`
   - Để **Public** hoặc Private đều được → **Create repository**
3. Mở **PowerShell** trong thư mục `doc-translator` (Shift + chuột phải → *Open PowerShell window here*), chạy lần lượt (thay `TEN-GITHUB` bằng tên tài khoản của bạn):

```bash
git init
git add -A
git commit -m "Doc Translator v2"
git branch -M main
git remote add origin https://github.com/TEN-GITHUB/doc-translator.git
git push -u origin main
```

Lần đầu `git push` sẽ hỏi đăng nhập GitHub — làm theo hướng dẫn hiện ra
(thường mở trình duyệt để xác thực).

---

## Bước 2 — Tạo dịch vụ trên Render

1. Tạo tài khoản: https://render.com  → chọn **Sign in with GitHub**.
2. Bảng điều khiển → **New +** → **Web Service**.
3. Chọn repo `doc-translator` vừa đẩy lên → **Connect**.
4. Render tự nhận cấu hình. Kiểm tra cho đúng:
   - **Language / Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Bấm **Create Web Service**. Chờ 3–7 phút build lần đầu.
6. Xong sẽ có địa chỉ dạng `https://doc-translator-xxxx.onrender.com`.

Mở địa chỉ đó trên **mọi thiết bị**. Xong.

---

## Bước 3 — Biến thành "app" trên điện thoại / máy tính

- **Android / Chrome**: mở địa chỉ → menu ⋮ → **Cài đặt ứng dụng / Add to Home screen**.
- **iPhone / Safari**: mở địa chỉ → nút Chia sẻ → **Thêm vào MH chính**.
- **PC / Chrome hoặc Edge**: biểu tượng ⊕ ở thanh địa chỉ → **Cài đặt**.

Sẽ có icon riêng, mở ra chạy toàn màn hình như app thật.

---

## Cập nhật về sau

Sửa code xong, trong PowerShell chạy:

```bash
git add -A
git commit -m "cap nhat"
git push
```

Render tự build lại và cập nhật trong vài phút.

---

## Đăng nhập & duyệt người dùng

- Vào app phải đăng nhập bằng email + mật khẩu. Người mới đăng ký ở trạng thái
  **chờ duyệt**; admin (`huytung412@gmail.com` hoặc `huytung410@gmail.com`) bấm
  **👥 Người dùng → Duyệt** thì tài khoản đó mới dùng được.
- **Lưu ý gói Free**: danh sách người dùng (`data/users.json`) nằm trên ổ đĩa tạm,
  **bị xoá mỗi lần deploy lại**. Sau khi cập nhật code, admin đăng nhập lại (tự
  được duyệt) rồi duyệt lại các tài khoản.
- **Cách giữ danh sách duyệt qua các lần deploy**: trên Render → service → **Environment**
  → sửa biến **`PREAPPROVED_EMAILS`**, điền các email cần cho phép, cách nhau bằng
  dấu phẩy. Ví dụ: `a@gmail.com, b@company.com`. Các email này luôn được duyệt sẵn.
- Muốn danh sách người dùng lưu vĩnh viễn: nâng lên gói **Starter ($7/tháng)** + gắn
  **Persistent Disk** mount vào thư mục `data`.

### Bật "Đăng nhập bằng Google" (1 chạm bằng tài khoản có sẵn trong máy)

1. Vào https://console.cloud.google.com/apis/credentials (đăng nhập Google).
2. Tạo project mới (nếu chưa có) → **Create Credentials** → **OAuth client ID**.
   - Nếu bị hỏi "Configure consent screen": chọn **External** → điền tên app, email hỗ trợ,
     lưu; phần Scopes/Test users bỏ qua được.
3. **Application type**: **Web application**.
4. **Authorized JavaScript origins** → **Add URI**, thêm:
   - `https://ht-document-reader.onrender.com`
   - (nếu chạy máy) `http://localhost:8756`
5. **Create** → copy chuỗi **Client ID** (dạng `xxxxx.apps.googleusercontent.com`).
6. Trên Render → service → **Environment** → sửa biến **`GOOGLE_CLIENT_ID`** = chuỗi vừa copy → **Save** (Render tự deploy lại).
7. Xong: trang đăng nhập hiện nút **"Tiếp tục với Google"** + gợi ý tài khoản đã đăng nhập sẵn.
   (Người đăng nhập Google lần đầu vẫn ở trạng thái chờ admin duyệt như thường.)

## Nếu muốn KHÔNG ngủ + địa chỉ đẹp

- Render gói trả phí ~7 USD/tháng: chạy 24/7 không ngủ, có ổ đĩa lưu vĩnh viễn
  (giữ bộ nhớ đệm bản dịch giữa các lần khởi động).
- Hoặc trỏ tên miền riêng của bạn vào (Settings → Custom Domain), miễn phí.

## Lựa chọn host khác (tương tự)

`Railway.app`, `Koyeb.com`, `Fly.io` — cùng cách: kết nối repo GitHub, chạy
`npm install` + `npm start`. File `render.yaml` chỉ dùng cho Render.
