'use strict';

/*
 * A small, forgiving HTML scanner — not a full parser. It walks the raw file
 * text once and records the exact character offsets of:
 *   - "leaf" text elements (h1–h6, p) that contain no nested tags
 *   - <img> tags: their src attribute value, their whole tag, and — if the
 *     image is the sole content of a wrapping element like <figure> or <a> —
 *     that wrapper's range too (used so add/remove/reorder move the real
 *     item, not just the bare <img>)
 *   - galleries: any element whose direct children are 2+ images (or 2+
 *     single-image wrappers)
 *
 * It never modifies anything. scanEditable() is called fresh on every
 * request (load or save) and — being a pure function of the file's current
 * text — produces the same ids for the same content every time, so the
 * server needs no session state between a page load and its save.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const SKIP_CONTENT_TAGS = new Set(['script', 'style']);
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);

function scanEditable(html) {
  const regions = [];
  const stack = [];
  let i = 0;
  const n = html.length;

  function makeRegion(obj) {
    const region = { eid: regions.length, ...obj };
    regions.push(region);
    return region;
  }

  function isImageLikeItem(frame) {
    if (frame.tag === 'img') return frame.imgRegion || null;
    if (frame.children.length === 1 && frame.children[0].tag === 'img') return frame.children[0].imgRegion || null;
    return null;
  }

  function finalizeFrame(frame, contentEnd) {
    frame.end = contentEnd;
    frame.outerEnd = VOID_TAGS.has(frame.tag) ? frame.openEnd : (html.indexOf('>', contentEnd) + 1);

    // Single-image wrapper (e.g. <figure><img></figure>, <a><img></a>):
    // record the wrapper's own range on that image's region.
    if (frame.children.length === 1 && frame.children[0].tag === 'img' && frame.children[0].imgRegion) {
      const only = frame.children[0];
      const before = html.slice(frame.openEnd, only.start).trim();
      const after = html.slice(only.outerEnd, frame.end).trim();
      if (!before && !after) {
        only.imgRegion.wrapperStart = frame.start;
        only.imgRegion.wrapperEnd = frame.outerEnd;
      }
    }

    // Gallery detection: 2+ direct children that are each either an <img>
    // or a single-image wrapper.
    if (frame.children.length >= 2) {
      const items = frame.children.map(isImageLikeItem);
      if (items.every(Boolean)) {
        const galleryId = `g${regions.length}_${frame.start}`;
        items.forEach((imgRegion, idx) => {
          imgRegion.galleryId = galleryId;
          imgRegion.galleryIndex = idx;
          imgRegion.galleryLast = idx === items.length - 1;
        });
      }
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(frame);

    if (frame.tag === 'img') return;

    if (TEXT_TAGS.has(frame.tag)) {
      const inner = html.slice(frame.openEnd, frame.end);
      if (!inner.includes('<')) {
        makeRegion({ type: 'text', tag: frame.tag, start: frame.openEnd, end: frame.end });
      }
    }
  }

  while (i < n) {
    if (html[i] !== '<') { i++; continue; }

    if (html.startsWith('<!--', i)) { const c = html.indexOf('-->', i + 4); i = c === -1 ? n : c + 3; continue; }
    if (html.startsWith('<!', i)) { const c = html.indexOf('>', i); i = c === -1 ? n : c + 1; continue; }

    const isClose = html[i + 1] === '/';
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i + (isClose ? 2 : 1)));
    if (!nameMatch) { i++; continue; }
    const tagName = nameMatch[0].toLowerCase();

    let j = i + (isClose ? 2 : 1) + tagName.length;
    let quote = null;
    while (j < n) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    const tagEnd = j;
    const tagRaw = html.slice(i, tagEnd + 1);
    const selfClosing = tagRaw[tagRaw.length - 2] === '/' || VOID_TAGS.has(tagName);

    if (isClose) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tagName) {
          const frame = stack.splice(k)[0];
          finalizeFrame(frame, i);
          break;
        }
      }
      i = tagEnd + 1;
      continue;
    }

    if (SKIP_CONTENT_TAGS.has(tagName)) {
      const closeIdx = html.toLowerCase().indexOf(`</${tagName}`, tagEnd + 1);
      i = closeIdx === -1 ? n : html.indexOf('>', closeIdx) + 1;
      continue;
    }

    const frame = { tag: tagName, start: i, openEnd: tagEnd + 1, children: [] };

    if (tagName === 'img') {
      const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tagRaw);
      if (srcMatch) {
        const attrIdxInTag = tagRaw.indexOf(srcMatch[0]);
        const valueOffsetInAttr = srcMatch[0].indexOf(srcMatch[1]) + 1;
        const srcStart = i + attrIdxInTag + valueOffsetInAttr;
        const srcVal = srcMatch[2] !== undefined ? srcMatch[2] : srcMatch[3];
        const srcEnd = srcStart + srcVal.length;
        frame.imgRegion = makeRegion({ type: 'img', srcStart, srcEnd, outerStart: i, outerEnd: tagEnd + 1 });
      }
    }

    if (!selfClosing) stack.push(frame);
    else finalizeFrame(frame, tagEnd + 1);

    i = tagEnd + 1;
  }

  return { regions };
}

module.exports = { scanEditable };
