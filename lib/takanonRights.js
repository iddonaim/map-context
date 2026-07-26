// Building-rights extraction from digital takanon PDFs (P3 of
// docs/TABA_ANALYSIS_SCOPE.md). Modern mavat takanons are born-digital and
// carry Table 5 ("טבלת זכויות והוראות בנייה") — quantitative rights per land
// designation. This module finds that table in the PDF text layer and
// reconstructs it from positioned text items.
//
// Hebrew PDFs are extracted in *visual* order: rows are rebuilt by clustering
// item y-positions and reading right-to-left by x, and some producers emit
// Hebrew strings reversed — see maybeFixReversedHebrew. Scanned takanons have
// no text layer at all; extraction returns an empty result with a
// "no-text-layer" note instead of guessing.

const fs = require("fs");

// ── Normalization ────────────────────────────────────────────

// Strip whitespace, punctuation and gershayim so יח"ד ≈ יחד, שצ"פ ≈ שצפ.
function normalizeHe(s) {
  return String(s ?? "")
    .replace(/[\s.,:;()\[\]"'׳״“”‘’%-]/g, "")
    .toLowerCase();
}

// Common designation words used to detect reversed Hebrew output.
const KNOWN_HEBREW_WORDS = [
  "מגורים", "מסחר", "תעסוקה", "ציבור", "מוסדות", "דרך", "חניה", "חניון",
  "תעשיה", "תעשייה", "מלונאות", "תיירות", "חקלאי", "פתוח", "פרטי", "ציבורי",
  "שטח", "יעוד", "ייעוד", "קומות", "גובה", "בניה", "בנייה", "זכויות",
  "תכסית", "יחד", "דיור", "טבלה", "הוראות", "מרתף", "עיקרי", "שירות",
];

// Some PDF producers store Hebrew glyphs in visual (reversed) order. If a
// string matches a known Hebrew word only when reversed, un-reverse it.
function maybeFixReversedHebrew(s) {
  const str = String(s ?? "");
  if (!/[֐-׿]/.test(str)) return str;
  const norm = normalizeHe(str);
  const revNorm = normalizeHe([...str].reverse().join(""));
  const hits = (n) => KNOWN_HEBREW_WORDS.filter(w => n.includes(w)).length;
  return hits(revNorm) > hits(norm) ? [...str].reverse().join("") : str;
}

// ── Table reconstruction ─────────────────────────────────────

/**
 * Cluster positioned text items ({str, x, y}) into rows by y proximity.
 * Returns rows sorted top-to-bottom (PDF y-axis points up), each row's cells
 * sorted right-to-left (RTL table order).
 */
function itemsToRows(items, yTol = 3) {
  const clean = items.filter(it => it.str && it.str.trim());
  const rows = [];
  for (const it of clean) {
    let row = rows.find(r => Math.abs(r.y - it.y) <= yTol);
    if (!row) { row = { y: it.y, cells: [] }; rows.push(row); }
    row.cells.push({ x: it.x, str: it.str.trim() });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.cells.sort((a, b) => b.x - a.x);
  return rows;
}

// Header keyword → rights field. Matched against normalized cell text.
const HEADER_FIELDS = [
  { field: "designation",     kws: ["יעוד", "ייעוד", "שימוש"] },
  { field: "floorsBelow",     kws: ["מרתף", "מתחתלכניסה", "מתחתלמפלס"] },
  { field: "floorsAbove",     kws: ["קומות", "מסקומות", "מספרקומות"] },
  { field: "coveragePercent", kws: ["תכסית"] },
  { field: "farPercent",      kws: ["אחוזיבניה", "אחוזיבנייה", "זכויותבניה", "זכויותבנייה", "שטחעיקרי", "סהכבניה", "סהכבנייה", "בניה", "בנייה"] },
  { field: "heightM",         kws: ["גובה"] },
  { field: "units",           kws: ["יחד", "יחידותדיור", "מסיחד", "דירות"] },
];

function headerFieldFor(cellText) {
  const n = normalizeHe(maybeFixReversedHebrew(cellText));
  if (!n) return null;
  for (const { field, kws } of HEADER_FIELDS) {
    if (kws.some(kw => n.includes(kw))) return field;
  }
  return null;
}

/** First number in a cell ("180%", "32.5 מ'", "1,200") or null. */
function parseCellNumber(s) {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Given rows from itemsToRows, locate the header row of a rights table and
 * parse the data rows under it. Column ownership is by nearest header x.
 */
function parseRightsTable(rows) {
  let headerIdx = -1;
  let columns = null; // [{field, x}]

  for (let i = 0; i < rows.length; i++) {
    const fields = rows[i].cells
      .map(c => ({ field: headerFieldFor(c.str), x: c.x }))
      .filter(c => c.field);
    const uniq = new Set(fields.map(f => f.field));
    // A real header names the designation column plus at least two metrics.
    if (uniq.has("designation") && uniq.size >= 3) {
      headerIdx = i;
      const seen = new Set();
      columns = fields.filter(f => !seen.has(f.field) && seen.add(f.field));
      break;
    }
  }
  if (headerIdx < 0) return null;

  const rights = [];
  let misses = 0;
  for (let i = headerIdx + 1; i < rows.length && misses < 3; i++) {
    const entry = {};
    for (const cell of rows[i].cells) {
      const col = columns.reduce((best, c) =>
        Math.abs(c.x - cell.x) < Math.abs(best.x - cell.x) ? c : best);
      if (col.field === "designation") {
        const txt = maybeFixReversedHebrew(cell.str);
        entry.designation = entry.designation ? `${entry.designation} ${txt}` : txt;
      } else if (entry[col.field] == null) {
        entry[col.field] = parseCellNumber(cell.str);
      }
    }
    const metricCount = ["farPercent", "coveragePercent", "floorsAbove", "floorsBelow", "heightM", "units"]
      .filter(k => entry[k] != null).length;
    if (entry.designation && metricCount >= 1) {
      rights.push({
        designation:     entry.designation,
        farPercent:      entry.farPercent      ?? null,
        coveragePercent: entry.coveragePercent ?? null,
        floorsAbove:     entry.floorsAbove     ?? null,
        floorsBelow:     entry.floorsBelow     ?? null,
        heightM:         entry.heightM         ?? null,
        units:           entry.units           ?? null,
      });
      misses = 0;
    } else {
      misses++;
    }
  }
  return rights.length ? rights : null;
}

// ── PDF driver ───────────────────────────────────────────────

const MAX_PAGES = 80;

function pageLooksLikeTable5(pageNorm) {
  if (pageNorm.includes("טבלה5")) return true;
  return pageNorm.includes("זכויות") && /בניי?ה/.test(pageNorm) && pageNorm.includes("טבל");
}

/**
 * Extract building rights from a takanon PDF.
 * Returns { rights, confidence, tablePage, pagesScanned, note }.
 * Never throws — failures degrade to an empty low-confidence result.
 */
async function extractRightsFromTakanon(pdfPath) {
  const empty = (note) => ({ rights: [], confidence: "low", tablePage: null, pagesScanned: 0, note });

  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch (e) {
    return empty(`pdfjs unavailable: ${e.message}`);
  }

  let doc;
  try {
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    doc = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (e) {
    return empty(`pdf load failed: ${e.message}`);
  }

  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    let totalItems = 0;
    let sawTableMarker = false;

    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.map(it => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      }));
      totalItems += items.length;

      const pageNorm = normalizeHe(items.map(i => maybeFixReversedHebrew(i.str)).join(""));
      if (!pageLooksLikeTable5(pageNorm)) continue;
      sawTableMarker = true;

      const rights = parseRightsTable(itemsToRows(items));
      if (rights) {
        return {
          rights: rights.map(r => ({ ...r, source: { doc: "takanon", page: p } })),
          confidence: pageNorm.includes("טבלה5") ? "high" : "medium",
          tablePage: p,
          pagesScanned: p,
          note: doc.numPages > MAX_PAGES ? `scan capped at ${MAX_PAGES}/${doc.numPages} pages` : null,
        };
      }
    }

    if (totalItems < 20 * pages) return { ...empty("no-text-layer (scanned PDF?)"), pagesScanned: pages };
    return { ...empty(sawTableMarker ? "table found but not parseable" : "no rights table found"), pagesScanned: pages };
  } catch (e) {
    return empty(`pdf parse failed: ${e.message}`);
  } finally {
    try { await doc.destroy(); } catch (_) {}
  }
}

module.exports = {
  extractRightsFromTakanon,
  _internal: {
    normalizeHe,
    maybeFixReversedHebrew,
    itemsToRows,
    headerFieldFor,
    parseCellNumber,
    parseRightsTable,
    pageLooksLikeTable5,
  },
};
