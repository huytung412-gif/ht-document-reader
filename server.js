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
  extractDocx,
  extractText,
  kindOf,
} from "./lib/extract.js";
import { translateMany } from "./lib/translate.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UP = path.join(ROOT, "uploads");
const IMGC = path.join(ROOT, "cache", "img");
const TXTC = path.join(ROOT, "cache", "txt");
for (const d of [UP, IMGC, TXTC]) fs.mkdirSync(d, { recursive: true });

const PORT = process.env.PORT || 8756;
const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
});

// docId -> { name, kind, pages, buffer, pdf, atime, blocks? }
const mem = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, d] of mem) {
    if (now - d.atime > 15 * 60 * 1000) {
      d.pdf = null;
      d.buffer = null;
      if (now - d.atime > 60 * 60 * 1000) mem.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

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
app.post("/api/open", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Chưa chọn file." });
    const buf = req.file.buffer;
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const kind = kindOf(name);
    if (kind === "doc")
      return res.status(400).json({
        error:
          "File .doc (Word cũ) chưa hỗ trợ. Mở bằng Word rồi lưu lại thành .docx.",
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
        const parsed =
          kind === "docx" ? await extractDocx(buf) : extractText(buf);
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
app.get("/api/page-image/:docId/:page", (req, res) => {
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
app.post("/api/pages-text", async (req, res) => {
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

    // OCR các trang trống nếu dải trang không quá lớn
    if (scanned.length && to - from + 1 <= 30) {
      try {
        if (!entry.buffer) {
          const bp = path.join(UP, docId + ".bin");
          if (fs.existsSync(bp)) entry.buffer = fs.readFileSync(bp);
        }
        const map = await ocrPdfPages(
          entry.buffer,
          scanned.map((p) => p - 1)
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

    res.json({ from, to, pages, scanned });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Lỗi đọc trang." });
  }
});

// ---------------- Dịch (không phụ thuộc phiên) ----------------
app.post("/api/translate", async (req, res) => {
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
