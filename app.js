// Alibi client: rebuild the order in which people crossed the museum hall and
// find the one false statement. State lives in memory only.
'use strict';

const $ = (id) => document.getElementById(id);
const SHORT_ORDINAL = ['1ᵉʳ', '2ᵉ', '3ᵉ', '4ᵉ', '5ᵉ', '6ᵉ', '7ᵉ', '8ᵉ'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const phone = window.matchMedia('(max-width: 860px)');

const state = {
  cases: [],
  index: 0,
  order: [], // slot -> person index, or null
  liar: null, // flagged statement index, or null
  locked: new Set(), // slots placed by a hint
  certified: new Set(), // statements a hint proved true
  checked: null, // { slots: ['ok' | 'bad' | null], liar: 'ok' | 'bad' | 'none' }
  hints: 0,
  revealed: false,
  won: false,
  picking: null, // slot being filled
  message: '',
};

const current = () => state.cases[state.index];
const personIndex = (name) => current().people.findIndex((p) => p.name === name);
const solutionOrder = () => current().solution.map(personIndex);

// ------------------------------------------------------------------ loading
async function boot() {
  const response = await fetch('cases.json');
  const data = await response.json();
  state.cases = data.cases;
  const select = $('case-select');
  state.cases.forEach((c, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `N° ${c.number} · ${c.difficulty}`;
    select.append(option);
  });
  const wanted = Number(new URLSearchParams(location.search).get('case'));
  openCase(wanted >= 1 && wanted <= state.cases.length ? wanted - 1 : 0);
  wire();
}

function openCase(index) {
  state.index = index;
  const c = current();
  state.order = new Array(c.people.length).fill(null);
  resetProgress();
  $('case-select').value = String(index);
  $('dossier-kicker').textContent = `Affaire n° ${c.number} · ${c.difficulty} · ${c.people.length} personnes`;
  $('dossier-title').textContent = c.title;
  $('story').textContent = c.story;
  const cast = $('cast');
  cast.replaceChildren(...c.people.map((p) => {
    const li = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = p.name;
    li.append(name, document.createTextNode(` — ${p.role}`));
    return li;
  }));
  buildSlots();
  buildStatements();
  closePicker(false);
  render();
}

function resetProgress() {
  state.order = state.order.map(() => null);
  state.liar = null;
  state.locked.clear();
  state.certified.clear();
  state.checked = null;
  state.hints = 0;
  state.revealed = false;
  state.won = false;
  state.message = '';
  $('shell').classList.remove('won');
  hideVerdict();
}

// ---------------------------------------------------------------- building
function buildSlots() {
  const c = current();
  const list = $('slots');
  list.style.setProperty('--count', c.people.length);
  list.replaceChildren(...c.people.map((_, slot) => {
    const li = document.createElement('li');
    li.className = 'slot-row';
    li.style.setProperty('--i', slot);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot';
    button.dataset.slot = String(slot);
    if (slot === c.theftSlot) button.classList.add('theft');
    button.innerHTML = '<span class="slot-rank"></span><span class="slot-name"></span><span class="slot-mark" aria-hidden="true"></span>';
    button.querySelector('.slot-rank').textContent = String(slot + 1);
    if (slot !== c.theftSlot) button.querySelector('.slot-rank').style.background = railTone(slot / (c.people.length - 1));
    li.append(button);
    return li;
  }));
}

// Rank discs shade from night (23 h) to a dark dawn ochre (6 h); both ends
// keep white digits above 4.5:1.
const NIGHT = [29, 43, 79];
const DAWN = [133, 86, 26];
function railTone(t) {
  const [r, g, b] = NIGHT.map((v, i) => Math.round(v + (DAWN[i] - v) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

// Names in a statement are set in bold ink so the people stand out.
function statementText(text, people) {
  const p = document.createElement('p');
  p.className = 'statement-text';
  const pattern = new RegExp(`(${people.map((x) => x.name).join('|')})`, 'gu');
  text.split(pattern).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const b = document.createElement('b');
      b.textContent = part;
      p.append(b);
    } else p.append(document.createTextNode(part));
  });
  return p;
}

function buildStatements() {
  const c = current();
  $('statements').replaceChildren(...c.statements.map((text, i) => {
    const li = document.createElement('li');
    li.className = 'statement';
    li.dataset.index = String(i);
    const flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'flag';
    flag.dataset.index = String(i);
    flag.innerHTML = '<span class="flag-num"></span>';
    flag.querySelector('.flag-num').textContent = String(i + 1);
    const stamp = document.createElement('span');
    stamp.className = 'stamp';
    stamp.setAttribute('aria-hidden', 'true');
    stamp.textContent = 'FAUX';
    const body = document.createElement('div');
    body.className = 'statement-body';
    const tag = document.createElement('span');
    tag.className = 'true-tag';
    tag.textContent = 'vraie';
    body.append(statementText(text, c.people), tag);
    li.append(flag, body, stamp);
    return li;
  }));
  $('statements-scroll').scrollTop = 0;
}

// ---------------------------------------------------------------- rendering
function render() {
  const c = current();
  document.querySelectorAll('.slot').forEach((button) => {
    const slot = Number(button.dataset.slot);
    const person = state.order[slot];
    const mark = state.checked ? state.checked.slots[slot] : null;
    button.classList.toggle('filled', person !== null);
    button.classList.toggle('locked', state.locked.has(slot));
    button.classList.toggle('picking', state.picking === slot);
    button.classList.toggle('ok', mark === 'ok');
    button.classList.toggle('bad', mark === 'bad');
    button.querySelector('.slot-name').textContent = person === null ? '—' : c.people[person].name;
    button.querySelector('.slot-mark').textContent = mark === 'ok' ? '✓' : mark === 'bad' ? '✗' : '';
    const who = person === null ? 'vide' : c.people[person].name;
    const verdict = mark === 'ok' ? ', juste' : mark === 'bad' ? ', faux' : '';
    const extra = `${slot === c.theftSlot ? ', passage du vol' : ''}${state.locked.has(slot) ? ', donné par un indice' : ''}`;
    button.setAttribute('aria-label', `${SHORT_ORDINAL[slot]} passage sur ${c.people.length} : ${who}${verdict}${extra}`);
    button.setAttribute('aria-disabled', String(state.locked.has(slot) || state.revealed));
    button.setAttribute('aria-expanded', String(state.picking === slot));
  });

  document.querySelectorAll('.statement').forEach((li) => {
    const i = Number(li.dataset.index);
    const flagged = state.liar === i;
    const certified = state.certified.has(i);
    li.classList.toggle('flagged', flagged);
    li.classList.toggle('certified', certified);
    li.classList.toggle('verdict-ok', flagged && state.checked?.liar === 'ok');
    li.classList.toggle('verdict-bad', flagged && state.checked?.liar === 'bad');
    const flag = li.querySelector('.flag');
    flag.setAttribute('aria-pressed', String(flagged));
    flag.setAttribute('aria-disabled', String(certified || state.revealed));
    flag.setAttribute('aria-label', certified
      ? `Déclaration ${i + 1} : prouvée vraie par un indice`
      : `Déclaration ${i + 1} : ${flagged ? 'désignée fausse — toucher pour retirer' : 'la désigner fausse'}`);
  });

  renderTally();
}

function renderTally() {
  const c = current();
  const n = c.people.length;
  const plural = (k, word) => `${k} ${word}${k > 1 ? 's' : ''}`;
  let text;
  if (state.message) text = state.message;
  else if (state.checked) {
    const ok = state.checked.slots.filter((m) => m === 'ok').length;
    const bad = state.checked.slots.filter((m) => m === 'bad').length;
    const empty = n - ok - bad;
    const liar = { ok: '✓', bad: '✗', none: '?' }[state.checked.liar];
    text = `${ok} ✓ · ${bad} ✗${empty ? ` · ${plural(empty, 'vide')}` : ''} · fausse ${liar}`;
  } else {
    const placed = state.order.filter((p) => p !== null).length;
    text = `${placed}/${n} placés · fausse : ${state.liar === null ? '—' : `n° ${state.liar + 1}`}`;
  }
  if (state.hints && !state.revealed && !state.message) text += ` · ${plural(state.hints, 'indice')}`;
  $('tally').textContent = text;
}

// ------------------------------------------------------------------ picker
function openPicker(slot) {
  if (state.locked.has(slot) || state.revealed) return;
  const c = current();
  state.picking = slot;
  $('picker-title').textContent = `${SHORT_ORDINAL[slot]} passage — qui ?`;
  const grid = $('picker-grid');
  grid.replaceChildren(...c.people.map((p, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pick';
    button.dataset.person = String(i);
    const at = state.order.indexOf(i);
    const lockedThere = at >= 0 && state.locked.has(at);
    button.disabled = lockedThere;
    button.classList.toggle('here', at === slot);
    const name = document.createElement('span');
    name.className = 'pick-name';
    name.textContent = p.name;
    button.append(name);
    if (at >= 0) {
      const where = document.createElement('span');
      where.className = 'pick-where';
      where.textContent = at === slot ? 'ici' : SHORT_ORDINAL[at];
      button.append(where);
    }
    button.setAttribute('aria-label', `${p.name}${at >= 0 ? `, déjà au ${SHORT_ORDINAL[at]} passage` : ''}`);
    return button;
  }));
  $('picker-clear').disabled = state.order[slot] === null;
  $('picker').hidden = false;
  render();
  (grid.querySelector('.pick:not(:disabled):not(.here)') || $('picker-close')).focus();
}

function closePicker(restoreFocus = true) {
  const slot = state.picking;
  state.picking = null;
  $('picker').hidden = true;
  if (restoreFocus && slot !== null) document.querySelector(`.slot[data-slot="${slot}"]`)?.focus();
  if (state.cases.length) render();
}

// Choosing someone already placed swaps them with the slot's occupant.
function place(slot, person) {
  const from = state.order.indexOf(person);
  const previous = state.order[slot];
  if (from >= 0) state.order[from] = previous;
  state.order[slot] = person;
  changed();
}

function changed() {
  state.checked = null;
  state.message = '';
  if (state.won) { state.won = false; $('shell').classList.remove('won'); }
}

// ----------------------------------------------------------------- actions
function toggleLiar(i) {
  if (state.certified.has(i) || state.revealed) return;
  state.liar = state.liar === i ? null : i;
  changed();
  render();
}

function check() {
  const c = current();
  const truth = solutionOrder();
  const slots = state.order.map((p, s) => (p === null ? null : p === truth[s] ? 'ok' : 'bad'));
  const liar = state.liar === null ? 'none' : state.liar === c.liar ? 'ok' : 'bad';
  state.checked = { slots, liar };
  state.message = '';
  const solved = slots.every((m) => m === 'ok') && liar === 'ok';
  render();
  if (solved && !state.revealed) win();
}

// Hint ladder: fix a wrong placement, then a wrong flag; then alternate
// between proving one statement true and placing one person.
function hint() {
  if (state.revealed) return;
  const c = current();
  const truth = solutionOrder();
  const say = (text) => { state.hints++; state.message = text; state.checked = null; render(); };
  const placeAt = (slot) => {
    const person = truth[slot];
    const from = state.order.indexOf(person);
    if (from >= 0) state.order[from] = state.order[slot];
    state.order[slot] = person;
    state.locked.add(slot);
    say(`Indice : ${c.people[person].name} au ${SHORT_ORDINAL[slot]} passage.`);
  };
  const certify = (i) => {
    state.certified.add(i);
    if (state.liar === i) state.liar = null;
    say(`Indice : la n° ${i + 1} est vraie.`);
  };

  const wrong = state.order.findIndex((p, s) => p !== null && p !== truth[s]);
  if (wrong >= 0) return placeAt(wrong);
  if (state.liar !== null && state.liar !== c.liar) return certify(state.liar);

  const uncertified = c.statements.map((_, i) => i).filter((i) => i !== c.liar && !state.certified.has(i));
  const empty = state.order.findIndex((p) => p === null);
  const preferCertify = state.hints % 2 === 0;
  if (uncertified.length && state.liar !== c.liar && (preferCertify || empty < 0)) {
    // Prove true the statement that sits furthest down the list: the player
    // reads top-down, so it removes doubt where they have looked least.
    return certify(uncertified[uncertified.length - 1]);
  }
  if (empty >= 0) return placeAt(empty);
  if (state.liar !== c.liar) {
    state.liar = c.liar;
    return say(`Indice : la n° ${c.liar + 1} est la fausse.`);
  }
  state.message = 'Tout est en place : appuyez sur Vérifier.';
  render();
}

function solve() {
  const c = current();
  state.order = solutionOrder();
  state.liar = c.liar;
  state.revealed = true;
  state.checked = null;
  state.message = `Solution affichée : la n° ${c.liar + 1} était fausse.`;
  closePicker(false);
  render();
}

function clearAll() {
  resetProgress();
  closePicker(false);
  render();
}

// Two-tap confirmation for the destructive actions.
function confirmTap(button, action) {
  if (button.classList.contains('confirm')) {
    clearTimeout(button.confirmTimer);
    button.classList.remove('confirm');
    button.textContent = button.dataset.label;
    action();
    return;
  }
  button.classList.add('confirm');
  button.textContent = 'Sûr ?';
  button.confirmTimer = setTimeout(() => {
    button.classList.remove('confirm');
    button.textContent = button.dataset.label;
  }, 3000);
}

function nextCase() {
  openCase((state.index + 1) % state.cases.length);
}

// ---------------------------------------------------------------- victory
function win() {
  const c = current();
  state.won = true;
  const shell = $('shell');
  shell.classList.remove('won');
  void shell.offsetWidth; // restart the cascade if the player wins again
  shell.classList.add('won');
  const culprit = c.people[personIndex(c.culprit)];
  $('verdict-text').textContent =
    `Ordre exact et fausse déclaration démasquée (n° ${c.liar + 1}). ` +
    `Au ${SHORT_ORDINAL[c.theftSlot]} passage, la vitrine cède : ${culprit.name}, ${culprit.role}, ` +
    `a emporté ${c.object}.`;
  const delay = reducedMotion.matches ? 0 : 120 * c.people.length + 250;
  clearTimeout(win.timer);
  win.timer = setTimeout(showVerdict, delay);
}

function showVerdict() {
  if (!state.won) return;
  $('verdict').hidden = false;
  $('verdict-next').focus();
}
function hideVerdict() {
  clearTimeout(win.timer);
  $('verdict').hidden = true;
}

// ----------------------------------------------------------------- dossier
function setDossier(open) {
  $('shell').classList.toggle('dossier-open', open);
  $('dossier-toggle').setAttribute('aria-expanded', String(open));
  if (open && phone.matches) $('dossier-close').focus();
  else if (!open && phone.matches) $('dossier-toggle').focus();
}

// ------------------------------------------------------------------ wiring
function wire() {
  $('case-select').addEventListener('change', (e) => openCase(Number(e.target.value)));
  $('next-case').addEventListener('click', nextCase);
  $('act-next').addEventListener('click', nextCase);
  $('verdict-next').addEventListener('click', nextCase);
  $('verdict-close').addEventListener('click', () => { hideVerdict(); $('act-check').focus(); });
  $('act-check').addEventListener('click', check);
  $('act-hint').addEventListener('click', hint);
  $('act-solve').addEventListener('click', (e) => confirmTap(e.currentTarget, solve));
  $('act-clear').addEventListener('click', (e) => confirmTap(e.currentTarget, clearAll));
  $('dossier-toggle').addEventListener('click', () => setDossier(!$('shell').classList.contains('dossier-open')));
  $('dossier-close').addEventListener('click', () => setDossier(false));

  $('slots').addEventListener('click', (e) => {
    const button = e.target.closest('.slot');
    if (!button) return;
    const slot = Number(button.dataset.slot);
    if (state.picking === slot) closePicker();
    else openPicker(slot);
  });
  $('picker-grid').addEventListener('click', (e) => {
    const button = e.target.closest('.pick');
    if (!button || button.disabled) return;
    const slot = state.picking;
    place(slot, Number(button.dataset.person));
    // Filling the line top-down: if the next slot is still empty, offer it.
    const next = slot + 1;
    if (next < state.order.length && state.order[next] === null && !state.locked.has(next)) openPicker(next);
    else closePicker();
  });
  $('picker-clear').addEventListener('click', () => {
    const slot = state.picking;
    state.order[slot] = null;
    changed();
    closePicker();
  });
  $('picker-close').addEventListener('click', () => closePicker());
  $('statements').addEventListener('click', (e) => {
    const flag = e.target.closest('.flag');
    if (flag) toggleLiar(Number(flag.dataset.index));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('verdict').hidden) hideVerdict();
    else if (state.picking !== null) closePicker();
    else if ($('shell').classList.contains('dossier-open') && phone.matches) setDossier(false);
  });
}

// Exposed for tools/audit.js (read-only use: it drives the UI by clicks).
window.alibi = { state, solutionOrder };

boot();
