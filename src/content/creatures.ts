/**
 * The printed roster.
 *
 * Starting power tier broadly tracks rarity — commons open at Weak, mythics at
 * Elite — but the two are deliberately not the same axis. A rare and an epic
 * can share a starting tier and still differ enormously in how far they go,
 * because rarity governs levelling headroom, not opening stats.
 *
 * Several cards are printed a hair under a tier threshold, so that unlocking
 * their second ability is itself the promotion. That is the moment the
 * levelling system is meant to sell.
 */

import type { CardDefinition } from '../core/cardDefinition.ts';
import { defineCard } from '../core/cardDefinition.ts';

export const CREATURES: readonly CardDefinition[] = [
  // ---------------------------------------------------------------- commons
  defineCard({
    id: 'ember-whelp',
    name: 'Ember Whelp',
    rarity: 'common',
    family: 'ember',
    baseStats: { might: 7, vitality: 20, speed: 6, guard: 2 },
    abilities: [{ abilityId: 'ferocity', unlockLevel: 1 }],
    flavor: 'Too small to raze a village. Determined to try anyway.',
  }),
  defineCard({
    id: 'thicket-hare',
    name: 'Thicket Hare',
    rarity: 'common',
    family: 'verdant',
    baseStats: { might: 4, vitality: 18, speed: 10, guard: 1 },
    abilities: [{ abilityId: 'first-strike', unlockLevel: 1 }],
    flavor: 'Gone before the grass it stood on springs back up.',
  }),
  defineCard({
    id: 'tide-minnow',
    name: 'Tide Minnow',
    rarity: 'common',
    family: 'tide',
    baseStats: { might: 5, vitality: 22, speed: 7, guard: 2 },
    abilities: [{ abilityId: 'siphon', unlockLevel: 1 }],
    flavor: 'It drinks what it bites.',
  }),
  defineCard({
    id: 'pebble-grub',
    name: 'Pebble Grub',
    rarity: 'common',
    family: 'stone',
    baseStats: { might: 3, vitality: 26, speed: 3, guard: 5 },
    abilities: [{ abilityId: 'stoneform', unlockLevel: 1 }],
    flavor: 'Outlasts most things, including the patience of its handler.',
  }),
  defineCard({
    id: 'dusk-mite',
    name: 'Dusk Mite',
    rarity: 'common',
    family: 'shade',
    baseStats: { might: 6, vitality: 16, speed: 8, guard: 1 },
    abilities: [{ abilityId: 'venom', unlockLevel: 1 }],
    flavor: 'The bite is nothing. The week afterward is the problem.',
  }),
  defineCard({
    id: 'gale-sprite',
    name: 'Gale Sprite',
    rarity: 'common',
    family: 'aether',
    baseStats: { might: 5, vitality: 18, speed: 9, guard: 1 },
    abilities: [{ abilityId: 'regrowth', unlockLevel: 1 }],
    flavor: 'Stitched back together by the wind it rides.',
  }),
  defineCard({
    id: 'scrapfang-pup',
    name: 'Scrapfang Pup',
    rarity: 'common',
    family: 'beast',
    baseStats: { might: 8, vitality: 19, speed: 7, guard: 1 },
    abilities: [{ abilityId: 'frenzy', unlockLevel: 1 }],
    flavor: 'Losing only makes it louder.',
  }),

  // -------------------------------------------------------------- uncommons
  defineCard({
    id: 'ashfang-jackal',
    name: 'Ashfang Jackal',
    rarity: 'uncommon',
    family: 'beast',
    baseStats: { might: 10, vitality: 26, speed: 9, guard: 3 },
    abilities: [{ abilityId: 'bloodlust', unlockLevel: 1 }],
    flavor: 'It hunts the pack that hunts with it.',
  }),
  defineCard({
    id: 'reef-sentinel',
    name: 'Reef Sentinel',
    rarity: 'uncommon',
    family: 'tide',
    baseStats: { might: 7, vitality: 34, speed: 5, guard: 6 },
    abilities: [{ abilityId: 'bulwark', unlockLevel: 1 }],
    flavor: 'The reef does not move. Neither does it.',
  }),
  defineCard({
    id: 'bramble-warden',
    name: 'Bramble Warden',
    rarity: 'uncommon',
    family: 'verdant',
    baseStats: { might: 8, vitality: 30, speed: 6, guard: 4 },
    abilities: [{ abilityId: 'warden', unlockLevel: 1 }],
    flavor: 'Grows a hedge around whatever it decides is worth keeping.',
  }),
  defineCard({
    id: 'cinder-imp',
    name: 'Cinder Imp',
    rarity: 'uncommon',
    family: 'ember',
    baseStats: { might: 12, vitality: 20, speed: 10, guard: 2 },
    abilities: [{ abilityId: 'frenzy', unlockLevel: 1 }],
    flavor: 'Hit it and it burns hotter. Everyone hits it anyway.',
  }),
  defineCard({
    id: 'grave-moth',
    name: 'Grave Moth',
    rarity: 'uncommon',
    family: 'shade',
    baseStats: { might: 9, vitality: 24, speed: 11, guard: 2 },
    abilities: [{ abilityId: 'venom', unlockLevel: 1 }],
    flavor: 'Drawn to lanterns, and to the people holding them.',
  }),

  // ------------------------------------------------------------------ rares
  defineCard({
    id: 'stormcaller-roc',
    name: 'Stormcaller Roc',
    rarity: 'rare',
    family: 'aether',
    baseStats: { might: 14, vitality: 36, speed: 15, guard: 5 },
    abilities: [
      { abilityId: 'first-strike', unlockLevel: 1 },
      { abilityId: 'overwhelm', unlockLevel: 6 },
    ],
    flavor: 'The storm is not weather. The storm is nesting.',
  }),
  defineCard({
    id: 'magma-colossus',
    name: 'Magma Colossus',
    rarity: 'rare',
    family: 'stone',
    baseStats: { might: 16, vitality: 46, speed: 5, guard: 9 },
    abilities: [
      { abilityId: 'bulwark', unlockLevel: 1 },
      { abilityId: 'thorns', unlockLevel: 7 },
    ],
    flavor: 'Cools into a mountain when it sleeps. Wakes annoyed.',
  }),
  defineCard({
    id: 'abyssal-serpent',
    name: 'Abyssal Serpent',
    rarity: 'rare',
    family: 'tide',
    baseStats: { might: 15, vitality: 38, speed: 11, guard: 5 },
    abilities: [
      { abilityId: 'venom', unlockLevel: 1 },
      { abilityId: 'siphon', unlockLevel: 8 },
    ],
    flavor: 'Coils around the hull and waits for the wood to give.',
  }),
  defineCard({
    id: 'verdant-matriarch',
    name: 'Verdant Matriarch',
    rarity: 'rare',
    family: 'verdant',
    baseStats: { might: 12, vitality: 44, speed: 8, guard: 6 },
    abilities: [
      { abilityId: 'regrowth', unlockLevel: 1 },
      { abilityId: 'rally', unlockLevel: 8 },
    ],
    flavor: 'Every root in the valley reports to her.',
  }),
  defineCard({
    id: 'nightmare-stalker',
    name: 'Nightmare Stalker',
    rarity: 'rare',
    family: 'shade',
    baseStats: { might: 18, vitality: 30, speed: 13, guard: 4 },
    abilities: [
      { abilityId: 'hunt', unlockLevel: 1 },
      { abilityId: 'bloodlust', unlockLevel: 9 },
    ],
    flavor: 'It picks the one already limping. It always has.',
  }),

  // ------------------------------------------------------------------ epics
  defineCard({
    id: 'pyreclaw-tyrant',
    name: 'Pyreclaw Tyrant',
    rarity: 'epic',
    family: 'ember',
    baseStats: { might: 22, vitality: 44, speed: 12, guard: 7 },
    abilities: [
      { abilityId: 'ferocity', unlockLevel: 1 },
      { abilityId: 'doublestrike', unlockLevel: 10 },
    ],
    flavor: 'Crowned itself. Nobody has yet argued.',
  }),
  defineCard({
    id: 'glacierheart-titan',
    name: 'Glacierheart Titan',
    rarity: 'epic',
    family: 'stone',
    baseStats: { might: 18, vitality: 60, speed: 6, guard: 12 },
    abilities: [
      { abilityId: 'bulwark', unlockLevel: 1 },
      { abilityId: 'stoneform', unlockLevel: 10 },
    ],
    flavor: 'A winter that learned to walk.',
  }),
  defineCard({
    id: 'void-harbinger',
    name: 'Void Harbinger',
    rarity: 'epic',
    family: 'shade',
    baseStats: { might: 20, vitality: 40, speed: 15, guard: 6 },
    abilities: [
      { abilityId: 'dread', unlockLevel: 1 },
      { abilityId: 'rebirth', unlockLevel: 12 },
    ],
    flavor: 'Arrives shortly before the reason for its arrival.',
  }),
  defineCard({
    id: 'skyfather-drake',
    name: 'Skyfather Drake',
    rarity: 'epic',
    family: 'aether',
    baseStats: { might: 21, vitality: 46, speed: 16, guard: 7 },
    abilities: [
      { abilityId: 'overwhelm', unlockLevel: 1 },
      { abilityId: 'aegis', unlockLevel: 12 },
    ],
    flavor: 'Its shadow crosses three provinces before it does.',
  }),
  defineCard({
    id: 'worldroot-behemoth',
    name: 'Worldroot Behemoth',
    rarity: 'epic',
    family: 'verdant',
    baseStats: { might: 17, vitality: 62, speed: 7, guard: 10 },
    abilities: [
      { abilityId: 'regrowth', unlockLevel: 1 },
      { abilityId: 'thorns', unlockLevel: 11 },
    ],
    flavor: 'Uproots itself once a century, and the map is redrawn.',
  }),

  // ---------------------------------------------------------------- mythics
  defineCard({
    id: 'emberlord-vashtak',
    name: 'Emberlord Vashtak',
    rarity: 'mythic',
    family: 'ember',
    baseStats: { might: 28, vitality: 58, speed: 14, guard: 10 },
    abilities: [
      { abilityId: 'ferocity', unlockLevel: 1 },
      { abilityId: 'bloodlust', unlockLevel: 8 },
      { abilityId: 'doublestrike', unlockLevel: 16 },
    ],
    flavor: 'He does not conquer. He simply stops being interrupted.',
  }),
  defineCard({
    id: 'leviathan-drowned-choir',
    name: 'Leviathan of the Drowned Choir',
    rarity: 'mythic',
    family: 'tide',
    baseStats: { might: 25, vitality: 70, speed: 11, guard: 12 },
    abilities: [
      { abilityId: 'siphon', unlockLevel: 1 },
      { abilityId: 'bulwark', unlockLevel: 9 },
      { abilityId: 'rebirth', unlockLevel: 17 },
    ],
    flavor: 'Every sailor it took is still singing.',
  }),
  defineCard({
    id: 'thanatos-hollow-crown',
    name: 'Thanatos, the Hollow Crown',
    rarity: 'mythic',
    family: 'shade',
    baseStats: { might: 30, vitality: 54, speed: 17, guard: 9 },
    abilities: [
      { abilityId: 'dread', unlockLevel: 1 },
      { abilityId: 'hunt', unlockLevel: 10 },
      { abilityId: 'rebirth', unlockLevel: 18 },
    ],
    flavor: 'The crown is empty. That is the whole of the threat.',
  }),
  defineCard({
    id: 'aurion-first-light',
    name: 'Aurion, First Light',
    rarity: 'mythic',
    family: 'aether',
    baseStats: { might: 26, vitality: 62, speed: 18, guard: 11 },
    abilities: [
      { abilityId: 'rally', unlockLevel: 1 },
      { abilityId: 'aegis', unlockLevel: 10 },
      { abilityId: 'doublestrike', unlockLevel: 18 },
    ],
    flavor: 'The first thing that ever cast a shadow.',
  }),
  defineCard({
    id: 'terrakhan-unbroken',
    name: 'Terrakhan the Unbroken',
    rarity: 'mythic',
    family: 'stone',
    baseStats: { might: 24, vitality: 80, speed: 8, guard: 15 },
    abilities: [
      { abilityId: 'bulwark', unlockLevel: 1 },
      { abilityId: 'thorns', unlockLevel: 9 },
      { abilityId: 'stoneform', unlockLevel: 17 },
    ],
    flavor: 'Sieges have been called off on account of him being in the way.',
  }),
  defineCard({
    id: 'ouroboros-world-eater',
    name: 'Ouroboros, the World-Eater',
    rarity: 'mythic',
    family: 'beast',
    baseStats: { might: 45, vitality: 130, speed: 22, guard: 24 },
    abilities: [
      { abilityId: 'rebirth', unlockLevel: 1 },
      { abilityId: 'bloodlust', unlockLevel: 12 },
      { abilityId: 'doublestrike', unlockLevel: 20 },
    ],
    flavor: 'The only card printed at Legendary. It has never needed the help.',
  }),
];
