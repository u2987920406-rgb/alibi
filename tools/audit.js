// Alibi layout + gameplay audit. Loads ../index.html in iframes at each size,
// measures the design laws and drives the game through real clicks.
//   phones  360×640, 360×740, 393×852, 412×915: one screen, no page scroll
//   wider   600×900, 1024×768, 1440×900: no horizontal scroll, same laws
// Every case is measured fresh; case 12 (8 people) and the case with the
// longest statements are also measured with the picker open, checked with
// errors, won, solved, hinted and (phones) with the dossier open.
'use strict';

const PHONES = [[360, 640], [360, 740], [393, 852], [412, 915]];
const WIDE = [[600, 900], [1024, 768], [1440, 900]];
const MIN_TARGET = 44;
const MIN_FONT = 16;
const MIN_CONTRAST = 4.5;
const params = new URLSearchParams(location.search);
const VERBOSE = params.has('verbose');
const REDUCED = params.has('reduced');

const lines = [];
const failures = [];
const log = (text) => lines.push(text);
const fail = (text) => { failures.push(text); lines.push(`FAIL ${text}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const r1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ colour
function parseColor(text) {
  const m = text && text.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
  return [Number(r), Number(g), Number(b), Number(a)];
}
const blend = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// Possible backgrounds behind a node: composite every ancestor's solid colour
// or, for gradients, each stop (the worst one wins).
function backgrounds(win, node) {
  const chain = [];
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
  let stack = [[255, 255, 255, 1]];
  for (let i = chain.length - 1; i >= 0; i--) {
    const style = win.getComputedStyle(chain[i]);
    const stops = (style.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parseColor);
    const solid = parseColor(style.backgroundColor);
    if (solid && solid[3] > 0) stack = stack.map((under) => blend(solid, under));
    if (stops.length && chain[i].tagName !== 'SELECT') stack = stack.flatMap((under) => stops.map((s) => blend(s, under)));
  }
  return stack;
}

// ----------------------------------------------------------------- helpers
function visible(win, node) {
  if (!node.getClientRects().length) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    const style = win.getComputedStyle(n);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (style.clipPath.startsWith('inset(50%')) return false; // screen-reader-only text
  }
  return true;
}
const scrolls = (s) => ['auto', 'scroll'].includes(s.overflowY) || ['auto', 'scroll'].includes(s.overflowX);
const describe = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}`;
// Nearest ancestor that clips or scrolls is where hidden overflow would happen.
function blockParent(win, node) {
  let n = node.parentElement;
  while (n && ['inline', 'contents'].includes(win.getComputedStyle(n).display)) n = n.parentElement;
  return n;
}

// ----------------------------------------------------------------- measure
function measure(frame) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const out = {
    fontMin: Infinity, fontAt: '', contrastMin: Infinity, contrastAt: '',
    targetMin: Infinity, targetAt: '', overflow: [], clipped: [], aspect: 0, aspectAt: '',
  };
  const scroller = doc.scrollingElement;
  out.hScroll = scroller.scrollWidth - scroller.clientWidth;
  out.pageScroll = scroller.scrollHeight;
  out.viewport = scroller.clientHeight;

  // Text: size, contrast, clipping by any non-scrolling ancestor.
  const range = doc.createRange();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const host = t.parentElement;
    if (!t.nodeValue.trim() || !host || host.closest('script, style, option, svg')) continue;
    if (!visible(win, host)) continue;
    const style = win.getComputedStyle(host);
    const size = parseFloat(style.fontSize);
    const label = `${describe(host)} "${t.nodeValue.trim().slice(0, 26)}"`;
    if (size < out.fontMin) { out.fontMin = size; out.fontAt = label; }
    const fg = parseColor(style.color);
    for (const bg of backgrounds(win, host)) {
      const c = contrast(blend(fg, bg), bg);
      if (c < out.contrastMin) { out.contrastMin = c; out.contrastAt = `${hex(fg)} on ${hex(bg)} ${label}`; }
    }
    range.selectNodeContents(t);
    const box = range.getBoundingClientRect();
    for (let n = host; n && n !== doc.documentElement; n = n.parentElement) {
      const s = win.getComputedStyle(n);
      if (scrolls(s)) break;
      const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.textOverflow === 'ellipsis';
      const block = !['inline', 'contents'].includes(s.display);
      if (!clips && !block) continue;
      const c = n.getBoundingClientRect();
      const spill = Math.max(c.left - box.left, box.right - c.right, clips ? Math.max(c.top - box.top, box.bottom - c.bottom) : 0);
      if (spill > 1) out.clipped.push(`${label} spills ${r1(spill)}px from ${describe(n)}`);
      if (block && !clips) break;
    }
  }
  // Selected <option> label must fit the closed <select> (minus the arrow).
  doc.querySelectorAll('select').forEach((select) => {
    if (!visible(win, select)) return;
    const s = win.getComputedStyle(select);
    const ctx = doc.createElement('canvas').getContext('2d');
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const text = select.options[select.selectedIndex]?.textContent || '';
    const room = select.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (ctx.measureText(text).width > room) out.clipped.push(`select "${text}" needs ${r1(ctx.measureText(text).width)}px, has ${r1(room)}px`);
    const c = contrast(parseColor(s.color), parseColor(s.backgroundColor));
    if (c < out.contrastMin) { out.contrastMin = c; out.contrastAt = `select "${text}"`; }
    if (parseFloat(s.fontSize) < out.fontMin) { out.fontMin = parseFloat(s.fontSize); out.fontAt = 'select'; }
  });

  // Every rendered box stays inside its block parent (scroll containers excepted).
  doc.querySelectorAll('body *').forEach((node) => {
    if (node.closest('svg') && node.tagName !== 'svg') return;
    if (node.matches('script, style, option') || !visible(win, node)) return;
    if (win.getComputedStyle(node).position === 'fixed') return;
    const parent = blockParent(win, node);
    if (!parent || parent === doc.documentElement || parent === doc.body) return;
    if (scrolls(win.getComputedStyle(parent))) return;
    const a = node.getBoundingClientRect();
    const b = parent.getBoundingClientRect();
    const spill = Math.max(b.left - a.left, a.right - b.right, b.top - a.top, a.bottom - b.bottom);
    if (spill > 0.5) out.overflow.push(`${describe(node)} out of ${describe(parent)} by ${r1(spill)}px`);
  });
  // Fixed layers (dossier sheet, verdict) must stay inside the viewport.
  doc.querySelectorAll('body *').forEach((node) => {
    if (!visible(win, node) || win.getComputedStyle(node).position !== 'fixed') return;
    const a = node.getBoundingClientRect();
    const spill = Math.max(-a.left, -a.top, a.right - win.innerWidth, a.bottom - win.innerHeight);
    if (spill > 0.5) out.overflow.push(`${describe(node)} out of viewport by ${r1(spill)}px`);
  });

  // Touch targets.
  doc.querySelectorAll('button, select, a[href], input, [role="button"]').forEach((node) => {
    if (!visible(win, node)) return;
    const r = node.getBoundingClientRect();
    const m = Math.min(r.width, r.height);
    if (m < out.targetMin) { out.targetMin = m; out.targetAt = `${describe(node)} ${r1(r.width)}×${r1(r.height)}`; }
  });

  // Subject aspect: SVG art vs its viewBox, and round discs must stay round.
  doc.querySelectorAll('svg[viewBox]').forEach((svg) => {
    if (!visible(win, svg)) return;
    const [, , w, h] = svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
    const r = svg.getBoundingClientRect();
    const d = Math.abs((r.width / r.height) / (w / h) - 1);
    if (d > out.aspect) { out.aspect = d; out.aspectAt = describe(svg); }
  });
  doc.querySelectorAll('.slot-rank, .flag').forEach((disc) => {
    if (!visible(win, disc)) return;
    const r = disc.getBoundingClientRect();
    const d = Math.abs(r.width / r.height - 1);
    if (d > out.aspect) { out.aspect = d; out.aspectAt = describe(disc); }
  });

  // Game-specific geometry.
  const slots = [...doc.querySelectorAll('.slot')].map((s) => s.getBoundingClientRect());
  out.slotMin = Math.min(...slots.map((s) => s.height));
  out.slotOrdered = slots.every((s, i) => i === 0 || s.top >= slots[i - 1].bottom - 0.5);
  const timeline = doc.querySelector('.timeline').getBoundingClientRect();
  out.slotsInside = slots.every((s) => s.top >= timeline.top - 0.5 && s.bottom <= timeline.bottom + 0.5);
  const names = [...doc.querySelectorAll('.slot-name')].filter((n) => visible(win, n));
  out.nameLines = Math.max(1, ...names.map((n) => Math.round(n.getBoundingClientRect().height / parseFloat(win.getComputedStyle(n).lineHeight))));
  const list = doc.getElementById('statements-scroll');
  const lb = list.getBoundingClientRect();
  out.statementsWhole = [...doc.querySelectorAll('.statement')].filter((s) => {
    const r = s.getBoundingClientRect();
    return r.top >= lb.top - 0.5 && r.bottom <= lb.bottom + 0.5;
  }).length;
  out.statementsTotal = doc.querySelectorAll('.statement').length;
  out.listHeight = lb.height;
  return out;
}

function report(label, m, phone) {
  const fit = phone ? ` · page ${m.pageScroll}/${m.viewport}px` : '';
  log(`[${label}] font ≥${m.fontMin}px · contraste ≥${m.contrastMin.toFixed(2)}:1 · cible ≥${r1(m.targetMin)}px · ` +
    `h-scroll ${m.hScroll}px${fit} · passage ≥${r1(m.slotMin)}px · déclarations entières ${m.statementsWhole}/${m.statementsTotal} · ` +
    `distorsion ${(m.aspect * 100).toFixed(2)}% · débordements ${m.overflow.length} · texte coupé ${m.clipped.length}`);
  if (VERBOSE) log(`    worst: font ${m.fontAt} · contrast ${m.contrastAt} · target ${m.targetAt} · aspect ${m.aspectAt}`);
  if (m.fontMin < MIN_FONT) fail(`${label}: font ${m.fontMin}px at ${m.fontAt}`);
  if (m.contrastMin < MIN_CONTRAST) fail(`${label}: contrast ${m.contrastMin.toFixed(2)} ${m.contrastAt}`);
  if (m.targetMin < MIN_TARGET) fail(`${label}: target ${m.targetAt}`);
  if (m.hScroll > 0) fail(`${label}: horizontal scroll ${m.hScroll}px`);
  if (phone && m.pageScroll !== m.viewport) fail(`${label}: page scrolls (${m.pageScroll} > ${m.viewport})`);
  if (m.slotMin < MIN_TARGET) fail(`${label}: slot ${r1(m.slotMin)}px tall`);
  if (!m.slotOrdered || !m.slotsInside) fail(`${label}: timeline slots out of order or outside the timeline`);
  if (m.nameLines > 1) fail(`${label}: a name wraps in its slot (${m.nameLines} lines)`);
  if (m.aspect > 0.01) fail(`${label}: aspect distortion ${(m.aspect * 100).toFixed(1)}% at ${m.aspectAt}`);
  m.overflow.slice(0, 6).forEach((o) => fail(`${label}: overflow ${o}`));
  m.clipped.slice(0, 6).forEach((o) => fail(`${label}: clipped ${o}`));
}

// ------------------------------------------------------------------ driving
async function load(width, height) {
  const frame = document.createElement('iframe');
  frame.width = String(width);
  frame.height = String(height);
  document.body.append(frame);
  await new Promise((resolve) => { frame.onload = resolve; frame.src = '../index.html'; });
  for (let i = 0; i < 50 && !frame.contentDocument.querySelector('.statement'); i++) await sleep(100);
  return frame;
}
const q = (frame, sel) => frame.contentDocument.querySelector(sel);
const qa = (frame, sel) => [...frame.contentDocument.querySelectorAll(sel)];
const click = (node) => node.click();
async function openCase(frame, index) {
  const select = q(frame, '#case-select');
  select.value = String(index);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(60);
}
// Place a whole order through the picker, slot by slot.
async function fill(frame, order) {
  for (let slot = 0; slot < order.length; slot++) {
    if (q(frame, '#picker').hidden || frame.contentWindow.alibi.state.picking !== slot) {
      click(q(frame, `.slot[data-slot="${slot}"]`));
    }
    click(q(frame, `.pick[data-person="${order[slot]}"]`));
  }
  if (!q(frame, '#picker').hidden) click(q(frame, '#picker-close'));
  await sleep(30);
}
const settle = () => sleep(REDUCED ? 100 : 2200);
const tally = (frame) => q(frame, '#tally').textContent;

async function auditSize([width, height], phone) {
  const size = `${width}×${height}`;
  const frame = await load(width, height);
  const app = frame.contentWindow.alibi;
  const cases = app.state.cases;

  // 1. Every case, fresh.
  for (let i = 0; i < cases.length; i++) {
    await openCase(frame, i);
    const m = measure(frame);
    if (VERBOSE || i === cases.length - 1) report(`${size} affaire ${i + 1}`, m, phone);
    else {
      const before = failures.length;
      report(`${size} affaire ${i + 1}`, m, phone);
      if (failures.length === before) lines.pop(); // keep the log short when clean
    }
  }

  // Heavy states on the 8-person case with the longest statements.
  const longest = cases.reduce((best, c, i) => {
    const len = c.statements.join('').length;
    return c.people.length === 8 && len > best.len ? { i, len } : best;
  }, { i: cases.length - 1, len: 0 }).i;
  await openCase(frame, longest);
  const c = cases[longest];
  const truth = app.solutionOrder();

  // 2. Picker open on the last slot.
  click(q(frame, `.slot[data-slot="${truth.length - 1}"]`));
  await sleep(30);
  if (q(frame, '#picker').hidden) fail(`${size}: picker did not open`);
  const picks = qa(frame, '.pick').length;
  report(`${size} sélecteur ouvert (${picks} noms)`, measure(frame), phone);
  click(q(frame, '#picker-close'));

  // 3. Wrong order (two swapped) + wrong liar, then Vérifier: ✓/✗ and tally.
  const swapped = truth.slice();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  await fill(frame, swapped);
  const wrongLiar = (c.liar + 1) % c.statements.length;
  click(q(frame, `.flag[data-index="${wrongLiar}"]`));
  click(q(frame, '#act-check'));
  await sleep(50);
  const ok = qa(frame, '.slot.ok').length;
  const bad = qa(frame, '.slot.bad').length;
  if (ok !== truth.length - 2 || bad !== 2) fail(`${size}: check marks ${ok}✓ ${bad}✗, expected ${truth.length - 2}✓ 2✗`);
  if (!/fausse ✗/.test(tally(frame))) fail(`${size}: tally should show a wrong liar, got "${tally(frame)}"`);
  if (!q(frame, '#verdict').hidden) fail(`${size}: verdict shown on a wrong answer`);
  if (!q(frame, '.statement.flagged .stamp') || !visible(frame.contentWindow, q(frame, '.statement.flagged .stamp'))) fail(`${size}: FAUX stamp not shown`);
  log(`[${size}] vérification avec erreurs → « ${tally(frame)} »`);
  report(`${size} vérifié avec erreurs`, measure(frame), phone);

  // 4. Fix it and win.
  await fill(frame, truth);
  click(q(frame, `.flag[data-index="${c.liar}"]`));
  click(q(frame, '#act-check'));
  const anims = frame.contentDocument.getAnimations().length;
  await settle();
  const won = !q(frame, '#verdict').hidden && frame.contentDocument.getElementById('shell').classList.contains('won');
  if (!won) fail(`${size}: no victory after a correct order + liar`);
  if (REDUCED && anims > 0) fail(`${size}: ${anims} animation(s) running under reduced motion`);
  if (!REDUCED && anims === 0) fail(`${size}: no victory animation`);
  log(`[${size}] victoire → « ${tally(frame)} » · animations au déclenchement ${anims}${REDUCED ? ' (mouvement réduit)' : ''}`);
  report(`${size} victoire`, measure(frame), phone);
  click(q(frame, '#verdict-close'));

  // 5. Clear (two taps), then hints, then the solution.
  click(q(frame, '#act-clear'));
  if (frame.contentWindow.alibi.state.order.some((p) => p !== null) === false) fail(`${size}: Effacer cleared on the first tap`);
  click(q(frame, '#act-clear'));
  if (frame.contentWindow.alibi.state.order.some((p) => p !== null)) fail(`${size}: Effacer did not clear`);
  for (let k = 0; k < 4; k++) click(q(frame, '#act-hint'));
  await sleep(30);
  const hinted = qa(frame, '.slot.locked').length;
  const certified = qa(frame, '.statement.certified').length;
  if (hinted + certified !== 4) fail(`${size}: 4 hints gave ${hinted} placements + ${certified} proofs`);
  if (qa(frame, '.statement.certified').some((li) => Number(li.dataset.index) === c.liar)) fail(`${size}: a hint proved the liar true`);
  log(`[${size}] 4 indices → ${hinted} passages posés, ${certified} déclarations prouvées vraies · « ${tally(frame)} »`);
  report(`${size} indices`, measure(frame), phone);
  click(q(frame, '#act-solve'));
  click(q(frame, '#act-solve'));
  await sleep(30);
  const solvedRight = frame.contentWindow.alibi.state.order.join() === truth.join() && frame.contentWindow.alibi.state.liar === c.liar;
  if (!solvedRight) fail(`${size}: Solution did not place the stored answer`);
  report(`${size} solution`, measure(frame), phone);

  // 6. Phones: the dossier sheet opens over the game and closes again.
  if (phone) {
    click(q(frame, '#dossier-toggle'));
    await sleep(30);
    const sheet = q(frame, '#dossier').getBoundingClientRect();
    if (sheet.height < height * 0.9) fail(`${size}: dossier sheet ${r1(sheet.height)}px tall`);
    report(`${size} dossier ouvert`, measure(frame), phone);
    click(q(frame, '#dossier-close'));
    await sleep(30);
    if (visible(frame.contentWindow, q(frame, '#dossier'))) fail(`${size}: dossier did not close`);
  }
  // 7. Affaire suivante.
  const before = frame.contentWindow.alibi.state.index;
  click(q(frame, phone ? '#next-case' : '#act-next'));
  if (frame.contentWindow.alibi.state.index !== (before + 1) % cases.length) fail(`${size}: next case did not open`);
  frame.remove();
}

(async () => {
  log(`Alibi audit — ${REDUCED ? 'prefers-reduced-motion: reduce' : 'mouvement normal'}`);
  log(`lois : texte ≥ ${MIN_FONT}px, contraste ≥ ${MIN_CONTRAST}:1, cibles ≥ ${MIN_TARGET}px, aucun débordement, aucun texte coupé, ratio préservé, 0 scroll horizontal ; téléphones : 0 scroll de page`);
  for (const size of PHONES) await auditSize(size, true);
  for (const size of WIDE) await auditSize(size, size[0] <= 860);
  log('');
  log(failures.length ? `RESULT FAIL (${failures.length})` : 'RESULT PASS');
  document.getElementById('audit-out').textContent = lines.join('\n');
})().catch((error) => {
  document.getElementById('audit-out').textContent = `${lines.join('\n')}\nRESULT FAIL crash: ${error.stack}`;
});
