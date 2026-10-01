/**
 * Drafting between duels.
 *
 * A run is only a deck-build if the deck changes. After each duel the player
 * is offered a few cards and takes one, or culls a card instead. That is what
 * makes the printed set matter: without it a run only ever sees the ten
 * creatures it started with.
 *
 * Recruits arrive at the level of the warband they are joining, not at level
 * one. A card drafted before the last duel is otherwise worthless, which makes
 * every late offer a non-choice.
 */

import type { CardDefinition } from '../core/cardDefinition.ts';
import type { EffectDefinition } from '../core/effects.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rarity } from '../core/rarity.ts';
import { rarityProfile } from '../core/rarity.ts';
import type { Rng } from '../core/rng.ts';

export type DraftOption =
  | {
      readonly kind: 'creature';
      readonly definitionId: string;
      readonly name: string;
      readonly rarity: Rarity;
      /** Level this recruit would join at. */
      readonly level: number;
    }
  | {
      readonly kind: 'effect';
      readonly effectId: string;
      readonly name: string;
      readonly rarity: Rarity;
    };

/** Rarer cards show up less often, but nothing is ever off the table. */
export const RARITY_DRAFT_WEIGHT: Record<Rarity, number> = {
  common: 40,
  uncommon: 28,
  rare: 18,
  epic: 10,
  mythic: 4,
};

/** Roughly two creatures offered for every effect. */
export const CREATURE_SHARE = 0.65;

export interface DraftRules {
  /** How many options to put in front of the player. */
  readonly count: number;
  /** Copies of one card a deck may hold. */
  readonly maxCopies: number;
}

export const DEFAULT_DRAFT_RULES: DraftRules = { count: 3, maxCopies: 2 };

export interface DraftContext {
  /** Levels of the creatures currently in the deck. */
  readonly rosterLevels: readonly number[];
  /** How many copies of each card id the deck already holds. */
  readonly copies: ReadonlyMap<string, number>;
}

/**
 * The level a recruit joins at: the middle of the warband, so a late draft is
 * still worth taking without outclassing what you have grown yourself.
 */
export function recruitLevel(rosterLevels: readonly number[], rarity: Rarity): number {
  if (rosterLevels.length === 0) return 1;
  const sorted = [...rosterLevels].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 1;
  return Math.max(1, Math.min(middle, rarityProfile(rarity).maxLevel));
}

interface Candidate {
  readonly option: DraftOption;
  readonly weight: number;
}

function candidates(
  library: CardLibrary,
  effects: readonly EffectDefinition[],
  context: DraftContext,
  rules: DraftRules,
): Candidate[] {
  const room = (id: string): boolean => (context.copies.get(id) ?? 0) < rules.maxCopies;
  const out: Candidate[] = [];

  for (const card of library.cards as readonly CardDefinition[]) {
    if (!room(card.id)) continue;
    out.push({
      option: {
        kind: 'creature',
        definitionId: card.id,
        name: card.name,
        rarity: card.rarity,
        level: recruitLevel(context.rosterLevels, card.rarity),
      },
      weight: RARITY_DRAFT_WEIGHT[card.rarity] * CREATURE_SHARE,
    });
  }

  for (const effect of effects) {
    if (!room(effect.id)) continue;
    out.push({
      option: { kind: 'effect', effectId: effect.id, name: effect.name, rarity: effect.rarity },
      weight: RARITY_DRAFT_WEIGHT[effect.rarity] * (1 - CREATURE_SHARE),
    });
  }

  return out;
}

/** Draws `rules.count` distinct options, weighted by rarity. */
export function rollDraft(
  rng: Rng,
  library: CardLibrary,
  effects: readonly EffectDefinition[],
  context: DraftContext,
  rules: DraftRules = DEFAULT_DRAFT_RULES,
): readonly DraftOption[] {
  const pool = candidates(library, effects, context, rules);
  const picked: DraftOption[] = [];

  while (picked.length < rules.count && pool.length > 0) {
    const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (total <= 0) break;

    let roll = rng.next() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= (pool[i] as Candidate).weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }

    const [taken] = pool.splice(index, 1);
    if (taken) picked.push(taken.option);
  }

  return picked;
}

export function optionId(option: DraftOption): string {
  return option.kind === 'creature' ? option.definitionId : option.effectId;
}
