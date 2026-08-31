import * as mupdf from "mupdf";
import fs from "node:fs";

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
const resources = doc.addObject({});
const page = doc.addPage([0, 0, 512, 512], 0, resources, buf);
doc.insertPage(-1, page);
const pdf = doc.saveToBuffer("");
const rd = mupdf.Document.openDocument(pdf.asUint8Array(), "application/pdf");
const pg = rd.loadPage(0);

for (const [name, s] of [
  ["icon-512.png", 1],
  ["icon-192.png", 192 / 512],
]) {
  const pix = pg.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(new URL("../public/" + name, import.meta.url), Buffer.from(pix.asPNG()));
  console.log("wrote", name);
}
