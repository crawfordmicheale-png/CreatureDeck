/**
 * Turning a finished duel into XP.
 *
 * Deliberately free of any combat type: the duel decides who won, and this
 * decides what that is worth. Keeping the two apart is what lets the balance
 * harness and the game award XP the same way.
 */

import { duelXp } from '../content/campaign.ts';
import type { Collection } from './collection.ts';

export interface XpAward {
  readonly instanceId: string;
  readonly name: string;
  readonly xp: number;
}

export interface AppliedAward extends XpAward {
  readonly levelsGained: number;
  readonly growthPointsGained: number;
  readonly abilitiesUnlocked: readonly string[];
  readonly newLevel: number;
  /** Upgrade forks now waiting to be chosen. */
  readonly pendingUpgrades: number;
}

/**
 * Every creature in the deck earns the same, whether or not it was drawn.
 * A roster where only the opening hand improves would quietly collapse into
 * five cards the player always plays and the rest dead weight.
 */
export function computeDuelXp(
  collection: Collection,
  instanceIds: readonly string[],
  depth: number,
  won: boolean,
  elite = false,
): readonly XpAward[] {
  const xp = duelXp(depth, won, elite);
  return instanceIds.map((instanceId) => ({
    instanceId,
    name: collection.resolve(instanceId).displayName,
    xp,
  }));
}

/** Applies awards to a collection, reporting what each card actually gained. */
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
      pendingUpgrades: collection.resolve(award.instanceId).pendingUpgrades,
    };
  });
}

/**
 * Spends growth points and takes upgrade forks the way a reasonable player
 * would. Used by the balance harness, which has to make these choices
 * thousands of times, and as the "just do something sensible" button.
 */
export function autoDevelop(
  collection: Collection,
  instanceId: string,
  focus: readonly import('../core/stats.ts').StatKey[],
  preferOffence: boolean,
): void {
  // Forks first: they change the stats the points are then spent alongside.
  for (let guard = 0; guard < 12; guard += 1) {
    const card = collection.resolve(instanceId);
    if (card.upgradeChoice === null) break;
    const [offence, other] = card.upgradeChoice;
    collection.chooseUpgrade(instanceId, preferOffence ? offence.id : other.id);
  }
  collection.autoAllocate(instanceId, focus);
}
