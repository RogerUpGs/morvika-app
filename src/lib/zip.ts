// Enkel ZIP-fil uten komprimering (bilder og PDF-er er allerede komprimert).
// Filnavn med æøå lagres som UTF-8, slik at de vises riktig i Windows og på Mac.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

export interface ZipEntry { name: string; data: Uint8Array<ArrayBuffer>; date?: Date }

export function makeZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const [t, d] = dosTime(e.date ?? new Date());
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, t, true); local.setUint16(12, d, true);
    local.setUint32(14, crc, true); local.setUint32(18, e.data.length, true); local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(local.buffer, name as Uint8Array<ArrayBuffer>, e.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, t, true); cen.setUint16(14, d, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, e.data.length, true); cen.setUint32(24, e.data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    const c = new Uint8Array(46 + name.length); c.set(new Uint8Array(cen.buffer), 0); c.set(name, 46);
    central.push(c);
    offset += 30 + name.length + e.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Rydder et filnavn så det virker i alle systemer, og gjør det unikt i mappen */
export function uniqueName(used: Set<string>, folder: string, name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'fil';
  let full = `${folder}/${clean}`; let i = 2;
  const dot = clean.lastIndexOf('.');
  while (used.has(full.toLowerCase())) {
    full = dot > 0 ? `${folder}/${clean.slice(0, dot)} (${i})${clean.slice(dot)}` : `${folder}/${clean} (${i})`;
    i++;
  }
  used.add(full.toLowerCase());
  return full;
}
