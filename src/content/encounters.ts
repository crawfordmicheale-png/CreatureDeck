/**
 * The bestiary.
 *
 * An encounter is one opposing deck with a name and a temperament. The map
 * draws from these by tier, so a run meets a different set every time — which
 * is the whole point of giving the player a branching path to choose.
 *
 * Each encounter is written for the *first* row of its tier, where a warband
 * arriving fresh from the tier below should meet it as a real fight. Rows
 * further into the same tier add a small, bounded bump on top (see
 * `scaleEncounter`), because the player levels through a tier and the decks
 * written for it do not. Without that the measured difficulty sawtooths:
 * the first row of every tier lands on target and the last is twenty points
 * too easy.
 */

import type { AiProfileName, StageCreature } from './campaign.ts';
import { FOCUS } from './campaign.ts';

export type EncounterKind = 'battle' | 'elite' | 'boss';

/** 1 is the opening stretch, 3 the approach to the boss. */
export type EncounterTier = 1 | 2 | 3;

export interface Encounter {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly kind: EncounterKind;
  readonly tier: EncounterTier;
  readonly profile: AiProfileName;
  readonly nexusHealth: number;
  readonly creatures: readonly StageCreature[];
  readonly effects: readonly string[];
  /** Card art used as this encounter's portrait on the map. */
  readonly art: string;
}

type Spec = ReadonlyArray<readonly [string, number, keyof typeof FOCUS]>;

function pack(spec: Spec): StageCreature[] {
  return spec.map(([definitionId, level, focus]) => ({
    definitionId,
    level,
    focus: FOCUS[focus],
  }));
}

function encounter(
  id: string,
  name: string,
  blurb: string,
  kind: EncounterKind,
  tier: EncounterTier,
  profile: AiProfileName,
  nexusHealth: number,
  art: string,
  spec: Spec,
  effects: readonly string[],
): Encounter {
  return { id, name, blurb, kind, tier, profile, nexusHealth, art, creatures: pack(spec), effects };
}

// ------------------------------------------------------------------- tier 1

const TIER_ONE: readonly Encounter[] = [
  encounter(
    'scavenger-warren', 'The Scavenger Warren',
    'Vermin from the under-dark. Barely blooded, and they know it.',
    'battle', 1, 'cautious', 10, 'dusk-mite',
    [['dusk-mite', 1, 'swift'], ['thicket-hare', 1, 'swift'], ['pebble-grub', 1, 'tank'],
     ['gale-sprite', 1, 'tank'], ['tide-minnow', 1, 'bruiser'], ['dusk-mite', 1, 'swift'],
     ['thicket-hare', 1, 'swift'], ['pebble-grub', 1, 'tank'], ['gale-sprite', 1, 'tank'],
     ['tide-minnow', 1, 'bruiser'], ['dusk-mite', 1, 'swift']],
    ['grave-draught'],
  ),
  encounter(
    'bramble-hollow', 'Bramble Hollow',
    'Something has been tending these thorns. It did not ask permission.',
    'battle', 1, 'cautious', 12, 'thicket-hare',
    [['thicket-hare', 2, 'swift'], ['thicket-hare', 2, 'swift'], ['bramble-warden', 1, 'tank'],
     ['gale-sprite', 2, 'tank'], ['pebble-grub', 2, 'tank'], ['scrapfang-pup', 1, 'might'],
     ['thicket-hare', 1, 'swift'], ['gale-sprite', 1, 'tank'], ['pebble-grub', 1, 'tank'],
     ['tide-minnow', 2, 'bruiser']],
    ['grave-draught', 'whetstone-rite'],
  ),
  encounter(
    'weeping-shallows', 'The Weeping Shallows',
    'Brackish water up to the knee, and nothing in it that should be.',
    'battle', 1, 'steady', 12, 'tide-minnow',
    [['tide-minnow', 2, 'bruiser'], ['tide-minnow', 2, 'bruiser'], ['reef-sentinel', 2, 'tank'],
     ['gale-sprite', 2, 'tank'], ['dusk-mite', 2, 'swift'], ['pebble-grub', 2, 'tank'],
     ['thicket-hare', 2, 'swift'], ['tide-minnow', 2, 'bruiser'], ['gale-sprite', 2, 'tank'],
     ['reef-sentinel', 1, 'tank']],
    ['grave-draught', 'shroud-of-ash'],
  ),
  encounter(
    'cinder-pit', 'The Cinder Pit',
    'Slag heaps that never cooled. Things nest in the warm parts.',
    'battle', 1, 'steady', 13, 'cinder-imp',
    [['cinder-imp', 2, 'swift'], ['ember-whelp', 2, 'might'], ['ember-whelp', 2, 'might'],
     ['scrapfang-pup', 2, 'might'], ['cinder-imp', 2, 'swift'], ['dusk-mite', 2, 'swift'],
     ['pebble-grub', 2, 'tank'], ['ember-whelp', 2, 'might'], ['scrapfang-pup', 2, 'might'],
     ['thicket-hare', 2, 'swift']],
    ['emberlash', 'whetstone-rite'],
  ),
  encounter(
    'moth-lantern-vigil', 'The Moth-Lantern Vigil',
    'They keep a light burning. It is not for your benefit.',
    'battle', 1, 'cautious', 12, 'grave-moth',
    [['grave-moth', 2, 'swift'], ['grave-moth', 2, 'swift'], ['dusk-mite', 2, 'swift'],
     ['gale-sprite', 2, 'tank'], ['thicket-hare', 2, 'swift'], ['tide-minnow', 2, 'bruiser'],
     ['grave-moth', 2, 'swift'], ['dusk-mite', 2, 'swift'], ['pebble-grub', 2, 'tank'],
     ['gale-sprite', 2, 'tank']],
    ['bonecage', 'grave-draught'],
  ),
  encounter(
    'gravel-kennels', 'The Gravel Kennels',
    'Pits dug into the scree. Whatever was kept here got out.',
    'battle', 1, 'steady', 13, 'scrapfang-pup',
    [['scrapfang-pup', 2, 'might'], ['scrapfang-pup', 2, 'might'], ['ashfang-jackal', 2, 'might'],
     ['pebble-grub', 2, 'tank'], ['dusk-mite', 2, 'swift'], ['thicket-hare', 2, 'swift'],
     ['scrapfang-pup', 2, 'bruiser'], ['ember-whelp', 2, 'might'], ['pebble-grub', 2, 'tank'],
     ['gale-sprite', 2, 'tank']],
    ['emberlash', 'whetstone-rite'],
  ),
];

// ------------------------------------------------------------------- tier 2

const TIER_TWO: readonly Encounter[] = [
  encounter(
    'brackwater-raiders', 'Brackwater Raiders',
    'Drowned-coast reavers. Their commons have promoted out of Weak.',
    'battle', 2, 'steady', 26, 'reef-sentinel',
    [['tide-minnow', 8, 'bruiser'], ['reef-sentinel', 8, 'tank'], ['grave-moth', 8, 'swift'],
     ['dusk-mite', 8, 'swift'], ['scrapfang-pup', 8, 'might'], ['ember-whelp', 8, 'might'],
     ['pebble-grub', 8, 'tank'], ['cinder-imp', 8, 'swift'], ['thicket-hare', 8, 'swift'],
     ['gale-sprite', 8, 'tank']],
    ['emberlash', 'shroud-of-ash', 'bonecage'],
  ),
  encounter(
    'ashen-kennel', 'The Ashen Kennel',
    'Cheap cards taken seriously. Every beast here is an Elite on a common frame.',
    'battle', 2, 'steady', 30, 'ashfang-jackal',
    [['ashfang-jackal', 10, 'might'], ['cinder-imp', 10, 'swift'], ['bramble-warden', 10, 'tank'],
     ['reef-sentinel', 10, 'tank'], ['grave-moth', 10, 'swift'], ['ember-whelp', 10, 'might'],
     ['thicket-hare', 10, 'swift'], ['scrapfang-pup', 10, 'bruiser'], ['dusk-mite', 10, 'swift'],
     ['pebble-grub', 10, 'tank']],
    ['emberlash', 'whetstone-rite', 'cinderbloom'],
  ),
  encounter(
    'drowned-procession', 'The Drowned Procession',
    'They walk the sea floor in single file and have for a long time.',
    'battle', 2, 'cautious', 30, 'abyssal-serpent',
    [['abyssal-serpent', 4, 'bruiser'], ['reef-sentinel', 11, 'tank'], ['reef-sentinel', 10, 'tank'],
     ['tide-minnow', 10, 'bruiser'], ['grave-moth', 9, 'swift'], ['tide-minnow', 9, 'bruiser'],
     ['gale-sprite', 9, 'tank'], ['pebble-grub', 10, 'tank'], ['dusk-mite', 9, 'swift'],
     ['bramble-warden', 9, 'tank']],
    ['shroud-of-ash', 'grave-draught', 'bonecage'],
  ),
  encounter(
    'thornwake-grove', 'Thornwake Grove',
    'The trees have opinions here, and the ground agrees with them.',
    'battle', 2, 'steady', 28, 'verdant-matriarch',
    [['verdant-matriarch', 4, 'tank'], ['bramble-warden', 11, 'tank'], ['thicket-hare', 10, 'swift'],
     ['thicket-hare', 10, 'swift'], ['gale-sprite', 10, 'tank'], ['tide-minnow', 9, 'bruiser'],
     ['pebble-grub', 10, 'tank'], ['grave-moth', 9, 'swift'], ['bramble-warden', 9, 'tank'],
     ['dusk-mite', 10, 'swift']],
    ['grave-draught', 'whetstone-rite', 'second-wind'],
  ),
  encounter(
    'emberfall-quarry', 'Emberfall Quarry',
    'They dig for something that burns. They have found a great deal of it.',
    'battle', 2, 'ruthless', 28, 'magma-colossus',
    [['magma-colossus', 4, 'tank'], ['cinder-imp', 11, 'swift'], ['ember-whelp', 10, 'might'],
     ['ashfang-jackal', 10, 'might'], ['scrapfang-pup', 10, 'might'], ['cinder-imp', 9, 'swift'],
     ['ember-whelp', 9, 'might'], ['pebble-grub', 10, 'tank'], ['dusk-mite', 9, 'swift'],
     ['thicket-hare', 9, 'swift']],
    ['emberlash', 'cinderbloom', 'whetstone-rite'],
  ),
  encounter(
    'pale-choir', 'The Pale Choir',
    'Hymns in a language with no word for stopping.',
    'battle', 2, 'cautious', 30, 'grave-moth',
    [['grave-moth', 12, 'swift'], ['grave-moth', 11, 'swift'], ['dusk-mite', 10, 'swift'],
     ['nightmare-stalker', 3, 'might'], ['bramble-warden', 10, 'tank'], ['gale-sprite', 10, 'tank'],
     ['grave-moth', 10, 'swift'], ['dusk-mite', 10, 'swift'], ['reef-sentinel', 10, 'tank'],
     ['tide-minnow', 10, 'bruiser']],
    ['bonecage', 'shroud-of-ash', 'grave-draught'],
  ),
];

// ------------------------------------------------------------------- tier 3

const TIER_THREE: readonly Encounter[] = [
  encounter(
    'gilded-menagerie', 'The Gilded Menagerie',
    'Rares and epics, lightly played. This is what your levelling was for.',
    'battle', 3, 'ruthless', 36, 'pyreclaw-tyrant',
    [['stormcaller-roc', 7, 'might'], ['magma-colossus', 7, 'tank'], ['abyssal-serpent', 7, 'bruiser'],
     ['nightmare-stalker', 7, 'might'], ['pyreclaw-tyrant', 6, 'might'], ['ember-whelp', 10, 'might'],
     ['thicket-hare', 10, 'swift'], ['tide-minnow', 10, 'bruiser'], ['dusk-mite', 10, 'swift'],
     ['gale-sprite', 10, 'tank']],
    ['ruinous-bolt', 'grave-draught', 'second-wind'],
  ),
  encounter(
    'stormcallers-eyrie', "The Stormcallers' Eyrie",
    'A cliff face of nests, and the weather does as it is told.',
    'battle', 3, 'ruthless', 36, 'stormcaller-roc',
    [['stormcaller-roc', 9, 'swift'], ['stormcaller-roc', 8, 'might'], ['skyfather-drake', 4, 'bruiser'],
     ['gale-sprite', 10, 'tank'], ['grave-moth', 12, 'swift'], ['thicket-hare', 10, 'swift'],
     ['dusk-mite', 10, 'swift'], ['gale-sprite', 10, 'tank'], ['tide-minnow', 10, 'bruiser'],
     ['cinder-imp', 11, 'swift']],
    ['ruinous-bolt', 'second-wind', 'bonecage'],
  ),
  encounter(
    'sunken-cathedral', 'The Sunken Cathedral',
    'A nave full of black water. Something is still taking confession.',
    'battle', 3, 'cautious', 38, 'leviathan-drowned-choir',
    [['leviathan-drowned-choir', 4, 'tank'], ['abyssal-serpent', 9, 'bruiser'], ['reef-sentinel', 13, 'tank'],
     ['magma-colossus', 7, 'tank'], ['tide-minnow', 10, 'bruiser'], ['reef-sentinel', 12, 'tank'],
     ['grave-moth', 11, 'swift'], ['pebble-grub', 10, 'tank'], ['bramble-warden', 11, 'tank'],
     ['dusk-mite', 10, 'swift']],
    ['shroud-of-ash', 'grave-draught', 'bonecage', 'second-wind'],
  ),
  encounter(
    'basalt-marches', 'The Basalt Marches',
    'Black glass underfoot for a hundred miles, and it is all walking.',
    'battle', 3, 'steady', 38, 'glacierheart-titan',
    [['glacierheart-titan', 6, 'tank'], ['magma-colossus', 9, 'tank'], ['worldroot-behemoth', 5, 'tank'],
     ['terrakhan-unbroken', 3, 'tank'], ['pebble-grub', 10, 'tank'], ['bramble-warden', 11, 'tank'],
     ['reef-sentinel', 11, 'tank'], ['ember-whelp', 10, 'might'], ['scrapfang-pup', 10, 'might'],
     ['cinder-imp', 10, 'swift']],
    ['whetstone-rite', 'cinderbloom', 'shroud-of-ash'],
  ),
  encounter(
    'nightmare-warrens', 'The Nightmare Warrens',
    'Tunnels that were not dug. Something simply decided they were there.',
    'battle', 3, 'ruthless', 36, 'nightmare-stalker',
    [['nightmare-stalker', 11, 'might'], ['nightmare-stalker', 10, 'might'], ['void-harbinger', 5, 'bruiser'],
     ['grave-moth', 12, 'swift'], ['dusk-mite', 10, 'swift'], ['abyssal-serpent', 8, 'bruiser'],
     ['thicket-hare', 10, 'swift'], ['cinder-imp', 11, 'swift'], ['grave-moth', 11, 'swift'],
     ['dusk-mite', 10, 'swift']],
    ['bonecage', 'emberlash', 'ruinous-bolt'],
  ),
];

// ------------------------------------------------------------------- elites

const ELITES: readonly Encounter[] = [
  encounter(
    'warden-deep-reef', 'Warden of the Deep Reef',
    'It has held this shelf since before the coast had a name.',
    'elite', 1, 'cautious', 20, 'reef-sentinel',
    [['reef-sentinel', 8, 'tank'], ['reef-sentinel', 7, 'tank'], ['abyssal-serpent', 3, 'bruiser'],
     ['tide-minnow', 8, 'bruiser'], ['bramble-warden', 7, 'tank'], ['pebble-grub', 8, 'tank'],
     ['tide-minnow', 7, 'bruiser'], ['gale-sprite', 7, 'tank'], ['reef-sentinel', 7, 'tank'],
     ['grave-moth', 7, 'swift']],
    ['shroud-of-ash', 'grave-draught', 'bonecage'],
  ),
  encounter(
    'ashfang-pack', 'The Ashfang Pack',
    'Nine jaws moving as one opinion.',
    'elite', 2, 'ruthless', 28, 'ashfang-jackal',
    [['ashfang-jackal', 11, 'might'], ['ashfang-jackal', 11, 'might'], ['ashfang-jackal', 10, 'might'],
     ['cinder-imp', 11, 'swift'], ['scrapfang-pup', 10, 'might'], ['nightmare-stalker', 5, 'might'],
     ['cinder-imp', 11, 'swift'], ['scrapfang-pup', 10, 'bruiser'], ['ember-whelp', 10, 'might'],
     ['dusk-mite', 10, 'swift']],
    ['emberlash', 'whetstone-rite', 'cinderbloom'],
  ),
  encounter(
    'void-harbinger', 'Harbinger of the Void',
    'It arrives shortly before the reason for its arrival.',
    'elite', 3, 'ruthless', 34, 'void-harbinger',
    [['void-harbinger', 8, 'bruiser'], ['nightmare-stalker', 9, 'might'], ['grave-moth', 12, 'swift'],
     ['abyssal-serpent', 8, 'bruiser'], ['dusk-mite', 10, 'swift'], ['abyssal-serpent', 9, 'bruiser'],
     ['grave-moth', 12, 'swift'], ['bramble-warden', 11, 'tank'], ['dusk-mite', 10, 'swift'],
     ['gale-sprite', 10, 'tank']],
    ['bonecage', 'ruinous-bolt', 'shroud-of-ash'],
  ),
  encounter(
    'glacierheart', 'Glacierheart',
    'A winter that learned to walk, and then learned to wait.',
    'elite', 3, 'cautious', 40, 'glacierheart-titan',
    [['glacierheart-titan', 10, 'tank'], ['terrakhan-unbroken', 5, 'tank'], ['magma-colossus', 11, 'tank'],
     ['worldroot-behemoth', 7, 'tank'], ['reef-sentinel', 12, 'tank'], ['bramble-warden', 12, 'tank'],
     ['pebble-grub', 10, 'tank'], ['glacierheart-titan', 8, 'tank'], ['grave-moth', 11, 'swift'],
     ['tide-minnow', 10, 'bruiser']],
    ['shroud-of-ash', 'grave-draught', 'whetstone-rite', 'second-wind'],
  ),
  encounter(
    'thistle-gallows', 'The Thistle Gallows',
    'Thorn-wood frames with something still hanging in them, and still moving.',
    'elite', 1, 'steady', 20, 'bramble-warden',
    [['bramble-warden', 8, 'tank'], ['bramble-warden', 7, 'tank'], ['verdant-matriarch', 3, 'tank'],
     ['thicket-hare', 8, 'swift'], ['grave-moth', 8, 'swift'], ['pebble-grub', 8, 'tank'],
     ['dusk-mite', 7, 'swift'], ['thicket-hare', 7, 'swift'], ['gale-sprite', 7, 'tank'],
     ['tide-minnow', 7, 'bruiser']],
    ['grave-draught', 'bonecage', 'whetstone-rite'],
  ),
  encounter(
    'shrike-roost', 'The Shrike Roost',
    'Everything here is kept on a spike until it is needed.',
    'elite', 2, 'ruthless', 28, 'stormcaller-roc',
    [['stormcaller-roc', 6, 'swift'], ['ashfang-jackal', 11, 'might'], ['cinder-imp', 11, 'swift'],
     ['grave-moth', 11, 'swift'], ['scrapfang-pup', 10, 'might'], ['ember-whelp', 10, 'might'],
     ['dusk-mite', 10, 'swift'], ['gale-sprite', 10, 'tank'], ['grave-moth', 10, 'swift'],
     ['thicket-hare', 10, 'swift']],
    ['emberlash', 'ruinous-bolt', 'whetstone-rite'],
  ),
  encounter(
    'worldroot-grave', 'The Worldroot Grave',
    'A root the size of a nave, and the things that grew up believing in it.',
    'elite', 3, 'steady', 36, 'worldroot-behemoth',
    [['worldroot-behemoth', 8, 'tank'], ['verdant-matriarch', 10, 'tank'], ['bramble-warden', 12, 'tank'],
     ['magma-colossus', 8, 'tank'], ['thicket-hare', 10, 'swift'], ['pebble-grub', 10, 'tank'],
     ['bramble-warden', 11, 'tank'], ['grave-moth', 11, 'swift'], ['gale-sprite', 10, 'tank'],
     ['tide-minnow', 10, 'bruiser']],
    ['grave-draught', 'second-wind', 'shroud-of-ash'],
  ),
];

// ------------------------------------------------------------------- bosses

const BOSSES: readonly Encounter[] = [
  encounter(
    'hollow-crown', 'The Hollow Crown',
    'The crown is empty. That is the whole of the threat.',
    'boss', 3, 'ruthless', 42, 'thanatos-hollow-crown',
    [['thanatos-hollow-crown', 14, 'might'], ['nightmare-stalker', 15, 'might'], ['abyssal-serpent', 15, 'bruiser'],
     ['ember-whelp', 10, 'might'], ['dusk-mite', 10, 'swift'], ['pebble-grub', 10, 'tank'],
     ['tide-minnow', 10, 'bruiser'], ['cinder-imp', 14, 'swift'], ['grave-moth', 14, 'swift'],
     ['reef-sentinel', 14, 'tank']],
    ['cinderbloom', 'ruinous-bolt', 'bonecage', 'shroud-of-ash'],
  ),
  encounter(
    'emberlord', 'Emberlord Vashtak',
    'He does not conquer. He simply stops being interrupted.',
    'boss', 3, 'ruthless', 42, 'emberlord-vashtak',
    [['emberlord-vashtak', 14, 'might'], ['pyreclaw-tyrant', 13, 'might'], ['magma-colossus', 14, 'tank'],
     ['cinder-imp', 14, 'swift'], ['ember-whelp', 10, 'might'], ['ashfang-jackal', 14, 'might'],
     ['scrapfang-pup', 10, 'might'], ['cinder-imp', 14, 'swift'], ['pebble-grub', 10, 'tank'],
     ['dusk-mite', 10, 'swift']],
    ['emberlash', 'cinderbloom', 'whetstone-rite', 'ruinous-bolt'],
  ),
  encounter(
    'ouroboros', 'Ouroboros, the World-Eater',
    'The only card printed at Legendary. It has never needed the help.',
    'boss', 3, 'steady', 46, 'ouroboros-world-eater',
    [['ouroboros-world-eater', 10, 'bruiser'], ['leviathan-drowned-choir', 12, 'tank'],
     ['terrakhan-unbroken', 11, 'tank'], ['worldroot-behemoth', 13, 'tank'],
     ['reef-sentinel', 14, 'tank'], ['bramble-warden', 14, 'tank'], ['tide-minnow', 10, 'bruiser'],
     ['pebble-grub', 10, 'tank'], ['grave-moth', 14, 'swift'], ['thicket-hare', 10, 'swift']],
    ['shroud-of-ash', 'grave-draught', 'cinderbloom', 'second-wind'],
  ),
  encounter(
    'aurion', 'Aurion, the First Light',
    'It was made to hold the dark back. It has had a very long time to reconsider.',
    'boss', 3, 'cautious', 44, 'aurion-first-light',
    [['aurion-first-light', 12, 'tank'], ['skyfather-drake', 12, 'bruiser'],
     ['glacierheart-titan', 13, 'tank'], ['stormcaller-roc', 14, 'swift'],
     ['bramble-warden', 14, 'tank'], ['reef-sentinel', 14, 'tank'], ['gale-sprite', 10, 'tank'],
     ['thicket-hare', 10, 'swift'], ['grave-moth', 13, 'swift'], ['pebble-grub', 10, 'tank']],
    ['shroud-of-ash', 'second-wind', 'whetstone-rite', 'ruinous-bolt'],
  ),
];

export const ENCOUNTERS: readonly Encounter[] = [
  ...TIER_ONE,
  ...TIER_TWO,
  ...TIER_THREE,
  ...ELITES,
  ...BOSSES,
];

export const ENCOUNTER_BY_ID: ReadonlyMap<string, Encounter> = new Map(
  ENCOUNTERS.map((item) => [item.id, item]),
);

export function encountersOf(kind: EncounterKind, tier?: EncounterTier): readonly Encounter[] {
  return ENCOUNTERS.filter(
    (item) => item.kind === kind && (tier === undefined || item.tier === tier),
  );
}

/**
 * Firms an encounter up for a row deeper into its own tier.
 *
 * `step` is how many rows above the tier's first row this one sits, so the
 * authored numbers are what a step of zero produces. A level per step and three
 * nexus health per step is enough to keep the curve monotonic without inventing
 * stat lines nobody wrote; `maxLevelOf` is injected so the bestiary stays free
 * of the card library.
 */
export function scaleEncounter(
  encounter: Encounter,
  step: number,
  maxLevelOf: (definitionId: string) => number,
): Encounter {
  if (step <= 0) return encounter;
  return {
    ...encounter,
    nexusHealth: encounter.nexusHealth + step * 3,
    creatures: encounter.creatures.map((creature) => ({
      ...creature,
      level: Math.min(creature.level + step, maxLevelOf(creature.definitionId)),
    })),
  };
}

export function encounterById(id: string): Encounter {
  const found = ENCOUNTER_BY_ID.get(id);
  if (!found) throw new Error(`Unknown encounter "${id}".`);
  return found;
}
