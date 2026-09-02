// Đăng nhập bằng email + mật khẩu, admin duyệt mới được dùng app.
// Lưu người dùng ra data/users.json. Token phiên ký bằng HMAC.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, "data");
const FILE = path.join(DIR, "users.json");
const SECRET_FILE = path.join(DIR, "secret");
fs.mkdirSync(DIR, { recursive: true });

export const ADMIN_EMAILS = ["huytung412@gmail.com", "huytung410@gmail.com"];

// Danh sách email được duyệt sẵn qua biến môi trường (giữ được khi máy chủ khởi động lại
// trên gói free — nơi file users.json bị xoá mỗi lần deploy). Ngăn cách bằng dấu phẩy.
const PREAPPROVED = new Set(
  String(process.env.PREAPPROVED_EMAILS || "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
export function isPreApproved(email) {
  return PREAPPROVED.has(String(email || "").trim().toLowerCase());
}

let SECRET = process.env.AUTH_SECRET || "";
if (!SECRET) {
  try { SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim(); } catch {}
  if (!SECRET) {
    SECRET = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(SECRET_FILE, SECRET); } catch {}
  }
}

const norm = (e) => String(e || "").trim().toLowerCase();
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(u) {
  try { fs.writeFileSync(FILE, JSON.stringify(u, null, 2)); }
  catch (e) { console.error("Lưu users lỗi:", e.message); }
}
function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
export function isAdmin(email) {
  return ADMIN_EMAILS.includes(norm(email));
}

export function register(email, pw) {
  email = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (!pw || String(pw).length < 6) throw new Error("Mật khẩu tối thiểu 6 ký tự.");
  const users = load();
  if (users[email]) throw new Error("Email này đã đăng ký. Hãy đăng nhập.");
  const salt = crypto.randomBytes(16).toString("hex");
  const admin = isAdmin(email);
  users[email] = {
    email, salt, hash: hashPw(pw, salt),
    status: admin || isPreApproved(email) ? "approved" : "pending",
    role: admin ? "admin" : "user",
    createdAt: Date.now(), lastLogin: Date.now(),
  };
  save(users);
  return users[email];
}

// Đăng nhập bằng Google (không mật khẩu) — tạo tài khoản nếu chưa có.
export function upsertOAuth(email) {
  email = norm(email);
  const users = load();
  let u = users[email];
  const admin = isAdmin(email);
  if (!u) {
    u = users[email] = {
      email, oauth: true,
      status: admin || isPreApproved(email) ? "approved" : "pending",
      role: admin ? "admin" : "user",
      createdAt: Date.now(), lastLogin: Date.now(),
    };
  } else {
    if (admin) { u.role = "admin"; u.status = "approved"; }
    else if (isPreApproved(email)) u.status = "approved";
    u.oauth = true;
    u.lastLogin = Date.now();
  }
  save(users);
  return u;
}

export function login(email, pw) {
  email = norm(email);
  const users = load();
  const u = users[email];
  if (!u) throw new Error("Chưa có tài khoản này. Hãy đăng ký.");
  if (hashPw(pw, u.salt) !== u.hash) throw new Error("Sai mật khẩu.");
  if (isAdmin(email)) { u.role = "admin"; u.status = "approved"; }
  else if (isPreApproved(email)) u.status = "approved";
  u.lastLogin = Date.now();
  save(users);
  return u;
}

export function changePassword(email, current, next) {
  email = norm(email);
  if (!next || String(next).length < 6)
    throw new Error("Mật khẩu mới tối thiểu 6 ký tự.");
  const users = load();
  const u = users[email];
  if (!u) throw new Error("Không tìm thấy tài khoản.");
  // Nếu tài khoản trước giờ chỉ đăng nhập Google (chưa có mật khẩu) thì cho đặt luôn.
  if (u.hash) {
    if (hashPw(current, u.salt) !== u.hash) throw new Error("Mật khẩu hiện tại không đúng.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  u.salt = salt;
  u.hash = hashPw(next, salt);
  save(users);
}

export function sign(email) {
  const body = Buffer.from(JSON.stringify({ e: norm(email), t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
export function verify(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const exp = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (exp.length !== sig.length ||
      !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return null;
  try {
    const { e, t } = JSON.parse(Buffer.from(body, "base64url").toString());
    if (Date.now() - t > 400 * 24 * 3600 * 1000) return null; // ~13 tháng
    return e;
  } catch { return null; }
}
export function getUser(email) {
  return load()[norm(email)] || null;
}

// Token cho link Duyệt/Từ chối trong email (gắn với email + thời điểm đăng ký).
export function actionToken(email, createdAt) {
  const body = Buffer.from(
    JSON.stringify({ e: norm(email), c: createdAt || 0, k: "act" })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
export function verifyActionToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const exp = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (exp.length !== sig.length ||
      !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return null;
  try {
    const { e, c, k } = JSON.parse(Buffer.from(body, "base64url").toString());
    if (k !== "act") return null;
    return { email: e, createdAt: c || 0 };
  } catch { return null; }
}

export function currentUser(token) {
  const email = verify(token);
  if (!email) return null;
  const u = load()[email];
  if (!u) return null;
  if (isAdmin(email)) { u.role = "admin"; u.status = "approved"; }
  else if (isPreApproved(email)) u.status = "approved";
  return u;
}

export function listUsers() {
  return Object.values(load())
    .map((u) => ({
      email: u.email, status: u.status, role: u.role,
      createdAt: u.createdAt, lastLogin: u.lastLogin,
    }))
    .sort((a, b) => {
      const pa = a.status === "pending" ? 0 : 1;
      const pb = b.status === "pending" ? 0 : 1;
      return pa - pb || (b.createdAt || 0) - (a.createdAt || 0);
    });
}
export function setStatus(email, status) {
  email = norm(email);
  const users = load();
  if (!users[email]) throw new Error("Không tìm thấy tài khoản.");
  if (isAdmin(email)) throw new Error("Không đổi được tài khoản admin.");
  users[email].status = status === "approved" ? "approved" : "pending";
  save(users);
}
export function removeUser(email) {
  email = norm(email);
  if (isAdmin(email)) throw new Error("Không xoá được tài khoản admin.");
  const users = load();
  delete users[email];
  save(users);
}
