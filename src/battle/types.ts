/**
 * Battle-time types.
 *
 * A `Combatant` is a resolved card that has actually been put on the board:
 * the card supplies the printed numbers, the combatant tracks what happens to
 * them over the course of one battle. Nothing here writes back to the player's
 * collection — battle damage is never permanent.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import type { ResolvedCard } from '../core/cardInstance.ts';
import type { Rng } from '../core/rng.ts';

export interface BattleConfig {
  readonly seed: number;
  readonly nexusHealth: number;
  readonly boardSlots: number;
  /** Cards drawn on the opening round. */
  readonly openingHand: number;
  readonly drawPerRound: number;
  readonly maxHandSize: number;
  readonly startingEnergy: number;
  readonly energyPerRound: number;
  readonly maxEnergy: number;
  readonly maxRounds: number;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  seed: 1,
  nexusHealth: 40,
  boardSlots: 5,
  openingHand: 4,
  drawPerRound: 1,
  maxHandSize: 7,
  startingEnergy: 3,
  energyPerRound: 2,
  maxEnergy: 14,
  maxRounds: 25,
};

export interface Combatant {
  readonly uid: string;
  readonly ownerId: string;
  readonly card: ResolvedCard;
  /** Board position. Lower slots are further forward and are hit first. */
  slot: number;
  /**
   * Round this creature was deployed. It cannot act until the round after,
   * which is what stops a cheap board from racing an undefended nexus down
   * before an expensive deck has the energy to answer.
   */
  readonly deployedRound: number;
  health: number;
  maxHealth: number;
  shield: number;
  /** Current Might, including battle-long buffs from Rally, Bloodlust, Dread. */
  might: number;
  speed: number;
  guard: number;
  poison: number;
  alive: boolean;
  /** Rebirth, Aegis: one-shot effects that must not re-trigger. */
  rebirthUsed: boolean;
  aegisUsed: boolean;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  readonly abilities: readonly AbilityDefinition[];
}

export type DamageKind = 'attack' | 'poison' | 'reflect' | 'fatigue';

export type BattleEventType =
  | 'battle-start'
  | 'round-start'
  | 'draw'
  | 'fatigue'
  | 'deploy'
  | 'ability'
  | 'attack'
  | 'dodge'
  | 'damage'
  | 'heal'
  | 'death'
  | 'revive'
  | 'nexus-damage'
  | 'battle-end';

export interface BattleEvent {
  readonly round: number;
  readonly type: BattleEventType;
  readonly playerId?: string;
  readonly actorUid?: string;
  readonly targetUid?: string;
  readonly abilityId?: string;
  readonly amount?: number;
  readonly message: string;
}

export interface CardBattleStats {
  readonly instanceId: string;
  readonly name: string;
  readonly deployed: boolean;
  readonly kills: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly survived: boolean;
}

export interface PlayerBattleSummary {
  readonly playerId: string;
  readonly name: string;
  readonly nexusHealth: number;
  readonly cardsDeployed: number;
  readonly cards: readonly CardBattleStats[];
}

export type BattleEndReason =
  | 'nexus-destroyed'
  | 'round-limit'
  | 'board-tiebreak'
  | 'mutual-destruction';

export interface BattleResult {
  /** Player id, or null for a draw. */
  readonly winner: string | null;
  readonly loser: string | null;
  readonly reason: BattleEndReason;
  readonly rounds: number;
  readonly players: readonly PlayerBattleSummary[];
  readonly log: readonly BattleEvent[];
}

/** What a controller is allowed to see when deciding what to deploy. */
export interface ControllerView {
  readonly round: number;
  readonly energy: number;
  readonly freeSlots: number;
  /** Playable cards, already filtered to those that fit the board. */
  readonly hand: readonly ResolvedCard[];
  readonly board: readonly Combatant[];
  readonly enemyBoard: readonly Combatant[];
  readonly nexusHealth: number;
  readonly enemyNexusHealth: number;
  readonly rng: Rng;
}

export interface Controller {
  readonly name: string;
  /**
   * Instance ids to deploy, in priority order. The engine deploys as many as
   * energy and open slots allow and silently skips the rest, so a controller
   * can safely return its whole wish list.
   */
  chooseDeployments(view: ControllerView): readonly string[];
}

/**
 * The surface ability handlers are given. Deliberately narrow: handlers may
 * deal damage, heal, buff and log, but may not reorder the round or reach into
 * another battle.
 */
export interface BattleApi {
  readonly rng: Rng;
  readonly round: number;
  alliesOf(combatant: Combatant): readonly Combatant[];
  enemiesOf(combatant: Combatant): readonly Combatant[];
  /** Living enemies, front-most first. */
  livingEnemiesOf(combatant: Combatant): readonly Combatant[];
  damage(target: Combatant, amount: number, kind: DamageKind, source: Combatant | null): number;
  heal(target: Combatant, amount: number): number;
  grantShield(target: Combatant, amount: number): void;
  buffMight(target: Combatant, amount: number): void;
  addPoison(target: Combatant, stacks: number): void;
  damageNexus(playerId: string, amount: number): void;
  opponentOf(playerId: string): string;
  log(event: Omit<BattleEvent, 'round'>): void;
}
