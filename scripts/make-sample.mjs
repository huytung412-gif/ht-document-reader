import * as mupdf from "mupdf";
import fs from "node:fs";

const doc = new mupdf.PDFDocument();
const font = doc.addSimpleFont(new mupdf.Font("Times-Roman"));

function escPdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeContent(paras) {
  let s = "BT /F1 14 Tf 60 780 Td 18 TL\n";
  for (const p of paras) {
    s += "(" + escPdf(p) + ") Tj T*\n";
  }
  s += "ET\n";
  return s;
}

function addPage(paras) {
  const buf = new mupdf.Buffer();
  buf.writeLine(makeContent(paras));
  const resources = doc.addObject({ Font: { F1: font } });
  const page = doc.addPage([0, 0, 595, 842], 0, resources, buf);
  doc.insertPage(-1, page);
}

addPage([
  "Introduction to Hydraulic Systems",
  "",
  "A hydraulic system transmits power using a confined liquid under pressure.",
  "The pump converts mechanical energy into hydraulic energy.",
  "Pressure relief valves protect the circuit from overload conditions.",
  "",
  "Every component must be rated for the maximum working pressure.",
]);
addPage([
  "Maintenance Procedure",
  "",
  "Check the fluid level every 100 operating hours.",
  "Replace the filter element when the clogging indicator turns red.",
  "Never exceed the maximum rated pressure of the accumulator.",
  "Torque all fittings to the values listed in Table 4.",
]);

const out = doc.saveToBuffer("compress");
fs.writeFileSync(new URL("../sample.pdf", import.meta.url), out.asUint8Array());
console.log("wrote sample.pdf");

const d2 = mupdf.Document.openDocument(
  fs.readFileSync(new URL("../sample.pdf", import.meta.url)),
  "application/pdf"
);
console.log("pages =", d2.countPages());
const st = d2.loadPage(0).toStructuredText("preserve-whitespace");
console.log(st.asJSON());
