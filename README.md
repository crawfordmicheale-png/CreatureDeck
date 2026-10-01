# CreatureDeck

A deck-building battler built around one idea: **every copy of a card starts the same, and every copy ends up different.**

Cards are creatures. They sit in a **rarity tier** (Common through Mythic) and are printed at a **power tier** (Weak through Ascendant). The rarity never changes. The power tier does — level a card up, choose which stats to pour its growth points into, and it climbs the tier ladder. Two players holding the same Ember Whelp will, fifty battles later, be holding two genuinely different creatures.

```
Ember Whelp   Common / Weak / L1        Mig  7  Vit 20  Spe  6  Gua  2   score 57   cost 1

  ... the same card, taken to level 10 three different ways ...

Cinderbite    Common / Elite / L10      Mig 34  Vit 34  Spe 10  Gua  3   score 137  cost 4
Old Scar      Common / Elite / L10      Mig 12  Vit 61  Spe 10  Gua 15   score 137  cost 4
Flicker       Common / Elite / L10      Mig 23  Vit 34  Spe 25  Gua  3   score 137  cost 4
```

Same printed card. Same power tier, same energy cost, near-identical power score — and three creatures that play nothing alike.

## Play it

**The Hollow Crown** is a tactical duel. You hold three cards. You choose what
comes down, which creature swings, and what it swings at.

- **Stamina.** Every attack spends one. At zero the creature is spent and goes
  to the discard pile, so a board is a clock rather than a wall. A common has
  more uses than a mythic: big cards hit harder and leave sooner.
- **Lanes.** Slot one faces slot one. Attack any enemy creature you like, but
  strike the nexus only through a lane with nothing facing your attacker.
- **Effect cards.** Ten one-shot spells that spend the energy a creature would
  have cost, so holding one is a real decision.
- **Levelling.** Between duels your creatures earn growth points and you choose
  the stats. Push a card far enough and it promotes a power tier for good.
- **Upgrade paths.** Every fourth level a card offers two mutually exclusive
  paths — one offensive, one defensive or utility — and the one you take is
  permanent. The fork is deterministic per card, so two copies in the same
  state see the same offer; take opposite paths and they diverge for good,
  including the offers they get later.
- **Drafting.** After each duel you take one of three cards from the whole
  printed set, or cull a card instead. Recruits join at the middle level of
  your warband, so a late draft is still worth taking.

Five duels stand between the starting warband and the Hollow Crown.

```bash
npm install
npm run build:web      # inlines the art, then bundles engine + UI into web/dist/index.html
```

Open `web/dist/index.html` in a browser. It is one self-contained file with no
runtime dependencies — the whole game, engine included, is about 66 kB.

A run is five battles against escalating opponents. Deploy creatures from your
hand by clicking them, end the turn, and watch combat resolve. Between battles
your cards earn XP and growth points, and you decide — per card, per stat —
where those points go. Push a card far enough and it is promoted to a higher
power tier permanently, which makes it stronger and more expensive to field.

The front-end lives in `web/` and only draws the rules. It never decides what
is legal: every button is built from the engine's own `legalActions`, which is
the same list the AI picks from, so the two can never disagree. Card art is
generated dark-fantasy illustration, inlined as WebP data URIs by `npm run art`
so the page stays a single self-contained file.

## Quick start

Node 22.6+ is the only requirement. There are no runtime dependencies.

```bash
npm install          # only installs TypeScript and @types/node, for typechecking
npm run demo         # the whole tour
npm test             # 116 tests
npm run balance      # archetype win-rate sweep
```

The demo runs in four sections, each of which can be run alone:

```bash
npm run demo -- roster        # the printed set, grouped by rarity
npm run demo -- divergence    # one card, three owners
npm run demo -- battle        # a full battle, with a play-by-play
npm run demo -- season        # five battles, XP carried between them
npm run demo -- battle --verbose --seed 7
```

## How the systems fit together

### Rarity is headroom, not power

Rarity does not make a card hit harder. It decides how far the card can go:

| Rarity | Max level | Growth points / level | Innate growth | XP cost | Ability slots |
|---|---|---|---|---|---|
| Common | 10 | 2 | ×1.0 | ×1.0 | 1 |
| Uncommon | 14 | 3 | ×1.1 | ×1.2 | 1 |
| Rare | 18 | 4 | ×1.25 | ×1.45 | 2 |
| Epic | 22 | 5 | ×1.4 | ×1.75 | 2 |
| Mythic | 26 | 6 | ×1.6 | ×2.1 | 3 |

A maxed Common reaches Elite. A maxed Mythic reaches Ascendant with room to spare. Nothing stops a Common from out-fighting an unplayed Epic — it just runs out of levels long before a Mythic runs out of ceiling.

### Power tier is what the card is right now

The power tier is not stored on the card; it is read off the card's **power score**, which is a weighted sum of its stats plus the weight of every unlocked ability. Cross a threshold and the card is promoted, permanently.

| Tier | Power score | Deploy cost | Attack bonus | Health bonus |
|---|---|---|---|---|
| Weak | 0+ | 1 | – | – |
| Normal | 60+ | 2 | +1 | +2 |
| Elite | 125+ | 4 | +3 | +6 |
| Legendary | 240+ | 6 | +6 | +14 |
| Ascendant | 420+ | 9 | +10 | +26 |

**Promotion is not free.** A higher tier hits harder but costs more energy to field, and the deck budget is capped, so levelling everything is a real decision rather than a free upgrade. A deck of twelve maxed Commons sits at exactly the 48-point budget — you can build it, but you then have nothing left over for anything larger.

### Levelling is the player's fingerprint

Each level grants growth points. The player spends them across four stats:

- **Might** — damage per attack
- **Vitality** — maximum health
- **Speed** — acting order, and the odds of slipping a blow
- **Guard** — flat damage reduction on every hit

A growth point is worth roughly the same *power score* in any stat, so focusing is never a numerical mistake — it changes what the creature does, not how much it is worth. Cards also grow innately each level, scaled off their own base stats, so a tanky creature stays tanky by default and the player's allocation is what bends it somewhere else.

Levels also unlock abilities. Several cards are printed a hair under a tier threshold on purpose, so that unlocking their second ability *is* the promotion.

## Playing a battle

Two players, a nexus each (40 health), five board slots. Each round:

1. **Upkeep** — Regrowth and friends tick, then poison bites.
2. **Draw** — one card, or the opening hand on round 1. An empty deck means escalating fatigue damage.
3. **Deployment** — each player spends that round's energy. A creature cannot act on the round it lands.
4. **Combat** — every living creature acts once, fastest first, hitting the front-most enemy (or the nexus, if the board is clear).
5. **Cleanup** — the dead leave the board, win conditions are checked.

Everything routes through a seeded RNG, so a battle replayed with the same decks and seed produces a byte-identical log.

## Project layout

```
src/core/       rarity, power tiers, stats, scoring, card definitions,
                card instances, levelling, upgrade paths — no combat logic
src/duel/       the game: turn state machine, abilities, effects, opponent AI
src/game/       collections, deck rules, XP rewards, drafting
src/content/    the printed set and the campaign: creatures, abilities,
                effect cards, the five stages and the progression curve
src/cli/        the card tour and the balance harness
web/            the browser front-end and its art, built to one HTML file
test/           116 tests
```

`src/core` knows nothing about battles, and `src/battle` knows nothing about the specific cards — everything takes a `CardLibrary`, so tests run against three-card fixtures and the real game against the full roster.

Abilities are split deliberately: `src/core/abilities.ts` holds the metadata (name, description, trigger, weight) and `src/battle/abilityHandlers.ts` holds the behaviour, keyed by the same id. Tooling can price and describe an ability without loading the combat engine, and a test asserts the two halves never drift apart.

Runs are saved to the browser as you go, so closing the tab does not lose
one. A duel in progress restarts from the top; everything between duels — your
roster, its levels, upgrades and deck — is kept.

## Balance

`npm run balance` plays whole runs of the shipped campaign with the AI on both
sides — drafting, levelling and upgrade forks included — and reports how far
they get against a target curve:

```
  1 The Scavenger Warren     reached  200 won  67% (target 80%)  14 turns  deck 13  14pt too hard
  2 Brackwater Raiders       reached  133 won  63% (target 70%)   9 turns  deck 14  on target
  3 The Ashen Kennel         reached   84 won  63% (target 60%)   6 turns  deck 15  on target
  4 The Gilded Menagerie     reached   53 won  62% (target 60%)   4 turns  deck 16  on target
  5 The Hollow Crown         reached   33 won  55% (target 45%)   4 turns  deck 17  on target
  full clears 18/200 (9%)
```

The campaign it measures lives in `src/content/campaign.ts`, not in the
front-end, so the harness and the game cannot drift apart. It reports three
development styles, because a curve that only works for one way of spending
growth points is not balanced.

### Known balance findings

- **Defence is not a viable style.** The aggressive build clears about a third
  of runs; the defensive build clears none, and stalls completely by duel four.
  Stamina is the cause: creatures expire after a few attacks, so there is no
  way to win by outlasting an opponent, and points spent on Vitality and Guard
  buy time the creature does not live to use. Fixing this needs a way to
  recover stamina — a "brace" action that trades an attack for a use and some
  Guard would give defensive play a win condition it currently lacks.
- **The opening duel is ~14 points harder than intended** and the longest in
  the run at 14 turns. Everything after it is on target.
- **The AI is a one-turn heuristic.** It never holds a card back and does not
  plan a curve, so these numbers are a floor rather than a ceiling.

## Extending it

Adding a creature is one entry in `src/content/creatures.ts`; `defineCard` rejects a card that lists more abilities than its rarity has slots for, and the library rejects one that references an ability that does not exist. Adding an ability means a metadata entry plus a handler — the test suite fails if you add one without the other.
