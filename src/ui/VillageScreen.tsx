/** Village router: the animated scene, or whichever building the player entered. */
import { useUi } from './store';
import { VillageScene } from './village/VillageScene';
import {
  ArmorerView,
  GateView,
  GraveyardView,
  GuildView,
  HallView,
  HospitalView,
  StoreView,
  TavernView,
} from './village/views';

export function VillageScreen() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
  const view = useUi((s) => s.villageView);
  if (!game) return null;
  switch (view) {
    case 'tavern':
      return <TavernView game={game} />;
    case 'armorer':
      return <ArmorerView game={game} />;
    case 'store':
      return <StoreView game={game} />;
    case 'guild':
      return <GuildView game={game} />;
    case 'hall':
      return <HallView game={game} />;
    case 'hospital':
      return <HospitalView game={game} />;
    case 'graveyard':
      return <GraveyardView game={game} />;
    case 'gate':
      return <GateView game={game} />;
    default:
      return <VillageScene />;
  }
}
