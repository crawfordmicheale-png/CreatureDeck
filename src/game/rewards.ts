/**
 * Turning a battle into XP.
 *
 * Cards that fought earn most of it, but benched cards still earn a share —
 * otherwise a player's deck ossifies around whichever six cards happened to be
 * good first, and the collection stops being interesting.
 */

import type { BattleResult } from '../battle/types.ts';
import type { Collection } from './collection.ts';

export interface XpRewardConfig {
  readonly base: number;
  readonly perRound: number;
  readonly winMultiplier: number;
  readonly perKill: number;
  /** One XP per this much damage dealt. */
  readonly damagePerXp: number;
  /** Fraction of the base award that undeployed cards receive. */
  readonly benchShare: number;
  readonly survivalBonus: number;
}

export const DEFAULT_XP_REWARDS: XpRewardConfig = {
  base: 30,
  perRound: 2,
  winMultiplier: 1.5,
  perKill: 15,
  damagePerXp: 4,
  benchShare: 0.25,
  survivalBonus: 10,
};

export interface XpAward {
  readonly instanceId: string;
  readonly name: string;
  readonly xp: number;
  readonly deployed: boolean;
}

export function computeXpAwards(
  result: BattleResult,
  playerId: string,
  config: XpRewardConfig = DEFAULT_XP_REWARDS,
): readonly XpAward[] {
  const summary = result.players.find((player) => player.playerId === playerId);
  if (!summary) throw new Error(`No battle summary for player "${playerId}".`);

  const won = result.winner === playerId;
  const pool = (config.base + config.perRound * result.rounds) * (won ? config.winMultiplier : 1);

  return summary.cards.map((card) => {
    if (!card.deployed) {
      return {
        instanceId: card.instanceId,
        name: card.name,
        xp: Math.round(pool * config.benchShare),
        deployed: false,
      };
    }
    const xp =
      pool +
      card.kills * config.perKill +
      Math.floor(card.damageDealt / config.damagePerXp) +
      (card.survived ? config.survivalBonus : 0);
    return { instanceId: card.instanceId, name: card.name, xp: Math.round(xp), deployed: true };
  });
}

export interface AppliedAward extends XpAward {
  readonly levelsGained: number;
  readonly growthPointsGained: number;
  readonly abilitiesUnlocked: readonly string[];
  readonly newLevel: number;
}

/** Applies awards to a collection, returning what each card actually gained. */
export function applyXpAwards(
  collection: Collection,
  awards: readonly XpAward[],
): readonly AppliedAward[] {
  return awards.map((award) => {
    const result = collection.grantXp(award.instanceId, award.xp);
    collection.recordBattle(award.instanceId);
    return {
      ...award,
      levelsGained: result.levelsGained,
      growthPointsGained: result.growthPointsGained,
      abilitiesUnlocked: result.abilitiesUnlocked,
      newLevel: result.instance.level,
    };
  });
}
