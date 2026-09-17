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

## Quick start

Node 22.6+ is the only requirement. There are no runtime dependencies.

```bash
npm install          # only installs TypeScript and @types/node, for typechecking
npm run demo         # the whole tour
npm test             # 100 tests
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
                card instances, levelling — no battle logic at all
src/battle/     the engine, ability handlers, deployment controllers
src/game/       collections, deck rules, XP rewards
src/content/    the printed set: 28 creatures and 18 abilities
src/cli/        the demo and the balance harness
test/           100 tests
```

`src/core` knows nothing about battles, and `src/battle` knows nothing about the specific cards — everything takes a `CardLibrary`, so tests run against three-card fixtures and the real game against the full roster.

Abilities are split deliberately: `src/core/abilities.ts` holds the metadata (name, description, trigger, weight) and `src/battle/abilityHandlers.ts` holds the behaviour, keyed by the same id. Tooling can price and describe an ability without loading the combat engine, and a test asserts the two halves never drift apart.

## Balance

`npm run balance` plays a round-robin between four deck archetypes over many deterministic seeds and flags anything suspicious:

```
  Veteran     vs Veteran       48 - 49    53 draws   avg 16.1 rounds
  Veteran     vs Collector    142 - 6      2 draws   avg 12.2 rounds  <- lopsided
  Veteran     vs Spike          6 - 109   35 draws   avg 14.8 rounds  <- lopsided
```

Mirror matches sitting near 50/50 is the load-bearing check — if a mirror skews, the engine favours whoever moves first, which is a bug rather than a balance question.

### Known balance findings

- **Spike is too strong.** "Three deeply levelled rares behind nine cost-1 bodies" beats every other archetype decisively. Cheap chaff is efficient enough at holding board slots that it fully funds the bombs, and the deck budget does not bind it (28 of 48). Not yet addressed.
- **The AI is naive.** Both controllers are greedy one-round heuristics with no notion of holding a card back or trading, so archetype win rates should be read as a smell test, not a metagame.
- **Draws are common in mirrors** even with the board-strength tiebreak, because symmetric decks take symmetric fatigue.

## Extending it

Adding a creature is one entry in `src/content/creatures.ts`; `defineCard` rejects a card that lists more abilities than its rarity has slots for, and the library rejects one that references an ability that does not exist. Adding an ability means a metadata entry plus a handler — the test suite fails if you add one without the other.
