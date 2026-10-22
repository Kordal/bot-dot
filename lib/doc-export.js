// A reply or a Markdown file taken out of botdot as a document (#348): Word, PDF or Markdown, the same for both apps.
// The text is read into blocks by the rules the chat draws by (mdBlocks, the same as public/app.js and Android's
// parseBlocks, test/fixtures/markdown-cases.json). Nothing in it is markup: the text is escaped before it is read, Word
// is written by botdot itself, and the PDF is WeasyPrint's from HTML botdot writes, with no address fetched.
const zlib = require('zlib');
const { spawn } = require('child_process');

const FORMATS = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
};
const MAX_TEXT = 1024 * 1024;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));

// The same blocks as mdBlocks in public/app.js, from the escaped text: heading (level, text), para (text), item (text,
// number or null, depth, task?), quote (text), rule, code (text, lang) and table (rows). A rule changes in all three.
function mdBlocks(src) {
  const code = [];
  const lines = esc(src || '').replace(/\r\n?/g, '\n').replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, c) => {
    code.push({ text: c.replace(/\n$/, ''), lang });
    return `\n\u0000${code.length - 1}\u0000\n`;
  }).split('\n');
  const out = [];
  let para = [];
  let stack = [], nums = [], item = null, blank = false;
  const flush = () => { if (para.length) out.push({ type: 'para', text: para.join('\n') }); para = []; };
  const endList = () => { stack = []; nums = []; item = null; blank = false; };
  const isTable = (t) => /^\|.*\|$/.test(t);
  const title = (line, i) => {
    const m = line.match(/^\*\*([^*]+)\*\*:?\s*$/);
    const text = m ? m[1].replace(/:$/, '').trim() : '';
    if (!text || text.replace(/&(amp|lt|gt|quot|#39);/g, '.').length > 60 || /[.!?]$/.test(text)) return '';
    return lines.slice(i + 1).some((l) => l.trim()) ? text : '';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    let m;
    if ((m = t.match(/^\u0000(\d+)\u0000$/))) { flush(); endList(); out.push({ type: 'code', text: code[m[1]]?.text ?? '', lang: code[m[1]]?.lang ?? '' }); }
    else if (isTable(t)) {
      flush(); endList();
      const rows = [];
      for (; i < lines.length && isTable(lines[i].trim()); i++) {
        const r = lines[i].trim();
        if (!/^[|:\-\s]+$/.test(r)) rows.push(r.slice(1, -1).split('|').map((c) => c.trim()));
      }
      i--;
      if (rows.length) out.push({ type: 'table', rows });
    }
    else if (!t) { flush(); if (item) blank = true; }
    else if (/^(---|\*\*\*|___)$/.test(t)) { flush(); endList(); out.push({ type: 'rule' }); }
    else if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flush(); endList(); out.push({ type: 'heading', level: Math.min(m[1].length, 4), text: m[2] }); }
    else if (t.startsWith('&gt;')) {
      flush(); endList();
      const quoted = [];
      for (; i < lines.length && lines[i].trim().startsWith('&gt;'); i++) quoted.push(lines[i].trim().slice(4).trim());
      i--;
      out.push({ type: 'quote', text: quoted.join('\n') });
    }
    else if ((m = line.match(/^(\s*)(?:[-*•+]|(\d{1,9})[.)])\s+(.*)$/))) {
      flush();
      while (stack.length && stack[stack.length - 1] >= m[1].length) stack.pop();
      if (stack.length > 3) stack.length = 3;
      const depth = stack.length;
      stack.push(m[1].length);
      nums.length = depth + 1;
      const number = m[2] === undefined ? null : nums[depth] != null ? nums[depth] + 1 : parseInt(m[2], 10);
      nums[depth] = number;
      const task = m[3].trim().match(/^\[([ xX])\]\s+(.*)$/);
      item = task ? { type: 'item', text: task[2], number, depth, task: task[1] === ' ' ? 'todo' : 'done' } : { type: 'item', text: m[3].trim(), number, depth };
      out.push(item);
      blank = false;
    }
    else if (item && (!blank || /^\s/.test(line))) { item.text += `\n${t}`; blank = false; }
    else if ((m = title(line, i))) { flush(); endList(); out.push({ type: 'heading', level: 3, text: m }); }
    else { endList(); para.push(t); }
  }
  flush();
  return out;
}

// An escaped line of text as runs: { text (plain), bold, italic, code, strike, link }, by the chat's inline rules.
function runsOf(t) {
  const runs = [];
  const re = /`([^`]+)`|~~([^~\s](?:[^~]*[^~\s])?)~~|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
  let at = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > at) runs.push({ text: unesc(t.slice(at, m.index)) });
    if (m[1] != null) runs.push({ text: unesc(m[1]), code: true });
    else if (m[2] != null) runs.push({ text: unesc(m[2]), strike: true });
    else if (m[3] != null) runs.push(...runsOf(m[3]).map((r) => ({ ...r, bold: true })));
    else if (m[4] != null) runs.push(...runsOf(m[4]).map((r) => ({ ...r, italic: true })));
    else runs.push({ text: unesc(m[5]), link: unesc(m[6]) });
    at = re.lastIndex;
  }
  if (at < t.length) runs.push({ text: unesc(t.slice(at)) });
  return runs;
}

// The document's title: the one asked for, else its first heading, else "Document".
function titleOf(asked, blocks) {
  const t = String(asked || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (t) return t;
  const h = blocks.find((b) => b.type === 'heading');
  return h ? runsOf(h.text).map((r) => r.text).join('').trim().slice(0, 200) || 'Document' : 'Document';
}
// A file name from a title: its words, safe on every system.
function fileName(title, format) {
  const base = String(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 80) || 'document';
  return `${base}.${format}`;
}

// ---------- HTML, for the PDF ----------

function htmlOf(title, blocks) {
  const inline = (t) => runsOf(t).map((r) => {
    let h = esc(r.text);
    if (r.code) h = `<code>${h}</code>`;
    if (r.strike) h = `<del>${h}</del>`;
    if (r.italic) h = `<em>${h}</em>`;
    if (r.bold) h = `<strong>${h}</strong>`;
    if (r.link) h = `<a href="${esc(r.link)}">${h}</a>`;
    return h;
  }).join('');
  const text = (t) => t.split('\n').map(inline).join('<br>');
  const body = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'item') {
      // A list: its items, each indented by its depth; the number as written in the chat.
      const items = [];
      for (; i < blocks.length && blocks[i].type === 'item'; i++) {
        const it = blocks[i];
        const mark = it.task ? (it.task === 'done' ? '☑' : '☐') : it.number == null ? '•' : `${it.number}.`;
        items.push(`<div class="li" style="margin-left:${1.4 * it.depth}em"><span class="mk">${mark}</span><span>${text(it.text)}</span></div>`);
      }
      i--;
      body.push(`<div class="list">${items.join('')}</div>`);
    }
    else if (b.type === 'heading') body.push(`<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`);
    else if (b.type === 'quote') body.push(`<blockquote>${text(b.text)}</blockquote>`);
    else if (b.type === 'rule') body.push('<hr>');
    else if (b.type === 'code') body.push(`<pre><code>${b.text}</code></pre>`);
    else if (b.type === 'table') body.push(`<table>${b.rows.map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table>`);
    else body.push(`<p>${text(b.text)}</p>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4; margin: 2cm 2cm 2.2cm; @bottom-center { content: counter(page); font-size: 9pt; color: #777; } }
body { font-family: "DejaVu Sans", "Liberation Sans", sans-serif; font-size: 10.5pt; line-height: 1.5; color: #111; }
h1 { font-size: 20pt; margin: 0 0 14pt; } h2 { font-size: 15pt; margin: 18pt 0 6pt; } h3 { font-size: 12.5pt; margin: 14pt 0 4pt; }
h4, h5 { font-size: 11pt; margin: 12pt 0 4pt; } p { margin: 0 0 8pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }
th, td { border: 0.6pt solid #bbb; padding: 4pt 6pt; text-align: left; vertical-align: top; } th { background: #f0f0f0; }
pre { background: #f4f4f4; padding: 8pt; font-size: 8.5pt; white-space: pre-wrap; } code { font-family: "DejaVu Sans Mono", monospace; font-size: 9pt; }
blockquote { border-left: 2pt solid #bbb; margin: 0 0 8pt; padding-left: 8pt; color: #444; }
.list { margin: 0 0 8pt; } .li { display: flex; gap: 6pt; } .mk { min-width: 1.2em; }
a { color: #1a5fb4; } hr { border: 0; border-top: 0.6pt solid #ccc; }
</style></head><body><h1>${esc(title)}</h1>
${body.join('\n')}
</body></html>`;
}

// The PDF of the HTML, by WeasyPrint (in the image, Dockerfile). Nothing is fetched: the HTML links no file, and the
// base address is a folder that does not exist. A machine without WeasyPrint answers 501.
function pdfOf(html, { bin = 'weasyprint', timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(bin, ['--base-url', '/nonexistent/', '-', '-'], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    const out = [], err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? Object.assign(new Error('PDF needs WeasyPrint, which this machine does not have. Take Word or Markdown.'), { status: 501, state: 'no-pdf' }) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const pdf = Buffer.concat(out);
      if (code === 0 && pdf.subarray(0, 5).toString() === '%PDF-') return resolve(pdf);
      reject(Object.assign(new Error("Couldn't make the PDF."), { status: 502, detail: Buffer.concat(err).toString().slice(-500) }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(html);
  });
}

// ---------- Word ----------

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function docxOf(title, blocks) {
  const links = [];
  const run = (r) => {
    const props = [r.bold && '<w:b/>', r.italic && '<w:i/>', r.strike && '<w:strike/>', r.code && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>',
      r.link && '<w:color w:val="1A5FB4"/><w:u w:val="single"/>'].filter(Boolean).join('');
    const parts = r.text.split('\n').map((p) => `<w:t xml:space="preserve">${xml(p)}</w:t>`).join('<w:br/>');
    const w = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts}</w:r>`;
    if (!r.link) return w;
    links.push(r.link);
    return `<w:hyperlink r:id="rIdL${links.length}">${w}</w:hyperlink>`;
  };
  const runs = (t) => t.split('\n').map((line) => runsOf(line).map(run).join('')).join('<w:r><w:br/></w:r>');
  const p = (inner, style, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${inner}</w:p>`;
  const body = [p(run({ text: title }), 'Title')];
  for (const b of blocks) {
    if (b.type === 'heading') body.push(p(runs(b.text), `Heading${b.level}`));
    else if (b.type === 'para') body.push(p(runs(b.text)));
    else if (b.type === 'quote') body.push(p(runs(b.text), 'Quote'));
    else if (b.type === 'rule') body.push(p('', null, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>'));
    else if (b.type === 'code') body.push(...unesc(b.text).split('\n').map((l) => p(run({ text: l, code: true }), 'Code')));
    else if (b.type === 'item') {
      const mark = b.task ? (b.task === 'done' ? '☑' : '☐') : b.number == null ? '•' : `${b.number}.`;
      const left = 360 + 360 * b.depth;
      body.push(p(`${run({ text: `${mark}\t` })}${runs(b.text)}`, 'ListParagraph', `<w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="300"/>`));
    }
    else if (b.type === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const cell = (c, head) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>' : ''}</w:tcPr>${p(head ? runsOf(c).map((r) => run({ ...r, bold: true })).join('') : runs(c))}</w:tc>`;
      body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>${b.rows.map((r, ri) => `<w:tr>${ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: cols }, (_, i) => cell(r[i] ?? '', ri === 0)).join('')}</w:tr>`).join('')}</w:tbl>`, p(''));
    }
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id, name, ppr, rpr, based = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:next w:val="Normal"/><w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title', 'Title', '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="44"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="32"/>')}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="28"/>')}
${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="24"/>')}
${style('Heading4', 'heading 4', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="3"/>', '<w:b/><w:i/><w:sz w:val="22"/>')}
${style('Quote', 'Quote', '<w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr>', '<w:color w:val="555555"/>')}
${style('Code', 'Code', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/>')}
${style('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/>', '')}
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:left w:val="single" w:sz="4" w:color="BBBBBB"/><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:right w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideH w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideV w:val="single" w:sz="4" w:color="BBBBBB"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>botdot</dc:creator></cp:coreProperties>`,
    'word/document.xml': document,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${links.map((l, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l)}" TargetMode="External"/>`).join('')}</Relationships>`,
  };
  return zip(files);
}

// A zip of { name: text }, each part deflated (the format Word reads; zlib.crc32 needs Node 22.2).
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const n = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

// The document in a format: { name, type, body }. A text that is not one, too long, or a format botdot does not make
// is a 400.
async function exportDoc({ title, text, format } = {}, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Nothing to export.'), { status: 400 });
  if (Buffer.byteLength(text) > MAX_TEXT) throw Object.assign(new Error('Too long to export: at most 1 MB of text.'), { status: 400 });
  if (!FORMATS[format]) throw Object.assign(new Error('Say the format: docx, pdf or md.'), { status: 400 });
  let blocks = mdBlocks(text);
  const t = titleOf(title, blocks);
  // A first heading that is the title is not written twice.
  if (blocks[0]?.type === 'heading' && runsOf(blocks[0].text).map((r) => r.text).join('').trim() === t) blocks = blocks.slice(1);
  const name = fileName(t, format);
  if (format === 'md') return { name, type: FORMATS.md, body: Buffer.from(text, 'utf8') };
  if (format === 'docx') return { name, type: FORMATS.docx, body: docxOf(t, blocks) };
  return { name, type: FORMATS.pdf, body: await pdfOf(htmlOf(t, blocks), opts) };
}

module.exports = { FORMATS, mdBlocks, runsOf, titleOf, fileName, htmlOf, docxOf, pdfOf, zip, exportDoc };
