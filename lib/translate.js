// Dịch máy nhiều đoạn một lúc, có bộ nhớ đệm và tự động chuyển nhà cung cấp khi lỗi.
import * as cache from "./cache.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

// ---------- Google (endpoint clients5, không cần key, chất lượng cao) ----------
async function googleChunk(texts, target) {
  const params = new URLSearchParams({
    client: "dict-chrome-ex",
    sl: "auto",
    tl: target,
  });
  for (const q of texts) params.append("q", q.length ? q : " ");
  const url = "https://clients5.google.com/translate_a/t?" + params.toString();
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("google HTTP " + r.status);
  let data = await r.json();
  if (!Array.isArray(data)) data = [data];
  // Chuẩn hoá: phần tử có thể là chuỗi hoặc mảng [dịch, gốc].
  const flat = data.map((v) => (Array.isArray(v) ? v[0] : v));
  if (texts.length === 1 && flat.length > 1) return [flat.join("")];
  return flat;
}

async function googleBatch(texts, target) {
  const out = new Array(texts.length).fill(null);
  let i = 0;
  while (i < texts.length) {
    const start = i;
    const group = [];
    let chars = 0;
    while (i < texts.length && group.length < 40 && chars < 4200) {
      group.push(texts[i]);
      chars += texts[i].length + 6;
      i++;
    }
    const res = await googleChunk(group, target);
    for (let k = 0; k < group.length; k++) {
      out[start + k] = typeof res[k] === "string" ? res[k] : null;
    }
    if (i < texts.length) await sleep(150);
  }
  return out;
}

// ---------- MyMemory (dự phòng, miễn phí, không cần key) ----------
async function myMemoryOne(text, target) {
  const chunks = text.match(/[\s\S]{1,450}(?=\s|$)|[\s\S]{1,450}/g) || [text];
  const parts = [];
  for (const c of chunks) {
    const url =
      "https://api.mymemory.translated.net/get?langpair=en|" +
      encodeURIComponent(target) +
      "&q=" +
      encodeURIComponent(c);
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("mymemory HTTP " + r.status);
    const d = await r.json();
    const t = d && d.responseData && d.responseData.translatedText;
    if (!t) throw new Error("mymemory rỗng");
    parts.push(t);
  }
  return parts.join(" ");
}

async function myMemoryBatch(texts, target) {
  const out = new Array(texts.length).fill(null);
  for (let k = 0; k < texts.length; k++) {
    try {
      out[k] = await myMemoryOne(texts[k], target);
    } catch {
      out[k] = null;
    }
    await sleep(120);
  }
  return out;
}

// ---------- LLM tuỳ chọn (người dùng tự dán API key) ----------
const LANG_NAME = {
  vi: "Vietnamese",
  en: "English",
  ja: "Japanese",
  zh: "Chinese (Simplified)",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
};

function buildLlmPrompt(texts, target) {
  const lang = LANG_NAME[target] || target;
  const numbered = texts
    .map((t, k) => `#${k + 1}#\n${t}`)
    .join("\n\n");
  return (
    `You are a professional translator specialised in engineering and technical documentation. ` +
    `Translate each numbered segment below into ${lang}. ` +
    `Keep technical terms, product names, code, numbers and units accurate and natural. ` +
    `Return ONLY the translations, each preceded by its own "#n#" marker on its own line, same order, nothing else.\n\n` +
    numbered
  );
}

function parseLlm(textOut, n) {
  const out = new Array(n).fill(null);
  const re = /#(\d+)#\s*\n?([\s\S]*?)(?=\n#\d+#|\s*$)/g;
  let m;
  while ((m = re.exec(textOut))) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < n) out[idx] = m[2].trim();
  }
  return out;
}

async function anthropicBatch(texts, target, apiKey, model) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      messages: [{ role: "user", content: buildLlmPrompt(texts, target) }],
    }),
  });
  if (!r.ok) throw new Error("anthropic HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const txt = (d.content || []).map((c) => c.text || "").join("");
  return parseLlm(txt, texts.length);
}

async function openaiBatch(texts, target, apiKey, model) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: 0.2,
      messages: [{ role: "user", content: buildLlmPrompt(texts, target) }],
    }),
  });
  if (!r.ok) throw new Error("openai HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const txt = d.choices?.[0]?.message?.content || "";
  return parseLlm(txt, texts.length);
}

async function deeplBatch(texts, target, apiKey) {
  const host = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
  const body = new URLSearchParams();
  body.set("target_lang", (target || "vi").toUpperCase());
  for (const t of texts) body.append("text", t);
  const r = await fetch(host + "/v2/translate", {
    method: "POST",
    headers: {
      authorization: "DeepL-Auth-Key " + apiKey,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) throw new Error("deepl HTTP " + r.status);
  const d = await r.json();
  return (d.translations || []).map((x) => x.text);
}

// ---------- Điều phối ----------
// opts: { target, engine, apiKey, model }
// engine: "auto" | "google" | "mymemory" | "anthropic" | "openai" | "deepl"
export async function translateMany(rawTexts, opts = {}) {
  const target = opts.target || "vi";
  const engine = opts.engine || "auto";
  const bucket = engine === "anthropic" || engine === "openai" ? "llm" : "mt";

  const texts = rawTexts.map(normalize);
  const result = new Array(texts.length).fill("");
  const keys = texts.map((t) => cache.keyFor(t, target, bucket));

  const missIdx = [];
  for (let k = 0; k < texts.length; k++) {
    if (!texts[k]) {
      result[k] = "";
      continue;
    }
    const hit = cache.get(keys[k]);
    if (hit) result[k] = hit;
    else missIdx.push(k);
  }
  if (!missIdx.length) return { translations: result, engine: "cache" };

  const missTexts = missIdx.map((k) => texts[k]);
  let used = engine;
  let got = null;

  async function run(name) {
    if (name === "google") return googleBatch(missTexts, target);
    if (name === "mymemory") return myMemoryBatch(missTexts, target);
    if (name === "anthropic")
      return anthropicBatch(missTexts, target, opts.apiKey, opts.model);
    if (name === "openai")
      return openaiBatch(missTexts, target, opts.apiKey, opts.model);
    if (name === "deepl") return deeplBatch(missTexts, target, opts.apiKey);
    throw new Error("engine không hỗ trợ: " + name);
  }

  try {
    if (engine === "auto") {
      try {
        got = await run("google");
        used = "google";
      } catch (e) {
        console.warn("google lỗi, chuyển MyMemory:", e.message);
        got = await run("mymemory");
        used = "mymemory";
      }
    } else {
      got = await run(engine);
    }
  } catch (e) {
    if (engine === "auto") {
      got = await run("mymemory");
      used = "mymemory";
    } else {
      throw e;
    }
  }

  // Ô nào nhà cung cấp chính bỏ trống thì vá bằng MyMemory.
  const holes = [];
  got.forEach((v, k) => {
    if (!v || !String(v).trim()) holes.push(k);
  });
  if (holes.length && used !== "mymemory") {
    try {
      const patch = await myMemoryBatch(
        holes.map((k) => missTexts[k]),
        target
      );
      holes.forEach((k, j) => {
        if (patch[j]) got[k] = patch[j];
      });
    } catch {
      /* bỏ qua, giữ nguyên gốc */
    }
  }

  missIdx.forEach((k, j) => {
    const v = got[j] && String(got[j]).trim() ? String(got[j]).trim() : texts[k];
    result[k] = v;
    if (v && v !== texts[k]) cache.set(keys[k], v);
  });

  return { translations: result, engine: used };
}
