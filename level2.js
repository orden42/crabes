import { startLevel } from "./game-core.js";

startLevel({
  levelLabel: "Niveau 2",
  creatureType: "shrimp",
  winCrabCount: 15,
  winText: "Bravo, vous avez gagné !",
  continueText: "Retour au titre",
  nextLevelUrl: "index.html",
  waveCycleSec: 5,
  crabsPerWaveMin: 5,
  crabsPerWaveMax: 7,
});
