// Gửi email thông báo cho admin. Bật bằng biến môi trường:
//   SMTP_USER, SMTP_PASS  (Gmail: bật 2 lớp bảo mật rồi tạo "App password")
//   hoặc SMTP_HOST/SMTP_PORT/SMTP_SECURE cho SMTP bất kỳ.
import nodemailer from "nodemailer";

const USER = process.env.SMTP_USER || "";
const PASS = process.env.SMTP_PASS || "";
export const mailEnabled = !!(USER && PASS);

let tx = null;
function transport() {
  if (tx) return tx;
  if (process.env.SMTP_HOST) {
    tx = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: { user: USER, pass: PASS },
    });
  } else {
    tx = nodemailer.createTransport({ service: "gmail", auth: { user: USER, pass: PASS } });
  }
  return tx;
}

export async function sendMail(to, subject, html) {
  if (!mailEnabled) return false;
  await transport().sendMail({
    from: `"HT Document Reader" <${USER}>`,
    to,
    subject,
    html,
  });
  return true;
}
