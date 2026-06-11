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
import { INJURIES } from '../game/content';
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
            <ClassSprite classId={h.classId} scale={2} />
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
          }
        }}
      >
        new game
      </button>
    </div>
  );
}

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function OfflineModal() {
  const report = useUi((s) => s.offlineReport);
  if (!report) return null;
  return (
    <div className="modal-overlay">
      <div className="modal panel">
        <div className="panel-title">⛺ Welcome back!</div>
        <p>
          You were away for <b>{fmtDuration(report.awayMs)}</b>
          {report.capped && <span className="muted"> (village work counts up to 12h)</span>}.
        </p>
        {report.goldEarned > 0 && (
          <p>
            The chores brought in <b className="gold">{report.goldEarned}g</b>.
          </p>
        )}
        {report.goldEarned < 0 && (
          <p>
            The training yard charged <b className="gold">{-report.goldEarned}g</b> for its services.
          </p>
        )}
        {report.heroes.map((h) => (
          <div key={h.name} className="small">
            • {h.name}
            {h.xpGained > 0 && <> earned {h.xpGained} xp</>}
            {h.levelsGained > 0 && (
              <b className="gold"> (+{h.levelsGained} level{h.levelsGained > 1 ? 's' : ''}!)</b>
            )}
            {h.recovered && <span className="muted"> — fully recovered</span>}
          </div>
        ))}
        {report.goldEarned === 0 && report.heroes.length === 0 && (
          <p className="muted">Nothing much happened. The village enjoyed the quiet.</p>
        )}
        <div className="row modal-footer">
          <button className="btn btn-primary" onClick={() => useUi.setState({ offlineReport: null })}>
            Continue
          </button>
        </div>
      </div>
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
        <span className="gold">⛀ {game.village.gold}g</span>
        <span className="muted">
          depth best: {game.progress.maxDepthReached} · heroes: {game.rosterOrder.length}
        </span>
        <span className="spacer" />
        <SpeedControls />
        <SaveMenu />
      </header>
      {inDungeon ? <DungeonScreen /> : <VillageScreen />}
      <OfflineModal />
      <DebriefModal />
      <TelemetryNotice />
    </div>
  );
}
