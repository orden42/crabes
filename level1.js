import { startLevel } from "./game-core.js";

startLevel({
  levelLabel: "Niveau 1",
  winCrabCount: 10,
  winText: "Niveau 1 terminé !",
  continueText: "Passer au niveau 2",
  nextLevelUrl: "level2.html",
  waveCycleSec: 7,
  crabsPerWaveMin: 4,
  crabsPerWaveMax: 5,
});
