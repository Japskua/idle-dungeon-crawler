import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { app } from './app/loop';
import { loadGame } from './app/saveManager';
import { newGame } from './game/newGame';

const state = loadGame() ?? newGame((Math.random() * 4294967296) >>> 0, Date.now());
app.boot(state);

createRoot(document.getElementById('root')!).render(<App />);
