/**
 * The duel: a tactical, player-driven battle.
 *
 * A duel only moves when someone takes an action: the player chooses what to
 * play, which creature swings, and what it swings at. Nothing resolves on its
 * own.
 *
 * Three rules carry the design:
 *   - **Stamina.** Every attack spends one. At zero the creature is spent and
 *     goes to the discard pile, so a board is a clock, not a wall.
 *   - **Lanes.** Slot 1 faces slot 1. You may attack any enemy creature, but
 *     you may only strike the nexus when the lane facing your attacker is
 *     empty — so there is always a way through without making blockers moot.
 *   - **Effects.** One-shot cards that spend the energy a creature would have
 *     cost, which is what makes holding one a real decision.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import type { ResolvedCard } from '../core/cardInstance.ts';
import type { EffectDefinition } from '../core/effects.ts';

export interface DuelConfig {
  readonly seed: number;
  readonly nexusHealth: number;
  readonly lanes: number;
  readonly handSize: number;
  readonly startingEnergy: number;
  readonly energyPerRound: number;
  readonly maxEnergy: number;
  /** Player turns, not rounds. Two turns make a round. */
  readonly maxTurns: number;
}

export const DEFAULT_DUEL_CONFIG: DuelConfig = {
  seed: 1,
  nexusHealth: 30,
  lanes: 3,
  handSize: 3,
  startingEnergy: 4,
  energyPerRound: 2,
  maxEnergy: 14,
  maxTurns: 60,
};

/** A card as it sits in a deck, hand or discard pile. */
export type DeckEntry =
  | { readonly kind: 'creature'; readonly instanceId: string }
  | { readonly kind: 'effect'; readonly effectId: string };

export interface DuelUnit {
  readonly uid: string;
  readonly ownerId: string;
  readonly card: ResolvedCard;
  lane: number;
  health: number;
  maxHealth: number;
  shield: number;
  might: number;
  speed: number;
  guard: number;
  poison: number;
  stamina: number;
  maxStamina: number;
  alive: boolean;
  /** Turn it was played; it cannot attack until the turn after. */
  readonly playedOnTurn: number;
  /** Turn it last attacked, so it only swings once per turn. */
  attackedOnTurn: number;
  rebirthUsed: boolean;
  aegisUsed: boolean;
  kills: number;
  damageDealt: number;
  readonly abilities: readonly AbilityDefinition[];
}

export type DuelAction =
  | { readonly type: 'play-creature'; readonly instanceId: string; readonly lane: number }
  | { readonly type: 'play-effect'; readonly effectId: string; readonly targetUid?: string }
  | { readonly type: 'attack'; readonly attackerUid: string; readonly targetUid: string }
  | { readonly type: 'end-turn' };

/** `targetUid` for an attack aimed at the enemy nexus. */
export const NEXUS_TARGET = 'nexus';

export type DuelEventType =
  | 'turn-start'
  | 'draw'
  | 'reshuffle'
  | 'play-creature'
  | 'play-effect'
  | 'ability'
  | 'attack'
  | 'dodge'
  | 'damage'
  | 'heal'
  | 'shield'
  | 'stamina'
  | 'spent'
  | 'death'
  | 'revive'
  | 'nexus-damage'
  | 'duel-end';

export interface DuelEvent {
  readonly turn: number;
  readonly type: DuelEventType;
  readonly playerId?: string;
  readonly actorUid?: string;
  readonly targetUid?: string;
  readonly amount?: number;
  readonly message: string;
}

export type DamageKind = 'attack' | 'effect' | 'poison' | 'reflect';

// ------------------------------------------------------------------ snapshot

export interface UnitSnapshot {
  readonly uid: string;
  readonly ownerId: string;
  readonly name: string;
  readonly lane: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly might: number;
  readonly guard: number;
  readonly speed: number;
  readonly poison: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly alive: boolean;
  readonly canAttack: boolean;
  readonly resting: boolean;
  readonly level: number;
  readonly rarity: string;
  readonly rarityLabel: string;
  readonly tier: string;
  readonly tierLabel: string;
  readonly art: string;
  readonly abilities: readonly { readonly name: string; readonly description: string }[];
}

export type HandSnapshot =
  | {
      readonly kind: 'creature';
      readonly id: string;
      readonly name: string;
      readonly cost: number;
      readonly playable: boolean;
      readonly level: number;
      readonly rarity: string;
      readonly rarityLabel: string;
      readonly tier: string;
      readonly tierLabel: string;
      readonly might: number;
      readonly vitality: number;
      readonly speed: number;
      readonly guard: number;
      readonly stamina: number;
      readonly art: string;
      readonly abilities: readonly { readonly name: string; readonly description: string }[];
      readonly blocked: string;
    }
  | {
      readonly kind: 'effect';
      readonly id: string;
      readonly name: string;
      readonly cost: number;
      readonly playable: boolean;
      readonly rarity: string;
      readonly rarityLabel: string;
      readonly target: string;
      readonly text: string;
      readonly art: string;
      readonly blocked: string;
    };

export interface DuelPlayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly nexusHealth: number;
  readonly maxNexusHealth: number;
  readonly energy: number;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly hand: readonly HandSnapshot[];
  readonly lanes: readonly (UnitSnapshot | null)[];
}

export interface DuelSnapshot {
  readonly turn: number;
  readonly round: number;
  readonly activePlayerId: string;
  readonly players: readonly [DuelPlayerSnapshot, DuelPlayerSnapshot];
  readonly over: boolean;
}

export type DuelEndReason = 'nexus-destroyed' | 'turn-limit';

export interface DuelResult {
  readonly winner: string | null;
  readonly loser: string | null;
  readonly reason: DuelEndReason;
  readonly turns: number;
  readonly nexus: Readonly<Record<string, number>>;
}

export interface DuelPlayerSetup {
  readonly id: string;
  readonly name: string;
  readonly deck: readonly DeckEntry[];
}

/** Everything a front-end needs to know about one legal attack. */
export interface AttackOption {
  readonly attackerUid: string;
  readonly targetUid: string;
  readonly lethal: boolean;
  readonly damage: number;
}

export type { EffectDefinition };

// ----------------------------------------------------------------- handlers

/**
 * The surface ability and effect handlers are given. Deliberately narrow:
 * they may damage, heal, buff and log, but cannot end a turn, reorder play,
 * or reach outside the duel.
 */
export interface DuelApi {
  readonly turn: number;
  alliesOf(unit: DuelUnit): readonly DuelUnit[];
  enemiesOf(unit: DuelUnit): readonly DuelUnit[];
  unitsOf(playerId: string): readonly DuelUnit[];
  opponentOf(playerId: string): string;
  damage(target: DuelUnit, amount: number, kind: DamageKind, source: DuelUnit | null): number;
  heal(target: DuelUnit, amount: number): number;
  grantShield(target: DuelUnit, amount: number): void;
  buffMight(target: DuelUnit, amount: number): void;
  addPoison(target: DuelUnit, stacks: number): void;
  clearPoison(target: DuelUnit): void;
  changeStamina(target: DuelUnit, delta: number): void;
  damageNexus(playerId: string, amount: number): void;
  drawCards(playerId: string, count: number): void;
  /** Pulls the best spent creature out of the discard pile. */
  recoverCreature(playerId: string): string | null;
  log(event: Omit<DuelEvent, 'turn'>): void;
}

export interface DuelAbilityHooks {
  /** Flat Speed bonus, which feeds dodge chance. */
  speedBonus?(ability: AbilityDefinition): number;
  /** Guard this unit grants to each living ally. */
  allyGuardBonus?(ability: AbilityDefinition): number;
  /** Attacks from this unit ignore the target's Guard. */
  piercing?(ability: AbilityDefinition): boolean;
  onPlay?(api: DuelApi, self: DuelUnit, ability: AbilityDefinition): void;
  onTurnStart?(api: DuelApi, self: DuelUnit, ability: AbilityDefinition): void;
  outgoingDamage?(
    api: DuelApi,
    self: DuelUnit,
    ability: AbilityDefinition,
    target: DuelUnit,
    damage: number,
  ): number;
  incomingDamage?(
    api: DuelApi,
    self: DuelUnit,
    ability: AbilityDefinition,
    kind: DamageKind,
    damage: number,
  ): number;
  afterAttack?(
    api: DuelApi,
    self: DuelUnit,
    ability: AbilityDefinition,
    target: DuelUnit,
    dealt: number,
    overkill: number,
  ): void;
  afterDamaged?(
    api: DuelApi,
    self: DuelUnit,
    ability: AbilityDefinition,
    attacker: DuelUnit | null,
    kind: DamageKind,
    dealt: number,
  ): void;
  onKill?(api: DuelApi, self: DuelUnit, ability: AbilityDefinition, victim: DuelUnit): void;
  /** Return true to cancel a lethal blow. */
  preventDeath?(api: DuelApi, self: DuelUnit, ability: AbilityDefinition): boolean;
  /** Extra swings, as damage multipliers, on the same activation. */
  extraSwings?(ability: AbilityDefinition): readonly number[];
}

export interface EffectContext {
  readonly api: DuelApi;
  readonly casterId: string;
  readonly effect: EffectDefinition;
  readonly target: DuelUnit | null;
}

export type EffectHandler = (context: EffectContext) => void;
