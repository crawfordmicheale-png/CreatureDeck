/**
 * Duel-time behaviour for the printed abilities.
 *
 * Most carry over from the auto-resolver unchanged. Two had to be rethought
 * for a game the player drives:
 *
 *   - **Hunt** used to pick the weakest enemy automatically. The player now
 *     picks targets, so instead it makes the creature's attacks ignore Guard.
 *   - **First Strike** no longer buys turn order, because you choose the order
 *     yourself. It still raises Speed, which is what dodging is read from.
 */

import { abilityParam } from '../core/abilities.ts';
import type { AbilityDefinition } from '../core/abilities.ts';
import type { DuelAbilityHooks, DuelUnit } from './types.ts';

export const DUEL_ABILITIES: Readonly<Record<string, DuelAbilityHooks>> = {
  ferocity: {
    outgoingDamage: (_api, self, ability, _target, damage) =>
      self.health * 2 > self.maxHealth ? damage + abilityParam(ability, 'bonus') : damage,
  },

  venom: {
    afterAttack: (api, self, ability, target, dealt) => {
      if (dealt <= 0 || !target.alive) return;
      const stacks = abilityParam(ability, 'stacks');
      api.addPoison(target, stacks);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: target.uid,
        amount: stacks,
        message: `${self.card.displayName} sinks ${stacks} poison into ${target.card.displayName}.`,
      });
    },
  },

  regrowth: {
    onTurnStart: (api, self, ability) => {
      const healed = api.heal(self, abilityParam(ability, 'heal'));
      if (healed > 0) {
        api.log({
          type: 'heal',
          actorUid: self.uid,
          amount: healed,
          message: `${self.card.displayName} regrows ${healed} health.`,
        });
      }
    },
  },

  rally: {
    onPlay: (api, self, ability) => {
      const amount = abilityParam(ability, 'might');
      const allies = api.alliesOf(self).filter((ally) => ally.alive && ally.uid !== self.uid);
      for (const ally of allies) api.buffMight(ally, amount);
      if (allies.length > 0) {
        api.log({
          type: 'ability',
          actorUid: self.uid,
          amount,
          message: `${self.card.displayName} rallies the line (+${amount} Might).`,
        });
      }
    },
  },

  bulwark: {
    allyGuardBonus: (ability) => abilityParam(ability, 'guard'),
  },

  'first-strike': {
    speedBonus: (ability) => abilityParam(ability, 'speed'),
  },

  bloodlust: {
    onKill: (api, self, ability, victim) => {
      const amount = abilityParam(ability, 'might');
      api.buffMight(self, amount);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        amount,
        message: `${self.card.displayName} feeds on ${victim.card.displayName} (+${amount} Might).`,
      });
    },
  },

  thorns: {
    afterDamaged: (api, self, ability, attacker, kind) => {
      if (kind !== 'attack' || attacker === null || !attacker.alive) return;
      const reflect = abilityParam(ability, 'reflect');
      api.damage(attacker, reflect, 'reflect', self);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: attacker.uid,
        amount: reflect,
        message: `${attacker.card.displayName} is gored for ${reflect} on ${self.card.displayName}'s thorns.`,
      });
    },
  },

  siphon: {
    afterAttack: (api, self, ability, _target, dealt) => {
      if (dealt <= 0) return;
      const healed = api.heal(self, Math.round((dealt * abilityParam(ability, 'percent')) / 100));
      if (healed > 0) {
        api.log({
          type: 'heal',
          actorUid: self.uid,
          amount: healed,
          message: `${self.card.displayName} siphons ${healed} health.`,
        });
      }
    },
  },

  doublestrike: {
    extraSwings: (ability) => [abilityParam(ability, 'percent') / 100],
  },

  dread: {
    onPlay: (api, self, ability) => {
      const amount = abilityParam(ability, 'might');
      const enemies = api.enemiesOf(self).filter((enemy) => enemy.alive);
      for (const enemy of enemies) api.buffMight(enemy, -amount);
      if (enemies.length > 0) {
        api.log({
          type: 'ability',
          actorUid: self.uid,
          amount,
          message: `${self.card.displayName} spreads dread (-${amount} enemy Might).`,
        });
      }
    },
  },

  rebirth: {
    preventDeath: (api, self, ability) => {
      if (self.rebirthUsed) return false;
      self.rebirthUsed = true;
      self.health = Math.max(
        1,
        Math.round((self.maxHealth * abilityParam(ability, 'percent')) / 100),
      );
      self.poison = 0;
      api.log({
        type: 'revive',
        actorUid: self.uid,
        amount: self.health,
        message: `${self.card.displayName} is reborn with ${self.health} health.`,
      });
      return true;
    },
  },

  stoneform: {
    incomingDamage: (_api, _self, ability, kind, damage) =>
      kind === 'attack' ? damage * (1 - abilityParam(ability, 'percent') / 100) : damage,
  },

  overwhelm: {
    afterAttack: (api, self, _ability, target, _dealt, overkill) => {
      if (overkill <= 0) return;
      api.damageNexus(api.opponentOf(self.ownerId), overkill);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        targetUid: target.uid,
        amount: overkill,
        message: `${self.card.displayName} overwhelms through for ${overkill}.`,
      });
    },
  },

  frenzy: {
    afterDamaged: (api, self, ability, _attacker, _kind, dealt) => {
      if (dealt <= 0) return;
      const amount = abilityParam(ability, 'might');
      api.buffMight(self, amount);
      api.log({
        type: 'ability',
        actorUid: self.uid,
        amount,
        message: `${self.card.displayName} works itself into a frenzy (+${amount} Might).`,
      });
    },
  },

  hunt: {
    // Repurposed: the player picks targets now, so this cuts through Guard.
    piercing: () => true,
  },

  aegis: {
    incomingDamage: (api, self, _ability, kind, damage) => {
      if (kind !== 'attack' || self.aegisUsed || damage <= 0) return damage;
      self.aegisUsed = true;
      api.log({
        type: 'ability',
        actorUid: self.uid,
        amount: 0,
        message: `${self.card.displayName}'s aegis turns the blow aside.`,
      });
      return 0;
    },
  },

  warden: {
    onPlay: (api, self, ability) => {
      const shield = abilityParam(ability, 'shield');
      api.grantShield(self, shield);
      const allies = api
        .alliesOf(self)
        .filter((ally) => ally.alive && ally.uid !== self.uid && ally.health < ally.maxHealth);
      let mostWounded: DuelUnit | null = null;
      for (const ally of allies) {
        if (
          mostWounded === null ||
          ally.maxHealth - ally.health > mostWounded.maxHealth - mostWounded.health
        ) {
          mostWounded = ally;
        }
      }
      if (mostWounded !== null) api.grantShield(mostWounded, shield);
      api.log({
        type: 'shield',
        actorUid: self.uid,
        amount: shield,
        message: `${self.card.displayName} raises a ${shield}-point ward.`,
      });
    },
  },
};

export function duelHooks(abilityId: string): DuelAbilityHooks | undefined {
  return DUEL_ABILITIES[abilityId];
}

/** Rules text with its numbers filled in, for display. */
export function abilityText(ability: AbilityDefinition): string {
  const base = ability.description.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = ability.params[key];
    return value === undefined ? match : String(value);
  });
  if (ability.id === 'hunt') return 'Attacks ignore the target’s Guard.';
  if (ability.id === 'first-strike') return `Harder to hit: +${abilityParam(ability, 'speed')} Speed.`;
  return base;
}
