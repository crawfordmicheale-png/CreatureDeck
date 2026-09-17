import { createLibrary } from '../core/library.ts';
import { ABILITIES } from './abilities.ts';
import { CREATURES } from './creatures.ts';

export { ABILITIES } from './abilities.ts';
export { CREATURES } from './creatures.ts';

/** The standard-set library: every printed creature and ability. */
export const STANDARD_LIBRARY = createLibrary(CREATURES, ABILITIES);
