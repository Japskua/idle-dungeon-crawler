import { useCallback, useEffect, useRef, useState } from 'react';
import { app } from '../app/loop';
import { telemetry } from '../app/telemetry';
import { CLASSES } from '../game/content';
import { partySpareCapacity } from '../game/run/runtime';
import type { Hero } from '../game/types';
import { MAX_PIXEL_SCALE, MIN_VIEW_H, MIN_VIEW_W, VIEW_H, VIEW_W } from '../render/renderer';
import { CombatLog } from './CombatLog';
import { HeroVitals } from './components';
import { TacticsEditor } from './TacticsEditor';
import { useUi } from './store';

function TacticSwitch({ hero }: { hero: Hero }) {
  const [editing, setEditing] = useState(false);
  return (
    <span className="row-buttons">
      <select
        value={hero.tactics.activeSetId}
        title="switch tactic set (applies immediately)"
        onChange={(e) => {
          telemetry.bump('tactic_set_switched');
          app.dispatch({ t: 'SWITCH_TACTIC_SET', heroId: hero.id, setId: e.target.value });
        }}
      >
        {hero.tactics.sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn btn-tiny" onClick={() => setEditing(true)} title="edit tactics">
        ⚙
      </button>
      {editing && <TacticsEditor hero={hero} onClose={() => setEditing(false)} />}
    </span>
  );
}

function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvas) app.renderer.attach(canvas);
    else app.renderer.detach();
  }, []);
  const [dims, setDims] = useState({ w: VIEW_W, h: VIEW_H, scale: 1 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const cw = Math.max(64, el.clientWidth);
      const ch = Math.max(64, el.clientHeight);
      // chunkiest integer pixel scale that keeps at least ~20x12 tiles on screen...
      const scale = Math.max(
        1,
        Math.min(MAX_PIXEL_SCALE, Math.floor(Math.min(cw / MIN_VIEW_W, ch / MIN_VIEW_H))),
      );
      // ...then grow the internal canvas so the window is filled edge to edge
      const w = Math.ceil(cw / scale);
      const h = Math.ceil(ch / scale);
      app.renderer.resize(w, h);
      setDims({ w: Math.max(MIN_VIEW_W, w), h: Math.max(MIN_VIEW_H, h), scale });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        style={{ width: dims.w * dims.scale, height: dims.h * dims.scale }}
      />
    </div>
  );
}

export function DungeonScreen() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
  const run = game?.run;
  if (!game || !run) return null;
  const party = run.party;

  return (
    <div className="dungeon-screen">
      <CanvasView />
      <aside className="sidebar">
        <div className="panel">
          <div className="panel-title">Party — Depth {run.depth}</div>
          {party.memberIds.map((id) => {
            const hero = game.roster[id];
            if (!hero) return null;
            const downed = id in party.downed;
            const carrying = party.carrying[id];
            return (
              <div key={id} className={`party-row ${downed ? 'downed' : ''}`}>
                <div className="party-row-head">
                  <b>{hero.name}</b>
                  <span className="muted">
                    {' '}
                    L{hero.level} {CLASSES[hero.classId]?.name}
                  </span>
                  {downed && <span className="tag tag-bad"> DOWN</span>}
                  {carrying && <span className="tag"> carrying {game.roster[carrying]?.name}</span>}
                </div>
                {!downed && <HeroVitals hero={hero} />}
                {!downed && (
                  <div className="row">
                    <span className="muted small">
                      potions: {hero.potions.hp}hp / {hero.potions.mp}mp
                      {hero.bombs > 0 ? ` · 💣 ${hero.bombs}` : ''}
                      {' · '}
                      <span className="gold">{hero.gold}g</span>
                      {hero.satchel.length > 0 ? ` · 🎒${hero.satchel.length}` : ''}
                    </span>
                    <TacticSwitch hero={hero} />
                  </div>
                )}
                {downed && !carrying && (
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => {
                      telemetry.bump('abandon_clicked');
                      app.dispatch({ t: 'ABANDON_HERO', heroId: id });
                    }}
                    title="Leave them behind. 50% they never come back."
                  >
                    Abandon
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="panel">
          <div className="row">
            <span>
              Party purse:{' '}
              <b className="gold">
                {party.memberIds.reduce((sum, id) => sum + (game.roster[id]?.gold ?? 0), 0)}g
              </b>
            </span>
            <span className="muted">
              loot: {party.memberIds.reduce((n, id) => n + (game.roster[id]?.satchel.length ?? 0), 0)}{' '}
              ({(() => {
                const spare = partySpareCapacity(app.state, run);
                return spare <= 2 ? 'bags full!' : `${spare.toFixed(0)}kg spare`;
              })()}
              )
            </span>
          </div>
          <button
            className="btn btn-warn wide"
            disabled={run.intent === 'withdraw'}
            onClick={() => {
              telemetry.noteManualWithdraw();
              app.dispatch({ t: 'WITHDRAW' });
            }}
            title="The party fights only when forced and carries downed friends to the exit."
          >
            {run.intent === 'withdraw' ? 'Withdrawing…' : '⟲ Withdraw'}
          </button>
        </div>
        <div className="panel grow">
          <div className="panel-title">Log</div>
          <CombatLog />
        </div>
      </aside>
    </div>
  );
}
