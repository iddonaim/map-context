// Test-fixture builders: minimal but spec-correct .shp / .dbf / stored .zip
// binaries, so tabaAnalysis tests exercise the REAL shapefile+unzipper path
// instead of mocks. Polygons only — that's all mmg layers need.

// ── SHP (ESRI shapefile, shape type 5 = Polygon) ─────────────

function buildShp(polygons) {
  // polygons: array of rings-arrays; each ring is [[x,y],...] (closed)
  const records = polygons.map((rings, i) => {
    const points = rings.flat();
    const numParts = rings.length;
    const numPoints = points.length;
    const contentLen = 4 + 32 + 8 + numParts * 4 + numPoints * 16; // bytes

    const buf = Buffer.alloc(8 + contentLen);
    buf.writeInt32BE(i + 1, 0);              // record number
    buf.writeInt32BE(contentLen / 2, 4);     // content length in 16-bit words
    let o = 8;
    buf.writeInt32LE(5, o); o += 4;          // shape type: polygon
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    buf.writeDoubleLE(Math.min(...xs), o); o += 8;
    buf.writeDoubleLE(Math.min(...ys), o); o += 8;
    buf.writeDoubleLE(Math.max(...xs), o); o += 8;
    buf.writeDoubleLE(Math.max(...ys), o); o += 8;
    buf.writeInt32LE(numParts, o); o += 4;
    buf.writeInt32LE(numPoints, o); o += 4;
    let partStart = 0;
    for (const ring of rings) { buf.writeInt32LE(partStart, o); o += 4; partStart += ring.length; }
    for (const [x, y] of points) { buf.writeDoubleLE(x, o); o += 8; buf.writeDoubleLE(y, o); o += 8; }
    return buf;
  });

  const body = Buffer.concat(records);
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);                        // file code
  header.writeInt32BE((100 + body.length) / 2, 24);    // file length in words
  header.writeInt32LE(1000, 28);                       // version
  header.writeInt32LE(5, 32);                          // shape type
  const allPts = polygons.flat(2);
  const xs = allPts.map(p => p[0]), ys = allPts.map(p => p[1]);
  header.writeDoubleLE(Math.min(...xs), 36);
  header.writeDoubleLE(Math.min(...ys), 44);
  header.writeDoubleLE(Math.max(...xs), 52);
  header.writeDoubleLE(Math.max(...ys), 60);
  return Buffer.concat([header, body]);
}

// ── DBF (dBase III, character fields only) ───────────────────

function buildDbf(fields, records) {
  // fields: [{name, length}], records: [{name: value}]
  const headerSize = 32 + fields.length * 32 + 1;
  const recordSize = 1 + fields.reduce((s, f) => s + f.length, 0);

  const head = Buffer.alloc(32);
  head[0] = 0x03;
  head[1] = 95; head[2] = 7; head[3] = 26;             // last-update date
  head.writeInt32LE(records.length, 4);
  head.writeInt16LE(headerSize, 8);
  head.writeInt16LE(recordSize, 10);

  const descriptors = fields.map(f => {
    const d = Buffer.alloc(32);
    d.write(f.name.slice(0, 10), 0, "ascii");
    d.write("C", 11, "ascii");
    d[16] = f.length;
    return d;
  });

  const rows = records.map(rec => {
    const r = Buffer.alloc(recordSize, 0x20);
    r[0] = 0x20; // not deleted
    let o = 1;
    for (const f of fields) {
      const val = Buffer.from(String(rec[f.name] ?? ""), "utf8").slice(0, f.length);
      val.copy(r, o);
      o += f.length;
    }
    return r;
  });

  return Buffer.concat([head, ...descriptors, Buffer.from([0x0d]), ...rows, Buffer.from([0x1a])]);
}

// ── ZIP (stored, no compression) ─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
  // entries: [{name, data(Buffer)}]
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // compressed (stored)
    local.writeUInt32LE(data.length, 22);  // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

module.exports = { buildShp, buildDbf, buildStoredZip, crc32 };
