/**
 * CreatureDeck — browser front-end.
 *
 * The rules live in `src/duel/`; this file draws them and collects clicks.
 * Nothing here decides what is legal: every button is built from the engine's
 * own `legalActions`, so the UI and the AI are working from the same list.
 *
 * Interaction is two-step. Click one of your creatures to select it, then
 * click a highlighted enemy — or the enemy nexus, when its lane is open.
 */

import { ART } from './art.ts';
import { STANDARD_LIBRARY, EFFECT_BY_ID, EFFECTS } from '../src/content/index.ts';
import { staminaFor } from '../src/core/cardDefinition.ts';
import type { CardInstance } from '../src/core/cardInstance.ts';
import { createCardInstance, resolveCard } from '../src/core/cardInstance.ts';
import { nextPowerTier, powerTierProfile } from '../src/core/powerTier.ts';
import { rarityProfile } from '../src/core/rarity.ts';
import { createRng, seedFromString } from '../src/core/rng.ts';
import { effectText } from '../src/core/effects.ts';
import { STAT_KEYS, STAT_LABELS } from '../src/core/stats.ts';
import type { StatKey } from '../src/core/stats.ts';
import { Collection } from '../src/game/collection.ts';
import { optionId, rollDraft } from '../src/game/draft.ts';
import type { DraftOption } from '../src/game/draft.ts';
import { applyXpAwards, computeDuelXp } from '../src/game/rewards.ts';
import { CAUTIOUS, RUTHLESS, STEADY, chooseAction } from '../src/duel/ai.ts';
import type { AiProfile } from '../src/duel/ai.ts';
import { Duel } from '../src/duel/engine.ts';
import type {
  DeckEntry,
  DuelEvent,
  DuelSnapshot,
  HandSnapshot,
  UnitSnapshot,
} from '../src/duel/types.ts';
import { NEXUS_TARGET } from '../src/duel/types.ts';

const library = STANDARD_LIBRARY;

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function art(id: string): string {
  return ART[id] ?? '';
}

// ------------------------------------------------------------------- content

import {
  MIN_CREATURES,
  MIN_DECK,
  STARTER_EFFECTS,
  STARTER_LEVEL,
  STARTER_ROSTER,
  restXp,
} from '../src/content/campaign.ts';
import type { AiProfileName } from '../src/content/campaign.ts';
import { encounterById, scaleEncounter } from '../src/content/encounters.ts';
import type { Encounter } from '../src/content/encounters.ts';
import { availableMoves, depthStep, generateMap, nodeAt } from '../src/game/map.ts';
import type { GameMap, MapNode, NodeKind } from '../src/game/map.ts';

/** The campaign names a profile; this maps it to the opponent's policy. */
const AI_PROFILES: Record<AiProfileName, AiProfile> = {
  cautious: CAUTIOUS,
  steady: STEADY,
  ruthless: RUTHLESS,
};

// --------------------------------------------------------------------- state

interface RunState {
  /** The map is regenerated from this, so a save never stores the graph. */
  mapSeed: number;
  map: GameMap;
  /** The node the warband is standing on; null before the first move. */
  current: string | null;
  /** The node being fought right now, so a reload resumes the same fight. */
  pending: string | null;
  /** Nodes resolved, in the order they were taken. */
  visited: string[];
  collection: Collection;
  /** Creature instance ids in the deck. */
  roster: string[];
  /** Effect card ids in the deck; duplicates are allowed. */
  effects: string[];
  wins: number;
  /** Drafts derive their randomness from this plus the depth, so a saved run
   *  can be restored without serialising a generator. */
  seed: number;
}

/** The level cap of a card's rarity, for firming an encounter up by depth. */
const capOf = (definitionId: string): number =>
  rarityProfile(library.getCard(definitionId).rarity).maxLevel;

/** The encounter at a node, firmed up for how deep into its tier it sits. */
function encounterAt(state: RunState, nodeId: string): Encounter {
  const node = nodeAt(state.map, nodeId);
  return scaleEncounter(
    encounterById(node.encounterId as string),
    depthStep(node.row, state.map.rows),
    capOf,
  );
}

let run: RunState | null = null;
let duel: Duel | null = null;
let snapshot: DuelSnapshot | null = null;
let selectedUid: string | null = null;
let pendingEffect: HandSnapshot | null = null;
let busy = false;
let helpDismissed = false;

const SAVE_KEY = 'creaturedeck.run.v2';

interface SavedRun {
  readonly version: 2;
  readonly mapSeed: number;
  readonly current: string | null;
  readonly pending: string | null;
  readonly visited: readonly string[];
  readonly wins: number;
  readonly seed: number;
  readonly effects: readonly string[];
  readonly roster: readonly {
    readonly instanceId: string;
    readonly definitionId: string;
    readonly level: number;
    readonly xp: number;
    readonly allocation: Record<string, number>;
    readonly upgrades: readonly string[];
    readonly nickname: string | null;
    readonly battlesFought: number;
  }[];
}

/**
 * Persists the run between visits.
 *
 * Only what is between duels is saved — a duel in progress restarts, because
 * serialising a live duel would mean versioning the whole engine state for
 * very little gain. Every access is wrapped: storage can be unavailable or
 * throw outright in a private window.
 */
function saveRun(): void {
  const state = run;
  if (!state) return;
  try {
    const payload: SavedRun = {
      version: 2,
      mapSeed: state.mapSeed,
      current: state.current,
      pending: state.pending,
      visited: state.visited,
      wins: state.wins,
      seed: state.seed,
      effects: state.effects,
      roster: state.roster.map((id) => {
        const instance = state.collection.get(id);
        return {
          instanceId: instance.instanceId,
          definitionId: instance.definitionId,
          level: instance.level,
          xp: instance.xp,
          allocation: { ...instance.allocation },
          upgrades: [...instance.upgrades],
          nickname: instance.nickname,
          battlesFought: instance.battlesFought,
        };
      }),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    // A run that cannot be saved is still perfectly playable.
  }
}

function clearRun(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to do */
  }
}

function loadRun(): RunState | null {
  let payload: SavedRun;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    payload = JSON.parse(raw) as SavedRun;
  } catch {
    return null;
  }

  if (payload?.version !== 2 || !Array.isArray(payload.roster) || payload.roster.length === 0) {
    return null;
  }

  try {
    const collection = new Collection(library);
    const roster = payload.roster.map((saved) => {
      // Throws on an unknown card, which a stale save can easily contain.
      library.getCard(saved.definitionId);
      return collection.add(saved.definitionId, {
        instanceId: saved.instanceId,
        level: saved.level,
        xp: saved.xp,
        allocation: saved.allocation,
        upgrades: saved.upgrades,
        nickname: saved.nickname,
        battlesFought: saved.battlesFought,
      }).instanceId;
    });
    const effects = payload.effects.filter((id) => EFFECTS.some((e) => e.id === id));

    // The map comes back from its seed. A node id the generator no longer
    // produces means the rules changed under the save, so start over rather
    // than drop the warband somewhere that does not exist.
    const map = generateMap(payload.mapSeed);
    const known = (id: string | null): boolean => id === null || map.nodes.has(id);
    if (!known(payload.current) || !known(payload.pending)) return null;

    return {
      mapSeed: payload.mapSeed,
      map,
      current: payload.current ?? null,
      pending: payload.pending ?? null,
      visited: (payload.visited ?? []).filter((id) => map.nodes.has(id)),
      collection,
      roster,
      effects: [...effects],
      wins: payload.wins ?? 0,
      seed: payload.seed ?? 1,
    };
  } catch {
    // A save written by an older set of cards: start fresh rather than crash.
    return null;
  }
}

function show(screen: string): void {
  for (const node of Array.from(document.querySelectorAll('.screen'))) {
    node.classList.toggle('on', node.id === screen);
  }
  window.scrollTo(0, 0);
}

// ----------------------------------------------------------------- run setup

function newRun(): RunState {
  const collection = new Collection(library);
  const roster = STARTER_ROSTER.map(([definitionId, nickname]) =>
    collection.add(definitionId, { nickname, level: STARTER_LEVEL }).instanceId,
  );
  const mapSeed = seedFromString(`map-${Date.now()}-${Math.random()}`);
  return {
    mapSeed,
    map: generateMap(mapSeed),
    current: null,
    pending: null,
    visited: [],
    collection,
    roster,
    effects: [...STARTER_EFFECTS],
    wins: 0,
    seed: seedFromString(`run-${Date.now()}-${Math.random()}`),
  };
}

function playerDeck(state: RunState): { deck: DeckEntry[]; instances: CardInstance[] } {
  const instances = state.roster.map((id) => state.collection.get(id));
  const deck: DeckEntry[] = [
    ...state.roster.map((id): DeckEntry => ({ kind: 'creature', instanceId: id })),
    ...state.effects.map((effectId): DeckEntry => ({ kind: 'effect', effectId })),
  ];
  return { deck, instances };
}

function opponentDeck(encounter: Encounter): { deck: DeckEntry[]; instances: CardInstance[] } {
  const foe = new Collection(library);
  const instances: CardInstance[] = [];
  const deck: DeckEntry[] = [];

  for (const entry of encounter.creatures) {
    const instance = foe.add(entry.definitionId, { level: entry.level });
    foe.autoAllocate(instance.instanceId, entry.focus);
    instances.push(foe.get(instance.instanceId));
    deck.push({ kind: 'creature', instanceId: instance.instanceId });
  }
  for (const effectId of encounter.effects) deck.push({ kind: 'effect', effectId });

  return { deck, instances };
}

// ----------------------------------------------------------------- the map

const NODE_GLYPH: Record<NodeKind, string> = {
  battle: '',
  elite: '',
  rest: '\u2698',
  cache: '\u25C6',
  boss: '',
};

const NODE_LABEL: Record<NodeKind, string> = {
  battle: 'Battle',
  elite: 'Elite',
  rest: 'Waystone',
  cache: 'Cache',
  boss: 'Boss',
};

/** What a node is, in a sentence, for the panel under the map. */
function nodeDescription(state: RunState, node: MapNode): { name: string; blurb: string } {
  if (node.kind === 'rest') {
    return {
      name: 'A waystone',
      blurb:
        'No fight here. The warband rests, takes the experience it has been carrying, ' +
        'and you spend what that earns.',
    };
  }
  if (node.kind === 'cache') {
    return {
      name: 'A cache',
      blurb: 'Someone left something behind. Take a card into the deck, or cut one loose.',
    };
  }
  const encounter = encounterAt(state, node.id);
  return { name: encounter.name, blurb: encounter.blurb };
}

function showMap(): void {
  const state = run;
  if (!state) return;
  duel = null;
  renderMap();
  show('screen-map');
}

function renderMap(): void {
  const state = run;
  if (!state) return;
  const { map } = state;
  const open = new Set(availableMoves(map, state.current));
  const taken = new Set(state.visited);

  const depth = state.current === null ? 0 : nodeAt(map, state.current).row + 1;
  el('map-depth').textContent = `Row ${Math.min(depth + 1, map.rows)} of ${map.rows}`;
  el('map-deck').textContent =
    `${state.roster.length} creatures · ${state.effects.length} effects`;
  const ways = (map.byRow[0] ?? []).length;
  el('map-hint').textContent =
    state.current === null
      ? `${ways} ways in. Every route ends at the same crown — what you meet on the way is yours to choose.`
      : 'One row at a time. Pick what you would rather fight.';

  // Lines first, in grid units, so node positions and edges cannot disagree.
  /* The boss lives at column 0 so its id is stable, but every route funnels
     into it. Drawn where it sits, that funnel reads as a fan of diagonals
     across the whole map; drawn centred, it reads as the funnel it is. */
  const centreOf = (node: MapNode): number =>
    node.kind === 'boss' ? map.columns / 2 : node.column + 0.5;
  const middleOf = (node: MapNode): number => map.rows - 0.5 - node.row;

  const edges: string[] = [];
  for (const node of map.nodes.values()) {
    for (const exitId of node.exits) {
      const exit = nodeAt(map, exitId);
      const live = state.current === node.id || (taken.has(node.id) && taken.has(exitId));
      edges.push(
        `<line x1="${centreOf(node)}" y1="${middleOf(node)}" ` +
          `x2="${centreOf(exit)}" y2="${middleOf(exit)}" ` +
          `class="${live ? 'edge live' : 'edge'}" vector-effect="non-scaling-stroke"></line>`,
      );
    }
  }

  const nodes = [...map.nodes.values()].map((node) => {
    const here = state.current === node.id;
    const reachable = open.has(node.id);
    const been = taken.has(node.id);
    const classes = ['mapnode', `k-${node.kind}`];
    if (here) classes.push('here');
    if (been && !here) classes.push('been');
    if (reachable) classes.push('open');
    const portrait = node.encounterId ? art(encounterById(node.encounterId).art) : '';
    const described = nodeDescription(state, node);

    return `<button class="${classes.join(' ')}" ${reachable ? '' : 'disabled'}
        data-node="${esc(node.id)}"
        style="left:${(centreOf(node) / map.columns) * 100}%;top:${
          (middleOf(node) / map.rows) * 100
        }%"
        title="${esc(`${NODE_LABEL[node.kind]} — ${described.name}`)}">
        <span class="face">${
          portrait ? `<img src="${portrait}" alt="">` : `<span class="glyph">${NODE_GLYPH[node.kind]}</span>`
        }</span>
        <span class="tag">${esc(NODE_LABEL[node.kind])}</span>
      </button>`;
  });

  el('map-graph').style.setProperty('--map-rows', String(map.rows));
  el('map-graph').innerHTML =
    `<svg class="mapedges" viewBox="0 0 ${map.columns} ${map.rows}" preserveAspectRatio="none" aria-hidden="true">${edges.join(
      '',
    )}</svg>` + nodes.join('');
}

/** Moves onto a node and resolves whatever is there. */
function enterNode(id: string): void {
  const state = run;
  if (!state) return;
  if (!availableMoves(state.map, state.current).includes(id)) return;

  const node = nodeAt(state.map, id);

  if (node.kind === 'rest' || node.kind === 'cache') {
    state.current = id;
    state.pending = null;
    state.visited.push(id);

    if (node.kind === 'rest') {
      const before = new Map<string, string>();
      for (const instanceId of state.roster) {
        before.set(instanceId, state.collection.resolve(instanceId).powerTier);
      }
      applyXpAwards(
        state.collection,
        state.roster.map((instanceId) => ({
          instanceId,
          name: state.collection.resolve(instanceId).displayName,
          xp: restXp(node.row),
        })),
      );
      promotedFrom = before;
      saveRun();
      showLevelUp('The warband rests', 'Experience carried this far, spent here.');
      return;
    }

    saveRun();
    showDraft('A cache, broken open');
    return;
  }

  state.pending = id;
  saveRun();
  startDuel();
}

// -------------------------------------------------------------------- battle

function startDuel(): void {
  const state = run;
  if (!state || state.pending === null) return;
  const node = nodeAt(state.map, state.pending);
  const encounter = encounterAt(state, state.pending);

  const mine = playerDeck(state);
  const theirs = opponentDeck(encounter);

  duel = new Duel(
    [
      { id: 'p1', name: 'Your warband', deck: mine.deck },
      { id: 'p2', name: encounter.name, deck: theirs.deck },
    ],
    library,
    EFFECT_BY_ID,
    [...mine.instances, ...theirs.instances],
    { seed: 1700 + seedFromString(node.id) % 9973, nexusHealth: encounter.nexusHealth },
  );

  selectedUid = null;
  pendingEffect = null;
  busy = false;

  el('stage-name').textContent = encounter.name;
  el('stage-count').textContent =
    `${NODE_LABEL[node.kind]} · row ${node.row + 1} of ${state.map.rows}`;
  el('log').innerHTML = '';

  const panel = el('help');
  panel.hidden = state.visited.length === 0 ? helpDismissed : true;
  el('help-toggle').setAttribute('aria-expanded', String(!panel.hidden));

  snapshot = duel.snapshot();
  for (const event of duel.drain()) logEvent(event);
  render();
  show('screen-duel');
}

/** Applies a player action, animates what happened, then hands over to the AI. */
function act(action: Parameters<Duel['apply']>[0]): void {
  if (!duel || busy || duel.isOver) return;
  selectedUid = null;
  pendingEffect = null;

  const events = duel.apply(action);
  busy = true;
  playEvents(events, () => {
    busy = false;
    snapshot = duel!.snapshot();
    render();

    if (duel!.isOver) {
      finishDuel();
      return;
    }
    if (duel!.snapshot().activePlayerId !== 'p1') runOpponentTurn();
  });
}

/** The temperament of whatever is being fought right now. */
function opposingProfile(): AiProfile {
  const state = run;
  if (!state || state.pending === null) return STEADY;
  return AI_PROFILES[encounterAt(state, state.pending).profile];
}

function runOpponentTurn(): void {
  if (!duel) return;
  const profile = opposingProfile();
  busy = true;
  render();

  const step = (): void => {
    if (!duel || duel.isOver) {
      busy = false;
      snapshot = duel?.snapshot() ?? snapshot;
      render();
      if (duel?.isOver) finishDuel();
      return;
    }
    if (duel.snapshot().activePlayerId === 'p1') {
      busy = false;
      snapshot = duel.snapshot();
      render();
      return;
    }

    const action = chooseAction(duel, profile);
    const events = duel.apply(action);
    snapshot = duel.snapshot();
    playEvents(events, step);
  };

  window.setTimeout(step, 420);
}

// ------------------------------------------------------------------ animation

const DELAYS: Partial<Record<DuelEvent['type'], number>> = {
  'turn-start': 360,
  'play-creature': 340,
  'play-effect': 420,
  ability: 320,
  attack: 240,
  dodge: 280,
  damage: 260,
  heal: 260,
  shield: 260,
  spent: 380,
  death: 420,
  revive: 460,
  'nexus-damage': 380,
  reshuffle: 260,
};

let fast = false;
const floaters: { uid: string; text: string; kind: string }[] = [];
const flashes = new Map<string, string>();

function playEvents(events: readonly DuelEvent[], done: () => void): void {
  let i = 0;
  const tick = (): void => {
    if (i >= events.length) {
      done();
      return;
    }
    const event = events[i] as DuelEvent;
    i += 1;
    logEvent(event);

    const delay = DELAYS[event.type];
    if (delay === undefined) {
      tick();
      return;
    }

    applyVisual(event);
    snapshot = duel?.snapshot() ?? snapshot;
    render();
    window.setTimeout(tick, fast ? Math.min(70, delay / 4) : delay);
  };
  tick();
}

function applyVisual(event: DuelEvent): void {
  if (event.type === 'damage' && event.targetUid) {
    flashes.set(event.targetUid, 'struck');
    floaters.push({ uid: event.targetUid, text: `-${event.amount ?? 0}`, kind: 'dmg' });
  } else if (event.type === 'heal' && (event.targetUid ?? event.actorUid)) {
    const uid = (event.targetUid ?? event.actorUid) as string;
    floaters.push({ uid, text: `+${event.amount ?? 0}`, kind: 'heal' });
  } else if (event.type === 'shield' && (event.targetUid ?? event.actorUid)) {
    const uid = (event.targetUid ?? event.actorUid) as string;
    floaters.push({ uid, text: `+${event.amount ?? 0}`, kind: 'shield' });
  } else if (event.type === 'dodge' && event.targetUid) {
    floaters.push({ uid: event.targetUid, text: 'miss', kind: 'miss' });
  } else if (event.type === 'attack' && event.actorUid) {
    flashes.set(event.actorUid, 'swing');
    if (event.targetUid) flashes.set(event.targetUid, 'targeted');
  } else if (event.type === 'death' && event.targetUid) {
    flashes.set(event.targetUid, 'dying');
  }
}

function logEvent(event: DuelEvent): void {
  if (event.type === 'draw' || event.type === 'stamina') return;
  const log = el('log');
  const line = document.createElement('p');
  line.className = `ev-${event.type}`;
  line.textContent = event.message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// -------------------------------------------------------------------- drawing

function unitHtml(unit: UnitSnapshot | null, side: 'you' | 'foe', lane: number): string {
  if (!unit) {
    return `<div class="slot" data-lane="${lane}" data-side="${side}"><span>lane ${lane + 1}</span></div>`;
  }

  const pct = Math.max(0, Math.round((unit.health / Math.max(1, unit.maxHealth)) * 100));
  const flash = flashes.get(unit.uid);
  flashes.delete(unit.uid);

  const selectable = side === 'you' && unit.canAttack && !busy;
  const targetable = isTargetable(unit);
  const selected = unit.uid === selectedUid;

  const pips: string[] = [];
  for (let i = 0; i < unit.maxStamina; i += 1) {
    pips.push(`<i class="${i < unit.stamina ? 'on' : ''}"></i>`);
  }

  const marks: string[] = [];
  if (unit.shield > 0) marks.push(`<span class="chip shd">+${unit.shield}</span>`);
  if (unit.poison > 0) marks.push(`<span class="chip psn">psn ${unit.poison}</span>`);

  const tip = `${unit.name} — L${unit.level} ${unit.rarityLabel} ${unit.tierLabel}. ${unit.might} attack, ${unit.guard} guard, ${unit.stamina}/${unit.maxStamina} stamina.${
    unit.abilities.length ? ' ' + unit.abilities.map((a) => `${a.name}: ${a.description}`).join(' ') : ''
  }`;

  return `
    <div class="unit${selectable ? ' ready' : ''}${targetable ? ' targetable' : ''}${
      selected ? ' selected' : ''
    }${unit.resting ? ' resting' : ''}${flash ? ' ' + flash : ''}"
         data-uid="${esc(unit.uid)}" data-side="${side}"
         style="--tier:var(--tier-${unit.tier})"
         title="${esc(tip)}">
      <div class="portrait"><img src="${art(unit.art)}" alt=""></div>
      <div class="body">
        <div class="nm">${esc(unit.name)}</div>
        <div class="stam">${pips.join('')}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="row">
          <span class="mt">${unit.might}</span>
          <span class="hp">${unit.health}</span>
        </div>
      </div>
      <div class="marks">${marks.join('')}</div>
      ${unit.resting ? '<div class="tag">resting</div>' : ''}
      ${targetable ? '<div class="crosshair"></div>' : ''}
    </div>`;
}

function isTargetable(unit: UnitSnapshot): boolean {
  if (!duel || busy) return false;
  if (pendingEffect && pendingEffect.kind === 'effect') {
    return duel
      .legalActions()
      .some(
        (action) =>
          action.type === 'play-effect' &&
          action.effectId === pendingEffect!.id &&
          action.targetUid === unit.uid,
      );
  }
  if (!selectedUid) return false;
  return duel
    .legalActions()
    .some(
      (action) =>
        action.type === 'attack' &&
        action.attackerUid === selectedUid &&
        action.targetUid === unit.uid,
    );
}

function handHtml(card: HandSnapshot): string {
  const selected = pendingEffect?.id === card.id;
  if (card.kind === 'effect') {
    return `
      <button class="card effect${card.playable ? ' playable' : ''}${selected ? ' selected' : ''}"
              data-hand="${esc(card.id)}" data-kind="effect" ${card.playable ? '' : 'disabled'}
              title="${esc(card.name)} — ${esc(card.text)}">
        <span class="cost">${card.cost}</span>
        <span class="portrait"><img src="${art(card.art)}" alt=""></span>
        <span class="nm">${esc(card.name)}</span>
        <span class="meta">Effect · ${esc(card.rarityLabel)}</span>
        <span class="txt">${card.playable ? esc(card.text) : `<i>${esc(card.blocked)}</i>`}</span>
      </button>`;
  }

  return `
    <button class="card${card.playable ? ' playable' : ''}"
            data-hand="${esc(card.id)}" data-kind="creature" ${card.playable ? '' : 'disabled'}
            style="--tier:var(--tier-${card.tier})"
            title="${esc(card.name)} — L${card.level} ${card.rarityLabel} ${card.tierLabel}. ${card.might} attack, ${card.vitality} health, ${card.stamina} stamina.">
      <span class="cost">${card.cost}</span>
      <span class="portrait"><img src="${art(card.art)}" alt=""></span>
      <span class="nm">${esc(card.name)}</span>
      <span class="meta" style="color:var(--rarity-${card.rarity})">${esc(card.rarityLabel)} · ${esc(
        card.tierLabel,
      )} · L${card.level}</span>
      <span class="txt">${
        card.playable
          ? `${card.might} atk · ${card.vitality} hp · ${card.stamina} stam`
          : `<i>${esc(card.blocked)}</i>`
      }</span>
    </button>`;
}

function render(): void {
  if (!snapshot || !duel) return;
  const [me, foe] = snapshot.players;

  el('foe-lanes').innerHTML = foe.lanes.map((u, i) => unitHtml(u, 'foe', i)).join('');
  el('you-lanes').innerHTML = me.lanes.map((u, i) => unitHtml(u, 'you', i)).join('');

  nexus('foe', foe.nexusHealth, foe.maxNexusHealth);
  nexus('you', me.nexusHealth, me.maxNexusHealth);

  const nexusOpen =
    !busy &&
    selectedUid !== null &&
    duel
      .legalActions()
      .some(
        (a) => a.type === 'attack' && a.attackerUid === selectedUid && a.targetUid === NEXUS_TARGET,
      );
  el('foe-nexus').classList.toggle('targetable', nexusOpen);

  el('turn-no').textContent = `Round ${snapshot.round}`;
  el('energy').textContent = String(me.energy);
  el('piles').textContent = `${me.drawCount} in deck · ${me.discardCount} discarded`;
  el('hand').innerHTML = me.hand.map(handHtml).join('');

  // Lane drop targets while a creature is chosen from hand.
  const placing = pendingCreature !== null;
  el('you-lanes').classList.toggle('placing', placing);

  const yourTurn = snapshot.activePlayerId === 'p1' && !busy && !duel.isOver;
  const prompt = el('prompt');
  prompt.classList.toggle('act', yourTurn);
  prompt.textContent = !yourTurn
    ? 'Opponent is playing…'
    : pendingCreature
      ? 'Choose a lane to place it in.'
      : pendingEffect
        ? 'Choose a target for the effect.'
        : selectedUid
          ? 'Choose what it attacks.'
          : 'Play a card, or click one of your ready creatures to attack.';

  const end = el<HTMLButtonElement>('end-turn');
  end.disabled = !yourTurn;

  for (const item of floaters.splice(0)) {
    const node = document.querySelector(`[data-uid="${CSS.escape(item.uid)}"]`);
    if (!node) continue;
    const span = document.createElement('span');
    span.className = `float ${item.kind}`;
    span.textContent = item.text;
    node.appendChild(span);
    window.setTimeout(() => span.remove(), 900);
  }
}

function nexus(side: string, health: number, max: number): void {
  el(`${side}-hp`).textContent = String(health);
  el(`${side}-bar`).style.width = `${Math.max(0, (health / Math.max(1, max)) * 100)}%`;
}

// ------------------------------------------------------------------- clicking

let pendingCreature: string | null = null;

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;

  if (target.closest('#foe-nexus') && selectedUid && !busy) {
    act({ type: 'attack', attackerUid: selectedUid, targetUid: NEXUS_TARGET });
    return;
  }

  const hand = target.closest<HTMLElement>('[data-hand]');
  if (hand && !busy) {
    const id = hand.getAttribute('data-hand') as string;
    if (hand.getAttribute('data-kind') === 'creature') {
      pendingCreature = pendingCreature === id ? null : id;
      pendingEffect = null;
      selectedUid = null;
    } else {
      const card = snapshot?.players[0].hand.find((c) => c.id === id) ?? null;
      const effect = EFFECTS.find((e) => e.id === id);
      pendingCreature = null;
      selectedUid = null;
      if (effect?.target === 'none') {
        act({ type: 'play-effect', effectId: id });
        return;
      }
      pendingEffect = pendingEffect?.id === id ? null : card;
    }
    render();
    return;
  }

  const slot = target.closest<HTMLElement>('.slot');
  if (slot && pendingCreature && slot.getAttribute('data-side') === 'you' && !busy) {
    act({
      type: 'play-creature',
      instanceId: pendingCreature,
      lane: Number(slot.getAttribute('data-lane')),
    });
    pendingCreature = null;
    return;
  }

  const unit = target.closest<HTMLElement>('[data-uid]');
  if (unit && !busy) {
    const uid = unit.getAttribute('data-uid') as string;
    const side = unit.getAttribute('data-side');

    if (pendingEffect) {
      act({ type: 'play-effect', effectId: pendingEffect.id, targetUid: uid });
      return;
    }
    if (side === 'you') {
      pendingCreature = null;
      selectedUid = selectedUid === uid ? null : uid;
      render();
      return;
    }
    if (selectedUid) {
      act({ type: 'attack', attackerUid: selectedUid, targetUid: uid });
      return;
    }
  }
}

// ------------------------------------------------------- after the duel

function finishDuel(): void {
  const state = run;
  if (!state || !duel) return;
  const result = duel.result;
  if (!result) return;

  const fought = state.pending;
  if (fought === null) return;
  const node = nodeAt(state.map, fought);
  const encounter = encounterAt(state, fought);

  const won = result.winner === 'p1';
  if (won) state.wins += 1;

  const before = new Map<string, string>();
  for (const id of state.roster) before.set(id, state.collection.resolve(id).powerTier);

  applyXpAwards(
    state.collection,
    computeDuelXp(state.collection, state.roster, node.row, won, node.kind === 'elite'),
  );
  promotedFrom = before;

  duel = null;

  if (!won) {
    clearRun();
    showOutcome(false, result.turns, encounter.name, node.row);
    return;
  }

  state.current = fought;
  state.pending = null;
  state.visited.push(fought);
  lastTurns = result.turns;

  if (node.kind === 'boss') {
    clearRun();
    showOutcome(true, result.turns, encounter.name, node.row);
    return;
  }
  saveRun();
  showDraft(`${encounter.name} broken`);
}

// ------------------------------------------------------------------- draft

let lastTurns = 0;
let offers: readonly DraftOption[] = [];

function deckCopies(state: RunState): Map<string, number> {
  const copies = new Map<string, number>();
  for (const id of state.roster) {
    const definitionId = state.collection.get(id).definitionId;
    copies.set(definitionId, (copies.get(definitionId) ?? 0) + 1);
  }
  for (const effectId of state.effects) {
    copies.set(effectId, (copies.get(effectId) ?? 0) + 1);
  }
  return copies;
}

function showDraft(headline: string): void {
  const state = run;
  if (!state) return;

  offers = rollDraft(
    createRng(state.seed + state.visited.length * 7919),
    library,
    EFFECTS,
    {
      rosterLevels: state.roster.map((id) => state.collection.resolve(id).level),
      copies: deckCopies(state),
    },
  );

  el('draft-head').textContent = headline;
  el('draft-sub').textContent = `Your deck holds ${
    state.roster.length + state.effects.length
  } cards.`;
  el('cull-pane').hidden = true;
  el('cull-toggle').textContent = 'Cull a card instead';

  renderDraft();
  show('screen-draft');
}

function renderDraft(): void {
  const state = run;
  if (!state) return;

  if (offers.length === 0) {
    el('draft-options').innerHTML =
      '<p class="hint">Nothing left in the set that your deck has room for.</p>';
    return;
  }

  el('draft-options').innerHTML = offers
    .map((option) => {
      const id = optionId(option);
      if (option.kind === 'effect') {
        const effect = EFFECTS.find((candidate) => candidate.id === id);
        return `
          <button class="pick" data-take="${esc(id)}" style="--tier:var(--rarity-${option.rarity})">
            <span class="kind">Effect</span>
            <span class="portrait"><img src="${art(id)}" alt=""></span>
            <span class="nm">${esc(option.name)}</span>
            <span class="meta" style="color:var(--rarity-${option.rarity})">${esc(
              option.rarity,
            )} · costs ${effect?.cost ?? '?'}</span>
            <span class="txt">${esc(effect ? effectText(effect) : '')}</span>
          </button>`;
      }

      // Preview the recruit exactly as it would arrive.
      const preview = resolveCard(
        createCardInstance(library.getCard(option.definitionId), {
          instanceId: `preview-${id}`,
          level: option.level,
        }),
        library,
      );
      return `
        <button class="pick" data-take="${esc(id)}" style="--tier:var(--tier-${preview.powerTier})">
          <span class="kind">Creature</span>
          <span class="portrait"><img src="${art(id)}" alt=""></span>
          <span class="nm">${esc(option.name)}</span>
          <span class="meta" style="color:var(--rarity-${option.rarity})">${esc(
            preview.rarity.label,
          )} · ${esc(preview.tier.label)} · joins at L${option.level}</span>
          <span class="line">${preview.stats.might} atk · ${preview.stats.vitality} hp · ${
            preview.stamina
          } stam · costs ${preview.deployCost}</span>
          <span class="txt">${esc(
            preview.abilities.map((ability) => ability.name).join(', ') || 'No ability yet',
          )}${
            preview.pendingUpgrades > 0
              ? ` · ${preview.pendingUpgrades} path${preview.pendingUpgrades === 1 ? '' : 's'} to choose`
              : ''
          }</span>
        </button>`;
    })
    .join('');
}

function renderCull(): void {
  const state = run;
  if (!state) return;
  const rows: string[] = [];

  for (const id of state.roster) {
    const card = state.collection.resolve(id);
    rows.push(`
      <button class="cull-row" data-cut-creature="${esc(id)}">
        <img src="${art(card.definition.id)}" alt="">
        <span>
          <span class="nm">${esc(card.displayName)}</span>
          <span class="meta"> — L${card.level} ${esc(card.rarity.label)} ${esc(card.tier.label)}</span>
        </span>
      </button>`);
  }
  state.effects.forEach((effectId, index) => {
    const effect = EFFECTS.find((candidate) => candidate.id === effectId);
    rows.push(`
      <button class="cull-row" data-cut-effect="${index}">
        <img src="${art(effectId)}" alt="">
        <span>
          <span class="nm">${esc(effect?.name ?? effectId)}</span>
          <span class="meta"> — effect, costs ${effect?.cost ?? '?'}</span>
        </span>
      </button>`);
  });

  el('cull-options').innerHTML = rows.join('');
}

function takeOption(id: string): void {
  const state = run;
  if (!state) return;
  const option = offers.find((candidate) => optionId(candidate) === id);
  if (!option) return;

  if (option.kind === 'creature') {
    const instance = state.collection.add(option.definitionId, { level: option.level });
    state.roster.push(instance.instanceId);
  } else {
    state.effects.push(option.effectId);
  }
  saveRun();
  showLevelUp('Spoils taken', 'Spend what the warband has earned.');
}

function cutCard(kind: 'creature' | 'effect', key: string): void {
  const state = run;
  if (!state) return;
  if (state.roster.length + state.effects.length <= MIN_DECK) return;

  if (kind === 'creature') {
    // Keep at least a few bodies, or there is nothing to put on the board.
    if (state.roster.length <= MIN_CREATURES) return;
    const at = state.roster.indexOf(key);
    if (at === -1) return;
    state.roster.splice(at, 1);
  } else {
    const at = Number(key);
    if (!Number.isInteger(at) || at < 0 || at >= state.effects.length) return;
    state.effects.splice(at, 1);
  }
  saveRun();
  showLevelUp('A leaner deck', 'Spend what the warband has earned.');
}

let promotedFrom = new Map<string, string>();

function showLevelUp(headline: string, subtitle: string): void {
  const state = run;
  if (!state) return;

  el('levelup-head').textContent = headline;
  el('levelup-sub').textContent = subtitle;

  // What the map offers next, so the points are spent against something.
  const ahead = availableMoves(state.map, state.current).map((id) => {
    const node = nodeAt(state.map, id);
    return `${NODE_LABEL[node.kind]} — ${nodeDescription(state, node).name}`;
  });
  el('next-name').textContent = ahead.length === 1 ? 'The only way on' : `${ahead.length} ways on`;
  el('next-blurb').textContent = ahead.join(' · ');

  renderRoster();
  show('screen-levelup');
}

function totalUnspent(): number {
  const state = run;
  if (!state) return 0;
  return state.roster.reduce((sum, id) => sum + state.collection.resolve(id).pointsUnspent, 0);
}

function renderRoster(): void {
  const state = run;
  if (!state) return;

  el('roster').innerHTML = state.roster
    .map((id) => {
      const card = state.collection.resolve(id);
      const was = promotedFrom.get(id);
      const promoted = was !== undefined && was !== card.powerTier;
      const profile = powerTierProfile(card.powerTier);
      const above = nextPowerTier(card.powerTier);
      const toNext = card.scoreToNextTier;
      const bandEnd = above === null ? card.powerScore : powerTierProfile(above).minScore;
      const pct =
        toNext === null
          ? 100
          : Math.max(
              3,
              Math.min(
                100,
                ((card.powerScore - profile.minScore) /
                  Math.max(1, bandEnd - profile.minScore)) * 100,
              ),
            );

      const stats = STAT_KEYS.map((key) => {
        const spent = card.instance.allocation[key];
        return `
          <div class="stat">
            <span class="k">${STAT_LABELS[key].slice(0, 3)}</span>
            <span class="v">${card.stats[key]}${spent > 0 ? `<span class="plus">+${spent}</span>` : ''}</span>
            <span class="btns">
              <button data-minus="${esc(id)}" data-stat="${key}" ${spent <= 0 ? 'disabled' : ''}
                      aria-label="Remove a point from ${STAT_LABELS[key]}">&minus;</button>
              <button data-plus="${esc(id)}" data-stat="${key}" ${card.pointsUnspent <= 0 ? 'disabled' : ''}
                      aria-label="Add a point to ${STAT_LABELS[key]}">+</button>
            </span>
          </div>`;
      }).join('');

      const fork =
        card.upgradeChoice === null
          ? ''
          : `
          <div class="fork">
            <div class="fork-head">Level ${
              upgradeMilestonesFor(card)
            } — choose a path, permanently</div>
            ${card.upgradeChoice
              .map(
                (option) => `
              <button class="path" data-upgrade="${esc(id)}" data-option="${esc(option.id)}">
                <span class="kind">${esc(option.kind)}</span>
                <span class="nm">${esc(option.name)}</span>
                <span class="txt">${esc(option.description)}</span>
              </button>`,
              )
              .join('')}
          </div>`;

      const taken =
        card.upgrades.length === 0
          ? ''
          : `<div class="taken">${card.upgrades
              .map((upgrade) => `<span>${esc(upgrade.name)}</span>`)
              .join('')}</div>`;

      return `
        <div class="entry${card.pendingUpgrades > 0 ? ' pending' : ''}" style="--tier:var(--tier-${card.powerTier})">
          <div class="who">
            <div class="face"><img src="${art(card.definition.id)}" alt=""></div>
            <div>
              <div class="nm">${esc(card.displayName)}</div>
              <div class="tags">
                <span class="badge" style="color:var(--rarity-${card.definition.rarity})">${esc(
                  rarityProfile(card.definition.rarity).label,
                )}</span>
                <span class="badge" style="color:var(--tier-${card.powerTier})">${esc(profile.label)}</span>
                <span class="num">L${card.level}${card.isMaxLevel ? ' max' : ''} · cost ${
                  card.deployCost
                } · ${staminaFor(card.definition.rarity, card.level)} stam</span>
                ${promoted ? '<span class="promo">Promoted</span>' : ''}
              </div>
              <div class="tiermeter">
                <span class="track"><i style="width:${pct}%;background:var(--tier-${card.powerTier})"></i></span>
                <small>${
                  toNext === null || above === null
                    ? 'Top tier reached.'
                    : `${toNext} power score to ${esc(powerTierProfile(above).label)}`
                }${
                  card.pointsUnspent > 0
                    ? ` · <b>${card.pointsUnspent} point${card.pointsUnspent === 1 ? '' : 's'} to spend</b>`
                    : ''
                }</small>
              </div>
              ${taken}
            </div>
          </div>
          <div class="alloc">${stats}</div>
          ${fork}
        </div>`;
    })
    .join('');

  const left = totalUnspent();
  el('points-left').textContent = left === 0 ? 'All points spent' : `${left} growth points unspent`;
  el('points-left').classList.toggle('warn', left > 0);

  // An unchosen path is pure loss, so it blocks the exit. Unspent growth
  // points do not — holding those back is a legitimate choice.
  const forks = state.roster.reduce(
    (sum, id) => sum + state.collection.resolve(id).pendingUpgrades,
    0,
  );
  el<HTMLButtonElement>('next-duel').disabled = forks > 0;
  el('upgrade-nag').hidden = forks === 0;
}

/** The milestone level the pending fork belongs to. */
function upgradeMilestonesFor(card: { level: number; upgrades: readonly unknown[] }): number {
  return (card.upgrades.length + 1) * 4;
}

function showOutcome(victory: boolean, turns: number, against: string, row: number): void {
  const state = run;
  if (!state) return;

  el('outcome-title').textContent = victory ? `${against} falls` : 'Your warband is broken';
  el('outcome-sub').textContent = victory
    ? 'The climb is finished. Every creature below began identical to the one beside it.'
    : `${against} stopped you at row ${row + 1} of ${state.map.rows}, ${state.wins} fight${
        state.wins === 1 ? '' : 's'
      } taken.`;
  el('outcome-turns').textContent = `The last duel lasted ${turns} turns.`;

  el('tally').innerHTML = state.roster
    .map((id) => state.collection.resolve(id))
    .sort((a, b) => b.powerScore - a.powerScore)
    .map(
      (card) => `
        <div class="r">
          <span><img src="${art(card.definition.id)}" alt="" class="pip-art">${esc(card.displayName)}
            <b style="color:var(--tier-${card.powerTier})">${esc(card.tier.label)}</b></span>
          <span class="num">L${card.level} · ${card.stats.might}/${card.stats.vitality} · score ${card.powerScore}</span>
        </div>`,
    )
    .join('');

  show('screen-end');
}

// --------------------------------------------------------------------- wiring

function onProgressionClick(event: MouseEvent): void {
  const step = (event.target as HTMLElement).closest<HTMLElement>('[data-node]');
  if (step) {
    const id = step.getAttribute('data-node');
    if (id) enterNode(id);
    return;
  }

  const node = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-take],[data-cut-creature],[data-cut-effect],[data-upgrade]',
  );
  if (node) {
    const state = run;
    if (!state) return;

    const take = node.getAttribute('data-take');
    if (take) {
      takeOption(take);
      return;
    }
    const cutCreature = node.getAttribute('data-cut-creature');
    if (cutCreature) {
      cutCard('creature', cutCreature);
      return;
    }
    const cutEffect = node.getAttribute('data-cut-effect');
    if (cutEffect) {
      cutCard('effect', cutEffect);
      return;
    }
    const upgradeFor = node.getAttribute('data-upgrade');
    const optionChosen = node.getAttribute('data-option');
    if (upgradeFor && optionChosen) {
      try {
        state.collection.chooseUpgrade(upgradeFor, optionChosen);
      } catch {
        return;
      }
      saveRun();
      renderRoster();
      return;
    }
  }

  const target = (event.target as HTMLElement).closest('[data-plus],[data-minus]');
  if (!(target instanceof HTMLElement)) return;
  const state = run;
  if (!state) return;

  const stat = target.getAttribute('data-stat') as StatKey | null;
  if (!stat) return;
  const plus = target.getAttribute('data-plus');
  const minus = target.getAttribute('data-minus');
  try {
    if (plus) state.collection.allocate(plus, { [stat]: 1 });
    else if (minus) state.collection.allocate(minus, { [stat]: -1 });
  } catch {
    return;
  }
  saveRun();
  renderRoster();
}

/**
 * A run opens on the warband, not the map.
 *
 * Starters arrive with growth points already banked, and the balance figures
 * assume they get spent. Dropping the player straight onto the map sends them
 * into the first fight carrying forty unspent points, which is a noticeably
 * weaker warband than anything that was ever measured.
 */
function startFreshRun(): void {
  clearRun();
  run = newRun();
  promotedFrom = new Map();
  saveRun();
  showLevelUp(
    'Ten creatures, none of them finished',
    'Every one starts with points banked. Spend them — then choose your way in.',
  );
}

function boot(): void {
  document.addEventListener('click', onClick);
  document.addEventListener('click', onProgressionClick);

  const saved = loadRun();
  if (saved) {
    const row = saved.current === null ? 0 : nodeAt(saved.map, saved.current).row + 1;
    const resume = el('resume');
    resume.hidden = false;
    resume.textContent = `Continue run — row ${row + 1} of ${saved.map.rows}`;
    resume.addEventListener('click', () => {
      run = loadRun();
      if (!run) return;
      // A run saved mid-fight resumes that fight; anywhere else, the map.
      if (run.pending !== null) startDuel();
      else showMap();
    });
  }

  el('begin').addEventListener('click', startFreshRun);
  el('map-warband').addEventListener('click', () => {
    if (!run) return;
    // The same screen, reached without a node behind it: you look at the
    // warband *before* committing to a route, which is when it matters.
    showLevelUp('Your warband', 'Spend anything unspent, then pick your route.');
  });
  el('end-turn').addEventListener('click', () => act({ type: 'end-turn' }));
  el('next-duel').addEventListener('click', showMap);
  el('again').addEventListener('click', startFreshRun);
  el('cull-toggle').addEventListener('click', () => {
    const pane = el('cull-pane');
    const opening = pane.hidden;
    pane.hidden = !opening;
    el('draft-options').hidden = opening;
    el('draft-title').hidden = opening;
    el('cull-toggle').textContent = opening ? 'Take a card instead' : 'Cull a card instead';
    if (opening) renderCull();
  });
  el('fast').addEventListener('click', () => {
    fast = !fast;
    el('fast').textContent = fast ? 'Speed: fast' : 'Speed: normal';
  });
  el('help-toggle').addEventListener('click', () => {
    const panel = el('help');
    panel.hidden = !panel.hidden;
    helpDismissed = panel.hidden;
    el('help-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });

  show('screen-title');
}

boot();
