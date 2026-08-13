/**
 * 极简 xlsx 生成器。
 *
 * 为什么自己写：Worker 环境跑不了 exceljs / sheetjs 那种依赖 Node API 的库，
 * 而我们只需要「多个 sheet、纯文本单元格」，没有样式、公式、图片的需求。
 * 于是直接手写 OOXML + 一个 store-only（不压缩）的 ZIP 封装，约 150 行搞定。
 *
 * 用 inlineStr 存字符串，省掉 sharedStrings.xml 这一层。
 * 不压缩会让文件偏大，但评论分析导出通常也就几百 KB，可以接受。
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const files: Array<{ path: string; data: Uint8Array }> = [];
  const enc = new TextEncoder();
  const add = (path: string, xml: string) => files.push({ path, data: enc.encode(xml) });

  const safe = sheets.length ? sheets : [{ name: 'Sheet1', rows: [[]] }];

  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${safe
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`,
  );

  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${safe.map((s, i) => `<sheet name="${sheetName(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets>
</workbook>`,
  );

  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safe
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
</Relationships>`,
  );

  safe.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));

  return zipStore(files);
}

/** Excel 的 sheet 名限制：≤31 字符，不能含 : \ / ? * [ ] */
function sheetName(name: string, index: number): string {
  const cleaned = (name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  return escapeXml(cleaned || `Sheet${index + 1}`);
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((row, ri) => {
      const cells = row
        .map((v, ci) => {
          const text = v == null ? '' : String(v);
          if (text === '') return '';
          return `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function colName(n: number): string {
  let s = '';
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 不允许的控制字符，留着 Excel 会直接报文件损坏
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// --- ZIP（store，不压缩）-----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 本地文件头签名
    lv.setUint16(4, 20, true); // 需要的版本
    lv.setUint16(6, 0x0800, true); // 标志位：文件名是 UTF-8
    lv.setUint16(8, 0, true); // 压缩方式 0 = store
    lv.setUint16(10, 0, true); // 修改时间
    lv.setUint16(12, 0x21, true); // 修改日期（1980-01-01，固定值保证输出可复现）
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    locals.push(local, f.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // 中央目录签名
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // 本地头偏移
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + f.data.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...locals, ...centrals, eocd];
  const total = all.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of all) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
