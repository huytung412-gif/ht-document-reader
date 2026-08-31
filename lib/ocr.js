// OCR cho trang PDF scan. Nạp tesseract.js chậm (chỉ khi cần).
import * as mupdf from "mupdf";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function ocrPages(buffer, pageIndexes, lang, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang || "eng", 1, {
    cachePath: path.join(ROOT, "cache", "tessdata"),
  });

  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const scale = mupdf.Matrix.scale(2.4, 2.4);
  const out = new Map();

  try {
    for (let k = 0; k < pageIndexes.length; k++) {
      const p = pageIndexes[k];
      const page = doc.loadPage(p);
      const pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false);
      const png = Buffer.from(pix.asPNG());
      pix.destroy?.();

      const { data } = await worker.recognize(png, {}, { blocks: true });

      let paras = [];
      if (Array.isArray(data.paragraphs) && data.paragraphs.length) {
        paras = data.paragraphs.map((x) => x.text.replace(/\s+/g, " ").trim());
      } else {
        paras = String(data.text || "")
          .split(/\n[ \t]*\n/)
          .map((s) => s.replace(/\s+/g, " ").trim());
      }
      out.set(p, paras.filter(Boolean));
      if (onProgress) onProgress(k + 1, pageIndexes.length);
    }
  } finally {
    await worker.terminate();
  }
  return out;
}
