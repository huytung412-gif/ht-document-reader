// Bộ nhớ đệm bản dịch: lưu ra file JSON để mở lại tài liệu là có ngay, không dịch lại.
import fs from "node:fs";
import crypto from "node:crypto";

const CACHE_DIR = new URL("../cache/", import.meta.url);
const FILE = new URL("../cache/translations.json", import.meta.url);

const map = new Map();
let dirty = false;

try {
  const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
  for (const k of Object.keys(obj)) map.set(k, obj[k]);
} catch {
  /* chưa có cache, bỏ qua */
}

const timer = setInterval(flush, 4000);
timer.unref();
process.on("exit", flush);
process.on("SIGINT", () => {
  flush();
  process.exit(0);
});

export function keyFor(text, target, bucket) {
  return crypto
    .createHash("sha1")
    .update(`${bucket}|${target}|${text}`)
    .digest("hex");
}

export function get(k) {
  return map.get(k);
}

export function set(k, v) {
  if (typeof v === "string" && v.length) {
    map.set(k, v);
    dirty = true;
  }
}

export function flush() {
  if (!dirty) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(map)));
    dirty = false;
  } catch (e) {
    console.error("Không ghi được cache:", e.message);
  }
}
