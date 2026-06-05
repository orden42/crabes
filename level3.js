import { startLevel } from "./game-core.js";

startLevel({
  levelLabel: "Niveau 3",
  theme: "ice",
  creatureType: "fish",
  freezeCycle: { activeSec: 8, frozenSec: 1 },
  winCrabCount: 12,
  winText: "Bravo, banquise conquise !",
  continueText: "Retour au titre",
  nextLevelUrl: "index.html",
  waveCycleSec: 10,
  crabsPerWaveMin: 4,
  crabsPerWaveMax: 6,
});
