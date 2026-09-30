import { createLibrary } from '../core/library.ts';
import { ABILITIES } from './abilities.ts';
import { CREATURES } from './creatures.ts';
import { EFFECTS } from './effects.ts';

export { ABILITIES } from './abilities.ts';
export { CREATURES } from './creatures.ts';
export { EFFECTS } from './effects.ts';

/** The standard-set library: every printed creature and ability. */
export const STANDARD_LIBRARY = createLibrary(CREATURES, ABILITIES);

/** Effect cards, by id. Effects are consumables and never level. */
export const EFFECT_BY_ID: ReadonlyMap<string, (typeof EFFECTS)[number]> = new Map(
  EFFECTS.map((effect) => [effect.id, effect]),
);
