// Tách tài liệu. PDF xử lý theo từng trang (mở nhanh, dịch theo dải trang).
import * as mupdf from "mupdf";
import mammoth from "mammoth";

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Đoạn có phải là "chữ thật" không (để bỏ nhãn trục, ký hiệu, mảnh vụn từ hình vẽ).
function isProse(t) {
  const s = String(t || "").trim();
  if (s.length < 3) return false;
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 3) return false;
  const nonSpace = s.replace(/\s/g, "").length || 1;
  if (letters / nonSpace < 0.4 && s.length < 40) return false;
  if (!/\p{L}{2,}/u.test(s)) return false; // cần ít nhất 1 cụm 2 chữ cái liền
  return true;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

// ---------------- PDF: mở & đọc theo trang ----------------
export function openPdf(buffer) {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  return { doc, pages: doc.countPages() };
}

// Trả về các đoạn văn của 1 trang (0-indexed) + kích thước trang, để căn bản dịch
// đúng vị trí trên ảnh gốc.
export function pdfPageBlocks(doc, pageIndex) {
  const page = doc.loadPage(pageIndex);
  const r = page.getBounds(); // [x0,y0,x1,y1] theo point
  const pageW = r[2] - r[0], pageH = r[3] - r[1];
  let st;
  try {
    st = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  } catch {
    st = { blocks: [] };
  }
  const out = [];
  let rawLen = 0;
  for (const b of st.blocks || []) {
    if (b.type !== "text" || !Array.isArray(b.lines)) continue;
    const text = clean(b.lines.map((l) => l.text).join(" "));
    rawLen += text.length;
    if (text && isProse(text)) out.push({ text, bbox: b.bbox || null });
  }
  return { blocks: out, pageW, pageH, rawLen };
}

// Render 1 trang thành ảnh PNG (Buffer).
export function pdfPageImage(doc, pageIndex, scale = 1.6) {
  const page = doc.loadPage(pageIndex);
  const m = mupdf.Matrix.scale(scale, scale);
  const pix = page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pix.asPNG());
  try {
    pix.destroy();
  } catch {}
  return png;
}

// OCR một số trang scan -> Map(pageIndex -> [text,...])
export async function ocrPdfPages(buffer, pageIndexes, onProgress) {
  const { ocrPages } = await import("./ocr.js");
  return ocrPages(buffer, pageIndexes, "eng", onProgress);
}

// ---------------- Word .docx ----------------
export async function extractDocx(buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const rawParts = html.split(/<\/(?:p|h[1-6]|li|tr|div)>/i);
  const blocks = [];
  for (const part of rawParts) {
    const isHeading = /<h[1-6][ >]/i.test(part);
    const text = clean(decodeEntities(part.replace(/<[^>]+>/g, " ")));
    if (text) blocks.push({ i: "b" + blocks.length, page: null, text, heading: isHeading });
  }
  return { kind: "docx", pages: null, blocks };
}

// ---------------- Text / Markdown ----------------
export function extractText(buffer) {
  const raw = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const chunks = raw.split(/\n[ \t]*\n+/);
  const blocks = [];
  for (const c of chunks) {
    const text = c.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ i: "b" + blocks.length, page: null, text });
  }
  return { kind: "text", pages: null, blocks };
}

export function kindOf(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  if (["txt", "md", "markdown", "text", "log", "csv"].includes(ext)) return "text";
  return "text";
}
