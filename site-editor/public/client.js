(function () {
  if (new URLSearchParams(location.search).get('__edit') !== '1') return;

  const PAGE = location.pathname;
  const pending = new Map(); // eid -> {kind, eid, value, eidA, eidB}

  const style = document.createElement('style');
  style.textContent = `
    [data-eid][data-etype="text"] { outline: 1px dashed transparent; cursor: text; }
    [data-eid][data-etype="text"]:hover { outline-color: #7cbf6a; }
    [data-eid][data-etype="text"]:focus { outline: 2px solid #4a90d9; outline-offset: 1px; }
    [data-eid][data-etype="img"] { cursor: pointer; position: relative; }
    [data-eid][data-etype="img"]:hover { outline: 2px solid #4a90d9; outline-offset: 2px; }
    .__editor_bar { position: fixed; right: 16px; bottom: 16px; z-index: 999999; background: #1c1c1c;
      color: #fff; padding: 10px 14px; border-radius: 8px; font: 13px -apple-system,Segoe UI,Arial,sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,.3); display: flex; align-items: center; gap: 10px; }
    .__editor_bar button { background: #4a90d9; color: #fff; border: none; padding: 7px 14px; border-radius: 5px;
      font-size: 13px; cursor: pointer; }
    .__editor_bar button:disabled { opacity: .4; cursor: default; }
    .__editor_bar .__editor_count { color: #aaa; }
    .__gal_btn { position: absolute; z-index: 999998; background: rgba(20,20,20,.85); color: #fff; border: none;
      border-radius: 50%; width: 22px; height: 22px; font-size: 14px; line-height: 22px; text-align: center;
      cursor: pointer; padding: 0; }
    .__gal_remove { top: 4px; right: 4px; }
    .__gal_add { position: static; display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; margin: 4px; background: #eee; color: #333; border: 2px dashed #999;
      border-radius: 6px; font-size: 20px; cursor: pointer; }
    .__editor_toast { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 999999;
      background: #222; color: #fff; padding: 8px 16px; border-radius: 6px; font: 13px -apple-system,Segoe UI,Arial,sans-serif; }
  `;
  document.head.appendChild(style);

  function markDirty(entry) {
    pending.set(entry.dedupeKey || String(entry.eid), entry);
    updateBar();
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = '__editor_toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function pickAndUpload() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const dataUrl = await fileToDataUrl(file);
        const res = await fetch('/__editor__/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: PAGE, filename: file.name, dataUrl }),
        });
        const json = await res.json();
        resolve(json.ok ? json.src : null);
      };
      input.click();
    });
  }

  // ---- Text elements ----
  document.querySelectorAll('[data-eid][data-etype="text"]').forEach(el => {
    el.contentEditable = 'true';
    el.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    el.addEventListener('input', () => {
      markDirty({ dedupeKey: 't' + el.dataset.eid, kind: 'text', eid: Number(el.dataset.eid), value: el.innerText });
    });
  });

  // ---- Images (including gallery items) ----
  document.querySelectorAll('[data-eid][data-etype="img"]').forEach(img => {
    img.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const src = await pickAndUpload();
      if (!src) return;
      img.src = src;
      markDirty({ dedupeKey: 'i' + img.dataset.eid, kind: 'image', eid: Number(img.dataset.eid), value: src });
    });
  });

  // ---- Gallery add/remove controls ----
  const galleryGroups = new Map();
  document.querySelectorAll('[data-gallery]').forEach(img => {
    const gid = img.dataset.gallery;
    if (!galleryGroups.has(gid)) galleryGroups.set(gid, []);
    galleryGroups.get(gid).push(img);
  });

  galleryGroups.forEach((imgs) => {
    imgs.forEach(img => {
      const holder = img.closest('figure, a, li, div') || img.parentElement;
      if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';

      const removeBtn = document.createElement('button');
      removeBtn.className = '__gal_btn __gal_remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove image';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (imgs.length <= 1) { toast("Can't remove the last image in a gallery here — edit the page directly for that."); return; }
        holder.style.opacity = '0.25';
        holder.style.pointerEvents = 'none';
        markDirty({ dedupeKey: 'r' + img.dataset.eid, kind: 'remove', eid: Number(img.dataset.eid) });
      });
      holder.appendChild(removeBtn);
    });

    const last = imgs[imgs.length - 1];
    const lastHolder = last.closest('figure, a, li, div') || last.parentElement;
    const addBtn = document.createElement('button');
    addBtn.className = '__gal_add';
    addBtn.textContent = '+';
    addBtn.title = 'Add image to this gallery';
    addBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const src = await pickAndUpload();
      if (!src) return;
      const clone = lastHolder.cloneNode(true);
      clone.querySelectorAll('.__gal_btn, .__gal_add').forEach(b => b.remove());
      const cImg = clone.tagName === 'IMG' ? clone : clone.querySelector('img');
      if (cImg) cImg.src = src;
      lastHolder.after(clone);
      markDirty({ dedupeKey: 'a' + Date.now() + Math.random(), kind: 'add', eid: Number(last.dataset.eid), value: src });
      toast('Image added — hit Save to write it to the file.');
    });
    lastHolder.after(addBtn);
  });

  // ---- Save bar ----
  const bar = document.createElement('div');
  bar.className = '__editor_bar';
  bar.innerHTML = `<span class="__editor_count">0 changes</span><button id="__editor_save" disabled>Save</button>`;
  document.body.appendChild(bar);
  const countEl = bar.querySelector('.__editor_count');
  const saveBtn = bar.querySelector('#__editor_save');

  function updateBar() {
    countEl.textContent = `${pending.size} change${pending.size === 1 ? '' : 's'}`;
    saveBtn.disabled = pending.size === 0;
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const res = await fetch('/__editor__/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: PAGE, ops: Array.from(pending.values()) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast('Saved.');
        setTimeout(() => location.reload(), 500);
      } else {
        toast('Save failed: ' + (json.error || 'unknown error'));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch (err) {
      toast('Save failed: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
})();
