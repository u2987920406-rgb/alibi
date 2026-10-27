// Independent verifier for Alibi. It does not import or mirror the generator:
// it reads only the French text of each statement, translates it back into a
// predicate with regular expressions (gender agreement included), then
// enumerates every order × every liar choice.
//   pairs  = (order, liar) such that the liar is false and all others true
//   strict = orders in which at most one statement is false
// A case passes when both are exactly 1 and match the stored order and liar.
import { readFileSync } from 'node:fs';

const { cases } = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

const NUMBERS = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
const RANKS = {
  première: 0, deuxième: 1, troisième: 2, quatrième: 3, cinquième: 4, sixième: 5, septième: 6, huitième: 7,
};

function translate(text, puzzle) {
  const n = puzzle.people.length;
  const index = new Map(puzzle.people.map((p, i) => [p.name, i]));
  const N = `(${puzzle.people.map((p) => p.name).join('|')})`;
  const at = (name) => {
    if (!index.has(name)) throw new Error(`unknown person "${name}" in: ${text}`);
    return index.get(name);
  };
  // "passé" / "passée" must agree with the subject.
  const agree = (name, suffix) => {
    const want = puzzle.people[at(name)].gender === 'f' ? 'e' : '';
    if ((suffix || '') !== want) throw new Error(`agreement "${name} … passé${suffix || ''}" in: ${text}`);
  };
  const rules = [
    [new RegExp(`^Il y avait exactement (une|deux|trois|quatre|cinq|six) personnes? entre ${N} et ${N}\\.$`, 'u'),
      ([, k, a, b]) => {
        if ((k === 'une') !== !text.includes('personnes')) throw new Error(`plural in: ${text}`);
        const gap = NUMBERS[k]; const x = at(a); const y = at(b);
        return (pos) => Math.abs(pos[x] - pos[y]) - 1 === gap;
      }],
    [new RegExp(`^${N} et ${N} ne sont pas passé(e?)s l’(une?) juste après l’autre\\.$`, 'u'),
      ([, a, b, e, one]) => {
        const bothF = puzzle.people[at(a)].gender === 'f' && puzzle.people[at(b)].gender === 'f';
        if ((e === 'e') !== bothF || (one === 'une') !== bothF) throw new Error(`agreement in: ${text}`);
        const x = at(a); const y = at(b);
        return (pos) => Math.abs(pos[x] - pos[y]) !== 1;
      }],
    [new RegExp(`^${N} n’est passé(e?) ni en premier ni en dernier\\.$`, 'u'),
      ([, a, e]) => { agree(a, e); const x = at(a); return (pos) => pos[x] !== 0 && pos[x] !== n - 1; }],
    [new RegExp(`^${N} est passé(e?) en premier\\.$`, 'u'),
      ([, a, e]) => { agree(a, e); const x = at(a); return (pos) => pos[x] === 0; }],
    [new RegExp(`^${N} est passé(e?) en dernier\\.$`, 'u'),
      ([, a, e]) => { agree(a, e); const x = at(a); return (pos) => pos[x] === n - 1; }],
    [new RegExp(`^${N} est passé(e?) en (\\p{L}+) position\\.$`, 'u'),
      ([, a, e, word]) => {
        agree(a, e);
        if (!(word in RANKS) || RANKS[word] >= n) throw new Error(`rank "${word}" in: ${text}`);
        const x = at(a); const r = RANKS[word];
        return (pos) => pos[x] === r;
      }],
    [new RegExp(`^${N} est passé(e?) juste (avant|après) ${N}\\.$`, 'u'),
      ([, a, e, way, b]) => {
        agree(a, e); const x = at(a); const y = at(b);
        return way === 'avant' ? (pos) => pos[y] - pos[x] === 1 : (pos) => pos[x] - pos[y] === 1;
      }],
    [new RegExp(`^${N} est passé(e?) après ${N} mais avant ${N}\\.$`, 'u'),
      ([, a, e, b, c]) => {
        agree(a, e); const x = at(a); const lo = at(b); const hi = at(c);
        return (pos) => pos[lo] < pos[x] && pos[x] < pos[hi];
      }],
    [new RegExp(`^${N} est passé(e?) (avant|après) ${N}\\.$`, 'u'),
      ([, a, e, way, b]) => {
        agree(a, e); const x = at(a); const y = at(b);
        return way === 'avant' ? (pos) => pos[x] < pos[y] : (pos) => pos[x] > pos[y];
      }],
  ];
  const hits = rules.map(([re, build]) => [text.match(re), build]).filter(([m]) => m);
  if (hits.length !== 1) throw new Error(`${hits.length} readings for: ${text}`);
  const [match, build] = hits[0];
  return build(match);
}

// Heap's algorithm over people indices; calls visit(order).
function eachOrder(n, visit) {
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  visit(a);
  for (let i = 1; i < n;) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0;
      [a[i], a[j]] = [a[j], a[i]];
      visit(a);
      c[i]++; i = 1;
    } else { c[i] = 0; i++; }
  }
}

let failures = 0;
for (const puzzle of cases) {
  let tests;
  try {
    tests = puzzle.statements.map((text) => translate(text, puzzle));
  } catch (error) {
    failures++;
    console.log(`#${puzzle.number} FAIL lecture : ${error.message}`);
    continue;
  }
  const n = puzzle.people.length;
  const pos = new Array(n);
  let pairs = 0;
  let strict = 0;
  let found = null;
  let orders = 0;
  eachOrder(n, (order) => {
    orders++;
    order.forEach((person, rank) => { pos[person] = rank; });
    const falses = [];
    for (let i = 0; i < tests.length && falses.length < 2; i++) if (!tests[i](pos)) falses.push(i);
    if (falses.length <= 1) strict++;
    if (falses.length === 1) { pairs++; found = { order: order.map((i) => puzzle.people[i].name), liar: falses[0] }; }
  });
  const ok = pairs === 1 && strict === 1 && found
    && found.order.join() === puzzle.solution.join() && found.liar === puzzle.liar;
  if (!ok) failures++;
  console.log(`#${String(puzzle.number).padStart(2)} ${puzzle.difficulty.padEnd(9)} ${n} pers. ` +
    `${tests.length} décl. ordres=${orders} solutions(ordre×menteuse)=${pairs} ordres≤1faux=${strict} ` +
    `menteuse=n°${found ? found.liar + 1 : '?'} stockée=n°${puzzle.liar + 1} ${ok ? 'OK' : 'FAIL'}`);
}

console.log(failures === 0
  ? `\n${cases.length}/${cases.length} affaires à solution unique (ré-analyse du texte français).`
  : `\n${failures} affaire(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
