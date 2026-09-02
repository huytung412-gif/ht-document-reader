// Gửi email thông báo cho admin.
//
// Gói Render Free CHẶN cổng gửi mail SMTP (25/465/587) -> nodemailer + Gmail
// sẽ treo rồi timeout. Vì vậy ưu tiên gửi qua API HTTPS (không bị chặn):
//   - Brevo  : đặt BREVO_API_KEY  (miễn phí 300 mail/ngày, gửi tới email bất kỳ)
//   - Resend : đặt RESEND_API_KEY (miễn phí 100 mail/ngày)
// Cần thêm MAIL_FROM = địa chỉ người gửi đã xác minh trên dịch vụ đó.
//
// Nếu chạy nơi không chặn SMTP thì vẫn dùng được:
//   SMTP_USER + SMTP_PASS  (Gmail: bật 2 lớp bảo mật rồi tạo "App password")
//   hoặc SMTP_HOST/SMTP_PORT/SMTP_SECURE cho SMTP bất kỳ.
import nodemailer from "nodemailer";

const BREVO_KEY = process.env.BREVO_API_KEY || "";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM =
  process.env.MAIL_FROM ||
  SMTP_USER ||
  "onboarding@resend.dev";
const FROM_NAME = "HT Document Reader";

export const mailEnabled = !!(BREVO_KEY || RESEND_KEY || (SMTP_USER && SMTP_PASS));
export const mailMode = BREVO_KEY
  ? "brevo"
  : RESEND_KEY
  ? "resend"
  : SMTP_USER && SMTP_PASS
  ? "smtp"
  : "off";

function toList(to) {
  return String(to)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendBrevo(to, subject, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: FROM, name: FROM_NAME },
      to: toList(to).map((email) => ({ email })),
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function sendResend(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM}>`,
      to: toList(to),
      subject,
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

let tx = null;
function transport() {
  if (tx) return tx;
  if (process.env.SMTP_HOST) {
    tx = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
    });
  } else {
    tx = nodemailer.createTransport({
      service: "gmail",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
    });
  }
  return tx;
}
async function sendSmtp(to, subject, html) {
  await transport().sendMail({ from: `"${FROM_NAME}" <${SMTP_USER}>`, to, subject, html });
}

export async function sendMail(to, subject, html) {
  if (!mailEnabled) return false;
  if (mailMode === "brevo") await sendBrevo(to, subject, html);
  else if (mailMode === "resend") await sendResend(to, subject, html);
  else await sendSmtp(to, subject, html);
  return true;
}
