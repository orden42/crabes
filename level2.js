import { startLevel } from "./game-core.js";

startLevel({
  levelLabel: "Niveau 2",
  creatureType: "shrimp",
  rockObstacles: {
    clusterCount: 5,
    minClusterSize: 3,
    maxClusterSize: 6,
  },
  rockCreaturePenalty: 0.5,
  winCrabCount: 15,
  winText: "Niveau 2 terminé !",
  continueText: "Passer au niveau 3",
  nextLevelUrl: "level3.html",
  waveCycleSec: 5,
  crabsPerWaveMin: 5,
  crabsPerWaveMax: 7,
});
