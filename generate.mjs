// Deterministic case generator for Alibi.
// Each case: an ordered line of N people crossing the museum hall, and a set
// of French statements about that order, exactly one of which is false.
// A case is written only if exhaustive enumeration proves that the true order
// is the ONLY permutation in which at most one statement is false. That is
// stronger than "one (order, liar) pair": for every wrong liar choice the
// remaining statements are contradictory, and for the right one they force
// a single order. If any case fails, nothing is written.
import { writeFileSync } from 'node:fs';

const SEED = 'alibi-vauclair-2026';
const PLAN = [
  ...Array(4).fill({ difficulty: 'facile', size: 6 }),
  ...Array(4).fill({ difficulty: 'moyenne', size: 7 }),
  ...Array(4).fill({ difficulty: 'difficile', size: 8 }),
];

// ------------------------------------------------------------------ random
function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
function shuffle(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------ content
// Short first names keep the timeline column and the statements narrow on a phone.
const PEOPLE = [
  ['Hugo', 'm'], ['Inès', 'f'], ['Jules', 'm'], ['Léa', 'f'], ['Omar', 'm'], ['Nina', 'f'],
  ['Rémi', 'm'], ['Elsa', 'f'], ['Théo', 'm'], ['Iris', 'f'], ['Malo', 'm'], ['Zoé', 'f'],
  ['Yann', 'm'], ['Maud', 'f'], ['Félix', 'm'], ['Rose', 'f'], ['Igor', 'm'], ['Jade', 'f'],
  ['Marc', 'm'], ['Lise', 'f'], ['Noé', 'm'], ['Ada', 'f'], ['Basile', 'm'], ['Odile', 'f'],
];
const ROLES = [
  ['gardien de nuit', 'gardienne de nuit'], ['agent d’entretien', 'agente d’entretien'],
  ['conservateur', 'conservatrice'], ['restaurateur', 'restauratrice'], ['électricien', 'électricienne'],
  ['livreur', 'livreuse'], ['stagiaire', 'stagiaire'], ['photographe', 'photographe'],
  ['guide', 'guide'], ['mécène', 'mécène'], ['pompier de garde', 'pompière de garde'], ['traiteur', 'traiteuse'],
];
const CASES = [
  ['Le camée bleu', 'le camée bleu de Pompéi', 'de la salle des antiques'],
  ['La montre du Régent', 'la montre en or du Régent', 'de la galerie des horloges'],
  ['Le scarabée d’or', 'le scarabée d’or de Karnak', 'de l’aile égyptienne'],
  ['L’astrolabe', 'l’astrolabe de Nuremberg', 'du cabinet des sciences'],
  ['Le carnet vert', 'le carnet de croquis vert', 'de la salle des dessins'],
  ['La broche libellule', 'la broche libellule en émail', 'de la galerie Art nouveau'],
  ['Le sceau perdu', 'le sceau de cire des ducs', 'de la salle des chartes'],
  ['L’éventail', 'l’éventail de nacre', 'du salon XVIIIᵉ'],
  ['La boussole', 'la boussole de l’expédition polaire', 'de la salle des voyages'],
  ['Le bouddha de jade', 'le petit bouddha de jade', 'de l’aile asiatique'],
  ['La clé d’argent', 'la clé d’argent du trésor', 'de la salle du trésor'],
  ['Le dernier masque', 'le masque de bal vénitien', 'de la galerie des fêtes'],
];
const ORDINAL = ['première', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième', 'huitième'];
const SHORT_ORDINAL = ['1ʳᵉ', '2ᵉ', '3ᵉ', '4ᵉ', '5ᵉ', '6ᵉ', '7ᵉ', '8ᵉ'];
const COUNT = ['aucune', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six'];
const WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'];

// --------------------------------------------------------------- statements
// A statement is { kind, args, text }. `holds(pos)` reads pos[person] = rank.
const KINDS = {
  next: { holds: ([a, b], pos) => pos[b] - pos[a] === 1 },
  before: { holds: ([a, b], pos) => pos[a] < pos[b] },
  gap: { holds: ([a, b, k], pos) => Math.abs(pos[a] - pos[b]) - 1 === k },
  inner: { holds: ([a], pos, n) => pos[a] !== 0 && pos[a] !== n - 1 },
  between: { holds: ([y, z, w], pos) => pos[z] < pos[y] && pos[y] < pos[w] },
  rank: { holds: ([a, r], pos) => pos[a] === r },
  apart: { holds: ([a, b], pos) => Math.abs(pos[a] - pos[b]) !== 1 },
};

function phrase(stmt, people, n, rng) {
  const name = (i) => people[i].name;
  const e = (i) => (people[i].gender === 'f' ? 'e' : '');
  const [a, b, c] = stmt.args;
  switch (stmt.kind) {
    case 'next':
      return rng() < 0.5
        ? `${name(a)} est passé${e(a)} juste avant ${name(b)}.`
        : `${name(b)} est passé${e(b)} juste après ${name(a)}.`;
    case 'before':
      return rng() < 0.5
        ? `${name(a)} est passé${e(a)} avant ${name(b)}.`
        : `${name(b)} est passé${e(b)} après ${name(a)}.`;
    case 'gap':
      return `Il y avait exactement ${COUNT[c]} personne${c > 1 ? 's' : ''} entre ${name(a)} et ${name(b)}.`;
    case 'inner':
      return `${name(a)} n’est passé${e(a)} ni en premier ni en dernier.`;
    case 'between':
      return `${name(a)} est passé${e(a)} après ${name(b)} mais avant ${name(c)}.`;
    case 'rank':
      if (b === 0) return `${name(a)} est passé${e(a)} en premier.`;
      if (b === n - 1) return `${name(a)} est passé${e(a)} en dernier.`;
      return `${name(a)} est passé${e(a)} en ${ORDINAL[b]} position.`;
    case 'apart': {
      const both = people[a].gender === 'f' && people[b].gender === 'f';
      return `${name(a)} et ${name(b)} ne sont pas passé${both ? 'es' : 's'} l’${both ? 'une' : 'un'} juste après l’autre.`;
    }
    default:
      throw new Error(`unknown kind ${stmt.kind}`);
  }
}

// Every statement of every kind about n people.
function allStatements(n) {
  const out = [];
  for (let a = 0; a < n; a++) {
    out.push({ kind: 'inner', args: [a] });
    for (let r = 0; r < n; r++) out.push({ kind: 'rank', args: [a, r] });
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      out.push({ kind: 'next', args: [a, b] });
      out.push({ kind: 'before', args: [a, b] });
      if (a < b) {
        out.push({ kind: 'apart', args: [a, b] });
        for (let k = 1; k <= Math.min(4, n - 2); k++) out.push({ kind: 'gap', args: [a, b, k] });
      }
      for (let c = 0; c < n; c++) {
        if (c !== a && c !== b) out.push({ kind: 'between', args: [a, b, c] });
      }
    }
  }
  return out;
}
const people = (stmt) => (stmt.kind === 'rank' || stmt.kind === 'gap' ? stmt.args.slice(0, 2) : stmt.args.slice());
const relationKey = (stmt) => people(stmt).slice().sort().join('-');

// All permutations as rank tables: positions[p * n + person] = rank.
function permutationTable(n) {
  const orders = [];
  const current = [];
  const used = new Array(n).fill(false);
  (function walk() {
    if (current.length === n) { orders.push(current.slice()); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; current.push(i); walk(); current.pop(); used[i] = false;
    }
  })();
  const positions = new Uint8Array(orders.length * n);
  orders.forEach((order, p) => order.forEach((person, rank) => { positions[p * n + person] = rank; }));
  return { orders, positions, count: orders.length };
}

// Truth vector of a statement over every permutation (1 = false there).
function falseVector(stmt, table, n) {
  const out = new Uint8Array(table.count);
  const pos = new Array(n);
  for (let p = 0; p < table.count; p++) {
    for (let i = 0; i < n; i++) pos[i] = table.positions[p * n + i];
    out[p] = KINDS[stmt.kind].holds(stmt.args, pos, n) ? 0 : 1;
  }
  return out;
}

// --------------------------------------------------------------- difficulty
// Weights bias which true statements the greedy search prefers. `keep` is the
// statement count pruning stops at (more statements = more cross-checks);
// `core` bounds the smallest contradictory subset, which always contains the
// liar: the larger it is, the further the player must look to expose the lie.
const PROFILE = {
  facile: {
    weights: { rank: 2.2, next: 2, before: 0.8, gap: 1, inner: 0.6, between: 0.8, apart: 0.3 },
    liarKinds: ['next', 'before', 'rank', 'between'],
    range: [7, 10], keep: 8, core: [2, 3], maxRank: 3, sameRelationAsLiar: true,
  },
  moyenne: {
    weights: { rank: 1, next: 1.4, before: 1, gap: 1.3, inner: 0.8, between: 1.3, apart: 0.6 },
    liarKinds: ['next', 'before', 'gap', 'between', 'inner'],
    range: [8, 11], keep: 9, core: [3, 4], maxRank: 2, sameRelationAsLiar: false,
  },
  difficile: {
    weights: { rank: 0.4, next: 1, before: 1.3, gap: 1.4, inner: 1, between: 1.5, apart: 0.8 },
    liarKinds: ['before', 'gap', 'between', 'inner', 'next'],
    range: [8, 11], keep: 8, core: [4, 8], maxRank: 1, sameRelationAsLiar: false,
  },
};

// Size of the smallest subset of statements that no order satisfies.
// A subset T is satisfiable iff some order's false-mask m has m & T === 0.
function smallestContradiction(vectors, count) {
  const k = vectors.length;
  const masks = new Set();
  for (let p = 0; p < count; p++) {
    let m = 0;
    for (let i = 0; i < k; i++) if (vectors[i][p]) m |= 1 << i;
    masks.add(m);
  }
  const satisfiable = new Uint8Array(1 << k);
  for (const m of masks) {
    const free = ~m & ((1 << k) - 1);
    for (let t = free; ; t = (t - 1) & free) { satisfiable[t] = 1; if (t === 0) break; }
  }
  let best = k;
  for (let t = 0; t < 1 << k; t++) {
    if (satisfiable[t]) continue;
    let bits = 0;
    for (let x = t; x; x &= x - 1) bits++;
    best = Math.min(best, bits);
  }
  return best;
}

function buildCase(index, plan, rng) {
  const n = plan.size;
  const profile = PROFILE[plan.difficulty];
  const table = permutationTable(n);
  const statements = allStatements(n);

  for (let attempt = 0; attempt < 600; attempt++) {
    const solutionIndex = Math.floor(rng() * table.count);
    const pos = Array.from({ length: n }, (_, i) => table.positions[solutionIndex * n + i]);
    const truth = statements.map((s) => KINDS[s.kind].holds(s.args, pos, n));

    // Rotate the liar's kind so a tier does not always lie the same way.
    const liarKind = profile.liarKinds[(index + Math.floor(attempt / 150)) % profile.liarKinds.length];
    const liarPool = statements.filter((s, i) => !truth[i] && s.kind === liarKind
      && !(s.kind === 'gap' && s.args[2] > 3));
    const liar = pick(rng, liarPool);
    const counts = falseVector(liar, table, n);
    const chosen = [{ stmt: liar, vector: counts.slice() }];
    const used = new Set([`${liar.kind}:${relationKey(liar)}`]);
    let ranks = liar.kind === 'rank' ? 1 : 0;

    const pool = statements.filter((s, i) => truth[i]
      && (profile.sameRelationAsLiar || relationKey(s) !== relationKey(liar)));
    const vectors = new Map();
    const vectorOf = (s) => {
      if (!vectors.has(s)) vectors.set(s, falseVector(s, table, n));
      return vectors.get(s);
    };

    // Greedy: add the statement that pushes most surviving orders past one
    // false statement, until only the solution survives.
    const alive = () => {
      const out = [];
      for (let p = 0; p < table.count; p++) if (p !== solutionIndex && counts[p] <= 1) out.push(p);
      return out;
    };
    let survivors = alive();
    while (survivors.length && chosen.length < 30) {
      const scored = [];
      for (const s of pool) {
        if (used.has(`${s.kind}:${relationKey(s)}`)) continue;
        if (s.kind === 'rank' && ranks >= profile.maxRank) continue;
        const v = vectorOf(s);
        let score = 0;
        for (const p of survivors) if (v[p]) score += counts[p] === 1 ? 1 : 0.55;
        if (score > 0) scored.push({ s, score: score * profile.weights[s.kind] * (0.75 + rng() * 0.5) });
      }
      if (!scored.length) break;
      scored.sort((x, y) => y.score - x.score);
      const { s } = scored[Math.floor(rng() * Math.min(4, scored.length))];
      const v = vectorOf(s);
      for (let p = 0; p < table.count; p++) counts[p] += v[p];
      chosen.push({ stmt: s, vector: v });
      used.add(`${s.kind}:${relationKey(s)}`);
      if (s.kind === 'rank') ranks++;
      survivors = alive();
    }
    if (survivors.length) continue;

    // Prune: drop any true statement whose removal keeps the case strict.
    for (const item of shuffle(rng, chosen.slice(1))) {
      if (chosen.length <= profile.keep) break;
      for (let p = 0; p < table.count; p++) counts[p] -= item.vector[p];
      let strict = true;
      for (let p = 0; p < table.count && strict; p++) if (p !== solutionIndex && counts[p] <= 1) strict = false;
      if (strict) chosen.splice(chosen.indexOf(item), 1);
      else for (let p = 0; p < table.count; p++) counts[p] += item.vector[p];
    }
    if (chosen.length < profile.range[0] || chosen.length > profile.range[1]) continue;
    const core = smallestContradiction(chosen.map((c) => c.vector), table.count);
    if (core < profile.core[0] || core > profile.core[1]) continue;

    return { n, table, solutionIndex, statements: shuffle(rng, chosen.map((c) => c.stmt)), liar, core };
  }
  throw new Error(`case ${index + 1}: no strict case found`);
}

// Own exhaustive proof on the final statement list: count (order, liar) pairs
// where the liar is false and every other statement true, and orders with ≤ 1
// false statement. Both must be exactly 1.
function prove(built) {
  const { n, table, statements } = built;
  const vectors = statements.map((s) => falseVector(s, table, n));
  let pairs = 0;
  let loose = 0;
  let found = null;
  for (let p = 0; p < table.count; p++) {
    let falseCount = 0;
    let which = -1;
    for (let i = 0; i < vectors.length; i++) if (vectors[i][p]) { falseCount++; which = i; }
    if (falseCount <= 1) loose++;
    if (falseCount === 1) { pairs++; found = { order: table.orders[p], liar: which }; }
  }
  return { pairs, loose, found };
}

// --------------------------------------------------------------------- main
const rng = mulberry32(hashSeed(SEED));
const roster = shuffle(rng, PEOPLE);
const cases = [];
let failures = 0;

PLAN.forEach((plan, index) => {
  const built = buildCase(index, plan, rng);
  const cast = shuffle(rng, roster).slice(0, plan.size)
    .sort((x, y) => x[0].localeCompare(y[0], 'fr'));
  const roles = shuffle(rng, ROLES);
  const peopleList = cast.map(([name, gender], i) => ({ name, gender, role: roles[i][gender === 'f' ? 1 : 0] }));
  const proof = prove(built);
  const order = built.table.orders[built.solutionIndex];
  const liarIndex = built.statements.indexOf(built.liar);
  const ok = proof.pairs === 1 && proof.loose === 1
    && proof.found.order.join() === order.join() && proof.found.liar === liarIndex;
  if (!ok) failures++;

  const [title, object, room] = CASES[index];
  const theftSlot = 1 + Math.floor(rng() * (plan.size - 2));
  const culprit = peopleList[order[theftSlot]];
  const texts = built.statements.map((s) => phrase(s, peopleList, plan.size, rng));
  cases.push({
    number: index + 1,
    difficulty: plan.difficulty,
    title,
    object,
    room,
    story: `À 6 h, la vitrine ${room} est vide : ${object} a disparu. ` +
      `Les caméras du hall étaient coupées ; ${WORDS[plan.size]} personnes l’ont traversé entre 23 h et 6 h, une à la fois. ` +
      `La vitrine a été forcée pendant le ${SHORT_ORDINAL[theftSlot]} passage. ` +
      `${WORDS[texts.length][0].toUpperCase()}${WORDS[texts.length].slice(1)} déclarations ont été recueillies — une seule est fausse.`,
    theftSlot,
    people: peopleList,
    statements: texts,
    solution: order.map((i) => peopleList[i].name),
    liar: liarIndex,
    culprit: culprit.name,
  });
  console.log(`#${String(index + 1).padStart(2)} ${plan.difficulty.padEnd(9)} n=${plan.size} ` +
    `déclarations=${texts.length} paires(ordre×menteuse)=${proof.pairs} ordres≤1faux=${proof.loose} ` +
    `noyau=${built.core} menteuse=${built.liar.kind} ${ok ? 'OK' : 'AMBIGU'}`);
});

if (failures) {
  console.error(`\n${failures} affaire(s) ambiguë(s) : cases.json n'est pas écrit.`);
  process.exit(1);
}
writeFileSync(new URL('./cases.json', import.meta.url), `${JSON.stringify({ seed: SEED, cases }, null, 2)}\n`);
console.log(`\n${cases.length} affaires écrites dans cases.json.`);
