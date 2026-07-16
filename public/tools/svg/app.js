// lilSVG: paste SVG code, preview it live, recolor it, set a background, and
// export as SVG / PNG / JPG / WebP. Fully client-side, no backend.
// Pasted SVG is untrusted markup, so it is sanitized (scripts, event handlers,
// and external references stripped) before it is ever rendered.
(function () {
  const root = document.getElementById('svg-tool');
  if (!root) return;
  const $ = (s) => root.querySelector(s);

  const input = $('#svg-input');
  const preview = $('#svg-preview');
  const previewWrap = $('#preview-wrap');
  const errEl = $('#svg-error');
  const dimsEl = $('#svg-dims');
  const swatchWrap = $('#color-swatches');
  const resetColorsBtn = $('#btn-reset-colors');
  const downloadBtn = $('#btn-download');

  const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
  const STYLE_RE = /(fill|stroke|stop-color|flood-color|lighting-color)\s*:\s*([^;]+)/gi;

  let srcSvg = null; // sanitized source (pre-recolor)
  let colorEdits = {}; // canonical key -> new hex
  let currentBg = 'transparent';
  let lastSig = '';

  // ---- color helpers ----
  const cctx = document.createElement('canvas').getContext('2d');
  function canonical(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (['none', 'transparent', 'inherit', 'currentcolor', 'context-fill', 'context-stroke'].includes(low)) return null;
    if (low.startsWith('url(')) return null;
    cctx.fillStyle = '#000000';
    cctx.fillStyle = s;
    const a = cctx.fillStyle;
    cctx.fillStyle = '#ffffff';
    cctx.fillStyle = s;
    const b = cctx.fillStyle;
    if (a !== b) return null; // browser rejected it, not a real color
    return a; // '#rrggbb' or 'rgba(r, g, b, a)'
  }
  function toInputHex(key) {
    if (key === 'currentColor') return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(key)) return key.toLowerCase();
    const m = key.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
    return '#000000';
  }

  // ---- parse + sanitize ----
  function parseSvg(raw) {
    let doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
    let svg = doc.documentElement;
    const bad = doc.querySelector('parsererror') || !svg || svg.tagName.toLowerCase() !== 'svg';
    if (bad) {
      // Fallback: maybe it is well-formed HTML-ish or has surrounding text.
      const html = new DOMParser().parseFromString(raw, 'text/html');
      const found = html.querySelector('svg');
      if (!found) return { error: 'No valid <svg> found. Paste a complete <svg> ... </svg> element.' };
      doc = new DOMParser().parseFromString(found.outerHTML, 'image/svg+xml');
      svg = doc.documentElement;
      if (doc.querySelector('parsererror') || svg.tagName.toLowerCase() !== 'svg') {
        return { error: 'That SVG has a syntax error and could not be parsed.' };
      }
    }
    sanitize(svg);
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return { svg };
  }
  function sanitize(svg) {
    svg.querySelectorAll('script').forEach((n) => n.remove());
    const all = [svg, ...svg.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        if (n === 'href' || n === 'xlink:href') {
          const v = attr.value.trim().toLowerCase();
          if (v.startsWith('javascript:') || /^https?:/.test(v) || v.startsWith('//')) el.removeAttribute(attr.name);
        }
      }
    }
  }

  // ---- detect distinct colors ----
  function detect(svg) {
    const meta = {}; // key -> {label, inputHex}
    const order = [];
    const add = (raw) => {
      const key = canonical(raw);
      if (!key) return;
      if (!meta[key]) { meta[key] = { label: raw.trim(), inputHex: toInputHex(key) }; order.push(key); }
    };
    let usesCurrent = false;
    const all = [svg, ...svg.querySelectorAll('*')];
    for (const el of all) {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'style') {
        (el.textContent.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).forEach(add);
        continue;
      }
      for (const a of COLOR_ATTRS) {
        if (el.hasAttribute(a)) {
          const v = el.getAttribute(a);
          if (v.trim().toLowerCase() === 'currentcolor') usesCurrent = true;
          else add(v);
        }
      }
      const style = el.getAttribute && el.getAttribute('style');
      if (style) {
        let m;
        STYLE_RE.lastIndex = 0;
        while ((m = STYLE_RE.exec(style))) {
          if (m[2].trim().toLowerCase() === 'currentcolor') usesCurrent = true;
          else add(m[2]);
        }
      }
    }
    if (usesCurrent) { meta.currentColor = { label: 'currentColor', inputHex: toInputHex('currentColor') }; order.push('currentColor'); }
    return { order, meta };
  }

  // ---- apply recolor edits to a clone ----
  function applyEdits(svg) {
    const repl = (val) => {
      const t = val.trim();
      if (t.toLowerCase() === 'currentcolor') return colorEdits.currentColor || val;
      const key = canonical(val);
      return key && colorEdits[key] ? colorEdits[key] : val;
    };
    const all = [svg, ...svg.querySelectorAll('*')];
    for (const el of all) {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'style') {
        el.textContent = el.textContent.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|currentColor/g, (tok) => repl(tok));
        continue;
      }
      for (const a of COLOR_ATTRS) {
        if (el.hasAttribute(a)) el.setAttribute(a, repl(el.getAttribute(a)));
      }
      const style = el.getAttribute && el.getAttribute('style');
      if (style) {
        el.setAttribute('style', style.replace(STYLE_RE, (full, prop, val) => `${prop}:${repl(val)}`));
      }
    }
  }

  // ---- swatches ----
  function renderSwatches(det) {
    swatchWrap.innerHTML = '';
    if (!det.order.length) {
      swatchWrap.innerHTML = '<span class="text-xs text-body-color dark:text-dark-6">No editable colors found in this SVG.</span>';
      resetColorsBtn.classList.add('hidden');
      return;
    }
    resetColorsBtn.classList.remove('hidden');
    for (const key of det.order) {
      const m = det.meta[key];
      const val = colorEdits[key] || m.inputHex;
      const el = document.createElement('label');
      el.className = 'swatch';
      el.innerHTML = `<input type="color" value="${val}" data-key="${key.replace(/"/g, '&quot;')}"><span>${m.label}</span>`;
      el.querySelector('input').addEventListener('input', (e) => {
        colorEdits[e.target.dataset.key] = e.target.value;
        rerender();
      });
      swatchWrap.appendChild(el);
    }
  }

  // ---- render ----
  function intrinsicSize(svg) {
    // Prefer the LARGER of the attribute size and the viewBox size as the raster
    // base. Icon sets ship as width="16" with a 512 viewBox; exporting at 16px
    // would be microscopic, and the viewBox is the real design resolution.
    const aw = parseFloat(svg.getAttribute('width'));
    const ah = parseFloat(svg.getAttribute('height'));
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const hasA = aw > 0 && ah > 0;
    const hasV = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    if (hasA && hasV) return aw * ah >= vb[2] * vb[3] ? { w: aw, h: ah } : { w: vb[2], h: vb[3] };
    if (hasA) return { w: aw, h: ah };
    if (hasV) return { w: vb[2], h: vb[3] };
    return { w: 300, h: 300 };
  }
  function updateDims(svg) {
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    const vb = svg.getAttribute('viewBox');
    if (w && h) dimsEl.textContent = `${w} × ${h}`;
    else if (vb) { const p = vb.split(/[\s,]+/); dimsEl.textContent = `${p[2]} × ${p[3]} (viewBox)`; }
    else dimsEl.textContent = '';
  }
  function buildOut() {
    const out = srcSvg.cloneNode(true);
    applyEdits(out);
    return out;
  }
  function rerender() {
    if (!srcSvg) return;
    const out = buildOut();
    updateDims(out);
    // The preview copy scales to FIT the box, up or down: guarantee a viewBox
    // (tiny icons ship as width="16" and would render as an invisible speck),
    // then drop the fixed size so CSS can letterbox it. Exports are untouched.
    if (!out.getAttribute('viewBox')) {
      const w = parseFloat(out.getAttribute('width'));
      const h = parseFloat(out.getAttribute('height'));
      if (w > 0 && h > 0) out.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    }
    out.removeAttribute('width');
    out.removeAttribute('height');
    preview.innerHTML = '';
    preview.appendChild(document.importNode(out, true));
  }

  function process(force) {
    const raw = input.value.trim();
    downloadBtn.disabled = !raw;
    if (!raw) {
      srcSvg = null;
      preview.innerHTML = '<span class="text-sm">Preview appears here</span>';
      dimsEl.textContent = '';
      swatchWrap.innerHTML = '<span class="text-xs text-body-color dark:text-dark-6">Paste an SVG to detect its colors.</span>';
      resetColorsBtn.classList.add('hidden');
      lastSig = '';
      hideErr();
      return;
    }
    const res = parseSvg(raw);
    if (res.error) { showErr(res.error); return; }
    hideErr();
    srcSvg = res.svg;
    const det = detect(srcSvg);
    const sig = det.order.join('|');
    if (force || sig !== lastSig) {
      for (const k in colorEdits) if (!det.order.includes(k)) delete colorEdits[k];
      renderSwatches(det);
      lastSig = sig;
    }
    rerender();
  }

  function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  function hideErr() { errEl.classList.add('hidden'); }

  // ---- serialize / export ----
  function svgString(forRaster) {
    if (!srcSvg) return '';
    const out = buildOut();
    if (forRaster) {
      const { w, h } = intrinsicSize(out);
      out.setAttribute('width', w);
      out.setAttribute('height', h);
    }
    return new XMLSerializer().serializeToString(out);
  }
  function dataUri() {
    const s = svgString(false);
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportRaster(mime, ext) {
    const { w, h } = intrinsicSize(srcSvg);
    const scaleSel = $('#export-scale').value;
    let outW, outH;
    if (scaleSel === 'custom') {
      const cw = Math.max(1, Math.min(8000, parseInt($('#export-width').value, 10) || Math.round(w)));
      outW = cw; outH = Math.round((cw * h) / w);
    } else {
      const s = parseInt(scaleSel, 10) || 1;
      outW = Math.round(w * s); outH = Math.round(h * s);
    }
    const svgStr = svgString(true);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('render failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    });
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // JPG has no alpha; a solid background also flattens transparency on purpose.
    if (mime === 'image/jpeg' || currentBg !== 'transparent') {
      ctx.fillStyle = currentBg === 'transparent' ? '#ffffff' : currentBg;
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(img, 0, 0, outW, outH);
    await new Promise((resolve) => canvas.toBlob((b) => { if (b) download(b, `lilsvg-export.${ext}`); resolve(); }, mime, 0.92));
  }

  // ---- prettify / minify ----
  function minify(str) {
    return str.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
  }
  function prettify(str) {
    const compact = str.replace(/>\s*</g, '><').trim();
    let pad = 0, out = '';
    compact.replace(/<[^>]+>|[^<]+/g, (tok) => {
      if (/^<\//.test(tok)) pad = Math.max(pad - 1, 0);
      if (tok.trim()) out += '  '.repeat(pad) + tok.trim() + '\n';
      if (/^<[^!?/][^>]*[^/]>$/.test(tok) && !/^<[^>]*\/>$/.test(tok)) pad++;
      return tok;
    });
    return out.trim();
  }

  // ---- background ----
  function setBg(val) {
    currentBg = val;
    const isCustom = !['transparent', '#ffffff', '#000000'].includes(String(val).toLowerCase());
    root.querySelectorAll('.bg-chip[data-bg]').forEach((b) => b.classList.toggle('active', b.dataset.bg === val));
    // The Custom chip is active for any non-preset color; its swatch shows it.
    const cbtn = root.querySelector('#bg-custom-btn');
    const cinput = root.querySelector('#bg-custom');
    const cswatch = root.querySelector('#bg-custom-swatch');
    if (cbtn) cbtn.classList.toggle('active', isCustom);
    if (isCustom) {
      if (cinput) cinput.value = val;
      if (cswatch) cswatch.style.background = val;
    }
    if (val === 'transparent') { previewWrap.classList.add('checkerboard'); previewWrap.style.background = ''; }
    else { previewWrap.classList.remove('checkerboard'); previewWrap.style.background = val; }
  }

  // ---- flash a button label ----
  function flash(btn, text) {
    const old = btn.textContent; btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); flash(btn, 'Copied!'); }
    catch { flash(btn, 'Copy failed'); }
  }

  // ---- wire up ----
  input.addEventListener('input', () => process(false));

  $('#btn-prettify').addEventListener('click', () => { if (input.value.trim()) { input.value = prettify(input.value); process(true); } });
  $('#btn-minify').addEventListener('click', () => { if (input.value.trim()) { input.value = minify(input.value); process(true); } });
  $('#btn-clear').addEventListener('click', () => { input.value = ''; colorEdits = {}; process(true); input.focus(); });
  $('#btn-sample').addEventListener('click', () => { input.value = SAMPLE; colorEdits = {}; process(true); });

  resetColorsBtn.addEventListener('click', () => { colorEdits = {}; process(true); });
  $('#btn-mono-apply').addEventListener('click', () => {
    if (!srcSvg) return;
    const c = $('#mono-color').value;
    const det = detect(srcSvg);
    det.order.forEach((k) => { colorEdits[k] = c; });
    process(true);
  });

  root.querySelectorAll('.bg-chip[data-bg]').forEach((b) => b.addEventListener('click', () => setBg(b.dataset.bg)));
  // The "Custom" chip opens the hidden native color picker.
  $('#bg-custom-btn').addEventListener('click', () => $('#bg-custom').click());
  // Some browsers only fire 'change' (not 'input') when the native color picker
  // closes, so listen for both, otherwise a picked custom background never applies.
  const onCustomBg = (e) => setBg(e.target.value);
  $('#bg-custom').addEventListener('input', onCustomBg);
  $('#bg-custom').addEventListener('change', onCustomBg);

  $('#export-scale').addEventListener('change', (e) => {
    $('#export-width').classList.toggle('hidden', e.target.value !== 'custom');
  });

  downloadBtn.addEventListener('click', async () => {
    if (!srcSvg) return;
    const fmt = $('#export-format').value;
    if (fmt === 'svg') { download(new Blob([svgString(false)], { type: 'image/svg+xml' }), 'lilsvg-export.svg'); return; }
    downloadBtn.disabled = true;
    const original = downloadBtn.textContent; downloadBtn.textContent = 'Rendering…';
    try {
      if (fmt === 'png') await exportRaster('image/png', 'png');
      else if (fmt === 'jpeg') await exportRaster('image/jpeg', 'jpg');
      else if (fmt === 'webp') await exportRaster('image/webp', 'webp');
    } catch { showErr('Could not rasterize this SVG. It may reference external images or fonts.'); }
    downloadBtn.textContent = original; downloadBtn.disabled = false;
  });

  $('#btn-copy-svg').addEventListener('click', (e) => { if (srcSvg) copy(svgString(false), e.currentTarget); });
  $('#btn-copy-datauri').addEventListener('click', (e) => { if (srcSvg) copy(dataUri(), e.currentTarget); });
  $('#btn-copy-css').addEventListener('click', (e) => { if (srcSvg) copy(`background-image: url("${dataUri()}");`, e.currentTarget); });

  const SAMPLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="160" height="160" fill="none" stroke="#536ee5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\n  <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" fill="#22c55e"/>\n  <rect x="3" y="14" width="7" height="7" rx="1" fill="#f59e0b"/>\n  <circle cx="17.5" cy="17.5" r="3.5" fill="#ef4444"/>\n</svg>';

  setBg('transparent');
})();
