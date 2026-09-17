/**
 * Battle-time behaviour for every printed ability, keyed by ability id.
 *
 * Handlers only ever touch the narrow `BattleApi`. They cannot reorder the
 * round, read the opposing hand, or reach outside the battle — which is what
 * keeps a battle reproducible from its seed.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import { abilityParam } from '../core/abilities.ts';
import type { BattleApi, Combatant, DamageKind } from './types.ts';

export interface AbilityCtx {
  readonly api: BattleApi;
  readonly self: Combatant;
  readonly ability: AbilityDefinition;
}

export interface AbilityHooks {
  /** Added to the owner's Speed when ordering actions and resolving dodges. */
  speedBonus?(ctx: AbilityCtx): number;
  /** Guard this creature grants to each living ally while it is alive. */
  allyGuardBonus?(ctx: AbilityCtx): number;
  onEnter?(ctx: AbilityCtx): void;
  onStartOfRound?(ctx: AbilityCtx): void;
  /** Override the default front-most target. First non-null hook wins. */
  selectTarget?(ctx: AbilityCtx, candidates: readonly Combatant[]): Combatant | null;
  outgoingDamage?(ctx: AbilityCtx, target: Combatant, damage: number): number;
  incomingDamage?(
    ctx: AbilityCtx,
    attacker: Combatant | null,
    kind: DamageKind,
    damage: number,
  ): number;
  afterAttack?(ctx: AbilityCtx, target: Combatant, dealt: number, overkill: number): void;
  /** Only fires when the owner survived the hit. */
  afterDamaged?(
    ctx: AbilityCtx,
    attacker: Combatant | null,
    kind: DamageKind,
    dealt: number,
  ): void;
  onKill?(ctx: AbilityCtx, victim: Combatant): void;
  /** Return true to cancel a lethal blow. */
  preventDeath?(ctx: AbilityCtx): boolean;
  /** Damage multipliers for additional swings after the main attack. */
  extraSwings?(ctx: AbilityCtx): readonly number[];
}

export const ABILITY_HANDLERS: Readonly<Record<string, AbilityHooks>> = {
  ferocity: {
    outgoingDamage: ({ self, ability }, _target, damage) =>
      self.health * 2 > self.maxHealth ? damage + abilityParam(ability, 'bonus') : damage,
  },

  venom: {
    afterAttack: ({ api, self, ability }, target, dealt) => {
      if (dealt <= 0 || !target.alive) return;
      const stacks = abilityParam(ability, 'stacks');
      api.addPoison(target, stacks);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: target.uid,
        abilityId: ability.id,
        amount: stacks,
        message: `${self.card.displayName} injects ${stacks} poison into ${target.card.displayName}.`,
      });
    },
  },

  regrowth: {
    onStartOfRound: ({ api, self, ability }) => {
      const healed = api.heal(self, abilityParam(ability, 'heal'));
      if (healed > 0) {
        api.log({
          type: 'heal',
          actorUid: self.uid,
          abilityId: ability.id,
          amount: healed,
          message: `${self.card.displayName} regrows ${healed} health.`,
        });
      }
    },
  },

  rally: {
    onEnter: ({ api, self, ability }) => {
      const amount = abilityParam(ability, 'might');
      const allies = api.alliesOf(self).filter((ally) => ally.alive && ally.uid !== self.uid);
      for (const ally of allies) api.buffMight(ally, amount);
      if (allies.length > 0) {
        api.log({
          type: 'ability',
          actorUid: self.uid,
          abilityId: ability.id,
          amount,
          message: `${self.card.displayName} rallies ${allies.length} ally(s) for +${amount} Might.`,
        });
      }
    },
  },

  bulwark: {
    allyGuardBonus: ({ ability }) => abilityParam(ability, 'guard'),
  },

  'first-strike': {
    speedBonus: ({ ability }) => abilityParam(ability, 'speed'),
  },

  bloodlust: {
    onKill: ({ api, self, ability }, victim) => {
      const amount = abilityParam(ability, 'might');
      api.buffMight(self, amount);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        abilityId: ability.id,
        amount,
        message: `${self.card.displayName} feeds on ${victim.card.displayName} (+${amount} Might).`,
      });
    },
  },

  thorns: {
    afterDamaged: ({ api, self, ability }, attacker, kind) => {
      if (kind !== 'attack' || attacker === null || !attacker.alive) return;
      const reflect = abilityParam(ability, 'reflect');
      api.damage(attacker, reflect, 'reflect', self);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: attacker.uid,
        abilityId: ability.id,
        amount: reflect,
        message: `${attacker.card.displayName} is gored for ${reflect} by ${self.card.displayName}'s thorns.`,
      });
    },
  },

  siphon: {
    afterAttack: ({ api, self, ability }, _target, dealt) => {
      if (dealt <= 0) return;
      const healed = api.heal(self, Math.round((dealt * abilityParam(ability, 'percent')) / 100));
      if (healed > 0) {
        api.log({
          type: 'heal',
          actorUid: self.uid,
          abilityId: ability.id,
          amount: healed,
          message: `${self.card.displayName} siphons ${healed} health.`,
        });
      }
    },
  },

  doublestrike: {
    extraSwings: ({ ability }) => [abilityParam(ability, 'percent') / 100],
  },

  dread: {
    onEnter: ({ api, self, ability }) => {
      const amount = abilityParam(ability, 'might');
      const enemies = api.livingEnemiesOf(self);
      for (const enemy of enemies) api.buffMight(enemy, -amount);
      if (enemies.length > 0) {
        api.log({
          type: 'ability',
          actorUid: self.uid,
          abilityId: ability.id,
          amount,
          message: `${self.card.displayName} spreads dread: ${enemies.length} enemy(s) lose ${amount} Might.`,
        });
      }
    },
  },

  rebirth: {
    preventDeath: ({ api, self, ability }) => {
      if (self.rebirthUsed) return false;
      self.rebirthUsed = true;
      self.health = Math.max(1, Math.round((self.maxHealth * abilityParam(ability, 'percent')) / 100));
      self.poison = 0;
      api.log({
        type: 'revive',
        actorUid: self.uid,
        abilityId: ability.id,
        amount: self.health,
        message: `${self.card.displayName} is reborn with ${self.health} health.`,
      });
      return true;
    },
  },

  stoneform: {
    incomingDamage: ({ ability }, _attacker, kind, damage) =>
      kind === 'attack' ? damage * (1 - abilityParam(ability, 'percent') / 100) : damage,
  },

  overwhelm: {
    afterAttack: ({ api, self, ability }, target, _dealt, overkill) => {
      if (overkill <= 0) return;
      api.damageNexus(api.opponentOf(self.ownerId), overkill);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: target.uid,
        abilityId: ability.id,
        amount: overkill,
        message: `${self.card.displayName} overwhelms through for ${overkill} nexus damage.`,
      });
    },
  },

  frenzy: {
    afterDamaged: ({ api, self, ability }, _attacker, _kind, dealt) => {
      if (dealt <= 0) return;
      const amount = abilityParam(ability, 'might');
      api.buffMight(self, amount);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        abilityId: ability.id,
        amount,
        message: `${self.card.displayName} works itself into a frenzy (+${amount} Might).`,
      });
    },
  },

  hunt: {
    selectTarget: (_ctx, candidates) => {
      let best: Combatant | null = null;
      for (const candidate of candidates) {
        if (best === null || candidate.health < best.health) best = candidate;
      }
      return best;
    },
  },

  aegis: {
    incomingDamage: ({ api, self, ability }, _attacker, kind, damage) => {
      if (kind !== 'attack' || self.aegisUsed || damage <= 0) return damage;
      self.aegisUsed = true;
      api.log({
        type: 'ability',
        actorUid: self.uid,
        abilityId: ability.id,
        amount: 0,
        message: `${self.card.displayName}'s aegis turns the blow aside.`,
      });
      return 0;
    },
  },

  warden: {
    onEnter: ({ api, self, ability }) => {
      const shield = abilityParam(ability, 'shield');
      api.grantShield(self, shield);
      const allies = api.alliesOf(self).filter((ally) => ally.alive && ally.uid !== self.uid);
      let mostWounded: Combatant | null = null;
      for (const ally of allies) {
        const missing = ally.maxHealth - ally.health;
        if (missing <= 0) continue;
        if (mostWounded === null || missing > mostWounded.maxHealth - mostWounded.health) {
          mostWounded = ally;
        }
      }
      if (mostWounded !== null) api.grantShield(mostWounded, shield);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        abilityId: ability.id,
        amount: shield,
        message: `${self.card.displayName} raises a ${shield}-point ward.`,
      });
    },
  },
};

export function hooksFor(abilityId: string): AbilityHooks | undefined {
  return ABILITY_HANDLERS[abilityId];
}
