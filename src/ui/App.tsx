import { useState } from 'react';
import { app } from '../app/loop';
import { wipeSave } from '../app/saveManager';
import {
  dismissTelemetryNotice,
  setTelemetryEnabled,
  telemetry,
  telemetryEnabled,
  telemetryNoticeSeen,
} from '../app/telemetry';
import { exportSave, importSave } from '../game/save/serialize';
import { newGame } from '../game/newGame';
import { DUNGEON_EVENTS, INJURIES } from '../game/content';
import { DungeonScreen } from './DungeonScreen';
import { VillageScreen } from './VillageScreen';
import { ClassSprite } from './components';
import { useUi } from './store';

/** the post-run debrief — stays up until acknowledged; goes full obituary on a wipe */
function DebriefModal() {
  const report = useUi((s) => s.debrief);
  if (!report) return null;
  const wiped = report.outcome === 'wiped';
  const seconds = Math.round(report.durationTicks / 10);
  const fallen = report.heroes.filter((h) => h.outcome === 'died');
  return (
    <div className="modal-overlay">
      <div className={`modal panel debrief ${wiped ? 'debrief-wiped' : ''}`}>
        <div className={`debrief-title ${wiped ? 'debrief-title-wiped' : ''}`}>
          {wiped ? '☠ THE PARTY HAS FALLEN' : '🏰 The Party Returns'}
        </div>
        <div className="muted debrief-sub">
          {wiped ? (
            <>
              Everyone was struck down at depth {report.depth}.{' '}
              <b className="req-unmet">{report.goldLost}g</b> was left in the dark
              {fallen.length > 0
                ? ` — and ${fallen.length === 1 ? 'one hero' : `${fallen.length} heroes`} will never come home.`
                : ', but everyone crawled home alive.'}
            </>
          ) : (
            <>
              Back from depth {report.depth} with <b className="gold">{report.goldKept}g</b> and{' '}
              {report.lootCount} piece{report.lootCount === 1 ? '' : 's'} of loot.
            </>
          )}
        </div>

        {report.heroes.map((h) => (
          <div key={h.heroId} className={`debrief-row ${h.outcome === 'died' ? 'debrief-row-dead' : ''}`}>
            <ClassSprite classId={h.classId} scale={3} />
            <div className="debrief-row-body">
              <div>
                <b>{h.name}</b>{' '}
                <span className="muted small">
                  {h.levelAfter > h.levelBefore ? (
                    <span className="gold">
                      L{h.levelBefore} → L{h.levelAfter}
                    </span>
                  ) : (
                    <>L{h.levelBefore}</>
                  )}
                  {' · '}+{h.xpGained} xp · {h.dmgDealt} dmg dealt
                </span>
              </div>
              <div className="small">
                {h.outcome === 'died' && <span className="req-unmet">☠ {h.deathCause ?? 'died'}</span>}
                {h.outcome === 'carried' && (
                  <span className="req-met">🤝 carried to safety by {h.carriedBy ?? 'a friend'}</span>
                )}
                {h.outcome === 'crawled' && <span className="muted">🩸 incapacitated — barely made it home</span>}
                {h.outcome === 'fine' && <span className="muted">made it back on their own two feet</span>}
                {h.carriedOut && <span className="req-met"> · 🏅 carried {h.carriedOut} out</span>}
              </div>
              {h.injuriesGained.length > 0 && (
                <div className="small">
                  {h.injuriesGained.map((iid) => (
                    <span key={iid} className="tag tag-bad" title={INJURIES[iid]?.flavor}>
                      {INJURIES[iid]?.name ?? iid}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="muted small debrief-footer">
          {report.monstersSlain} monsters slain
          {report.bossesSlain.length > 0 ? ` · ${report.bossesSlain.length} boss${report.bossesSlain.length > 1 ? 'es' : ''} felled` : ''}
          {' · '}
          {Math.floor(seconds / 60)}m {seconds % 60}s in the dark
        </div>
        <div className="row modal-footer">
          <button
            className={`btn ${wiped ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => useUi.setState({ debrief: null })}
          >
            {wiped ? 'Mourn and move on' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** an interactive dungeon event — the auto-crawl pauses until you choose (or it auto-picks) */
function EventModal() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
  const pending = game?.run?.pendingEvent;
  if (!pending) return null;
  const ev = DUNGEON_EVENTS[pending.eventId];
  if (!ev) return null;
  return (
    <div className="modal-overlay">
      <div className="modal panel event-modal">
        <div className="debrief-title">✦ {ev.name}</div>
        <p className="event-prompt">{ev.prompt}</p>
        <div className="event-choices">
          {ev.choices.map((c) => (
            <button
              key={c.key}
              className={`btn wide ${c.default ? '' : 'btn-warn'}`}
              onClick={() => app.dispatch({ t: 'EVENT_CHOICE', eventId: ev.id, choiceKey: c.key })}
            >
              {c.label}
              {c.default ? ' (safe)' : ''}
            </button>
          ))}
        </div>
        <p className="muted small">If you don’t choose, the party takes the cautious option on its own.</p>
      </div>
    </div>
  );
}

/** first-steps explainer for brand-new games */
function WelcomeModal() {
  const open = useUi((s) => s.welcome);
  if (!open) return null;
  return (
    <div className="modal-overlay">
      <div className="modal panel welcome">
        <div className="debrief-title">⚔ Welcome, Guildmaster</div>
        <p className="muted">
          Your heroes crawl the dungeon <b>on their own</b> — you run everything above it.
        </p>
        <div className="welcome-list">
          <p>
            🍺 <b>Tavern</b> — hire heroes. Up to <b>4</b> enter the dungeon together; the rest
            rest, recover, or do chores for slow gold.
          </p>
          <p>
            🚪 <b>Dungeon Gate</b> — send the party down. They explore, fight and descend by
            themselves, guided by each hero's <b>tactics</b>: IF→THEN rules you can edit (drink a
            potion below 35% HP, flee from bosses…).
          </p>
          <p>
            ⟲ <b>Withdraw</b> — order a retreat any time. Standing heroes carry fallen friends
            home; the fallen come back <b>injured</b>. Abandoned heroes — or a full party wipe —
            risk <b>permanent death</b>.
          </p>
          <p>
            ⛀ A wipe loses the gold the party carried. <b>XP, items and equipment are never
            lost.</b>
          </p>
          <p>
            🛠 <b>Armorer / Store / Magician's Guild</b> sell gear, supplies and spells. The{' '}
            <b>Hospital</b> patches everyone up. The <b>Graveyard</b> remembers.
          </p>
        </div>
        <p className="muted small">
          The ⏸/1×/2×/4× buttons control time — and the village keeps working while you're away.
        </p>
        <div className="row modal-footer">
          <button className="btn btn-primary" onClick={() => useUi.setState({ welcome: false })}>
            To the village!
          </button>
        </div>
      </div>
    </div>
  );
}

const ABOUT_LINKS = {
  site: 'https://www.janneparkkila.com',
  linkedin: 'https://www.linkedin.com/in/janneparkkila/',
  github: 'https://github.com/Japskua/idle-dungeon-crawler',
};

/** about / credits — author, links, and the open-source libraries used */
function AboutModal() {
  const open = useUi((s) => s.about);
  if (!open) return null;
  const close = () => useUi.setState({ about: false });
  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal panel about" onClick={(e) => e.stopPropagation()}>
        <div className="debrief-title">ⓘ About</div>
        <p>
          <b>Idle Dungeon Crawler</b> — an idle RPG: you command a party of pixel-art heroes, and they
          crawl an endless procedurally generated dungeon on their own.
        </p>
        <p className="muted">
          Made by{' '}
          <a href={ABOUT_LINKS.site} target="_blank" rel="noreferrer noopener">
            Janne Parkkila
          </a>
          .
        </p>
        <div className="about-links">
          <a className="btn btn-small" href={ABOUT_LINKS.site} target="_blank" rel="noreferrer noopener">
            🌐 janneparkkila.com
          </a>
          <a className="btn btn-small" href={ABOUT_LINKS.linkedin} target="_blank" rel="noreferrer noopener">
            💼 LinkedIn
          </a>
          <a className="btn btn-small" href={ABOUT_LINKS.github} target="_blank" rel="noreferrer noopener">
            ⌨ GitHub
          </a>
        </div>
        <div className="about-section">
          <div className="about-h">Built with</div>
          <ul className="about-libs">
            <li>
              React 19 <span className="muted small">— UI · MIT</span>
            </li>
            <li>
              Zustand <span className="muted small">— state · MIT</span>
            </li>
            <li>
              Bun <span className="muted small">— runtime, bundler &amp; test runner · MIT</span>
            </li>
            <li>
              TypeScript <span className="muted small">— Apache-2.0</span>
            </li>
            <li>Canvas 2D + hand-authored pixel art</li>
            <li>
              Cloudflare Pages <span className="muted small">— hosting (+ D1 for anonymous stats)</span>
            </li>
          </ul>
        </div>
        <p className="muted small">All code, content and pixel art are original. © 2026 Janne Parkkila.</p>
        <div className="row modal-footer">
          <button className="btn btn-primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** one-time heads-up that anonymous stats are collected (opt-out right there) */
function TelemetryNotice() {
  const [seen, setSeen] = useState(telemetryNoticeSeen());
  if (seen) return null;
  return (
    <div className="telemetry-notice">
      <span>
        📊 Anonymous gameplay statistics (runs, depths, class picks — never anything personal) are
        collected to help improve the game.
      </span>
      <span className="row-buttons">
        <button
          className="btn btn-tiny"
          onClick={() => {
            setTelemetryEnabled(false);
            dismissTelemetryNotice();
            setSeen(true);
          }}
        >
          turn off
        </button>
        <button
          className="btn btn-tiny btn-primary"
          onClick={() => {
            dismissTelemetryNotice();
            setSeen(true);
          }}
        >
          OK
        </button>
      </span>
    </div>
  );
}

function SpeedControls() {
  const speed = useUi((s) => s.speed);
  return (
    <div className="speed-controls">
      {[0, 1, 2, 4].map((s) => (
        <button
          key={s}
          className={`btn btn-small ${speed === s ? 'active' : ''}`}
          onClick={() => app.setSpeed(s)}
        >
          {s === 0 ? '⏸' : `${s}×`}
        </button>
      ))}
    </div>
  );
}

function SaveMenu() {
  const [statsOn, setStatsOn] = useState(telemetryEnabled());
  return (
    <div className="speed-controls">
      <button
        className="btn btn-small"
        title="Copy a save string to share or back up"
        onClick={() => {
          telemetry.bump('save_exported');
          const text = exportSave(app.state);
          navigator.clipboard?.writeText(text).catch(() => {});
          prompt('Your save string (copied to clipboard):', text);
        }}
      >
        export
      </button>
      <button
        className="btn btn-small"
        onClick={() => {
          const text = prompt('Paste a save string:');
          if (!text) return;
          try {
            app.replaceState(importSave(text));
            telemetry.bump('save_imported');
          } catch (e) {
            alert(`Import failed: ${(e as Error).message}`);
          }
        }}
      >
        import
      </button>
      <button
        className="btn btn-small"
        title={statsOn ? 'Anonymous gameplay statistics: ON (click to turn off)' : 'Anonymous gameplay statistics: OFF (click to turn on)'}
        onClick={() => {
          setTelemetryEnabled(!statsOn);
          setStatsOn(!statsOn);
        }}
      >
        stats: {statsOn ? 'on' : 'off'}
      </button>
      <button
        className="btn btn-small btn-danger"
        onClick={() => {
          if (confirm('Start over? The current save will be erased.')) {
            telemetry.track('reset', {
              depth: app.state.progress.maxDepthReached,
              value: app.state.rosterOrder.length,
              payload: { wipes: app.state.progress.totalWipes, permadeaths: app.state.progress.totalPermadeaths },
            });
            telemetry.markNewGame();
            telemetry.track('new_game');
            wipeSave();
            app.replaceState(newGame((Math.random() * 4294967296) >>> 0, Date.now()));
            useUi.setState({ welcome: true });
          }
        }}
      >
        new game
      </button>
    </div>
  );
}

export function App() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
  const locked = useUi((s) => s.lockedByOtherTab);
  if (locked) {
    return (
      <div className="boot">
        <h2>⚠ The game is open in another tab</h2>
        <p className="muted">This tab has been frozen so your save stays safe. Close it or the other one.</p>
      </div>
    );
  }
  if (!game) return <div className="boot">Lighting the torches…</div>;
  const inDungeon = game.mode === 'dungeon' && game.run;
  return (
    <div className="app">
      <header className="topbar">
        <span className="title">IDLE DUNGEON CRAWLER</span>
        <button
          className="btn btn-tiny about-btn"
          title="About, credits & links"
          aria-label="About"
          onClick={() => useUi.setState({ about: true })}
        >
          ⓘ
        </button>
        <span className="gold">⛀ {game.village.gold}g</span>
        {(() => {
          const purse = game.rosterOrder.reduce((sum, id) => sum + (game.roster[id]?.gold ?? 0), 0);
          return purse > 0 ? <span className="muted small">+ {purse}g in purses</span> : null;
        })()}
        <span className="muted">
          depth best: {game.progress.maxDepthReached} · heroes: {game.rosterOrder.length}
        </span>
        <span className="spacer" />
        <SpeedControls />
        <SaveMenu />
      </header>
      {inDungeon ? <DungeonScreen /> : <VillageScreen />}
      <DebriefModal />
      <WelcomeModal />
      <EventModal />
      <AboutModal />
      <TelemetryNotice />
    </div>
  );
}
