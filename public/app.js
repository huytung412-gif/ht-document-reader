"use strict";
const $ = (id) => document.getElementById(id);
const paneL = $("paneL"), paneR = $("paneR"), colL = $("colL"), colR = $("colR");

const state = {
  docId: null, name: "", kind: null, pages: null,
  mode: "image", from: 1, to: 8, span: 8,
  src: new Map(), trans: new Map(),
  lEl: new Map(), rEl: new Map(),
  pageIdx: new Map(), pageOf: new Map(),
  translated: new Set(), requested: new Set(), pending: new Set(),
  pinned: new Set(),
  full: new Map(), busyAll: false, busyFull: false,
};

/* ---------- cài đặt ---------- */
const cfg = JSON.parse(localStorage.getItem("dt.cfg") || "{}");
const saveCfg = () => localStorage.setItem("dt.cfg", JSON.stringify(cfg));
cfg.font = cfg.font || 17;
cfg.zoom = cfg.zoom || 100;
document.documentElement.style.setProperty("--font-scale", cfg.font + "px");
document.documentElement.style.setProperty("--zoom", cfg.zoom);
if (cfg.target) $("target").value = cfg.target;
if (cfg.engine) $("engine").value = cfg.engine;
if (cfg.domain) $("domain").value = cfg.domain;
// Ô "Dịch từ" dùng lại danh sách ngôn ngữ của ô "Dịch sang".
$("source").insertAdjacentHTML("beforeend", $("target").innerHTML.replace(/\s+selected/g, ""));
$("source").value = cfg.source || "auto";
if (cfg.target) $("target").value = cfg.target;
if (cfg.mode) state.mode = cfg.mode;
if (cfg.sync === false) $("syncChk").checked = false;
if (cfg.ratio) $("split").style.gridTemplateColumns = `${cfg.ratio}fr 6px ${1 - cfg.ratio}fr`;
toggleKey();

function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function toggleKey() {
  $("apiKey").classList.toggle("hidden", !["deepl", "anthropic", "openai"].includes($("engine").value));
}
async function apiJSON(path, body) {
  const opt = body == null
    ? { method: "GET" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    showGate(/duyệt/.test(d.error || ""));
    throw new Error(d.error || "Cần đăng nhập.");
  }
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

/* ---------- mở file ---------- */
$("btnOpen").onclick = $("btnOpen2").onclick = () => $("file").click();
$("file").onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; };
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hidden"); drop.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && e.relatedTarget) return; drop.classList.remove("dragover"); }));
document.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(file) {
  drop.classList.remove("hidden");
  drop.querySelector("h2").textContent = "Đang mở “" + file.name + "”…";
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch("/api/open", { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { showGate(/duyệt/.test(data.error || "")); return; }
    if (!r.ok) throw new Error(data.error || "Lỗi mở file");
    onOpened(data);
  } catch (err) {
    toast("Không mở được file: " + err.message, 6000);
    drop.querySelector("h2").textContent = "Kéo thả file vào đây";
  }
}

function resetDoc(data) {
  state.docId = data.docId; state.name = data.name; state.kind = data.kind; state.pages = data.pages;
  state.src.clear(); state.trans.clear(); state.lEl.clear(); state.rEl.clear(); state.pageIdx.clear(); state.pageOf.clear(); state.pinned.clear();
  state.translated.clear(); state.requested.clear(); state.pending.clear();
  state.full.clear(); state.busyFull = false;
  colL.innerHTML = ""; colR.innerHTML = "";
  io.disconnect();
  $("docName").textContent = data.name;
  $("btnExport").disabled = false;
  $("btnAll").disabled = false;
  $("btnFull").disabled = data.kind !== "pdf";
  drop.classList.add("hidden");
}

function onOpened(data) {
  resetDoc(data);
  if (data.kind === "pdf") {
    document.body.classList.add("is-pdf");
    document.body.classList.toggle("mode-image", state.mode === "image");
    $("pgTotal").textContent = "/ " + data.pages;
    state.from = 1; state.to = Math.min(data.pages, 8); state.span = state.to - state.from + 1;
    $("pgFrom").value = state.from; $("pgTo").value = state.to;
    $("pgFrom").max = data.pages; $("pgTo").max = data.pages;
    $("btnAll").textContent = "⚡ Dịch dải trang này";
    loadRange();
  } else {
    document.body.classList.remove("is-pdf", "mode-image");
    $("btnAll").textContent = "⚡ Dịch toàn bộ";
    buildTextBlocks(data.blocks.map((b) => ({ ...b, page: null })), false);
    toast(`${data.blocks.length} đoạn`, 3500);
    kickVisible();
  }
}

/* ---------- Ghi / khôi phục vị trí đang xem (giữ nguyên khi đổi chế độ) ---------- */
function viewAnchor() {
  const kids = colL.children;
  if (!kids.length) return null;
  const top = paneL.scrollTop;
  let lo = 0, hi = kids.length - 1, ans = hi;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, e = kids[m];
    if (e.offsetTop + e.offsetHeight > top) { ans = m; hi = m - 1; } else lo = m + 1;
  }
  const el = kids[ans];
  const frac = Math.min(1, Math.max(0, (top - el.offsetTop) / Math.max(1, el.offsetHeight)));
  let page = null;
  if (el.dataset && el.dataset.page) page = +el.dataset.page;
  else if (el.classList.contains("pagesep")) {
    const mm = el.textContent.match(/(\d+)/); page = mm ? +mm[1] : null;
  } else if (el.dataset && el.dataset.i && state.pageOf.has(el.dataset.i)) {
    page = state.pageOf.get(el.dataset.i);
  }
  return { page, frac, ratio: kids.length ? ans / kids.length : 0 };
}
function restoreView(a) {
  if (!a) return;
  let target = null;
  if (a.page != null) {
    target = colL.querySelector(`.pagewrap[data-page="${a.page}"]`);
    if (!target)
      target = [...colL.querySelectorAll(".pagesep")].find((s) =>
        new RegExp(`\\b${a.page}\\b`).test(s.textContent)
      );
  }
  if (target) paneL.scrollTop = target.offsetTop + a.frac * target.offsetHeight;
  else paneL.scrollTop = a.ratio * (paneL.scrollHeight - paneL.clientHeight);
  resyncNow();
}

/* ---------- PDF: nạp một dải trang ---------- */
async function loadRange(keepView) {
  if (state.kind !== "pdf") return;
  const anchor = keepView ? viewAnchor() : null;
  let from = Math.max(1, parseInt($("pgFrom").value, 10) || 1);
  let to = Math.min(state.pages, parseInt($("pgTo").value, 10) || from);
  if (to < from) to = from;
  if (to - from > 60) { to = from + 60; toast("Mỗi lần xem tối đa 61 trang.", 3500); }
  state.from = from; state.to = to; state.span = to - from + 1;
  $("pgFrom").value = from; $("pgTo").value = to;

  state.src.clear(); state.trans.clear(); state.lEl.clear(); state.rEl.clear(); state.pageIdx.clear(); state.pageOf.clear(); state.pinned.clear();
  state.translated.clear(); state.requested.clear(); state.pending.clear();
  colL.innerHTML = ""; colR.innerHTML = ""; io.disconnect();

  const imageMode = state.mode === "image";
  document.body.classList.toggle("mode-image", imageMode);

  if (imageMode) {
    // khoá tỉ lệ 50/50 để 2 bên khớp tuyệt đối
    $("split").style.gridTemplateColumns = "1fr 8px 1fr";
    const fragL = document.createDocumentFragment(), fragR = document.createDocumentFragment();
    for (let p = from; p <= to; p++) {
      const src = `/api/page-image/${state.docId}/${p}?scale=2`;
      const eager = p - from < 4;

      const lw = document.createElement("div");
      lw.className = "pagewrap"; lw.dataset.page = p;
      lw.innerHTML = `<span class="plabel">Trang ${p}/${state.pages}</span>`;
      const limg = document.createElement("img");
      limg.className = "page"; limg.loading = eager ? "eager" : "lazy"; limg.decoding = "async"; limg.src = src;
      lw.appendChild(limg);

      const rw = document.createElement("div");
      rw.className = "pagewrap ov"; rw.dataset.page = p;
      const rimg = document.createElement("img");
      rimg.className = "page ghost"; rimg.loading = eager ? "eager" : "lazy"; rimg.decoding = "async"; rimg.src = src;
      rw.appendChild(rimg);

      fragL.appendChild(lw); fragR.appendChild(rw);
      state.pageIdx.set(p, []);
      io.observe(lw);
    }
    colL.appendChild(fragL); colR.appendChild(fragR);
  } else {
    $("split").style.gridTemplateColumns = cfg.ratio ? `${cfg.ratio}fr 8px ${1 - cfg.ratio}fr` : "1fr 8px 1fr";
  }

  toast(`Đang đọc chữ trang ${from}–${to}…`, 2500);
  let data;
  try { data = await apiJSON("/api/pages-text", { docId: state.docId, from, to }); }
  catch (e) { toast("Lỗi đọc trang: " + e.message, 6000); return; }

  if (imageMode) {
    for (const pg of data.pages) {
      const par = pg.pageW && pg.pageH ? `${pg.pageW} / ${pg.pageH}` : "";
      const lw = colL.querySelector(`.pagewrap[data-page="${pg.page}"]`);
      const rw = colR.querySelector(`.pagewrap[data-page="${pg.page}"]`);
      if (par) { if (lw) lw.style.aspectRatio = par; if (rw) rw.style.aspectRatio = par; }
      if (!rw || !lw) continue;
      const arr = [];
      pg.blocks.forEach((b, k) => {
        state.src.set(b.i, b.text); state.pageOf.set(b.i, pg.page); arr.push(b.i);
        // vùng bấm trên ảnh gốc (bên trái) — trùng khít khung đoạn
        const rg = document.createElement("div");
        rg.className = "rgn"; rg.dataset.i = b.i;
        placeBox(rg, b.bbox, pg, k);
        lw.appendChild(rg); state.lEl.set(b.i, rg);
        // ô dịch (bên phải) — cắt đúng khung đoạn gốc, không tràn
        const tb = document.createElement("div");
        tb.className = "tblk pending"; tb.dataset.i = b.i; tb.textContent = "…";
        placeBox(tb, b.bbox, pg, k, true);
        rw.appendChild(tb); state.rEl.set(b.i, tb);
      });
      state.pageIdx.set(pg.page, arr);
    }
  } else {
    const fragL = document.createDocumentFragment(), fragR = document.createDocumentFragment();
    for (const pg of data.pages) {
      const sepL = document.createElement("div"); sepL.className = "pagesep"; sepL.textContent = `— Trang ${pg.page} —`;
      const sepR = sepL.cloneNode(true);
      fragL.appendChild(sepL); fragR.appendChild(sepR);
      for (const b of pg.blocks) {
        state.src.set(b.i, b.text); state.pageOf.set(b.i, pg.page);
        const lb = document.createElement("div"); lb.className = "blk"; lb.dataset.i = b.i; lb.textContent = b.text;
        const rb = document.createElement("div"); rb.className = "blk pending"; rb.dataset.i = b.i; rb.textContent = "…";
        fragL.appendChild(lb); fragR.appendChild(rb);
        state.lEl.set(b.i, lb); state.rEl.set(b.i, rb); io.observe(lb);
      }
    }
    colL.appendChild(fragL); colR.appendChild(fragR);
  }
  if (data.scanned && data.scanned.length)
    toast(`Trang ${data.scanned.join(", ")} là ảnh scan — đã thử OCR.`, 4500);
  if (anchor) {
    // căn lại nhiều lần vì bố cục còn xê dịch khi ảnh/bản dịch nạp xong
    const reapply = () => restoreView(anchor);
    requestAnimationFrame(() => requestAnimationFrame(reapply));
    setTimeout(reapply, 260);
    setTimeout(reapply, 800);
  } else {
    paneL.scrollTop = 0; paneR.scrollTop = 0;
  }
  kickVisible();
}

// Đặt phần tử phủ đúng khung đoạn gốc (theo % của trang) — dùng chung cho cả 2 bên
// nên vị trí trùng khít 100%.
function placeBox(el, bbox, pg, k, strict) {
  if (bbox && pg.pageW && pg.pageH) {
    const lx = (bbox.x / pg.pageW) * 100;
    el.style.left = lx.toFixed(3) + "%";
    el.style.top = ((bbox.y / pg.pageH) * 100).toFixed(3) + "%";
    el.style.width = Math.min(100 - lx, (bbox.w / pg.pageW) * 100 + 1.5).toFixed(3) + "%";
    el.style.height = Math.max((bbox.h / pg.pageH) * 100, 1).toFixed(3) + "%";
  } else {
    el.style.left = "5%"; el.style.width = "90%";
    el.style.top = (5 + k * 6).toFixed(2) + "%"; el.style.height = "5%";
  }
  if (strict) el.style.overflow = "hidden";
}

/* ---------- dịch: hàng đợi theo vùng nhìn ---------- */
const io = new IntersectionObserver((ents) => {
  for (const e of ents) {
    if (!e.isIntersecting) continue;
    if (e.target.classList.contains("pagewrap")) {
      const p = +e.target.dataset.page;
      for (const i of state.pageIdx.get(p) || [])
        if (!state.translated.has(i) && !state.requested.has(i)) state.pending.add(i);
    } else {
      const i = e.target.dataset.i;
      if (i && !state.translated.has(i) && !state.requested.has(i)) state.pending.add(i);
    }
  }
  kick();
}, { root: paneL, rootMargin: "700px 0px" });

function kickVisible() {
  // ép dịch phần đang hiển thị ngay (không chờ observer)
  const h = paneL.clientHeight || 800;
  const scan = state.mode === "image" && state.kind === "pdf"
    ? [...colL.children] : [...state.lEl.values()];
  for (const el of scan) {
    const r = el.getBoundingClientRect();
    if (r.bottom > -500 && r.top < h + 500) {
      if (el.classList.contains("pagewrap")) {
        for (const i of state.pageIdx.get(+el.dataset.page) || []) if (!state.translated.has(i)) state.pending.add(i);
      } else if (el.dataset.i && !state.translated.has(el.dataset.i)) state.pending.add(el.dataset.i);
    }
  }
  kick();
}

let flushTimer = null;
function kick() { if (!flushTimer && state.pending.size) flushTimer = setTimeout(flush, 200); }
async function flush() {
  flushTimer = null;
  if (!state.pending.size) return;
  const idx = [...state.pending].slice(0, 60);
  idx.forEach((i) => { state.pending.delete(i); state.requested.add(i); });
  await translateBatch(idx);
  if (state.pending.size) kick();
}
async function translateBatch(idx) {
  const items = idx.map((i) => ({ i, text: state.src.get(i) || "" }));
  try {
    const data = await apiJSON("/api/translate", {
      items, source: $("source").value, target: $("target").value, engine: $("engine").value,
      domain: $("domain").value,
      apiKey: $("apiKey").value.trim() || undefined,
    });
    for (const [i, t] of Object.entries(data.translations)) setRight(i, t);
    return data.engine;
  } catch (err) {
    idx.forEach((i) => {
      state.requested.delete(i);
      const el = state.rEl.get(i);
      if (el && el.classList.contains("pending")) { el.classList.replace("pending", "err"); el.textContent = state.src.get(i); }
    });
    toast("Lỗi dịch: " + err.message, 5000);
  }
}
function setRight(i, text) {
  const el = state.rEl.get(i); if (!el) return;
  el.classList.remove("pending", "err"); el.textContent = text;
  state.trans.set(i, text); state.translated.add(i);
  if (el.classList.contains("tblk") && el.style.height) fitText(el);
}
// Thu nhỏ cỡ chữ bản dịch cho vừa đúng khung đoạn gốc -> không tràn, không lệch dòng.
function fitText(el) {
  el.style.fontSize = ""; el.style.lineHeight = "";
  if (!el.style.height) return;
  let fs = parseFloat(getComputedStyle(el).fontSize) || 12;
  let guard = 0;
  while (el.scrollHeight > el.clientHeight + 1 && fs > 5 && guard++ < 50) {
    fs -= 0.5;
    el.style.fontSize = fs + "px";
    if (fs <= 10) el.style.lineHeight = "1.12";
  }
}
function refitAll() {
  requestAnimationFrame(() => {
    for (const el of state.rEl.values())
      if (el.classList && el.classList.contains("tblk") && el.style.height) fitText(el);
  });
}
colR.addEventListener("click", (e) => {
  const el = e.target.closest(".blk.err"); if (!el) return;
  const i = el.dataset.i; state.requested.add(i);
  el.classList.replace("err", "pending"); el.textContent = "…";
  translateBatch([i]);
});

/* ---------- dịch cả dải ---------- */
$("btnAll").onclick = async () => {
  if (state.busyAll) { state.busyAll = false; return; }
  const all = [...state.src.keys()].filter((i) => !state.translated.has(i));
  if (!all.length) { toast("Dải trang này đã dịch xong.", 2500); return; }
  state.busyAll = true;
  const label = $("btnAll").textContent;
  $("btnAll").textContent = "⏹ Dừng";
  $("progWrap").classList.remove("hidden");
  for (let k = 0; k < all.length && state.busyAll; k += 60) {
    const slice = all.slice(k, k + 60).filter((i) => !state.translated.has(i));
    slice.forEach((i) => state.requested.add(i));
    const eng = await translateBatch(slice);
    const done = [...state.src.keys()].filter((i) => state.translated.has(i)).length;
    $("progBar").style.width = ((done / state.src.size) * 100).toFixed(1) + "%";
    $("progTxt").textContent = `${done}/${state.src.size}${eng ? " · " + eng : ""}`;
  }
  state.busyAll = false;
  $("btnAll").textContent = label;
  setTimeout(() => $("progWrap").classList.add("hidden"), 1500);
};

/* ---------- dịch TOÀN BỘ tài liệu (chạy nền, để xuất file) ---------- */
$("btnFull").onclick = async () => {
  if (state.busyFull) { state.busyFull = false; return; }
  if (state.kind !== "pdf") return;
  state.busyFull = true;
  const btn = $("btnFull"); const label = btn.textContent;
  btn.textContent = "⏹ Dừng";
  $("progWrap").classList.remove("hidden");
  const STEP = 10;
  try {
    for (let p = 1; p <= state.pages && state.busyFull; p += STEP) {
      const to = Math.min(state.pages, p + STEP - 1);
      let data;
      try { data = await apiJSON("/api/pages-text", { docId: state.docId, from: p, to }); }
      catch (e) { toast("Lỗi đọc trang " + p + ": " + e.message, 5000); break; }
      const items = [];
      for (const pg of data.pages) for (const b of pg.blocks) {
        if (!state.full.has(b.i)) state.full.set(b.i, { page: pg.page, src: b.text, trans: "" });
        if (!state.full.get(b.i).trans) items.push({ i: b.i, text: b.text });
      }
      for (let k = 0; k < items.length && state.busyFull; k += 60) {
        const chunk = items.slice(k, k + 60);
        try {
          const res = await apiJSON("/api/translate", {
            items: chunk, source: $("source").value, target: $("target").value, engine: $("engine").value,
            domain: $("domain").value,
            apiKey: $("apiKey").value.trim() || undefined,
          });
          for (const [i, tx] of Object.entries(res.translations)) {
            if (state.full.get(i)) state.full.get(i).trans = tx;
            if (state.rEl.get(i)) setRight(i, tx);
          }
        } catch { /* bỏ qua đoạn lỗi, dịch tiếp */ }
      }
      const done = Math.min(to, state.pages);
      $("progBar").style.width = ((done / state.pages) * 100).toFixed(1) + "%";
      $("progTxt").textContent = `Toàn bộ: trang ${done}/${state.pages}`;
    }
  } finally {
    const stopped = !state.busyFull;
    state.busyFull = false;
    btn.textContent = label;
    const n = [...state.full.values()].filter((v) => v.trans).length;
    toast(`${stopped ? "Đã dừng. " : ""}Đã dịch ${n} đoạn. Bấm 💾 Lưu file → chọn định dạng để xuất.`, 6000);
    setTimeout(() => $("progWrap").classList.add("hidden"), 2000);
  }
};

/* ---------- cuộn đồng bộ ---------- */
let lock = 0;
function anchorOf(pane, col) {
  const kids = col.children, top = pane.scrollTop;
  let lo = 0, hi = kids.length - 1, ans = hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, el = kids[mid];
    if (el.offsetTop + el.offsetHeight > top) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  const el = kids[ans];
  if (!el) return { idx: 0, frac: 0 };
  return { idx: ans, frac: Math.min(1, Math.max(0, (top - el.offsetTop) / Math.max(1, el.offsetHeight))) };
}
function applyAnchor(pane, col, a) {
  const el = col.children[a.idx]; if (!el) return;
  pane.scrollTop = el.offsetTop + a.frac * el.offsetHeight;
}
function sync(from, force) {
  if (!$("syncChk").checked) return;
  if (!force && performance.now() - lock < 60) return;
  lock = performance.now();
  if (from === "L") applyAnchor(paneR, colR, anchorOf(paneL, colL));
  else applyAnchor(paneL, colL, anchorOf(paneR, colR));
}
// Bật lại "Cuộn đồng bộ" thì căn lại ngay theo bên trái.
function resyncNow() { lock = 0; sync("L", true); }
paneL.addEventListener("scroll", () => { sync("L"); }, { passive: true });
paneR.addEventListener("scroll", () => { sync("R"); }, { passive: true });
paneL.addEventListener("scroll", () => { if (!flushTimer) kickVisibleThrottled(); }, { passive: true });
let kvT = 0;
function kickVisibleThrottled() { const n = performance.now(); if (n - kvT > 300) { kvT = n; kickVisible(); } }

/* ---------- Tô sáng 2 bên khi rê / bấm ---------- */
function markHot(i, on) {
  const a = state.lEl.get(i), b = state.rEl.get(i);
  if (a) a.classList.toggle("hot", on);
  if (b) b.classList.toggle("hot", on);
}
function wireHot(col) {
  col.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-i]"); if (el) markHot(el.dataset.i, true);
  });
  col.addEventListener("mouseout", (e) => {
    const el = e.target.closest("[data-i]");
    if (el && !state.pinned.has(el.dataset.i)) markHot(el.dataset.i, false);
  });
  col.addEventListener("click", (e) => {
    const el = e.target.closest("[data-i]"); if (!el) return;
    const i = el.dataset.i;
    if (el.classList.contains("err")) return;
    if (state.pinned.has(i)) { state.pinned.delete(i); markHot(i, false); }
    else { state.pinned.add(i); markHot(i, true); }
  });
}
wireHot(colL); wireHot(colR);

/* ---------- điều khiển PDF ---------- */
$("pgGo").onclick = () => loadRange();
$("pgPrev").onclick = () => { const s = state.span; $("pgFrom").value = state.from - s; $("pgTo").value = state.to - s; loadRange(); };
$("pgNext").onclick = () => { const s = state.span; $("pgFrom").value = state.from + s; $("pgTo").value = state.to + s; loadRange(); };
$("mImg").onclick = () => setMode("image");
$("mTxt").onclick = () => setMode("text");
function setMode(m) {
  if (state.mode === m) return;
  state.mode = m; cfg.mode = m; saveCfg();
  $("mImg").classList.toggle("on", m === "image");
  $("mTxt").classList.toggle("on", m === "text");
  loadRange(true); // giữ nguyên vị trí đang xem
}
$("mImg").classList.toggle("on", state.mode === "image");
$("mTxt").classList.toggle("on", state.mode === "text");
$("zIn").onclick = () => setZoom(cfg.zoom + 12);
$("zOut").onclick = () => setZoom(cfg.zoom - 12);
function setZoom(v) {
  const a = viewAnchor();
  cfg.zoom = Math.max(40, Math.min(220, v));
  document.documentElement.style.setProperty("--zoom", cfg.zoom);
  saveCfg(); refitAll();
  requestAnimationFrame(() => restoreView(a));
}

/* ---------- toolbar chung ---------- */
$("fPlus").onclick = () => setFont(cfg.font + 1);
$("fMinus").onclick = () => setFont(cfg.font - 1);
function setFont(v) { cfg.font = Math.max(12, Math.min(30, v)); document.documentElement.style.setProperty("--font-scale", cfg.font + "px"); saveCfg(); }
$("source").onchange = () => { cfg.source = $("source").value; saveCfg(); reTranslate(); };
$("target").onchange = () => { cfg.target = $("target").value; saveCfg(); reTranslate(); };
$("engine").onchange = () => { cfg.engine = $("engine").value; saveCfg(); toggleKey(); reTranslate(); };
$("domain").onchange = () => {
  cfg.domain = $("domain").value; saveCfg();
  const d = $("domain").value;
  if (d !== "general" && !["anthropic", "openai"].includes($("engine").value))
    toast("Chuyên ngành: bộ dịch miễn phí sẽ chuẩn hoá thuật ngữ; muốn sát nghĩa nhất hãy chọn bộ dịch Claude/OpenAI + dán key.", 6000);
  reTranslate();
};
$("syncChk").onchange = () => {
  cfg.sync = $("syncChk").checked; saveCfg();
  if (cfg.sync) resyncNow();
};
function reTranslate() {
  if (!state.src.size) return;
  state.translated.clear(); state.requested.clear(); state.pending.clear(); state.pinned.clear();
  state.trans.clear();
  for (const [i, el] of state.rEl) {
    el.classList.remove("hot", "err");
    el.classList.add("pending");
    el.textContent = "…";
    el.style.fontSize = ""; el.style.lineHeight = "";
  }
  for (const [i, el] of state.lEl) el.classList && el.classList.remove("hot");
  for (const i of state.src.keys()) state.pending.add(i);
  kick();
}

const divider = $("divider");
let dragging = false;
divider.addEventListener("pointerdown", (e) => { dragging = true; divider.setPointerCapture(e.pointerId); });
divider.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const r = $("split").getBoundingClientRect();
  let ratio = (e.clientX - r.left) / r.width;
  ratio = Math.max(0.2, Math.min(0.8, ratio));
  $("split").style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
  cfg.ratio = ratio;
});
divider.addEventListener("pointerup", (e) => { dragging = false; divider.releasePointerCapture(e.pointerId); saveCfg(); });

/* ---------- xuất file ---------- */
function collectPairs() {
  if (state.full.size) {
    return [...state.full.values()].map((v) => ({ page: v.page, src: v.src, trans: v.trans }));
  }
  return [...state.src.keys()].map((i) => ({
    page: state.pageOf ? state.pageOf.get(i) : null,
    src: state.src.get(i) || "", trans: state.trans.get(i) || "",
  }));
}
const exportMenu = $("exportMenu");
$("btnExport").onclick = (e) => { e.stopPropagation(); exportMenu.classList.toggle("hidden"); };
document.addEventListener("click", () => exportMenu.classList.add("hidden"));
exportMenu.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-fmt]"); if (!b) return;
  exportMenu.classList.add("hidden");
  exportFile(b.dataset.fmt);
});

function exportFile(fmt) {
  const pairs = collectPairs();
  if (!pairs.some((p) => p.trans)) { toast("Chưa có nội dung đã dịch để lưu.", 3500); return; }
  const base = state.name.replace(/\.[^.]+$/, "");
  const scope = state.full.size ? "toàn bộ" : (state.kind === "pdf" ? `trang ${state.from}–${state.to}` : "toàn bộ");
  let blob, fname;

  if (fmt === "txt") {
    let out = `${base} — bản dịch (${scope})\n\n`;
    let lastPage = null;
    for (const p of pairs) {
      if (p.page && p.page !== lastPage) { out += `\n===== Trang ${p.page} =====\n\n`; lastPage = p.page; }
      if (p.trans) out += p.trans + "\n\n";
    }
    blob = new Blob([out], { type: "text/plain;charset=utf-8" });
    fname = `${base} (bản dịch).txt`;
  } else {
    let rows = "", lastPage = null;
    for (const p of pairs) {
      if (p.page && p.page !== lastPage) {
        rows += `<tr class="ph"><td colspan="2">Trang ${p.page}</td></tr>`;
        lastPage = p.page;
      }
      rows += `<tr><td>${esc(p.src)}</td><td>${esc(p.trans)}</td></tr>`;
    }
    blob = new Blob([`<!doctype html><meta charset="utf-8"><title>${esc(base)} — song ngữ</title>
<style>body{font:16px/1.6 "Segoe UI",system-ui,sans-serif;margin:0;color:#1f2430}
h1{padding:16px 24px;margin:0;border-bottom:1px solid #ddd;font-size:18px}
table{border-collapse:collapse;width:100%}
td{vertical-align:top;padding:10px 24px;width:50%;border-bottom:1px solid #eee;white-space:pre-wrap}
td:first-child{border-right:1px solid #eee;background:#fafafa}
tr.ph td{background:#eef2ff;font-weight:700;color:#2563eb;text-align:center;width:auto}</style>
<h1>${esc(base)} — bản gốc &amp; bản dịch (${scope})</h1><table>${rows}</table>`], { type: "text/html;charset=utf-8" });
    fname = `${base} (song ngữ).html`;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Đã lưu: " + fname, 3500);
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

/* ---------- text doc (docx/txt) ---------- */
function buildTextBlocks(blocks) {
  const fragL = document.createDocumentFragment(), fragR = document.createDocumentFragment();
  for (const b of blocks) {
    state.src.set(b.i, b.text);
    const lb = document.createElement("div");
    lb.className = "blk" + (b.heading ? " heading" : ""); lb.dataset.i = b.i; lb.textContent = b.text;
    const rb = document.createElement("div");
    rb.className = "blk pending" + (b.heading ? " heading" : ""); rb.dataset.i = b.i; rb.textContent = "…";
    fragL.appendChild(lb); fragR.appendChild(rb);
    state.lEl.set(b.i, lb); state.rEl.set(b.i, rb); io.observe(lb);
  }
  colL.appendChild(fragL); colR.appendChild(fragR);
  paneL.scrollTop = 0; paneR.scrollTop = 0;
}

let rzT = 0;
window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(refitAll, 200); });

/* ================= Đăng nhập / quản lý người dùng ================= */
const gate = $("authgate");
let pendPoll = null;
function stopPendPoll() { if (pendPoll) { clearInterval(pendPoll); pendPoll = null; } }
function showGate(pending, email) {
  gate.classList.remove("hidden");
  $("authForm").classList.toggle("hidden", !!pending);
  $("authPending").classList.toggle("hidden", !pending);
  if (pending && email) $("pendingEmail").textContent = email;
  $("userChip").classList.add("hidden");
  stopPendPoll();
  if (pending) {
    // tự vào ngay khi admin duyệt (không cần tải lại thủ công)
    pendPoll = setInterval(async () => {
      try {
        const r = await fetch("/api/auth/me");
        if (r.status === 401) { stopPendPoll(); showGate(false); return; }
        const me = await r.json();
        if (me.status === "approved") { stopPendPoll(); location.reload(); }
      } catch {}
    }, 15000);
  }
}
function hideGate(me) {
  gate.classList.add("hidden");
  $("userChip").classList.remove("hidden");
  $("meEmail").textContent = me.email;
  $("btnUsers").classList.toggle("hidden", me.role !== "admin");
}
function setAuthMsg(t, cls) {
  const m = $("authMsg");
  m.textContent = t || "";
  m.className = "authmsg" + (cls ? " " + cls : "");
}
async function checkAuth() {
  try {
    const r = await fetch("/api/auth/me");
    if (r.status === 401) { showGate(false); initGoogle(); return; }
    const me = await r.json();
    if (me.status !== "approved") { showGate(true, me.email); return; }
    hideGate(me);
  } catch {
    showGate(false);
    initGoogle();
  }
}
async function handleAuthResp(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { setAuthMsg(d.error || "Lỗi.", "err"); return; }
  setAuthMsg("");
  if (d.status !== "approved") showGate(true, d.email);
  else location.reload();
}
let gsiInited = false;
async function initGoogle() {
  if (gsiInited) return;
  gsiInited = true;
  let conf;
  try { conf = await (await fetch("/api/config")).json(); } catch { return; }
  if (!conf || !conf.googleClientId) return;
  await new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
  if (!(window.google && google.accounts && google.accounts.id)) return;
  google.accounts.id.initialize({
    client_id: conf.googleClientId,
    callback: async (resp) => {
      setAuthMsg("Đang đăng nhập bằng Google…");
      try {
        const r = await fetch("/api/auth/google", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: resp.credential }),
        });
        await handleAuthResp(r);
      } catch (e) { setAuthMsg("Lỗi mạng: " + e.message, "err"); }
    },
  });
  google.accounts.id.renderButton($("gsi"), {
    theme: "filled_blue", size: "large", width: 300, text: "continue_with", locale: "vi",
  });
  $("gsiWrap").classList.remove("hidden");
  try { google.accounts.id.prompt(); } catch {}
}

async function doAuth(path) {
  const email = $("authEmail").value.trim();
  const password = $("authPw").value;
  if (!email || !password) { setAuthMsg("Nhập email và mật khẩu.", "err"); return; }
  setAuthMsg("Đang xử lý…");
  try {
    const r = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await handleAuthResp(r);
  } catch (e) {
    setAuthMsg("Lỗi mạng: " + e.message, "err");
  }
}
$("btnLogin").onclick = () => doAuth("/api/auth/login");
$("btnRegister").onclick = () => doAuth("/api/auth/register");
$("authPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth("/api/auth/login"); });
async function logout() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  location.reload();
}
$("btnLogout").onclick = logout;
$("btnLogout2").onclick = logout;

$("btnUsers").onclick = openAdmin;
$("adminClose").onclick = () => $("adminModal").classList.add("hidden");
$("adminModal").addEventListener("click", (e) => {
  if (e.target === $("adminModal")) $("adminModal").classList.add("hidden");
});
async function openAdmin() {
  $("adminModal").classList.remove("hidden");
  const list = $("adminList");
  list.innerHTML = "<div class='urow'>Đang tải…</div>";
  try {
    const { users } = await apiJSON("/api/admin/users");
    list.innerHTML = "";
    if (!users.length) { list.innerHTML = "<div class='urow'>Chưa có tài khoản nào.</div>"; return; }
    for (const u of users) list.appendChild(userRow(u));
  } catch (e) {
    list.innerHTML = "<div class='urow'>Lỗi: " + esc(e.message) + "</div>";
  }
}
function userRow(u) {
  const row = document.createElement("div");
  row.className = "urow";
  const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString("vi-VN") : "";
  const isAdmin = u.role === "admin";
  const badge = isAdmin ? "admin" : u.status;
  const badgeTxt = isAdmin ? "ADMIN" : u.status === "approved" ? "ĐÃ DUYỆT" : "CHỜ DUYỆT";
  row.innerHTML =
    `<span class="ubadge ${badge}">${badgeTxt}</span>` +
    `<div class="uinfo"><div class="uemail">${esc(u.email)}</div><div class="umeta">Đăng ký: ${created}</div></div>`;
  if (!isAdmin) {
    const t = document.createElement("button");
    t.className = "btn sm";
    t.textContent = u.status === "approved" ? "Huỷ duyệt" : "Duyệt";
    t.onclick = async () => {
      t.disabled = true;
      try {
        await apiJSON("/api/admin/set", {
          email: u.email,
          status: u.status === "approved" ? "pending" : "approved",
        });
        openAdmin();
      } catch (e) { alert(e.message); t.disabled = false; }
    };
    const d = document.createElement("button");
    d.className = "btn sm";
    d.textContent = "Xoá";
    d.onclick = async () => {
      if (!confirm("Xoá tài khoản " + u.email + " ?")) return;
      try { await apiJSON("/api/admin/delete", { email: u.email }); openAdmin(); }
      catch (e) { alert(e.message); }
    };
    row.appendChild(t);
    row.appendChild(d);
  }
  return row;
}

checkAuth();

/* ---------- Cài đặt thành ứng dụng (PWA) ---------- */
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let deferredInstall = null;
function showInstall(on) {
  for (const id of ["btnInstall", "btnInstall2"]) {
    const b = $(id);
    if (b) b.classList.toggle("hidden", !on);
  }
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!isStandalone()) showInstall(true);
});
window.addEventListener("appinstalled", () => { deferredInstall = null; showInstall(false); });
async function doInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    if (outcome === "accepted") showInstall(false);
    return;
  }
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const msg = iOS
    ? "iPhone/iPad: bấm nút Chia sẻ ⬆️ ở thanh Safari → chọn “Thêm vào MH chính”."
    : "Máy tính: bấm biểu tượng cài đặt (⊕ / màn hình nhỏ) ở cuối thanh địa chỉ → Cài đặt.";
  setAuthMsg(msg, "ok");
  toast(msg, 7000);
}
$("btnInstall").onclick = doInstall;
$("btnInstall2").onclick = doInstall;
// iOS không có beforeinstallprompt -> vẫn hiện nút để hướng dẫn
if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) showInstall(true);

/* Service worker network-first: cần cho việc cài app + chạy offline phần vỏ. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
