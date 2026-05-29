const BGM_URL = "./iletaitpetitnavire.mid";
const WAVES_URL = "./vagues.mp3";
const TING_URL = "./ting.mp3";
const GAME_OVER_URL = "./game-over.mp3";
const SOUNDFONT_URL =
  "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";

let ready = false;
let started = false;
let wavesStarted = false;
let wavesAudio;
let tingAudio;
let gameOverAudio;

function getMIDI() {
  return typeof window !== "undefined" ? window.MIDI : undefined;
}

function setupLoop(MIDI) {
  let restarting = false;
  MIDI.Player.setAnimation((data) => {
    if (!started || restarting || data.end <= 0) return;
    if (data.now >= data.end - 0.15) {
      restarting = true;
      MIDI.Player.stop();
      MIDI.Player.currentTime = 0;
      MIDI.Player.restart = 0;
      MIDI.Player.start();
      restarting = false;
    }
  });
}

function initWaveAmbience() {
  wavesAudio = new Audio(WAVES_URL);
  wavesAudio.loop = true;
  wavesAudio.volume = 0.35;
  wavesAudio.preload = "auto";
}

function initTingSound() {
  tingAudio = new Audio(TING_URL);
  tingAudio.volume = 0.35;
  tingAudio.preload = "auto";
}

function initGameOverSound() {
  gameOverAudio = new Audio(GAME_OVER_URL);
  gameOverAudio.volume = 0.7;
  gameOverAudio.preload = "auto";
}

export function playGameOverSound() {
  if (!gameOverAudio) return;
  gameOverAudio.currentTime = 0;
  gameOverAudio.play().catch((err) => console.warn("Game-over sound could not play:", err));
}

export function playTingSound() {
  if (!tingAudio) return;
  tingAudio.currentTime = 0;
  tingAudio.play().catch((err) => console.warn("Ting sound could not play:", err));
}

function tryStartWaveAmbience() {
  if (!wavesAudio || wavesStarted) return;
  wavesStarted = true;
  wavesAudio.play().catch((err) => {
    wavesStarted = false;
    console.warn("Wave ambience could not start:", err);
  });
}

export function initBackgroundMusic() {
  initWaveAmbience();
  initTingSound();
  initGameOverSound();

  const MIDI = getMIDI();
  if (!MIDI) {
    console.warn("MIDI.js is not loaded");
    return;
  }

  MIDI.loadPlugin({
    soundfontUrl: SOUNDFONT_URL,
    instrument: "acoustic_grand_piano",
    onsuccess() {
      MIDI.Player.loadFile(
        BGM_URL,
        () => {
          ready = true;
          setupLoop(MIDI);
        },
        null,
        (err) => console.error("Failed to load background MIDI:", err),
      );
    },
  });
}

export function tryStartBackgroundMusic() {
  tryStartWaveAmbience();

  const MIDI = getMIDI();
  if (!MIDI || started || !ready) return false;

  started = true;
  for (let ch = 0; ch < 16; ch++) {
    MIDI.setVolume(ch, 90);
  }
  MIDI.Player.start();
  return true;
}
