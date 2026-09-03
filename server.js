import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openPdf,
  pdfPageBlocks,
  pdfPageImage,
  ocrPdfPages,
  extractNonPdf,
  kindOf,
} from "./lib/extract.js";
import { translateMany } from "./lib/translate.js";
import * as auth from "./lib/auth.js";
import { sendMail, mailEnabled, mailMode } from "./lib/mailer.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UP = path.join(ROOT, "uploads");
const IMGC = path.join(ROOT, "cache", "img");
const TXTC = path.join(ROOT, "cache", "txt");
for (const d of [UP, IMGC, TXTC]) fs.mkdirSync(d, { recursive: true });

const PORT = process.env.PORT || 8756;
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(ROOT, "public")));

/* ---------------- Đăng nhập / phân quyền ---------------- */
function getToken(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)dt_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
const SESSION_MAX_AGE = 400 * 24 * 3600; // ~13 tháng
function setSessionCookie(req, res, token) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `dt_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`
  );
}
// ---- Chặn dò mật khẩu: giới hạn số lần thử theo IP ----
const attempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (now - a.first > 15 * 60 * 1000) attempts.delete(k);
}, 5 * 60 * 1000).unref();
function tooMany(key, max = 12, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || now - a.first > windowMs) { a = { n: 0, first: now }; attempts.set(key, a); }
  a.n++;
  return a.n > max;
}
function clearTries(key) { attempts.delete(key); }

// Làm mới cookie phiên, nhúng "đã duyệt" để người dùng vào thẳng các lần sau
// (kể cả khi máy chủ deploy lại làm mất danh sách người dùng).
function refreshApproved(req, res, email) {
  try { setSessionCookie(req, res, auth.sign(email, true)); } catch {}
}

function requireApproved(req, res, next) {
  const u = auth.currentUser(getToken(req));
  if (!u) return res.status(401).json({ error: "Cần đăng nhập." });
  if (u.status !== "approved")
    return res.status(403).json({ error: "Tài khoản đang chờ admin duyệt." });
  req.user = u;
  refreshApproved(req, res, u.email);
  next();
}
function requireAdmin(req, res, next) {
  requireApproved(req, res, () => {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Chỉ admin mới được." });
    next();
  });
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.headers.host}`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function htmlPage(title, msg, color, extra = "") {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:420px;margin:56px auto;text-align:center;padding:32px;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 6px 22px rgba(0,0,0,.1)">
<h2 style="color:${color};margin:0 0 8px">${esc(title)}</h2><p style="color:#374151">${esc(msg)}</p>${extra}
<p style="margin-top:18px"><a href="/" style="color:#2563eb;font-weight:600">Mở HT Document Reader</a></p></div>`;
}
async function notifyAdmins(req, u) {
  if (!mailEnabled || u.status === "approved") return;
  const base = appUrl(req);
  const tok = encodeURIComponent(auth.actionToken(u.email, u.createdAt));
  const approve = `${base}/api/admin/action?do=approve&token=${tok}`;
  const reject = `${base}/api/admin/action?do=reject&token=${tok}`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1f2b;line-height:1.6">
    <h2 style="color:#2563eb;margin:0 0 6px">Yêu cầu truy cập HT Document Reader</h2>
    <p><b>${esc(u.email)}</b> vừa đăng ký và đang <b>chờ duyệt</b>.</p>
    <p style="margin:20px 0">
      <a href="${approve}" style="background:#16a34a;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;margin-right:12px">✔ DUYỆT</a>
      <a href="${reject}" style="background:#dc2626;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700">✘ TỪ CHỐI</a>
    </p>
    <p style="color:#6b7280;font-size:12px">Bấm nút là xong, không cần mở app. Hoặc vào app → nút “👥 Người dùng”.</p>
  </div>`;
  try {
    await sendMail(auth.ADMIN_EMAILS.join(","), `[HT Reader] ${u.email} xin quyền truy cập`, html);
  } catch (e) {
    console.warn("Gửi email admin lỗi:", e.message);
  }
}

app.post("/api/auth/register", async (req, res) => {
  const key = "reg:" + (req.ip || "?");
  if (tooMany(key, 6))
    return res.status(429).json({ error: "Đăng ký quá nhiều lần. Thử lại sau." });
  try {
    const u = auth.register(req.body?.email, req.body?.password);
    setSessionCookie(req, res, auth.sign(u.email, u.status === "approved"));
    notifyAdmins(req, u);
    res.json({ email: u.email, status: u.status, role: u.role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/admin/action", (req, res) => {
  const page = (title, msg, color) =>
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:460px;margin:56px auto;text-align:center;padding:32px;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 6px 22px rgba(0,0,0,.1)">
<h2 style="color:${color};margin:0 0 8px">${esc(title)}</h2><p style="color:#374151">${esc(msg)}</p>
<p style="margin-top:18px"><a href="/" style="color:#2563eb;font-weight:600">Mở HT Document Reader</a></p></div>`;
  const t = auth.verifyActionToken(req.query.token);
  if (!t) return res.status(400).send(page("Link không hợp lệ", "Liên kết đã hỏng.", "#dc2626"));
  const u = auth.getUser(t.email);
  if (!u || (u.createdAt || 0) !== t.createdAt)
    return res.status(410).send(page("Không áp dụng được", "Tài khoản không còn hoặc đã đăng ký lại.", "#dc2626"));
  if (u.role === "admin")
    return res.send(page("Bỏ qua", "Đây là tài khoản admin, không cần duyệt.", "#6b7280"));
  try {
    if (req.query.do === "approve") {
      auth.setStatus(t.email, "approved");
      return res.send(page("Đã duyệt ✔", `${t.email} giờ đã dùng được app.`, "#16a34a"));
    }
    if (req.query.do === "reject") {
      auth.removeUser(t.email);
      return res.send(page("Đã từ chối ✘", `Đã xoá yêu cầu của ${t.email}.`, "#dc2626"));
    }
    return res.status(400).send(page("Thiếu hành động", "Không rõ duyệt hay từ chối.", "#dc2626"));
  } catch (e) {
    return res.status(500).send(page("Lỗi", e.message, "#dc2626"));
  }
});
// ---- Quên mật khẩu (chỉ cho tài khoản đăng nhập bằng mật khẩu) ----
app.post("/api/auth/forgot", async (req, res) => {
  const key = "forgot:" + (req.ip || "?");
  if (tooMany(key, 6)) return res.status(429).json({ error: "Thử lại sau ~10 phút." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const u = auth.getUser(email);
  if (u && u.hash && mailEnabled) {
    try {
      const link = `${appUrl(req)}/api/auth/reset?token=${encodeURIComponent(auth.resetToken(email))}`;
      await sendMail(
        email,
        "[HT Reader] Đặt lại mật khẩu",
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Có yêu cầu đặt lại mật khẩu cho tài khoản <b>${esc(email)}</b> trên HT Document Reader.</p>
        <p style="margin:18px 0"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700">Đặt mật khẩu mới</a></p>
        <p style="color:#6b7280;font-size:12px">Link có hiệu lực 1 giờ. Không phải bạn thì bỏ qua email này.</p></div>`
      );
    } catch (e) {
      console.warn("Gửi email đặt lại mật khẩu lỗi:", e.message);
    }
  }
  res.json({ ok: true }); // luôn ok để không lộ email nào có tài khoản
});

app.get("/api/auth/reset", (req, res) => {
  const email = auth.verifyResetToken(req.query.token);
  if (!email)
    return res.status(400).send(htmlPage("Link không hợp lệ hoặc đã hết hạn", "Hãy yêu cầu lại từ trang đăng nhập.", "#dc2626"));
  res.send(
    htmlPage("Đặt mật khẩu mới", `Cho tài khoản ${email}`, "#2563eb",
      `<form method="POST" action="/api/auth/reset" style="margin-top:14px">
       <input type="hidden" name="token" value="${esc(req.query.token)}">
       <input type="password" name="password" placeholder="Mật khẩu mới (ít nhất 6 ký tự)" required minlength="6"
         style="width:100%;height:42px;padding:0 12px;border:1px solid #d7dae0;border-radius:10px;font-size:14px;box-sizing:border-box">
       <button style="width:100%;height:44px;margin-top:12px;background:#2563eb;color:#fff;border:0;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer">Lưu mật khẩu mới</button>
     </form>`)
  );
});

app.post("/api/auth/reset", express.urlencoded({ extended: false }), (req, res) => {
  const email = auth.verifyResetToken(req.body.token);
  if (!email)
    return res.status(400).send(htmlPage("Link không hợp lệ hoặc đã hết hạn", "Hãy yêu cầu lại.", "#dc2626"));
  try {
    auth.forceSetPassword(email, req.body.password);
    res.send(htmlPage("Đã đổi mật khẩu ✔", "Quay lại app và đăng nhập bằng mật khẩu mới.", "#16a34a"));
  } catch (e) {
    res.status(400).send(htmlPage("Lỗi", e.message, "#dc2626"));
  }
});

app.post("/api/auth/login", (req, res) => {
  const key = "login:" + (req.ip || "?");
  if (tooMany(key))
    return res.status(429).json({ error: "Thử quá nhiều lần. Đợi ~10 phút rồi thử lại." });
  try {
    const u = auth.login(req.body?.email, req.body?.password);
    clearTries(key);
    setSessionCookie(req, res, auth.sign(u.email, u.status === "approved"));
    res.json({ email: u.email, status: u.status, role: u.role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/password", requireApproved, (req, res) => {
  try {
    auth.changePassword(req.user.email, req.body?.current, req.body?.next);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", "dt_session=; Path=/; HttpOnly; Max-Age=0");
  res.json({ ok: true });
});

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
app.get("/api/config", (_req, res) =>
  res.json({ googleClientId: GOOGLE_CLIENT_ID, mailEnabled })
);

// Xác thực credential (JWT) từ Google, trả về claims hoặc null.
async function verifyGoogleCred(cred) {
  if (!GOOGLE_CLIENT_ID || !cred) return null;
  const r = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(cred)
  );
  const info = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  if (info.aud !== GOOGLE_CLIENT_ID) return null;
  if (info.iss !== "accounts.google.com" && info.iss !== "https://accounts.google.com")
    return null;
  if (!info.email || String(info.email_verified) !== "true") return null;
  if (info.exp && Date.now() / 1000 > Number(info.exp) + 60) return null;
  return info;
}

async function finishGoogle(req, res, info, redirect) {
  const before = auth.getUser(info.email);
  const u = auth.upsertOAuth(info.email);
  setSessionCookie(req, res, auth.sign(u.email, u.status === "approved"));
  if (!before && u.status !== "approved") notifyAdmins(req, u);
  if (redirect) return res.redirect("/?signedin=1");
  res.json({ email: u.email, status: u.status, role: u.role });
}

// Chế độ popup (fetch JSON)
app.post("/api/auth/google", async (req, res) => {
  try {
    const info = await verifyGoogleCred(req.body?.credential);
    if (!info) return res.status(401).json({ error: "Xác thực Google thất bại." });
    await finishGoogle(req, res, info, false);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Lỗi đăng nhập Google." });
  }
});

// Chế độ redirect (Google POST form-encoded thẳng vào đây) — ổn định trên điện thoại
app.post(
  "/api/auth/google-redirect",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const m = (req.headers.cookie || "").match(/(?:^|;\s*)g_csrf_token=([^;]+)/);
      const cookieTok = m ? decodeURIComponent(m[1]) : "";
      if (!cookieTok || !req.body.g_csrf_token || cookieTok !== req.body.g_csrf_token)
        return res.status(400).send("Yêu cầu không hợp lệ (CSRF).");
      const info = await verifyGoogleCred(req.body.credential);
      if (!info)
        return res
          .status(401)
          .send("<p>Xác thực Google thất bại. <a href='/'>Quay lại</a></p>");
      await finishGoogle(req, res, info, true);
    } catch (e) {
      console.error(e);
      res.status(500).send("Lỗi: " + e.message);
    }
  }
);
app.get("/api/auth/me", (req, res) => {
  const u = auth.currentUser(getToken(req));
  if (!u) return res.status(401).json({ error: "chưa đăng nhập" });
  if (u.status === "approved") refreshApproved(req, res, u.email);
  res.json({ email: u.email, status: u.status, role: u.role });
});

app.get("/api/admin/users", requireAdmin, (_req, res) =>
  res.json({ users: auth.listUsers() })
);
app.post("/api/admin/set", requireAdmin, (req, res) => {
  try {
    auth.setStatus(req.body?.email, req.body?.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/admin/delete", requireAdmin, (req, res) => {
  try {
    auth.removeUser(req.body?.email);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/admin/test-mail", requireAdmin, async (req, res) => {
  if (!mailEnabled)
    return res.json({
      ok: false,
      error:
        "Chưa cấu hình gửi mail. Đặt BREVO_API_KEY (khuyên dùng) hoặc RESEND_API_KEY, hoặc SMTP_USER+SMTP_PASS trên Render.",
    });
  try {
    await sendMail(
      auth.ADMIN_EMAILS.join(","),
      "[HT Reader] Email thử nghiệm",
      `<p style="font-family:Segoe UI,Arial,sans-serif">Nếu bạn nhận được email này, chức năng gửi email báo admin đang <b>hoạt động tốt</b>. ✔ (kênh gửi: ${mailMode})</p>`
    );
    res.json({ ok: true, mode: mailMode });
  } catch (e) {
    res.json({ ok: false, mode: mailMode, error: e.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
});

// docId -> { name, kind, pages, buffer, pdf, atime, blocks? }
const mem = new Map();
const FILE_TTL = 3 * 60 * 60 * 1000; // tự xoá file tải lên sau ~3 giờ không dùng

function purgeDocFiles(id) {
  const targets = [
    path.join(UP, id + ".bin"),
    path.join(UP, id + ".json"),
    path.join(IMGC, id),
    path.join(TXTC, id),
  ];
  for (const t of targets) {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch {}
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [id, d] of mem) {
    if (now - d.atime > 15 * 60 * 1000) { d.pdf = null; d.buffer = null; }
    if (now - d.atime > FILE_TTL) { mem.delete(id); purgeDocFiles(id); }
  }
  // Quét cả file mồ côi trên đĩa (server khởi động lại làm mất mem).
  try {
    for (const f of fs.readdirSync(UP)) {
      if (!f.endsWith(".bin")) continue;
      const p = path.join(UP, f);
      if (now - fs.statSync(p).mtimeMs > FILE_TTL) purgeDocFiles(f.replace(/\.bin$/, ""));
    }
  } catch {}
}, 10 * 60 * 1000).unref();

function getEntry(docId) {
  const d = mem.get(docId);
  if (!d) return null;
  d.atime = Date.now();
  if (d.kind === "pdf" && !d.pdf) {
    const binPath = path.join(UP, docId + ".bin");
    if (!d.buffer && fs.existsSync(binPath)) d.buffer = fs.readFileSync(binPath);
    if (d.buffer) d.pdf = openPdf(d.buffer).doc;
  }
  return d;
}

function rehydrateFromDisk(docId) {
  const metaPath = path.join(UP, docId + ".json");
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const entry = { ...meta, buffer: null, pdf: null, atime: Date.now() };
  mem.set(docId, entry);
  return getEntry(docId);
}

// ---------------- Mở tài liệu ----------------
app.post("/api/open", requireApproved, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Chưa chọn file." });
    const buf = req.file.buffer;
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const kind = kindOf(name);
    if (kind === "doc" || kind === "ppt")
      return res.status(400).json({
        error:
          "File Office đời cũ (.doc / .ppt) chưa hỗ trợ. Mở bằng Office rồi lưu lại thành .docx / .pptx.",
      });

    const docId = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);

    let entry = mem.get(docId) || rehydrateFromDisk(docId);
    if (!entry) {
      if (kind === "pdf") {
        const { pages } = openPdf(buf);
        fs.writeFileSync(path.join(UP, docId + ".bin"), buf);
        entry = { name, kind, pages, buffer: buf, pdf: null, atime: Date.now() };
        fs.writeFileSync(
          path.join(UP, docId + ".json"),
          JSON.stringify({ name, kind, pages })
        );
      } else {
        const parsed = await extractNonPdf(kind, buf);
        entry = {
          name,
          kind: parsed.kind,
          pages: null,
          blocks: parsed.blocks,
          atime: Date.now(),
        };
        fs.writeFileSync(
          path.join(UP, docId + ".json"),
          JSON.stringify({
            name,
            kind: parsed.kind,
            pages: null,
            blocks: parsed.blocks,
          })
        );
      }
      mem.set(docId, entry);
    }

    res.json({
      docId,
      name: entry.name,
      kind: entry.kind,
      pages: entry.pages,
      blocks: entry.blocks || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Lỗi đọc tài liệu." });
  }
});

// ---------------- Ảnh 1 trang PDF ----------------
app.get("/api/page-image/:docId/:page", requireApproved, (req, res) => {
  try {
    const docId = req.params.docId;
    const page = parseInt(req.params.page, 10); // 1-indexed
    const scale = Math.min(3, Math.max(0.6, parseFloat(req.query.scale) || 1.6));
    const entry = getEntry(docId) || rehydrateFromDisk(docId);
    if (!entry || entry.kind !== "pdf")
      return res.status(404).end("not a pdf");
    if (page < 1 || page > entry.pages) return res.status(404).end("range");

    const dir = path.join(IMGC, docId);
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${page}_${scale}.png`);
    if (!fs.existsSync(fp)) {
      const png = pdfPageImage(entry.pdf, page - 1, scale);
      fs.writeFileSync(fp, png);
    }
    res.set("Cache-Control", "public, max-age=86400");
    res.type("png").send(fs.readFileSync(fp));
  } catch (e) {
    console.error(e);
    res.status(500).end(e.message);
  }
});

// ---------------- Text của một dải trang ----------------
app.post("/api/pages-text", requireApproved, async (req, res) => {
  try {
    const { docId } = req.body || {};
    let from = parseInt(req.body.from, 10);
    let to = parseInt(req.body.to, 10);
    const entry = getEntry(docId) || rehydrateFromDisk(docId);
    if (!entry || entry.kind !== "pdf")
      return res.status(404).json({ error: "Không tìm thấy PDF. Hãy mở lại." });

    from = Math.max(1, from || 1);
    to = Math.min(entry.pages, to || from);
    if (to < from) to = from;

    const dir = path.join(TXTC, docId);
    fs.mkdirSync(dir, { recursive: true });

    const pages = [];
    const scanned = [];
    for (let p = from; p <= to; p++) {
      const fp = path.join(dir, p + ".v3.json");
      let rec;
      if (fs.existsSync(fp)) {
        rec = JSON.parse(fs.readFileSync(fp, "utf8"));
      } else {
        const raw = pdfPageBlocks(entry.pdf, p - 1);
        rec = {
          page: p,
          pageW: raw.pageW,
          pageH: raw.pageH,
          rawLen: raw.rawLen,
          blocks: raw.blocks.map((b, k) => ({
            i: `${p}:${k}`, page: p, text: b.text, bbox: b.bbox,
          })),
        };
        fs.writeFileSync(fp, JSON.stringify(rec));
      }
      if ((rec.rawLen || 0) < 12) {
        if (!scanned.includes(p)) scanned.push(p);
      }
      pages.push(rec);
    }

    // OCR các trang không có sẵn chữ (bản scan).
    // Máy chủ gói free (CPU ~0.1) OCR cực chậm -> request sẽ timeout. Vì vậy
    // MẶC ĐỊNH để trình duyệt người dùng tự OCR (nhanh hơn nhiều). Chỉ OCR ở
    // máy chủ khi bật SERVER_OCR=1 (chạy local / máy mạnh).
    const serverOcr = process.env.SERVER_OCR === "1";
    const clientOcr = !serverOcr && scanned.length > 0;
    const OCR_MAX = 20;
    let ocrNote = null;
    let ocrList = serverOcr ? scanned : [];
    if (serverOcr && scanned.length > OCR_MAX) {
      ocrList = scanned.slice(0, OCR_MAX);
      ocrNote =
        `Tài liệu là bản scan. Mỗi lượt chỉ nhận dạng ${OCR_MAX} trang. ` +
        `Đã xử lý tới trang ${ocrList[ocrList.length - 1]}; hãy mở dải trang nhỏ hơn.`;
    }
    if (ocrList.length) {
      try {
        if (!entry.buffer) {
          const bp = path.join(UP, docId + ".bin");
          if (fs.existsSync(bp)) entry.buffer = fs.readFileSync(bp);
        }
        const map = await ocrPdfPages(
          entry.buffer,
          ocrList.map((p) => p - 1)
        );
        for (const pg of pages) {
          const arr = map.get(pg.page - 1);
          if (arr && arr.length) {
            pg.blocks = arr.map((t, k) => ({
              i: `${pg.page}:${k}`,
              page: pg.page,
              text: t,
              bbox: null,
              ocr: true,
            }));
            fs.writeFileSync(
              path.join(dir, pg.page + ".v3.json"),
              JSON.stringify(pg)
            );
          }
        }
      } catch (e) {
        console.warn("OCR lỗi:", e.message);
      }
    }

    res.json({ from, to, pages, scanned, ocrNote, clientOcr });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Lỗi đọc trang." });
  }
});

// ---------------- Dịch (không phụ thuộc phiên) ----------------
app.post("/api/translate", requireApproved, async (req, res) => {
  try {
    const { items, source, target, engine, apiKey, model, domain } = req.body || {};
    if (!Array.isArray(items) || !items.length)
      return res.json({ translations: {}, engine: "none" });
    const texts = items.map((x) => x.text || "");
    const { translations, engine: used } = await translateMany(texts, {
      source: source || "auto",
      target: target || "vi",
      engine: engine || "auto",
      apiKey,
      model,
      domain: domain || "general",
    });
    const out = {};
    items.forEach((x, k) => (out[x.i] = translations[k]));
    res.json({ translations: out, engine: used });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Lỗi dịch." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("\n  HT Document Reader đang chạy.\n");
  console.log("  Trên máy này:       http://localhost:" + PORT);
  for (const ip of lanIPs())
    console.log("  Thiết bị cùng mạng: http://" + ip + ":" + PORT);
  console.log("\n  (Để cửa sổ này mở trong lúc dùng.)\n");
});
server.setTimeout(15 * 60 * 1000);
