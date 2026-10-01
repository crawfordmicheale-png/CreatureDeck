/**
 * Run simulator.
 *
 * Walks a generated map end to end with the AI on both sides — routing,
 * fighting, drafting, resting and levelling — so the balance harness measures
 * the game rather than an idealised version of it. The AI playing both sides
 * means a result reflects the *decks and the route*, not how well anyone
 * piloted them.
 */

import {
  MIN_CREATURES,
  MIN_DECK,
  STARTER_EFFECTS,
  STARTER_LEVEL,
  STARTER_ROSTER,
  duelXp,
  restXp,
} from '../content/campaign.ts';
import type { AiProfileName } from '../content/campaign.ts';
import type { Encounter } from '../content/encounters.ts';
import { encounterById, scaleEncounter } from '../content/encounters.ts';
import { EFFECTS, EFFECT_BY_ID } from '../content/index.ts';
import type { CardInstance } from '../core/cardInstance.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rng } from '../core/rng.ts';
import { createRng } from '../core/rng.ts';
import { rarityProfile } from '../core/rarity.ts';
import type { StatKey } from '../core/stats.ts';
import { CAUTIOUS, RUTHLESS, STEADY, playTurn } from '../duel/ai.ts';
import type { AiProfile } from '../duel/ai.ts';
import { Duel } from '../duel/engine.ts';
import type { DeckEntry } from '../duel/types.ts';
import { Collection } from './collection.ts';
import { optionId, rollDraft } from './draft.ts';
import type { GameMap, MapNode, NodeKind } from './map.ts';
import { availableMoves, depthStep, generateMap, nodeAt } from './map.ts';
import { applyXpAwards, autoDevelop } from './rewards.ts';

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

/** How a simulated player develops cards, plays turns and picks a route. */
export interface PlayerStyle {
  readonly name: string;
  readonly profile: AiProfile;
  readonly preferOffence: boolean;
  focusFor(definitionId: string, index: number): readonly StatKey[];
  /** Ranks a node the route could move to; highest wins. */
  rankNode?(kind: NodeKind): number;
}

const GREEDY_ROUTE: Record<NodeKind, number> = {
  elite: 3,
  cache: 2,
  battle: 1,
  rest: 0,
  boss: 0,
};
const SAFE_ROUTE: Record<NodeKind, number> = {
  rest: 3,
  cache: 2,
  battle: 1,
  elite: 0,
  boss: 0,
};

export const BALANCED_STYLE: PlayerStyle = {
  name: 'Balanced',
  profile: STEADY,
  preferOffence: true,
  focusFor: (_id, index) => FOCUS_PRESETS[index % FOCUS_PRESETS.length] as readonly StatKey[],
  rankNode: (kind) => GREEDY_ROUTE[kind],
};

export const AGGRESSIVE_STYLE: PlayerStyle = {
  name: 'Aggressive',
  profile: RUTHLESS,
  preferOffence: true,
  focusFor: () => ['might'],
  rankNode: (kind) => GREEDY_ROUTE[kind],
};

export const DEFENSIVE_STYLE: PlayerStyle = {
  name: 'Defensive',
  profile: CAUTIOUS,
  preferOffence: false,
  focusFor: () => ['vitality', 'guard'],
  rankNode: (kind) => SAFE_ROUTE[kind],
};

export interface FightOutcome {
  readonly depth: number;
  readonly kind: NodeKind;
  readonly encounterId: string;
  readonly encounterName: string;
  readonly tier: number;
  readonly won: boolean;
  readonly turns: number;
  readonly deckSize: number;
}

export interface RunOutcome {
  readonly cleared: boolean;
  /** How far up the map the run reached, 0-indexed. */
  readonly depthReached: number;
  readonly fights: readonly FightOutcome[];
  readonly visited: readonly NodeKind[];
  readonly finalCreatures: number;
  readonly finalEffects: number;
}

interface RunDeck {
  readonly collection: Collection;
  roster: string[];
  effects: string[];
}

/** The level cap of a card's rarity, for firming an encounter up by depth. */
export function maxLevelOf(library: CardLibrary): (definitionId: string) => number {
  return (definitionId) => rarityProfile(library.getCard(definitionId).rarity).maxLevel;
}

function buildStarter(library: CardLibrary, style: PlayerStyle): RunDeck {
  const collection = new Collection(library);
  const roster = STARTER_ROSTER.map(([definitionId, nickname], index) => {
    const instance = collection.add(definitionId, { nickname, level: STARTER_LEVEL });
    collection.autoAllocate(instance.instanceId, style.focusFor(definitionId, index));
    return instance.instanceId;
  });
  return { collection, roster, effects: [...STARTER_EFFECTS] };
}

function buildEncounter(
  library: CardLibrary,
  encounter: Encounter,
): { deck: DeckEntry[]; instances: CardInstance[] } {
  const collection = new Collection(library);
  const instances: CardInstance[] = [];
  const deck: DeckEntry[] = [];

  for (const entry of encounter.creatures) {
    const instance = collection.add(entry.definitionId, { level: entry.level });
    collection.autoAllocate(instance.instanceId, entry.focus);
    instances.push(collection.get(instance.instanceId));
    deck.push({ kind: 'creature', instanceId: instance.instanceId });
  }
  for (const effectId of encounter.effects) deck.push({ kind: 'effect', effectId });

  return { deck, instances };
}

function playerEntries(run: RunDeck): DeckEntry[] {
  return [
    ...run.roster.map((id): DeckEntry => ({ kind: 'creature', instanceId: id })),
    ...run.effects.map((effectId): DeckEntry => ({ kind: 'effect', effectId })),
  ];
}

export function simulateFight(
  library: CardLibrary,
  run: RunDeck,
  encounter: Encounter,
  seed: number,
  playerProfile: AiProfile,
): { won: boolean; turns: number } {
  const foe = buildEncounter(library, encounter);
  const mine = run.roster.map((id) => run.collection.get(id));

  const duel = new Duel(
    [
      { id: 'p1', name: 'You', deck: playerEntries(run) },
      { id: 'p2', name: encounter.name, deck: foe.deck },
    ],
    library,
    EFFECT_BY_ID,
    [...mine, ...foe.instances],
    { seed, nexusHealth: encounter.nexusHealth },
  );

  const enemyProfile = PROFILES[encounter.profile];
  for (let guard = 0; guard < 400 && !duel.isOver; guard += 1) {
    const mineToMove = duel.snapshot().activePlayerId === 'p1';
    playTurn(duel, mineToMove ? playerProfile : enemyProfile);
  }

  const result = duel.result;
  return { won: result?.winner === 'p1', turns: result?.turns ?? 0 };
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

  const creatures = offers.filter((option) => option.kind === 'creature');
  const pick = creatures.length > 0 ? creatures[0] : offers[0];
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

function develop(run: RunDeck, style: PlayerStyle): void {
  run.roster.forEach((id, index) => {
    const definitionId = run.collection.get(id).definitionId;
    autoDevelop(run.collection, id, style.focusFor(definitionId, index), style.preferOffence);
  });
}

function award(run: RunDeck, xp: number): void {
  applyXpAwards(
    run.collection,
    run.roster.map((id) => ({
      instanceId: id,
      name: run.collection.resolve(id).displayName,
      xp,
    })),
  );
}

/** Picks the next node by the style's taste, breaking ties with the rng. */
function chooseNext(map: GameMap, from: string | null, style: PlayerStyle, rng: Rng): string | null {
  const moves = availableMoves(map, from);
  if (moves.length === 0) return null;
  if (!style.rankNode) return rng.pick(moves);

  const ranked = [...moves].sort((a, b) => {
    const delta = (style.rankNode as (k: NodeKind) => number)(nodeAt(map, b).kind) -
      (style.rankNode as (k: NodeKind) => number)(nodeAt(map, a).kind);
    return delta !== 0 ? delta : (rng.next() < 0.5 ? -1 : 1);
  });
  return ranked[0] ?? null;
}

export interface RunOptions {
  readonly seed: number;
  readonly style?: PlayerStyle;
  readonly draft?: boolean;
}

export function simulateRun(library: CardLibrary, options: RunOptions): RunOutcome {
  const style = options.style ?? BALANCED_STYLE;
  const rng = createRng(options.seed);
  const map = generateMap(options.seed);
  const run = buildStarter(library, style);

  const fights: FightOutcome[] = [];
  const visited: NodeKind[] = [];
  let current: string | null = null;
  let depth = -1;

  for (let step = 0; step < map.rows + 2; step += 1) {
    const next: string | null = chooseNext(map, current, style, rng);
    if (next === null) break;
    current = next;

    const node: MapNode = nodeAt(map, current);
    depth = node.row;
    visited.push(node.kind);

    if (node.kind === 'rest') {
      award(run, restXp(depth));
      develop(run, style);
      continue;
    }
    if (node.kind === 'cache') {
      if (options.draft !== false) draftOnce(library, run, rng, style);
      develop(run, style);
      continue;
    }

    const encounter = scaleEncounter(
      encounterById(node.encounterId as string),
      depthStep(depth, map.rows),
      maxLevelOf(library),
    );
    const outcome = simulateFight(
      library,
      run,
      encounter,
      options.seed + depth * 7919,
      style.profile,
    );

    fights.push({
      depth,
      kind: node.kind,
      encounterId: encounter.id,
      encounterName: encounter.name,
      tier: encounter.tier,
      won: outcome.won,
      turns: outcome.turns,
      deckSize: run.roster.length + run.effects.length,
    });

    award(run, duelXp(depth, outcome.won, node.kind === 'elite'));
    if (!outcome.won) {
      return {
        cleared: false,
        depthReached: depth,
        fights,
        visited,
        finalCreatures: run.roster.length,
        finalEffects: run.effects.length,
      };
    }
    if (node.kind === 'boss') break;

    if (options.draft !== false) draftOnce(library, run, rng, style);
    develop(run, style);
  }

  return {
    cleared: current === map.bossId,
    depthReached: depth,
    fights,
    visited,
    finalCreatures: run.roster.length,
    finalEffects: run.effects.length,
  };
}

export interface DepthReport {
  readonly depth: number;
  readonly played: number;
  readonly won: number;
  readonly winRate: number;
  readonly averageTurns: number;
}

export interface SweepReport {
  readonly runs: number;
  readonly clears: number;
  readonly clearRate: number;
  readonly averageDepth: number;
  readonly depths: readonly DepthReport[];
  readonly byKind: Readonly<Record<string, { played: number; won: number }>>;
  readonly worst: readonly { readonly name: string; readonly played: number; readonly winRate: number }[];
}

export function sweep(
  library: CardLibrary,
  runs: number,
  options: Omit<RunOptions, 'seed'> = {},
): SweepReport {
  const rows = 12;
  const played = new Array(rows).fill(0) as number[];
  const won = new Array(rows).fill(0) as number[];
  const turns = new Array(rows).fill(0) as number[];
  const byKind: Record<string, { played: number; won: number }> = {};
  const byEncounter = new Map<string, { name: string; played: number; won: number }>();
  let clears = 0;
  let depthTotal = 0;

  for (let i = 0; i < runs; i += 1) {
    const outcome = simulateRun(library, { ...options, seed: 1000 + i * 131 });
    if (outcome.cleared) clears += 1;
    depthTotal += outcome.depthReached + 1;

    for (const fight of outcome.fights) {
      played[fight.depth] = (played[fight.depth] ?? 0) + 1;
      turns[fight.depth] = (turns[fight.depth] ?? 0) + fight.turns;
      if (fight.won) won[fight.depth] = (won[fight.depth] ?? 0) + 1;

      byKind[fight.kind] ??= { played: 0, won: 0 };
      (byKind[fight.kind] as { played: number; won: number }).played += 1;
      if (fight.won) (byKind[fight.kind] as { played: number; won: number }).won += 1;

      const seen = byEncounter.get(fight.encounterId) ?? {
        name: fight.encounterName,
        played: 0,
        won: 0,
      };
      seen.played += 1;
      if (fight.won) seen.won += 1;
      byEncounter.set(fight.encounterId, seen);
    }
  }

  const worst = [...byEncounter.values()]
    .filter((entry) => entry.played >= 10)
    .map((entry) => ({ name: entry.name, played: entry.played, winRate: entry.won / entry.played }))
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);

  return {
    runs,
    clears,
    clearRate: clears / runs,
    averageDepth: depthTotal / runs,
    depths: played.map((count, depth) => ({
      depth,
      played: count,
      won: won[depth] ?? 0,
      winRate: count === 0 ? 0 : (won[depth] ?? 0) / count,
      averageTurns: count === 0 ? 0 : (turns[depth] ?? 0) / count,
    })),
    byKind,
    worst,
  };
}
