# Design notes

Why the systems are shaped the way they are, and what the numbers are doing. The README covers *what* the game is; this covers *why*, and where it is still wrong.

## The central tension

The pitch is "cards level up and change power tier." The obvious failure mode is that levelling becomes a strictly-better button: everyone maxes everything, rarity stops mattering, and the collection flattens into "how much have you played."

Three mechanisms push back on that.

**1. Promotion costs tempo.** A card's power tier sets its deploy cost. Levelling a Weak card to Elite quadruples what it costs to put on the board (1 → 4 energy). The card is better, and you will field it two rounds later. This is the main lever and it is why deploy cost is derived from the tier rather than printed on the card.

**2. The deck budget is capped.** A legal deck is twelve cards totalling at most 48 deploy cost. That is exactly twelve Elites — you can max a deck of Commons, but you then cannot include a single Legendary. Deciding *which* copies to invest in is the deck-building decision the levelling system exists to create.

**3. Rarity governs headroom, not power.** Rarity adds no stats. It sets the level cap, the growth points per level, the innate growth multiplier, the XP curve, and the ability slot count. A Common tops out at Elite because it runs out of levels, not because a rule forbids it from going further.

## Scoring

Power score is the only input to power tier:

```
score = round( might*2.2 + vitality*0.9 + speed*1.6 + guard*2.0 + sum(unlocked ability weights) )
```

A growth point buys a different amount of each stat:

| Stat | Per point | × weight | = score per point |
|---|---|---|---|
| Might | +1.2 | 2.2 | 2.64 |
| Vitality | +3.0 | 0.9 | 2.70 |
| Speed | +1.6 | 1.6 | 2.56 |
| Guard | +1.3 | 2.0 | 2.60 |

These are deliberately equal to within ~5%, and a test enforces it. The consequence is the thing the whole design rests on: **two builds of the same card at the same level have the same power score, the same tier, and the same deploy cost.** Focusing is a choice about play, not a numerical trap — you cannot build a card "wrong" and end up paying more for less.

Innate growth is a fraction of the card's *own* base stats (8% per level, times the rarity multiplier), not a flat block. A creature printed tanky stays tanky as it levels, and the player's allocation is the thing that bends it away from its printed shape.

Ability weight is added to the score, so unlocking an ability can promote a card on its own. Several rares are printed just under the Elite threshold specifically so that their level-6-to-8 unlock *is* the promotion — that is the moment the system is meant to sell, and it should happen on a card a new player actually owns.

## The tier ladder

Thresholds are 0 / 60 / 125 / 240 / 420, with deploy costs 1 / 2 / 4 / 6 / 9.

This was retuned twice during development, both times because a sweep caught something:

- **First pass** had Legendary at 300 and Ascendant at 650, with costs 1/2/3/5/7. The Elite band was so wide that a maxed Uncommon (score 255) and a fresh Epic (score 131) both sat at Elite and both cost 3 energy — nearly a 2× power difference for the same price. Levelled decks won 30–0 without losing a card.
- **Second pass** steepened the cost curve, which then made a deck of all-Ascendant cards *literally unplayable*: at 9 energy each and a +1/round ramp, nothing could be deployed until round 7, and the game was over by round 2. Fixed by raising the energy ramp to +2/round (max 14) and by leaning on the deck budget to make such a deck illegal in the first place.

The lesson worth keeping: the cost curve and the energy curve have to be tuned together, and the deck budget is what stops the top of the cost curve from being reachable across a whole deck.

## Combat rules that exist for a reason

**Deployment sickness.** A creature cannot act on the round it lands. Without it, a cheap deck deploys three 1-cost bodies on round 1 and swings at an undefended nexus immediately; an expensive deck simply dies before it can answer. This single rule is what makes the cost curve survivable at the top end.

**Dodge from speed.** A defender faster than its attacker dodges at 1.5% per point of speed advantage, capped at 25%. Speed needed a second use beyond turn order, or allocating into it was strictly worse than Might for any aggressive build.

**Board-strength tiebreak.** Two symmetric decks take symmetric fatigue and arrive at the round limit on exactly equal nexus health, which produced a draw about a third of the time. A round-limit tie now resolves to whoever still holds the board. Draws are down but not gone.

**Minimum damage of 1.** Guard subtracts from incoming damage but an attack always lands for at least 1, so stacking Guard cannot make a creature literally invincible against a whole archetype.

## Ability design

Abilities are split across two files on purpose:

- `src/core/abilities.ts` — id, name, description, trigger, **weight**, and tuning params.
- `src/battle/abilityHandlers.ts` — the behaviour, keyed by the same id.

Card tooling, a deck builder, or a collection screen can price and describe an ability without pulling in the combat engine, and the battle layer never needs to know what a card costs. Two tests keep the halves honest: every printed ability must have a handler, and every handler must have a printed ability.

Handlers only ever see a narrow `BattleApi` — they can damage, heal, buff, poison, shield and log, and nothing else. They cannot reorder the round, read the opposing hand, or reach outside the battle. That is what keeps a battle reproducible from its seed.

Weight is the balance dial. An ability that reads as strong must weigh more, or it is free value: weight feeds power score, which feeds tier, which feeds deploy cost. Doublestrike at 20 and Rebirth at 22 are the heaviest; First Strike at 8 is the lightest.

## Determinism

Every random decision goes through a seeded `mulberry32` stream, forked per player for deck shuffling. `runBattle` with the same decks, controllers and seed produces a byte-identical event log — asserted by a test. This is what makes the balance harness a regression test rather than a vibe check: change a weight and the win-rate table moves in a way you can actually read.

## Known problems

**Spike dominates.** The archetype of "three deeply levelled rares behind nine 1-cost bodies" beats every other archetype decisively (109–6 against the maxed-Commons deck). Two things are feeding it: 1-cost chaff is extremely efficient per board slot, and the deck budget does not constrain the archetype at all (28 of 48 used). Candidate fixes, none tried: a minimum average deploy cost, board slots that cost something, or making chaff worse at holding a lane. This is the clearest open balance issue.

**The AI is a one-round heuristic.** Both controllers sort the affordable cards and deploy greedily. They never hold a card back, never consider the opposing board, and never plan a curve. Archetype win rates should be read as a smell test.

**Mirror matches still draw often.** The board-strength tiebreak helped but symmetric decks remain prone to symmetric outcomes.

**Nothing is persisted.** A `Collection` lives in memory. Serialisation is deliberately absent rather than half-done — `CardInstance` is a flat, plain-data record specifically so that adding it later is trivial.
