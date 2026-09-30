/**
 * The printed effect cards.
 *
 * Effects are the answer to a board you cannot beat in a straight fight:
 * removal, reach, tempo and card draw. They cost energy that would otherwise
 * deploy a creature, so every one of them is a turn you did not spend on the
 * board.
 */

import type { EffectDefinition } from '../core/effects.ts';
import { defineEffect } from '../core/effects.ts';

export const EFFECTS: readonly EffectDefinition[] = [
  defineEffect({
    id: 'emberlash',
    name: 'Emberlash',
    rarity: 'common',
    family: 'ember',
    cost: 2,
    target: 'enemy',
    text: 'Deal {damage} damage to an enemy creature, ignoring Guard.',
    params: { damage: 8 },
    flavor: 'A whip of fire that remembers the hand that threw it.',
  }),
  defineEffect({
    id: 'grave-draught',
    name: 'Grave Draught',
    rarity: 'common',
    family: 'verdant',
    cost: 2,
    target: 'ally',
    text: 'Restore {heal} health to an ally and cleanse its poison.',
    params: { heal: 12 },
    flavor: 'Tastes of riverbed. Works anyway.',
  }),
  defineEffect({
    id: 'whetstone-rite',
    name: 'Whetstone Rite',
    rarity: 'common',
    family: 'stone',
    cost: 2,
    target: 'ally',
    text: 'An ally gains +{might} Might for the rest of the battle.',
    params: { might: 4 },
    flavor: 'Sharpened on a stone older than the war.',
  }),
  defineEffect({
    id: 'shroud-of-ash',
    name: 'Shroud of Ash',
    rarity: 'uncommon',
    family: 'shade',
    cost: 2,
    target: 'ally',
    text: 'An ally gains a {shield}-point shield.',
    params: { shield: 12 },
    flavor: 'What the fire leaves behind still protects.',
  }),
  defineEffect({
    id: 'second-wind',
    name: 'Second Wind',
    rarity: 'uncommon',
    family: 'aether',
    cost: 3,
    target: 'ally',
    text: 'Restore {stamina} stamina to an ally.',
    params: { stamina: 2 },
    flavor: 'One more. There is always one more.',
  }),
  defineEffect({
    id: 'bonecage',
    name: 'Bonecage',
    rarity: 'uncommon',
    family: 'shade',
    cost: 3,
    target: 'enemy',
    text: 'Drain {stamina} stamina from an enemy creature.',
    params: { stamina: 2 },
    flavor: 'The ribs close. The thing inside stops trying.',
  }),
  defineEffect({
    id: 'cinderbloom',
    name: 'Cinderbloom',
    rarity: 'rare',
    family: 'ember',
    cost: 4,
    target: 'none',
    text: 'Deal {damage} damage to every enemy creature.',
    params: { damage: 6 },
    flavor: 'It opens once, and the field is glass.',
  }),
  defineEffect({
    id: 'hollow-pact',
    name: 'Hollow Pact',
    rarity: 'rare',
    family: 'shade',
    cost: 2,
    target: 'none',
    text: 'Draw {cards} cards.',
    params: { cards: 2 },
    flavor: 'Something answers. It is not fussy about what it is asked.',
  }),
  defineEffect({
    id: 'ruinous-bolt',
    name: 'Ruinous Bolt',
    rarity: 'rare',
    family: 'aether',
    cost: 4,
    target: 'none',
    text: 'Deal {damage} damage directly to the enemy nexus.',
    params: { damage: 12 },
    flavor: 'Skips the argument entirely.',
  }),
  defineEffect({
    id: 'gravewake',
    name: 'Gravewake',
    rarity: 'rare',
    family: 'verdant',
    cost: 3,
    target: 'none',
    text: 'Return a spent creature from your discard pile to your hand, fully rested.',
    params: {},
    flavor: 'The roots give back what they are asked for. Once.',
  }),
];

export const EFFECT_BY_ID: ReadonlyMap<string, EffectDefinition> = new Map(
  EFFECTS.map((effect) => [effect.id, effect]),
);
