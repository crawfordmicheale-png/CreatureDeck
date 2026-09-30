/**
 * What each effect card does when it resolves.
 *
 * Keyed by the same ids as `src/content/effects.ts`; a test asserts the two
 * halves never drift apart.
 */

import { effectParam } from '../core/effects.ts';
import type { EffectContext, EffectHandler } from './types.ts';

function requireTarget(context: EffectContext): boolean {
  return context.target !== null && context.target.alive;
}

export const EFFECT_HANDLERS: Readonly<Record<string, EffectHandler>> = {
  emberlash: (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const damage = effectParam(context.effect, 'damage');
    context.api.damage(target, damage, 'effect', null);
    context.api.log({
      type: 'play-effect',
      targetUid: target.uid,
      amount: damage,
      message: `Emberlash sears ${target.card.displayName} for ${damage}.`,
    });
  },

  'grave-draught': (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const healed = context.api.heal(target, effectParam(context.effect, 'heal'));
    context.api.clearPoison(target);
    context.api.log({
      type: 'heal',
      targetUid: target.uid,
      amount: healed,
      message: `Grave Draught restores ${healed} to ${target.card.displayName} and clears its poison.`,
    });
  },

  'whetstone-rite': (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const might = effectParam(context.effect, 'might');
    context.api.buffMight(target, might);
    context.api.log({
      type: 'play-effect',
      targetUid: target.uid,
      amount: might,
      message: `Whetstone Rite sharpens ${target.card.displayName} (+${might} Might).`,
    });
  },

  'shroud-of-ash': (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const shield = effectParam(context.effect, 'shield');
    context.api.grantShield(target, shield);
    context.api.log({
      type: 'shield',
      targetUid: target.uid,
      amount: shield,
      message: `Shroud of Ash wraps ${target.card.displayName} in ${shield} shield.`,
    });
  },

  'second-wind': (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const amount = effectParam(context.effect, 'stamina');
    context.api.changeStamina(target, amount);
    context.api.log({
      type: 'stamina',
      targetUid: target.uid,
      amount,
      message: `Second Wind returns ${amount} stamina to ${target.card.displayName}.`,
    });
  },

  bonecage: (context) => {
    if (!requireTarget(context)) return;
    const target = context.target!;
    const amount = effectParam(context.effect, 'stamina');
    context.api.changeStamina(target, -amount);
    context.api.log({
      type: 'stamina',
      targetUid: target.uid,
      amount,
      message: `Bonecage drains ${amount} stamina from ${target.card.displayName}.`,
    });
  },

  cinderbloom: (context) => {
    const damage = effectParam(context.effect, 'damage');
    const enemies = context.api
      .unitsOf(context.api.opponentOf(context.casterId))
      .filter((unit) => unit.alive);
    context.api.log({
      type: 'play-effect',
      amount: damage,
      message: `Cinderbloom opens: ${damage} damage to ${enemies.length} enemy creature(s).`,
    });
    for (const enemy of enemies) context.api.damage(enemy, damage, 'effect', null);
  },

  'hollow-pact': (context) => {
    const cards = effectParam(context.effect, 'cards');
    context.api.drawCards(context.casterId, cards);
    context.api.log({
      type: 'play-effect',
      playerId: context.casterId,
      amount: cards,
      message: `Hollow Pact draws ${cards} cards.`,
    });
  },

  'ruinous-bolt': (context) => {
    const damage = effectParam(context.effect, 'damage');
    context.api.damageNexus(context.api.opponentOf(context.casterId), damage);
    context.api.log({
      type: 'play-effect',
      amount: damage,
      message: `Ruinous Bolt strikes the enemy nexus for ${damage}.`,
    });
  },

  gravewake: (context) => {
    const recovered = context.api.recoverCreature(context.casterId);
    context.api.log({
      type: 'play-effect',
      playerId: context.casterId,
      message: recovered
        ? `Gravewake returns ${recovered} to your hand, fully rested.`
        : 'Gravewake finds nothing to raise.',
    });
  },
};

export function effectHandler(effectId: string): EffectHandler | undefined {
  return EFFECT_HANDLERS[effectId];
}
