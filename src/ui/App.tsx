import { app } from '../app/loop';
import { wipeSave } from '../app/saveManager';
import { exportSave, importSave } from '../game/save/serialize';
import { newGame } from '../game/newGame';
import { DungeonScreen } from './DungeonScreen';
import { VillageScreen } from './VillageScreen';
import { useUi } from './store';

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
  return (
    <div className="speed-controls">
      <button
        className="btn btn-small"
        title="Copy a save string to share or back up"
        onClick={() => {
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
          } catch (e) {
            alert(`Import failed: ${(e as Error).message}`);
          }
        }}
      >
        import
      </button>
      <button
        className="btn btn-small btn-danger"
        onClick={() => {
          if (confirm('Start over? The current save will be erased.')) {
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

export function App() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
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
    </div>
  );
}
