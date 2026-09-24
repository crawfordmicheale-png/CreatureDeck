/**
 * CreatureDeck — browser front-end.
 *
 * The rules live entirely in `src/`; this file only draws them and collects
 * clicks. It drives a battle through the engine's interactive generator:
 * `next(instanceId)` deploys a card, `next(null)` ends the turn, and the
 * events that come back are animated a frame at a time.
 */

import { GREEDY_CONTROLLER, VALUE_CONTROLLER } from '../src/battle/controllers.ts';
import { playBattle } from '../src/battle/engine.ts';
import type { BattlePlayerSetup } from '../src/battle/engine.ts';
import type {
  BattleEvent,
  BattleResult,
  BattleSnapshot,
  BattleStep,
  CombatantSnapshot,
  DeploymentReply,
  ResolvedCardSnapshot,
} from '../src/battle/types.ts';
import { STANDARD_LIBRARY } from '../src/content/index.ts';
import type { CardInstance } from '../src/core/cardInstance.ts';
import { nextPowerTier, powerTierProfile } from '../src/core/powerTier.ts';
import { rarityProfile } from '../src/core/rarity.ts';
import { STAT_KEYS, STAT_LABELS } from '../src/core/stats.ts';
import type { StatKey } from '../src/core/stats.ts';
import { Collection } from '../src/game/collection.ts';
import { applyXpAwards, computeXpAwards } from '../src/game/rewards.ts';

const library = STANDARD_LIBRARY;

// ------------------------------------------------------------------- stages

interface Stage {
  readonly name: string;
  readonly blurb: string;
  /** [definitionId, level, focus] */
  readonly deck: ReadonlyArray<readonly [string, number, readonly StatKey[]]>;
  readonly clever: boolean;
}

const MIGHT: readonly StatKey[] = ['might'];
const BRUISER: readonly StatKey[] = ['might', 'vitality'];
const TANK: readonly StatKey[] = ['vitality', 'guard'];
const SWIFT: readonly StatKey[] = ['speed', 'might'];

const STAGES: readonly Stage[] = [
  {
    name: 'The Scavenger Warren',
    blurb: 'Vermin, fresh out of the dirt. Nothing here has ever been levelled.',
    clever: false,
    deck: [
      ['dusk-mite', 1, SWIFT], ['dusk-mite', 1, SWIFT], ['thicket-hare', 1, SWIFT],
      ['thicket-hare', 1, SWIFT], ['pebble-grub', 1, TANK], ['pebble-grub', 1, TANK],
      ['scrapfang-pup', 1, MIGHT], ['scrapfang-pup', 1, MIGHT], ['gale-sprite', 1, TANK],
      ['tide-minnow', 1, BRUISER], ['ember-whelp', 1, MIGHT], ['ember-whelp', 1, MIGHT],
    ],
  },
  {
    name: 'Brackwater Raiders',
    blurb: 'Blooded a few times. Their commons have started to promote.',
    clever: false,
    deck: [
      ['tide-minnow', 5, BRUISER], ['tide-minnow', 5, BRUISER], ['reef-sentinel', 4, TANK],
      ['grave-moth', 5, SWIFT], ['grave-moth', 5, SWIFT], ['dusk-mite', 6, SWIFT],
      ['scrapfang-pup', 6, MIGHT], ['ember-whelp', 6, MIGHT], ['pebble-grub', 6, TANK],
      ['thicket-hare', 6, SWIFT], ['gale-sprite', 5, TANK], ['cinder-imp', 4, SWIFT],
    ],
  },
  {
    name: 'The Ashen Kennel',
    blurb: 'Every beast here is maxed. Cheap cards, taken as far as they go.',
    clever: true,
    deck: [
      ['ashfang-jackal', 11, MIGHT], ['ashfang-jackal', 11, MIGHT], ['cinder-imp', 11, SWIFT],
      ['cinder-imp', 11, SWIFT], ['bramble-warden', 10, TANK], ['reef-sentinel', 10, TANK],
      ['grave-moth', 10, SWIFT], ['ember-whelp', 10, MIGHT], ['scrapfang-pup', 10, BRUISER],
      ['thicket-hare', 10, SWIFT], ['pebble-grub', 10, TANK], ['dusk-mite', 10, SWIFT],
    ],
  },
  {
    name: 'The Gilded Menagerie',
    blurb: 'Rares and epics, straight out of the packs. Rarity with nothing behind it.',
    clever: true,
    deck: [
      ['stormcaller-roc', 1, MIGHT], ['stormcaller-roc', 1, MIGHT], ['magma-colossus', 1, TANK],
      ['abyssal-serpent', 1, BRUISER], ['abyssal-serpent', 1, BRUISER], ['verdant-matriarch', 1, TANK],
      ['nightmare-stalker', 1, MIGHT], ['nightmare-stalker', 1, MIGHT], ['pyreclaw-tyrant', 1, MIGHT],
      ['glacierheart-titan', 1, TANK], ['void-harbinger', 1, BRUISER], ['skyfather-drake', 1, BRUISER],
    ],
  },
  {
    name: 'The Hollow Crown',
    blurb: 'Levelled rares behind a mythic. This is what the whole system builds toward.',
    clever: true,
    deck: [
      ['thanatos-hollow-crown', 10, MIGHT], ['nightmare-stalker', 14, MIGHT],
      ['abyssal-serpent', 13, BRUISER], ['magma-colossus', 12, TANK],
      ['stormcaller-roc', 12, SWIFT], ['verdant-matriarch', 11, TANK],
      ['ember-whelp', 1, MIGHT], ['thicket-hare', 1, SWIFT], ['dusk-mite', 1, SWIFT],
      ['pebble-grub', 1, TANK], ['gale-sprite', 1, TANK], ['tide-minnow', 1, BRUISER],
    ],
  },
];

/** The roster the player starts a run with: twelve unlevelled cards. */
const STARTER: ReadonlyArray<readonly [string, string]> = [
  ['ember-whelp', 'Cinderbite'],
  ['ember-whelp', 'Scorch'],
  ['scrapfang-pup', 'Gnash'],
  ['thicket-hare', 'Flicker'],
  ['pebble-grub', 'Old Scar'],
  ['tide-minnow', 'Brine'],
  ['dusk-mite', 'Whisper'],
  ['gale-sprite', 'Zephyr'],
  ['ashfang-jackal', 'Ashfang'],
  ['cinder-imp', 'Ember'],
  ['reef-sentinel', 'Bulwark'],
  ['bramble-warden', 'Thistle'],
];

// -------------------------------------------------------------------- state

interface RunState {
  stage: number;
  collection: Collection;
  deckIds: string[];
  wins: number;
}

let run: RunState | null = null;
let battle: Generator<BattleStep, BattleResult, DeploymentReply> | null = null;
let awaiting = false;
let fast = false;

/** Board as the animation currently believes it to be, between snapshots. */
let live: BattleSnapshot | null = null;
let lastStep: Extract<BattleStep, { kind: 'deployment' }> | null = null;

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function show(screen: string): void {
  for (const node of Array.from(document.querySelectorAll('.screen'))) {
    node.classList.toggle('on', node.id === screen);
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ helpers

function tierColor(tier: string): string {
  return `var(--tier-${tier})`;
}

function rarityColor(rarity: string): string {
  return `var(--rarity-${rarity})`;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function newRun(): RunState {
  const collection = new Collection(library);
  const deckIds = STARTER.map(([definitionId, nickname]) =>
    collection.add(definitionId, { nickname }).instanceId,
  );
  return { stage: 0, collection, deckIds, wins: 0 };
}

function opponentDeck(stage: Stage): { setup: BattlePlayerSetup } {
  const foe = new Collection(library);
  const ids = stage.deck.map(([definitionId, level, focus]) => {
    const instance = foe.add(definitionId, { level });
    foe.autoAllocate(instance.instanceId, focus);
    return instance.instanceId;
  });
  return {
    setup: {
      id: 'p2',
      name: stage.name,
      deck: foe.deckInstances(ids),
      controller: stage.clever ? VALUE_CONTROLLER : GREEDY_CONTROLLER,
    },
  };
}

// ------------------------------------------------------------------- battle

function startBattle(): void {
  const state = run;
  if (!state) return;
  const stage = STAGES[state.stage] as Stage;

  el('stage-name').textContent = stage.name;
  el('stage-count').textContent = `Battle ${state.stage + 1} of ${STAGES.length}`;
  el('log').innerHTML = '';

  const mine: BattlePlayerSetup = {
    id: 'p1',
    name: 'Your warband',
    deck: state.collection.deckInstances(state.deckIds),
    controller: GREEDY_CONTROLLER,
  };

  battle = playBattle([mine, opponentDeck(stage).setup], library, ['p1'], {
    seed: 1000 + state.stage * 977,
  });

  show('screen-battle');
  advance(undefined);
}

function advance(reply: DeploymentReply): void {
  if (!battle) return;
  awaiting = false;
  renderControls();

  const next = battle.next(reply);

  if (next.done) {
    finishBattle(next.value);
    return;
  }

  const step = next.value;
  live = step.snapshot;

  playEvents(step.events, () => {
    live = step.snapshot;
    if (step.kind === 'deployment') {
      lastStep = step;
      awaiting = true;
      render();
    } else {
      render();
      advance(undefined);
    }
  });
}

const DELAYS: Partial<Record<BattleEvent['type'], number>> = {
  'round-start': 340,
  deploy: 300,
  attack: 200,
  damage: 230,
  dodge: 260,
  death: 430,
  heal: 240,
  ability: 300,
  'nexus-damage': 380,
  revive: 500,
  fatigue: 300,
};

/** Walks the event list, mutating the local board so the fight can be watched. */
function playEvents(events: readonly BattleEvent[], done: () => void): void {
  let i = 0;

  const tick = (): void => {
    if (i >= events.length) {
      done();
      return;
    }
    const event = events[i] as BattleEvent;
    i += 1;

    logEvent(event);
    const delay = DELAYS[event.type];

    if (delay === undefined) {
      tick();
      return;
    }

    applyEvent(event);
    render();
    window.setTimeout(tick, fast ? Math.min(60, delay / 4) : delay);
  };

  tick();
}

function findUnit(uid: string | undefined): CombatantSnapshot | null {
  if (!uid || !live) return null;
  for (const player of live.players) {
    for (const slot of player.board) if (slot && slot.uid === uid) return slot;
  }
  return null;
}

/**
 * Applies one event to the local picture. The authoritative snapshot lands
 * at the end of the step, so small drift here is corrected automatically.
 */
function applyEvent(event: BattleEvent): void {
  if (!live) return;

  if (event.type === 'damage' && event.targetUid) {
    const unit = findUnit(event.targetUid) as { health: number; shield: number } | null;
    if (unit) {
      const absorbed = Math.min(unit.shield, event.amount ?? 0);
      unit.shield -= absorbed;
      unit.health = Math.max(0, unit.health - ((event.amount ?? 0) - absorbed));
    }
    flash(event.targetUid, 'struck');
    float(event.targetUid, `-${event.amount ?? 0}`, 'dmg');
  } else if (event.type === 'heal' && event.actorUid) {
    const unit = findUnit(event.actorUid) as { health: number; maxHealth: number } | null;
    if (unit) unit.health = Math.min(unit.maxHealth, unit.health + (event.amount ?? 0));
    float(event.actorUid, `+${event.amount ?? 0}`, 'heal');
  } else if (event.type === 'dodge' && event.targetUid) {
    float(event.targetUid, 'miss', 'miss');
  } else if (event.type === 'attack' && event.actorUid) {
    flash(event.actorUid, 'swing');
  } else if (event.type === 'death' && event.targetUid) {
    const unit = findUnit(event.targetUid) as { alive: boolean } | null;
    if (unit) unit.alive = false;
    flash(event.targetUid, 'dying');
  } else if (event.type === 'nexus-damage' && event.playerId) {
    const player = live.players.find((p) => p.id === event.playerId) as
      | { nexusHealth: number }
      | undefined;
    if (player) player.nexusHealth = Math.max(0, player.nexusHealth - (event.amount ?? 0));
  }
}

const pendingFlash = new Map<string, string>();
const pendingFloat: { uid: string; text: string; kind: string }[] = [];

function flash(uid: string, kind: string): void {
  pendingFlash.set(uid, kind);
}
function float(uid: string, text: string, kind: string): void {
  pendingFloat.push({ uid, text, kind });
}

function logEvent(event: BattleEvent): void {
  if (event.type === 'draw' || event.type === 'battle-start') return;
  const log = el('log');
  const line = document.createElement('p');
  line.className = `ev-${event.type}`;
  line.textContent = event.message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ------------------------------------------------------------------ drawing

function unitHtml(unit: CombatantSnapshot | null): string {
  if (!unit) return '<div class="slot"></div>';

  const pct = Math.max(0, Math.round((unit.health / Math.max(1, unit.maxHealth)) * 100));
  const hurt = unit.health * 2 <= unit.maxHealth ? ' hurt' : '';
  const sick = unit.justDeployed ? ' sick' : '';
  const extra = pendingFlash.get(unit.uid);
  pendingFlash.delete(unit.uid);

  const marks: string[] = [];
  if (unit.shield > 0) marks.push(`<span class="chip shd">+${unit.shield}</span>`);
  if (unit.poison > 0) marks.push(`<span class="chip psn">psn ${unit.poison}</span>`);

  return `
    <div class="unit${hurt}${sick}${extra ? ' ' + extra : ''}"
         data-uid="${esc(unit.uid)}"
         style="border-top-color:${tierColor(unit.tier)}"
         title="${esc(unit.name)} — L${unit.level} ${unit.tierLabel}${
           unit.abilities.length ? ' · ' + esc(unit.abilities.join(', ')) : ''
         }">
      <div class="nm">${esc(unit.name)}</div>
      <div class="lv">L${unit.level} ${esc(unit.tierLabel)}</div>
      <div class="fill"></div>
      <div class="marks">${marks.join('')}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row">
        <span class="mt">${unit.might}</span>
        <span class="hp">${unit.health}/${unit.maxHealth}</span>
      </div>
    </div>`;
}

function cardHtml(card: ResolvedCardSnapshot, affordable: boolean): string {
  const ability = card.abilities[0];
  return `
    <button class="card${affordable ? ' playable' : ''}"
            data-play="${esc(card.instanceId)}" ${affordable ? '' : 'disabled'}
            style="border-top-color:${tierColor(card.tier)}">
      <span class="cost num">${card.deployCost}</span>
      <span class="nm">${esc(card.name)}</span>
      <span class="meta" style="color:${rarityColor(card.rarity)}">${esc(
        card.rarityLabel,
      )} · ${esc(card.tierLabel)} · L${card.level}</span>
      <span class="stats"><span>${card.might} mt</span><span>${card.vitality} hp</span><span>${
        card.guard
      } gd</span></span>
      <span class="abil">${ability ? esc(ability.name) : '&nbsp;'}</span>
    </button>`;
}

function render(): void {
  if (!live) return;
  const [me, foe] = live.players;

  el('foe-board').innerHTML = foe.board.map(unitHtml).join('');
  el('you-board').innerHTML = me.board.map(unitHtml).join('');

  renderNexus('foe', foe.nexusHealth, foe.maxNexusHealth);
  renderNexus('you', me.nexusHealth, me.maxNexusHealth);

  el('round-no').textContent = `Round ${live.round}`;

  const energy = lastStep && awaiting ? lastStep.energy : me.energy;
  const pips: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    pips.push(`<span class="e${i < energy ? ' on' : ''}"></span>`);
  }
  el('energy-pips').innerHTML = pips.join('');
  el('energy-num').textContent = String(energy);

  const playableIds = new Set((lastStep?.playable ?? []).map((card) => card.instanceId));
  el('hand').innerHTML = me.hand
    .map((card) => cardHtml(card, awaiting && playableIds.has(card.instanceId)))
    .join('');

  for (const item of pendingFloat.splice(0)) {
    const node = document.querySelector(`[data-uid="${CSS.escape(item.uid)}"]`);
    if (!node) continue;
    const span = document.createElement('span');
    span.className = `float ${item.kind}`;
    span.textContent = item.text;
    node.appendChild(span);
    window.setTimeout(() => span.remove(), 950);
  }

  renderControls();
}

function renderNexus(side: string, health: number, max: number): void {
  el(`${side}-hp`).textContent = String(health);
  el(`${side}-bar`).style.width = `${Math.max(0, (health / Math.max(1, max)) * 100)}%`;
  el(`${side}-nexus`).classList.toggle('hit', health * 3 <= max);
}

function renderControls(): void {
  const endTurn = el<HTMLButtonElement>('end-turn');
  endTurn.disabled = !awaiting;
  endTurn.textContent = awaiting ? 'End turn' : 'Resolving…';
}

// ------------------------------------------------------- post-battle growth

let pendingAwards: { instanceId: string; before: string }[] = [];

function finishBattle(result: BattleResult): void {
  const state = run;
  if (!state) return;

  const won = result.winner === 'p1';
  if (won) state.wins += 1;

  const before = new Map<string, string>();
  for (const id of state.deckIds) before.set(id, state.collection.resolve(id).powerTier);

  applyXpAwards(state.collection, computeXpAwards(result, 'p1'));
  pendingAwards = state.deckIds.map((id) => ({
    instanceId: id,
    before: before.get(id) ?? 'weak',
  }));

  battle = null;
  awaiting = false;

  if (!won) {
    showOutcome(false, result);
    return;
  }

  state.stage += 1;
  if (state.stage >= STAGES.length) {
    showOutcome(true, result);
    return;
  }

  showLevelUp(result);
}

function showLevelUp(result: BattleResult): void {
  const state = run;
  if (!state) return;
  const next = STAGES[state.stage] as Stage;

  el('levelup-head').textContent = `${STAGES[state.stage - 1]?.name ?? ''} defeated`;
  el('levelup-sub').textContent =
    `${result.rounds} rounds. Your survivors earned XP — spend their growth points, then face ${next.name}.`;
  el('next-name').textContent = next.name;
  el('next-blurb').textContent = next.blurb;

  renderRoster();
  show('screen-levelup');
}

function totalUnspent(): number {
  const state = run;
  if (!state) return 0;
  return state.deckIds.reduce(
    (sum, id) => sum + state.collection.resolve(id).pointsUnspent,
    0,
  );
}

function renderRoster(): void {
  const state = run;
  if (!state) return;

  const rows = state.deckIds.map((id) => {
    const card = state.collection.resolve(id);
    const was = pendingAwards.find((a) => a.instanceId === id)?.before;
    const promoted = was !== undefined && was !== card.powerTier;
    const profile = powerTierProfile(card.powerTier);
    const rarity = rarityProfile(card.definition.rarity);

    const toNext = card.scoreToNextTier;
    const above = nextPowerTier(card.powerTier);
    const bandStart = profile.minScore;
    const bandEnd = above === null ? card.powerScore : powerTierProfile(above).minScore;
    const pct =
      toNext === null
        ? 100
        : Math.max(
            2,
            Math.min(100, ((card.powerScore - bandStart) / Math.max(1, bandEnd - bandStart)) * 100),
          );

    const stats = STAT_KEYS.map((key) => {
      const spent = card.instance.allocation[key];
      return `
        <div class="stat">
          <span class="k">${STAT_LABELS[key].slice(0, 3)}</span>
          <span class="v">${card.stats[key]}${
            spent > 0 ? ` <span class="plus">+${spent}</span>` : ''
          }</span>
          <span class="btns">
            <button data-minus="${esc(id)}" data-stat="${key}" ${
              spent <= 0 ? 'disabled' : ''
            } aria-label="Remove a point from ${STAT_LABELS[key]}">−</button>
            <button data-plus="${esc(id)}" data-stat="${key}" ${
              card.pointsUnspent <= 0 ? 'disabled' : ''
            } aria-label="Add a point to ${STAT_LABELS[key]}">+</button>
          </span>
        </div>`;
    }).join('');

    return `
      <div class="entry${card.pointsUnspent > 0 ? ' fresh' : ''}"
           style="border-left-color:${tierColor(card.powerTier)}">
        <div class="who">
          <span class="nm">${esc(card.displayName)}</span>
          <span class="tags">
            <span class="badge" style="color:${rarityColor(card.definition.rarity)}">${esc(
              rarity.label,
            )}</span>
            <span class="badge" style="color:${tierColor(card.powerTier)}">${esc(
              profile.label,
            )}</span>
            <span class="num" style="color:var(--ink-faint)">L${card.level}${
              card.isMaxLevel ? ' max' : ''
            } · cost ${card.deployCost} · score ${card.powerScore}</span>
            ${promoted ? `<span class="promo">Promoted</span>` : ''}
          </span>
          <span class="tiermeter">
            <span class="track"><i style="width:${pct}%;background:${tierColor(
              card.powerTier,
            )}"></i></span>
            <small>${
              toNext === null || above === null
                ? 'Top tier reached.'
                : `${toNext} power score to ${esc(powerTierProfile(above).label)}`
            }${
              card.pointsUnspent > 0
                ? ` · <b style="color:var(--you)">${card.pointsUnspent} point${
                    card.pointsUnspent === 1 ? '' : 's'
                  } to spend</b>`
                : ''
            }</small>
          </span>
        </div>
        <div class="alloc">${stats}</div>
      </div>`;
  });

  el('roster').innerHTML = rows.join('');

  const left = totalUnspent();
  el('points-left').textContent = left === 0 ? 'All points spent' : `${left} growth points unspent`;
  el('points-left').style.color = left > 0 ? 'var(--you)' : 'var(--ink-dim)';
}

// ------------------------------------------------------------------ outcome

function showOutcome(victory: boolean, result: BattleResult): void {
  const state = run;
  if (!state) return;

  el('outcome-title').textContent = victory ? 'The Hollow Crown falls' : 'Your warband is broken';
  el('outcome-sub').textContent = victory
    ? `You took all ${STAGES.length} battles. Every card below started identical to the one beside it.`
    : `You won ${state.wins} of ${STAGES.length}. The run ends here — but the cards remember.`;

  const rows = state.deckIds
    .map((id) => state.collection.resolve(id))
    .sort((a, b) => b.powerScore - a.powerScore)
    .map(
      (card) => `
        <div class="r">
          <span>${esc(card.displayName)}
            <span class="num" style="color:${tierColor(card.powerTier)}"> ${esc(
              card.tier.label,
            )}</span>
          </span>
          <span>L${card.level} · ${card.stats.might}/${card.stats.vitality} · score ${
            card.powerScore
          }</span>
        </div>`,
    );

  el('tally').innerHTML = rows.join('');
  el('outcome-rounds').textContent = `Final battle lasted ${result.rounds} rounds.`;
  show('screen-end');
}

// -------------------------------------------------------------------- wiring

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest('[data-play],[data-plus],[data-minus]');
  if (!(target instanceof HTMLElement)) return;

  const play = target.getAttribute('data-play');
  if (play && awaiting) {
    advance(play);
    return;
  }

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
    // Over- or under-spending is already prevented by the disabled state;
    // if it slips through, ignore it rather than breaking the screen.
    return;
  }
  renderRoster();
}

function boot(): void {
  document.addEventListener('click', onClick);

  el('begin').addEventListener('click', () => {
    run = newRun();
    startBattle();
  });
  el('end-turn').addEventListener('click', () => {
    if (awaiting) advance(null);
  });
  el('next-battle').addEventListener('click', startBattle);
  el('again').addEventListener('click', () => {
    run = newRun();
    startBattle();
  });
  el('fast').addEventListener('click', () => {
    fast = !fast;
    el('fast').textContent = fast ? 'Speed: fast' : 'Speed: normal';
  });

  show('screen-title');
}

boot();
