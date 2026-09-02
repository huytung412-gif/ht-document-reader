// Tạo icon PWA. Nếu có public/brand.png thì thu nhỏ từ đó; nếu không thì tự vẽ.
import * as mupdf from "mupdf";
import fs from "node:fs";

const P = (n) => new URL("../public/" + n, import.meta.url);
const brand = P("brand.png");

function fromBrand() {
  const src = fs.readFileSync(brand);
  const img = new mupdf.Image(src);
  const w = img.getWidth(), h = img.getHeight();
  for (const [name, size] of [["icon-512.png", 512], ["icon-192.png", 192]]) {
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, size, size], false);
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    const s = size / Math.max(w, h);
    const ox = (size - w * s) / 2, oy = (size - h * s) / 2;
    dev.fillImage(img, [s, 0, 0, s, ox, oy], 1);
    dev.close();
    fs.writeFileSync(P(name), Buffer.from(pix.asPNG()));
    console.log("wrote", name, "từ brand.png");
  }
}

function drawn() {
  const content = `
0.145 0.388 0.922 rg 0 0 512 512 re f
1 1 1 rg
96 150 44 250 re f
206 150 44 250 re f
96 253 154 44 re f
0.80 0.88 1 rg
258 356 158 44 re f
315 150 44 250 re f
1 1 1 rg
104 100 m 256 124 l 256 150 l 104 126 l h f
408 100 m 256 124 l 256 150 l 408 126 l h f
`;
  const doc = new mupdf.PDFDocument();
  const buf = new mupdf.Buffer();
  buf.writeLine(content);
  const page = doc.addPage([0, 0, 512, 512], 0, doc.addObject({}), buf);
  doc.insertPage(-1, page);
  const rd = mupdf.Document.openDocument(doc.saveToBuffer("").asUint8Array(), "application/pdf");
  const pg = rd.loadPage(0);
  for (const [name, s] of [["icon-512.png", 1], ["icon-192.png", 192 / 512]]) {
    const pix = pg.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(P(name), Buffer.from(pix.asPNG()));
    console.log("wrote", name, "(tự vẽ)");
  }
}

if (fs.existsSync(brand)) fromBrand();
else drawn();
