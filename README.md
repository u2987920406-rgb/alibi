# Alibi

A one-screen deduction game. One night at the (fictional) Musée Vauclair,
six to eight people crossed the main hall one at a time between 11 pm and
6 am, and an object went missing. The player rebuilds **the order in which
they passed** and points out **the one statement that is false**. No grid, no
rooms: a single ordered line and one lying witness.

No build step, no dependencies, no CDN, no external fonts or images. Player-facing
text is French; code, comments and file names are English. State is kept in
memory only (no `localStorage`).

## Run

```
cd ~/projets/alibi
node generate.mjs     # writes cases.json (deterministic, seed in the file)
node verify.mjs       # independent proof: "12/12 affaires à solution unique"
python3 -m http.server 8140
```

Open http://127.0.0.1:8140/ (`fetch('cases.json')` needs http, not `file://`).
`?case=N` opens case N directly.

## Rules (as shown to the player)

1. Put each person in their slot on the vertical timeline, 23 h at the top,
   6 h at the bottom. One person per slot.
2. Exactly **one** statement is false and every other one is true. Tap its
   number to stamp it **FAUX**.
3. "avant" / "après" mean at any distance; "juste avant" / "juste après" mean
   immediately before / after.
4. The slot with a red disc is when the display case was forced. Whoever
   passed then is the thief, which is revealed when the case is solved.

Statement forms: `X est passé(e) juste avant/après Y`, `X est passé(e)
avant/après Y`, `Il y avait exactement k personne(s) entre X et Y`,
`X n'est passé(e) ni en premier ni en dernier`, `X est passé(e) après Y mais
avant Z`, `X est passé(e) en premier / en dernier / en n-ième position`, and
`X et Y ne sont pas passé(e)s l'un(e) juste après l'autre`.

## Cases: `generate.mjs` → `cases.json`

Twelve cases: 4 *facile* (6 people), 4 *moyenne* (7) and 4 *difficile* (8),
from a fixed seed (`alibi-vauclair-2026`). Two runs produce byte-identical output.

Uniqueness is **strict**. The true order is the only permutation in which at
most one statement is false. So for the real liar, the other statements
force exactly one order, and for any other liar choice the remaining statements
contradict each other. This implies the weaker "exactly one (order, liar)
pair" property, and both are counted.

How a case is built:

1. Pick a random true order and a false statement (the liar). The liar's kind
   rotates through the tier so cases do not all lie the same way.
2. Greedily add true statements, scored on how many surviving orders they push
   past one false statement and weighted by a per-tier taste: easy cases favor
   positions and "juste avant", hard ones favor "avant", "entre" and gaps.
3. Prune statements that are not needed for strictness, down to a per-tier
   floor.
4. Measure the **smallest contradictory subset**. Every contradiction contains
   the liar, so this size says how far the player must look to expose the lie.
   In the shipped set: easy 2–3, medium 3, hard 4–5.
5. Prove the result by full enumeration (720 / 5 040 / 40 320 orders × every
   liar choice). If any case is ambiguous, the script exits non-zero and does
   **not** write `cases.json`.

## Independent check: `verify.mjs`

`verify.mjs` imports nothing from the generator. It reads only the French text
of each statement and turns it back into a predicate with anchored regular
expressions. Each sentence must match exactly one form, and "passé/passée",
"l'un/l'une" and "personne/personnes" must agree with the people named. It
then enumerates every order × liar choice and requires both counts to be 1 and
to match the stored order and liar. It exits non-zero on any failure.

## Client

- `index.html`, `styles.css`, `app.js`. The timeline is plain DOM: a CSS rail
  that shades from night blue to dawn ochre, and rank discs whose tone
  `app.js` computes per slot.
- Tap a slot to open the **picker** over the statements column. Choosing
  someone already placed swaps the two people, and the next empty slot opens
  automatically for quick top-down entry.
- Each statement has a round number button: pressing it marks that statement
  as the false one (only one can be marked). The text is struck through and
  stamped FAUX.
- Actions:
  - `Vérifier` marks every placed slot ✓/✗, says whether the chosen liar is
    right, and updates the compact tally (`5 ✓ · 2 ✗ · 1 vide · fausse ✗`).
  - `Indice` follows a ladder. It first fixes a wrong placement, then a wrong
    liar choice (by proving that statement true). After that it alternates
    between proving one statement true and placing one person.
  - `Solution` and `Effacer` need two taps ("Sûr ?").
  - `Affaire suivante` is the arrow in the phone header, and a labelled button
    on desktop and in the victory card.
- Victory (order and liar both right, after `Vérifier`): the slots light up one
  after another, from night to dawn, then an "Affaire classée" stamp lands and
  the thief is named. With `prefers-reduced-motion: reduce`, every animation is
  off and the card appears immediately.

### Phone layout (≤ 860 px)

One viewport, with no page scroll at 360×640, 360×740, 393×852 and 412×915.
Rows: compact header (seal, case selector, next, dossier) / tally / desk /
action bar. The desk shows **the timeline and the statements side by side**,
so the player always sees both. The statements scroll inside their own
column. The story, the cast with their jobs and the rules live in a
full-screen *dossier* behind the folder button. Under 380 px wide the brand
name hides and only the seal remains. On desktop the dossier becomes a third
column.

## Audit

```
node tools/audit.mjs              # normal motion, then prefers-reduced-motion
node tools/audit.mjs --verbose    # one line per case and size, worst offenders
```

`tools/audit.html` + `tools/audit.js` load the game in iframes at 360×640,
360×740, 393×852, 412×915, 600×900, 1024×768 and 1440×900.

For each size it measures all 12 cases fresh. On the 8-person case with the
longest statements, it also measures every state: picker open, checked with
errors, won, hinted, solved, and (phones) dossier open. Checks:

- text ≥ 16 px and contrast ≥ 4.5:1 (worst gradient stop counts);
- touch targets ≥ 44×44;
- no box outside its block parent, and no fixed layer outside the viewport;
- no clipped text, including the closed `<select>` label;
- aspect ratio: every SVG matches its viewBox, and rank discs and number
  buttons stay round;
- no horizontal scroll; on phones, `scrollHeight == clientHeight`;
- timeline slots ≥ 44 px, in order, inside the timeline, names on one line.

It also checks the gameplay flows: ✓/✗ counts after a deliberately wrong
answer, no victory on a wrong liar, a victory with animations (or none under
reduced motion), two-tap `Effacer`, four hints that never prove the liar true,
`Solution`, the dossier opening and closing, and `Affaire suivante`. It exits
non-zero on any failure. A mutation run during development (14 px text, a page
taller than the viewport, a 30 px button, low contrast, a squashed SVG) made
it fail on every injected fault.

`tools/scene.html?case=12&scene=picker|checked|won|hints|dossier|solution`
drives the page into a state for screenshots.
