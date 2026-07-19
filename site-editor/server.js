'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { scanEditable } = require('./lib/scan');

const SITE_ROOT = path.resolve(process.argv[2] || '.');
const PORT = Number(process.argv[3] || 5051);

if (!fs.existsSync(SITE_ROOT) || !fs.statSync(SITE_ROOT).isDirectory()) {
  console.error(`Not a folder: ${SITE_ROOT}`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain',
};

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.__site-editor']);

function findHtmlFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      findHtmlFiles(full, base, out);
    } else if (/\.html?$/i.test(entry.name)) {
      out.push('/' + path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function safeJoin(root, relPath) {
  const decoded = decodeURIComponent(relPath.split('?')[0]);
  const full = path.normalize(path.join(root, decoded));
  if (!full.startsWith(root)) return null; // path traversal guard
  return full;
}

function escText(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Inject data-eid/data-etype/data-gallery markers into the tags the scanner
// found, without touching anything else. Insertion offsets shift as we go,
// so we work from the end of the file backwards.
function instrument(html) {
  const { regions } = scanEditable(html);
  const inserts = []; // { at, text }

  for (const r of regions) {
    if (r.type === 'text') {
      const openInsertAt = findOpenTagInsertPoint(html, r.start);
      inserts.push({ at: openInsertAt, mark: ` data-eid="${r.eid}" data-etype="text"` });
    } else {
      const openInsertAt = findOpenTagInsertPoint(html, r.outerStart);
      let mark = ` data-eid="${r.eid}" data-etype="img"`;
      if (r.galleryId) {
        mark += ` data-gallery="${r.galleryId}" data-gidx="${r.galleryIndex}"${r.galleryLast ? ' data-glast="1"' : ''}`;
      }
      inserts.push({ at: openInsertAt, mark });
    }
  }

  inserts.sort((a, b) => b.at - a.at);
  let out = html;
  for (const ins of inserts) {
    out = out.slice(0, ins.at) + ins.mark + out.slice(ins.at);
  }
  return out;
}

// Given the index of an element's content-start (for text) or tag-start (for
// img outerStart), find where inside the *opening tag* to splice a new
// attribute — i.e. right after the tag name.
function findOpenTagInsertPoint(html, anchor) {
  // Walk backwards from `anchor` to the tag's '<', then forward past the name.
  let start = anchor;
  if (html[start] !== '<') {
    // anchor is a content-start index (right after '>'); the tag is just before it.
    start = html.lastIndexOf('<', anchor - 1);
  }
  const m = /^<\/?[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(start));
  return start + (m ? m[0].length : 1);
}

const EDITOR_SCRIPT_TAG = '\n<script src="/__editor__/client.js"></script>\n</body>';

function buildEditPage(html) {
  let out = instrument(html);
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, EDITOR_SCRIPT_TAG);
  else out += `<script src="/__editor__/client.js"></script>`;
  return out;
}

function applyOps(html, ops) {
  const { regions } = scanEditable(html);
  const byId = new Map(regions.map(r => [r.eid, r]));
  const edits = []; // { start, end, replacement }

  for (const op of ops) {
    if (op.kind === 'text') {
      const r = byId.get(op.eid);
      if (r && r.type === 'text') edits.push({ start: r.start, end: r.end, replacement: escText(op.value) });
    } else if (op.kind === 'image') {
      const r = byId.get(op.eid);
      if (r && r.type === 'img') edits.push({ start: r.srcStart, end: r.srcEnd, replacement: escAttr(op.value) });
    } else if (op.kind === 'remove') {
      const r = byId.get(op.eid);
      if (r && r.type === 'img') {
        const s = r.wrapperStart ?? r.outerStart, e = r.wrapperEnd ?? r.outerEnd;
        edits.push({ start: s, end: e, replacement: '' });
      }
    } else if (op.kind === 'add') {
      const r = byId.get(op.eid);
      if (r && r.type === 'img') {
        const s = r.wrapperStart ?? r.outerStart, e = r.wrapperEnd ?? r.outerEnd;
        const template = html.slice(s, e);
        const origSrc = html.slice(r.srcStart, r.srcEnd);
        const duplicate = template.split(origSrc).join(escAttr(op.value));
        edits.push({ start: e, end: e, replacement: duplicate });
      }
    } else if (op.kind === 'swap') {
      const a = byId.get(op.eidA), b = byId.get(op.eidB);
      if (a && b && a.type === 'img' && b.type === 'img') {
        const as = a.wrapperStart ?? a.outerStart, ae = a.wrapperEnd ?? a.outerEnd;
        const bs = b.wrapperStart ?? b.outerStart, be = b.wrapperEnd ?? b.outerEnd;
        const aText = html.slice(as, ae), bText = html.slice(bs, be);
        edits.push({ start: as, end: ae, replacement: bText });
        edits.push({ start: bs, end: be, replacement: aText });
      }
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 30 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  try {
    if (pathname === '/__editor__/' || pathname === '/__editor__') {
      const pages = findHtmlFiles(SITE_ROOT);
      return send(res, 200, renderShell(pages), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (pathname === '/__editor__/client.js') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'client.js')), { 'Content-Type': 'application/javascript' });
    }

    if (pathname === '/__editor__/save' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const filePath = safeJoin(SITE_ROOT, body.page);
      if (!filePath || !fs.existsSync(filePath)) return send(res, 400, JSON.stringify({ ok: false, error: 'bad page path' }));
      const html = fs.readFileSync(filePath, 'utf8');
      const patched = applyOps(html, body.ops || []);
      fs.writeFileSync(filePath, patched, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
    }

    if (pathname === '/__editor__/upload' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const pageDir = path.dirname(safeJoin(SITE_ROOT, body.page) || SITE_ROOT);
      const uploadsDir = path.join(SITE_ROOT, 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      const m = /^data:(.+?);base64,(.*)$/.exec(body.dataUrl || '');
      if (!m) return send(res, 400, JSON.stringify({ ok: false, error: 'bad image data' }));
      const ext = (body.filename && path.extname(body.filename)) || ('.' + (m[1].split('/')[1] || 'png'));
      let base = (body.filename ? path.basename(body.filename, path.extname(body.filename)) : 'image').replace(/[^a-z0-9_-]/gi, '_');
      let dest, tries = 0;
      do {
        const suffix = tries === 0 ? '' : `_${tries}`;
        dest = path.join(uploadsDir, `${base}${suffix}${ext}`);
        tries++;
      } while (fs.existsSync(dest));
      fs.writeFileSync(dest, Buffer.from(m[2], 'base64'));
      const relFromPage = path.relative(pageDir, dest).split(path.sep).join('/');
      return send(res, 200, JSON.stringify({ ok: true, src: relFromPage }), { 'Content-Type': 'application/json' });
    }

    // Static file serving (real files, untouched) — with ?__edit=1 instrumentation for html.
    let filePath = safeJoin(SITE_ROOT, pathname === '/' ? '/index.html' : pathname);
    if (!filePath) return send(res, 403, 'Forbidden');
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) return send(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    if (/\.html?$/i.test(ext) && parsed.query.__edit === '1') {
      const html = fs.readFileSync(filePath, 'utf8');
      return send(res, 200, buildEditPage(html), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    return send(res, 200, fs.readFileSync(filePath), { 'Content-Type': mime });
  } catch (err) {
    console.error(err);
    return send(res, 500, 'Server error: ' + err.message);
  }
});

function renderShell(pages) {
  const items = pages.sort().map(p =>
    `<div class="pg" data-href="${p}">${p}</div>`
  ).join('\n');
  return fs.readFileSync(path.join(__dirname, 'public', 'shell.html'), 'utf8').replace('{{PAGES}}', items);
}

server.listen(PORT, () => {
  console.log(`Site editor running.`);
  console.log(`  Editing:      http://localhost:${PORT}/__editor__/`);
  console.log(`  Serving from: ${SITE_ROOT}`);
});
