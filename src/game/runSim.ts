/**
 * Run simulator.
 *
 * Plays the shipped campaign end to end with the AI on both sides — including
 * drafting, levelling and upgrade forks — so the balance harness measures the
 * game rather than an idealised version of it. The AI playing both sides means
 * a result reflects the *decks*, not how well anyone piloted them.
 */

import {
  MIN_CREATURES,
  MIN_DECK,
  STAGES,
  STARTER_EFFECTS,
  STARTER_ROSTER,
} from '../content/campaign.ts';
import type { AiProfileName, Stage } from '../content/campaign.ts';
import { EFFECTS, EFFECT_BY_ID } from '../content/index.ts';
import type { CardInstance } from '../core/cardInstance.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rng } from '../core/rng.ts';
import { createRng } from '../core/rng.ts';
import type { StatKey } from '../core/stats.ts';
import { CAUTIOUS, RUTHLESS, STEADY, playTurn } from '../duel/ai.ts';
import type { AiProfile } from '../duel/ai.ts';
import { Duel } from '../duel/engine.ts';
import type { DeckEntry } from '../duel/types.ts';
import { Collection } from './collection.ts';
import { optionId, rollDraft } from './draft.ts';
import { applyXpAwards, autoDevelop, computeDuelXp } from './rewards.ts';

const PROFILES: Record<AiProfileName, AiProfile> = {
  cautious: CAUTIOUS,
  steady: STEADY,
  ruthless: RUTHLESS,
};

const FOCUS_PRESETS: readonly (readonly StatKey[])[] = [
  ['might'],
  ['might', 'vitality'],
  ['vitality', 'guard'],
  ['speed', 'might'],
];

/** How a simulated player develops their cards and plays their turns. */
export interface PlayerStyle {
  readonly name: string;
  /** The policy the simulated player uses, at every stage. */
  readonly profile: AiProfile;
  /** Takes the offensive fork at every milestone when true. */
  readonly preferOffence: boolean;
  /** Picks a stat focus for a card; the harness varies this per archetype. */
  focusFor(definitionId: string, index: number): readonly StatKey[];
}

export const BALANCED_STYLE: PlayerStyle = {
  name: 'Balanced',
  profile: STEADY,
  preferOffence: true,
  focusFor: (_definitionId, index) =>
    FOCUS_PRESETS[index % FOCUS_PRESETS.length] as readonly StatKey[],
};

export const AGGRESSIVE_STYLE: PlayerStyle = {
  name: 'Aggressive',
  profile: RUTHLESS,
  preferOffence: true,
  focusFor: () => ['might'],
};

export const DEFENSIVE_STYLE: PlayerStyle = {
  name: 'Defensive',
  profile: CAUTIOUS,
  preferOffence: false,
  focusFor: () => ['vitality', 'guard'],
};

export interface DuelOutcome {
  readonly stage: number;
  readonly stageName: string;
  readonly won: boolean;
  readonly turns: number;
  /** Nexus health left on each side, winner first in the pair's own order. */
  readonly playerNexus: number;
  readonly enemyNexus: number;
  readonly playerDeckSize: number;
}

export interface RunOutcome {
  readonly cleared: boolean;
  readonly stagesWon: number;
  readonly duels: readonly DuelOutcome[];
  /** Deck as it ended: creature count and effect count. */
  readonly finalCreatures: number;
  readonly finalEffects: number;
}

interface RunDeck {
  readonly collection: Collection;
  roster: string[];
  effects: string[];
}

function buildStarter(library: CardLibrary, style: PlayerStyle): RunDeck {
  const collection = new Collection(library);
  const roster = STARTER_ROSTER.map(([definitionId, nickname], index) => {
    const instance = collection.add(definitionId, { nickname });
    collection.autoAllocate(instance.instanceId, style.focusFor(definitionId, index));
    return instance.instanceId;
  });
  return { collection, roster, effects: [...STARTER_EFFECTS] };
}

function buildStage(library: CardLibrary, stage: Stage): {
  deck: DeckEntry[];
  instances: CardInstance[];
} {
  const collection = new Collection(library);
  const instances: CardInstance[] = [];
  const deck: DeckEntry[] = [];

  for (const entry of stage.creatures) {
    const instance = collection.add(entry.definitionId, { level: entry.level });
    collection.autoAllocate(instance.instanceId, entry.focus);
    instances.push(collection.get(instance.instanceId));
    deck.push({ kind: 'creature', instanceId: instance.instanceId });
  }
  for (const effectId of stage.effects) deck.push({ kind: 'effect', effectId });

  return { deck, instances };
}

function playerEntries(run: RunDeck): DeckEntry[] {
  return [
    ...run.roster.map((id): DeckEntry => ({ kind: 'creature', instanceId: id })),
    ...run.effects.map((effectId): DeckEntry => ({ kind: 'effect', effectId })),
  ];
}

/** Plays one duel out with the AI on both sides. */
export function simulateDuel(
  library: CardLibrary,
  run: RunDeck,
  stage: Stage,
  seed: number,
  playerProfile: AiProfile = STEADY,
): { won: boolean; turns: number; playerNexus: number; enemyNexus: number } {
  const foe = buildStage(library, stage);
  const mine = run.roster.map((id) => run.collection.get(id));

  const duel = new Duel(
    [
      { id: 'p1', name: 'You', deck: playerEntries(run) },
      { id: 'p2', name: stage.name, deck: foe.deck },
    ],
    library,
    EFFECT_BY_ID,
    [...mine, ...foe.instances],
    { seed, nexusHealth: stage.nexusHealth },
  );

  // The opponent plays to its stage's temperament; the simulated player plays
  // the same way at every stage. Using the stage profile for both sides made
  // the "player" turn cautious against cautious opponents, which is not a
  // measurement of the decks — it is a measurement of the opponent's mood.
  const enemyProfile = PROFILES[stage.profile];
  for (let guard = 0; guard < 400 && !duel.isOver; guard += 1) {
    const mine = duel.snapshot().activePlayerId === 'p1';
    playTurn(duel, mine ? playerProfile : enemyProfile);
  }

  const result = duel.result;
  return {
    won: result?.winner === 'p1',
    turns: result?.turns ?? 0,
    playerNexus: result?.nexus['p1'] ?? 0,
    enemyNexus: result?.nexus['p2'] ?? 0,
  };
}

function draftOnce(library: CardLibrary, run: RunDeck, rng: Rng, style: PlayerStyle): void {
  const copies = new Map<string, number>();
  for (const id of run.roster) {
    const definitionId = run.collection.get(id).definitionId;
    copies.set(definitionId, (copies.get(definitionId) ?? 0) + 1);
  }
  for (const effectId of run.effects) {
    copies.set(effectId, (copies.get(effectId) ?? 0) + 1);
  }

  const offers = rollDraft(rng, library, EFFECTS, {
    rosterLevels: run.roster.map((id) => run.collection.resolve(id).level),
    copies,
  });
  if (offers.length === 0) return;

  // A simulated player takes the strongest body on offer, or an effect when
  // nothing else is going; good enough to stand in for a reasonable human.
  const creatures = offers.filter((option) => option.kind === 'creature');
  const pick = creatures.length > 0 ? (creatures[0] as (typeof offers)[number]) : offers[0];
  if (!pick) return;

  if (pick.kind === 'creature') {
    const instance = run.collection.add(pick.definitionId, { level: pick.level });
    run.roster.push(instance.instanceId);
    run.collection.autoAllocate(
      instance.instanceId,
      style.focusFor(pick.definitionId, run.roster.length),
    );
  } else {
    run.effects.push(optionId(pick));
  }
}

export interface RunOptions {
  readonly seed: number;
  readonly style?: PlayerStyle;
  /** Draft between duels. Off reproduces a fixed-deck run. */
  readonly draft?: boolean;
}

export function simulateRun(library: CardLibrary, options: RunOptions): RunOutcome {
  const style = options.style ?? BALANCED_STYLE;
  const rng = createRng(options.seed);
  const run = buildStarter(library, style);

  const duels: DuelOutcome[] = [];
  let stagesWon = 0;

  for (let index = 0; index < STAGES.length; index += 1) {
    const stage = STAGES[index] as Stage;
    const outcome = simulateDuel(library, run, stage, options.seed + index * 7919, style.profile);

    duels.push({
      stage: index,
      stageName: stage.name,
      won: outcome.won,
      turns: outcome.turns,
      playerNexus: outcome.playerNexus,
      enemyNexus: outcome.enemyNexus,
      playerDeckSize: run.roster.length + run.effects.length,
    });

    applyXpAwards(run.collection, computeDuelXp(run.collection, run.roster, index + 1, outcome.won));

    if (!outcome.won) break;
    stagesWon += 1;
    if (index === STAGES.length - 1) break;

    if (options.draft !== false) draftOnce(library, run, rng, style);
    run.roster.forEach((id, i) => {
      const definitionId = run.collection.get(id).definitionId;
      autoDevelop(run.collection, id, style.focusFor(definitionId, i), style.preferOffence);
    });
  }

  return {
    cleared: stagesWon === STAGES.length,
    stagesWon,
    duels,
    finalCreatures: run.roster.length,
    finalEffects: run.effects.length,
  };
}

export interface StageReport {
  readonly stage: number;
  readonly name: string;
  readonly played: number;
  readonly won: number;
  readonly winRate: number;
  readonly averageTurns: number;
  readonly averageDeckSize: number;
}

export interface SweepReport {
  readonly runs: number;
  readonly clears: number;
  readonly clearRate: number;
  readonly stages: readonly StageReport[];
}

/** Plays many runs and summarises how far they got. */
export function sweep(
  library: CardLibrary,
  runs: number,
  options: Omit<RunOptions, 'seed'> = {},
): SweepReport {
  const played = new Array(STAGES.length).fill(0) as number[];
  const won = new Array(STAGES.length).fill(0) as number[];
  const turns = new Array(STAGES.length).fill(0) as number[];
  const deck = new Array(STAGES.length).fill(0) as number[];
  let clears = 0;

  for (let i = 0; i < runs; i += 1) {
    const outcome = simulateRun(library, { ...options, seed: 1000 + i * 131 });
    if (outcome.cleared) clears += 1;
    for (const duel of outcome.duels) {
      played[duel.stage] = (played[duel.stage] ?? 0) + 1;
      if (duel.won) won[duel.stage] = (won[duel.stage] ?? 0) + 1;
      turns[duel.stage] = (turns[duel.stage] ?? 0) + duel.turns;
      deck[duel.stage] = (deck[duel.stage] ?? 0) + duel.playerDeckSize;
    }
  }

  return {
    runs,
    clears,
    clearRate: clears / runs,
    stages: STAGES.map((stage, index) => {
      const count = played[index] ?? 0;
      return {
        stage: index,
        name: stage.name,
        played: count,
        won: won[index] ?? 0,
        winRate: count === 0 ? 0 : (won[index] ?? 0) / count,
        averageTurns: count === 0 ? 0 : (turns[index] ?? 0) / count,
        averageDeckSize: count === 0 ? 0 : (deck[index] ?? 0) / count,
      };
    }),
  };
}
