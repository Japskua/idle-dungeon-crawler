import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { app } from './app/loop';
import { loadGame } from './app/saveManager';
import { newGame } from './game/newGame';
import { applyOfflineCatchUp } from './game/village/offline';
import { telemetry } from './app/telemetry';
import { useUi } from './ui/store';

// only one tab may own the save
const channel = new BroadcastChannel('idle-dungeon-crawler');
channel.onmessage = (e) => {
  if (e.data === 'hello') channel.postMessage('occupied');
  if (e.data === 'occupied') {
    useUi.setState({ lockedByOtherTab: true });
    app.halt();
  }
};
channel.postMessage('hello');

const loaded = loadGame();
const state = loaded ?? newGame((Math.random() * 4294967296) >>> 0, Date.now());
if (loaded) {
  const report = applyOfflineCatchUp(state, Date.now());
  if (report) useUi.setState({ offlineReport: report });
} else {
  telemetry.markNewGame();
  useUi.setState({ welcome: true });
}
app.boot(state);

createRoot(document.getElementById('root')!).render(<App />);
