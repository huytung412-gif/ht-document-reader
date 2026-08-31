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
1 1 1 rg 96 104 180 304 re f
0.78 0.84 0.98 rg
124 338 124 16 re f
124 300 124 16 re f
124 262 90 16 re f
0.059 0.145 0.306 rg 236 104 180 304 re f
0.302 0.494 0.871 rg
264 338 124 16 re f
264 300 124 16 re f
264 262 90 16 re f
1 0.835 0.290 rg
196 268 120 18 re f
196 232 120 18 re f
296 260 34 34 re f
182 224 34 34 re f
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
