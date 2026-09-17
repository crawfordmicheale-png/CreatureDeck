/**
 * Balance harness.
 *
 *   npm run balance            round-robin over the archetypes, 150 seeds each
 *   npm run balance -- 400     more seeds
 *
 * Every battle is deterministic, so this is a regression test for balance as
 * much as a design tool: change a weight or a tier threshold and the table
 * moves in a way you can read.
 *
 * What to look for:
 *   - Mirror matches should sit near 50/50. If they do not, the engine favours
 *     whoever moves first, which is a bug rather than a balance question.
 *   - No archetype should beat every other archetype decisively.
 */

import { GREEDY_CONTROLLER } from '../battle/controllers.ts';
import { runBattle } from '../battle/engine.ts';
import { STANDARD_LIBRARY } from '../content/index.ts';
import type { StatKey } from '../core/stats.ts';
import { Collection } from '../game/collection.ts';
import { STANDARD_DECK_RULES, validateDeck } from '../game/deck.ts';
import { heading, paint } from './format.ts';

const library = STANDARD_LIBRARY;

const MIGHT: readonly StatKey[] = ['might'];
const MIGHT_VIT: readonly StatKey[] = ['might', 'vitality'];
const TANK: readonly StatKey[] = ['vitality', 'guard'];
const SWIFT: readonly StatKey[] = ['speed', 'might'];

/** [definitionId, level, focus] */
type DeckPlan = ReadonlyArray<readonly [string, number, readonly StatKey[]]>;

interface Archetype {
  readonly name: string;
  readonly blurb: string;
  readonly plan: DeckPlan;
}

const ARCHETYPES: readonly Archetype[] = [
  {
    name: 'Veteran',
    blurb: 'Twelve low-rarity cards, every one of them maxed. Spends the whole energy budget.',
    plan: [
      ['ember-whelp', 10, MIGHT],
      ['ember-whelp', 10, SWIFT],
      ['scrapfang-pup', 10, MIGHT_VIT],
      ['thicket-hare', 10, ['speed']],
      ['pebble-grub', 10, TANK],
      ['tide-minnow', 10, MIGHT_VIT],
      ['dusk-mite', 10, SWIFT],
      ['gale-sprite', 10, TANK],
      ['ashfang-jackal', 11, MIGHT],
      ['cinder-imp', 11, SWIFT],
      ['reef-sentinel', 11, TANK],
      ['grave-moth', 11, SWIFT],
    ],
  },
  {
    name: 'Collector',
    blurb: 'Rares and epics straight out of the packs. Rarity with no investment behind it.',
    plan: [
      ['stormcaller-roc', 1, MIGHT],
      ['stormcaller-roc', 1, MIGHT],
      ['magma-colossus', 1, TANK],
      ['abyssal-serpent', 1, MIGHT_VIT],
      ['abyssal-serpent', 1, MIGHT_VIT],
      ['verdant-matriarch', 1, TANK],
      ['nightmare-stalker', 1, MIGHT],
      ['nightmare-stalker', 1, MIGHT],
      ['pyreclaw-tyrant', 1, MIGHT],
      ['glacierheart-titan', 1, TANK],
      ['void-harbinger', 1, MIGHT_VIT],
      ['skyfather-drake', 1, MIGHT_VIT],
    ],
  },
  {
    name: 'Spike',
    blurb: 'Three deeply levelled rares behind nine cost-1 bodies.',
    plan: [
      ['nightmare-stalker', 14, MIGHT],
      ['abyssal-serpent', 13, MIGHT_VIT],
      ['magma-colossus', 12, TANK],
      ['ember-whelp', 1, MIGHT],
      ['ember-whelp', 1, MIGHT],
      ['thicket-hare', 1, ['speed']],
      ['scrapfang-pup', 1, MIGHT_VIT],
      ['pebble-grub', 1, TANK],
      ['tide-minnow', 1, MIGHT_VIT],
      ['dusk-mite', 1, SWIFT],
      ['gale-sprite', 1, TANK],
      ['cinder-imp', 1, SWIFT],
    ],
  },
  {
    name: 'Curve',
    blurb: 'Everything levelled halfway. The deck that never commits.',
    plan: [
      ['ember-whelp', 6, MIGHT],
      ['scrapfang-pup', 6, MIGHT_VIT],
      ['thicket-hare', 6, ['speed']],
      ['pebble-grub', 6, TANK],
      ['tide-minnow', 6, MIGHT_VIT],
      ['dusk-mite', 6, SWIFT],
      ['gale-sprite', 6, TANK],
      ['ashfang-jackal', 8, MIGHT],
      ['cinder-imp', 8, SWIFT],
      ['reef-sentinel', 8, TANK],
      ['grave-moth', 8, SWIFT],
      ['bramble-warden', 8, TANK],
    ],
  },
];

interface BuiltArchetype {
  readonly name: string;
  readonly blurb: string;
  readonly collection: Collection;
  readonly instanceIds: readonly string[];
  readonly cost: number;
  readonly score: number;
  readonly legal: boolean;
  readonly errors: readonly string[];
}

function build(archetype: Archetype): BuiltArchetype {
  const collection = new Collection(library);
  const instanceIds = archetype.plan.map(([definitionId, level, focus]) => {
    const instance = collection.add(definitionId, { level });
    collection.autoAllocate(instance.instanceId, focus);
    return instance.instanceId;
  });
  const validation = validateDeck(
    collection.deckInstances(instanceIds),
    library,
    STANDARD_DECK_RULES,
  );
  return {
    name: archetype.name,
    blurb: archetype.blurb,
    collection,
    instanceIds,
    cost: validation.stats.totalDeployCost,
    score: validation.stats.totalPowerScore,
    legal: validation.valid,
    errors: validation.errors,
  };
}

interface MatchRecord {
  readonly winsA: number;
  readonly winsB: number;
  readonly draws: number;
  readonly averageRounds: number;
}

function playMatch(a: BuiltArchetype, b: BuiltArchetype, seeds: number): MatchRecord {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let rounds = 0;

  for (let seed = 1; seed <= seeds; seed += 1) {
    const result = runBattle(
      [
        {
          id: 'a',
          name: a.name,
          deck: a.collection.deckInstances(a.instanceIds),
          controller: GREEDY_CONTROLLER,
        },
        {
          id: 'b',
          name: b.name,
          deck: b.collection.deckInstances(b.instanceIds),
          controller: GREEDY_CONTROLLER,
        },
      ],
      library,
      { seed: seed * 7919 },
    );
    rounds += result.rounds;
    if (result.winner === 'a') winsA += 1;
    else if (result.winner === 'b') winsB += 1;
    else draws += 1;
  }

  return { winsA, winsB, draws, averageRounds: rounds / seeds };
}

function main(): void {
  const seeds = Number(process.argv[2] ?? 150);
  const built = ARCHETYPES.map(build);

  console.log(heading(`Balance sweep - ${seeds} seeds per pairing`));
  for (const deck of built) {
    const legality = deck.legal
      ? paint('legal', 'green')
      : paint(`ILLEGAL: ${deck.errors.join('; ')}`, 'red');
    console.log(
      `  ${paint(deck.name.padEnd(11), 'bold')} cost ${String(deck.cost).padStart(3)}/${
        STANDARD_DECK_RULES.maxTotalDeployCost ?? '-'
      }  score ${String(deck.score).padStart(4)}  ${legality}`,
    );
    console.log(paint(`              ${deck.blurb}`, 'dim'));
  }

  console.log();
  for (let i = 0; i < built.length; i += 1) {
    for (let j = i; j < built.length; j += 1) {
      const a = built[i] as BuiltArchetype;
      const b = built[j] as BuiltArchetype;
      const record = playMatch(a, b, seeds);
      const mirror = i === j;
      const total = record.winsA + record.winsB;
      const share = total === 0 ? 0.5 : record.winsA / total;
      const lopsided = !mirror && (share > 0.8 || share < 0.2);
      const mirrorSkew = mirror && Math.abs(share - 0.5) > 0.15;

      const line =
        `  ${a.name.padEnd(11)} vs ${b.name.padEnd(11)} ` +
        `${String(record.winsA).padStart(4)} - ${String(record.winsB).padEnd(4)} ` +
        `${String(record.draws).padStart(3)} draws   avg ${record.averageRounds.toFixed(1)} rounds`;

      if (mirrorSkew) console.log(`${line}  ${paint('<- mirror should be even', 'red')}`);
      else if (lopsided) console.log(`${line}  ${paint('<- lopsided', 'yellow')}`);
      else console.log(line);
    }
  }
  console.log();
}

main();
