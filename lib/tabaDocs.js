// On-demand TABA document store. Plan documents (takanon/tasrit/mmg) used to
// be downloaded during the analysis run — the single longest wait in the
// pipeline ("Downloading plan documents"). Now the run only writes each
// plan's source paths (sources.json, no network), and the actual file is
// fetched the first time something asks for it: the /taba-docs/... route
// (user clicked a document link) or the plan analyzer (needs mmg.zip).
// Downloads cache to disk, so each document is fetched at most once.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const TABA_DOCS_DIR = path.resolve("./cache", "taba-docs");

/** Same sanitization the TABA phase applies to plan numbers. */
function planSafeName(planNumber) {
  return String(planNumber ?? "").replace(/[^a-zA-Z0-9\-\.]/g, "_");
}

const SAFE_NAME_RE = /^[a-zA-Z0-9\-\._]+$/;
const KNOWN_FILES  = new Set(["takanon.pdf", "tasrit.pdf", "mmg.zip"]);

/** A structurally complete zip has its end-of-central-directory signature in
 *  the last 65 KB. A truncated download (observed live: unzipper FILE_ENDED)
 *  fails this and must NOT be cached. */
function zipLooksComplete(buf) {
  const start = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return true;
  }
  return false;
}

async function tryDownloadFile(url, magic, timeoutMs = 30000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
        headers: {
          Referer: "https://apps.land.gov.il/TabaSearch/",
          "User-Agent": "map-context/1.0 (contact@cuboidstudio.com)",
        },
        validateStatus: s => s < 500,
      });
      if (res.status === 404) return null;
      const buf = Buffer.from(res.data);
      if (magic && !buf.slice(0, magic.length).equals(Buffer.from(magic))) return null;
      return buf;
    } catch (_) {
      // retry once, then give up
    }
  }
  return null;
}

const inFlight = new Map(); // "<safe>/<file>" -> Promise<string|null>

/**
 * Ensure a plan document exists locally, downloading it from the source
 * recorded in the plan's sources.json if needed.
 * Returns the absolute file path, or null (unknown plan/file, no source,
 * download failed). Never throws.
 */
function ensurePlanDoc(safeName, filename, opts = {}) {
  const docsDir = opts.docsDir ?? TABA_DOCS_DIR;
  if (!SAFE_NAME_RE.test(safeName) || !KNOWN_FILES.has(filename)) return Promise.resolve(null);

  const localPath = path.join(docsDir, safeName, filename);
  if (fs.existsSync(localPath)) return Promise.resolve(localPath);

  const key = `${safeName}/${filename}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    let sources;
    try {
      sources = JSON.parse(fs.readFileSync(path.join(docsDir, safeName, "sources.json"), "utf8"));
    } catch (_) {
      return null;
    }
    const slot = sources?.files?.[filename];
    if (!slot?.srcPath || !sources.base) return null;

    // mmg zips can be tens of MB from a slow server — give them longer.
    const timeoutMs = filename.endsWith(".zip") ? 90000 : 30000;
    const buf = await tryDownloadFile(`${sources.base}${slot.srcPath}`, slot.magic, timeoutMs);
    if (!buf) return null;
    if (filename.endsWith(".zip") && !zipLooksComplete(buf)) {
      // Truncated/партial zip — caching it would poison every later read.
      return null;
    }
    try {
      fs.writeFileSync(localPath, buf);
    } catch (_) {
      return null;
    }
    return localPath;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

module.exports = { TABA_DOCS_DIR, planSafeName, ensurePlanDoc, tryDownloadFile, zipLooksComplete };
