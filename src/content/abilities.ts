/**
 * The printed ability list.
 *
 * `weight` is the balance dial: it is added to the power score of any card
 * that has the ability unlocked, which pushes that card toward the next power
 * tier — and therefore toward a higher deploy cost. An ability that reads as
 * strong should weigh more, or it will be strictly free value.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import { defineAbility } from '../core/abilities.ts';

export const ABILITIES: readonly AbilityDefinition[] = [
  defineAbility({
    id: 'ferocity',
    name: 'Ferocity',
    description: 'While above half health, deals +{bonus} damage.',
    trigger: 'passive',
    weight: 10,
    params: { bonus: 3 },
  }),
  defineAbility({
    id: 'venom',
    name: 'Venom',
    description: 'Attacks apply {stacks} poison. Poison deals 1 damage per stack each round, ignoring Guard.',
    trigger: 'onAttack',
    weight: 12,
    params: { stacks: 2 },
  }),
  defineAbility({
    id: 'regrowth',
    name: 'Regrowth',
    description: 'Heals {heal} health at the start of each round.',
    trigger: 'startOfRound',
    weight: 9,
    params: { heal: 3 },
  }),
  defineAbility({
    id: 'rally',
    name: 'Rally',
    description: 'On deploy, allies already on the board gain +{might} Might for the battle.',
    trigger: 'onDeploy',
    weight: 14,
    params: { might: 2 },
  }),
  defineAbility({
    id: 'bulwark',
    name: 'Bulwark',
    description: 'Allies gain +{guard} Guard while this creature lives.',
    trigger: 'passive',
    weight: 11,
    params: { guard: 2 },
  }),
  defineAbility({
    id: 'first-strike',
    name: 'First Strike',
    description: 'Acts as though {speed} Speed faster.',
    trigger: 'passive',
    weight: 8,
    params: { speed: 4 },
  }),
  defineAbility({
    id: 'bloodlust',
    name: 'Bloodlust',
    description: 'Gains +{might} Might for the rest of the battle after each kill.',
    trigger: 'onKill',
    weight: 13,
    params: { might: 2 },
  }),
  defineAbility({
    id: 'thorns',
    name: 'Thorns',
    description: 'Attackers take {reflect} damage, ignoring Guard.',
    trigger: 'onDamaged',
    weight: 10,
    params: { reflect: 2 },
  }),
  defineAbility({
    id: 'siphon',
    name: 'Siphon',
    description: 'Heals for {percent}% of the damage its attacks deal.',
    trigger: 'onAttack',
    weight: 12,
    params: { percent: 50 },
  }),
  defineAbility({
    id: 'doublestrike',
    name: 'Doublestrike',
    description: 'Attacks twice; the second blow deals {percent}% damage.',
    trigger: 'passive',
    weight: 20,
    params: { percent: 60 },
  }),
  defineAbility({
    id: 'dread',
    name: 'Dread',
    description: 'On deploy, every enemy creature loses {might} Might for the battle.',
    trigger: 'onDeploy',
    weight: 12,
    params: { might: 2 },
  }),
  defineAbility({
    id: 'rebirth',
    name: 'Rebirth',
    description: 'The first time it dies, it returns at {percent}% health.',
    trigger: 'onDeath',
    weight: 22,
    params: { percent: 50 },
  }),
  defineAbility({
    id: 'stoneform',
    name: 'Stoneform',
    description: 'Takes {percent}% less damage from attacks.',
    trigger: 'passive',
    weight: 9,
    params: { percent: 15 },
  }),
  defineAbility({
    id: 'overwhelm',
    name: 'Overwhelm',
    description: 'Damage in excess of the target’s remaining health carries through to the enemy nexus.',
    trigger: 'onAttack',
    weight: 11,
    params: {},
  }),
  defineAbility({
    id: 'frenzy',
    name: 'Frenzy',
    description: 'Gains +{might} Might for the battle whenever it is damaged.',
    trigger: 'onDamaged',
    weight: 9,
    params: { might: 1 },
  }),
  defineAbility({
    id: 'hunt',
    name: 'Hunt',
    description: 'Attacks the enemy creature with the lowest remaining health instead of the front one.',
    trigger: 'passive',
    weight: 14,
    params: {},
  }),
  defineAbility({
    id: 'aegis',
    name: 'Aegis',
    description: 'Ignores the first instance of attack damage it would take each battle.',
    trigger: 'passive',
    weight: 16,
    params: {},
  }),
  defineAbility({
    id: 'warden',
    name: 'Warden',
    description: 'On deploy, grants {shield} shield to itself and the most wounded ally.',
    trigger: 'onDeploy',
    weight: 10,
    params: { shield: 5 },
  }),
];

export const ABILITY_IDS: readonly string[] = ABILITIES.map((ability) => ability.id);
