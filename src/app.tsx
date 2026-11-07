import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { BallIndicator, GameControls } from './game/scene';
import type { MatchState } from './game/physics';
import type { Difficulty } from './game/match-rules';
import type { CameraMode, CameraPreset } from './game/chase-camera';
import { createControlFrame, readGamepadMapping } from './game/input';
import { clampStickBase, createTouchStickLive, followBase, normalizeStick, resetTouchStickLive, stickToDrive, type Point, type TouchStickMode } from './game/touch-stick';
import { hitActionCluster, type ClusterHit } from './game/action-cluster';
import { CAMERA, KICK, TOUCH } from './game/config';
import { tryVibrate, type HapticKind } from './game/haptics';

type AudioPlayer = ReturnType<typeof import('./game/audio').createAudio>;

const CAMERA_STORAGE_KEY = 'bate-bate-soccer:camera';
const BALL_CAM_STORAGE_KEY = 'bate-bate-soccer:ball-cam';
const HAPTICS_STORAGE_KEY = 'bate-bate-soccer:haptics';
const TOUCH_MODE_STORAGE_KEY = 'bate-bate-soccer:touch-mode';
const CAMERA_LABELS: Record<CameraPreset, string> = { perto: 'Perto', alta: 'Alta' };
const TOUCH_MODE_LABELS: Record<TouchStickMode, string> = { aim: 'Apontar', steer: 'Volante' };
const IDLE_STICK = { pointerId: -1, base: { x: 0, y: 0 } as Point };

function loadCameraPreset(): CameraPreset {
  try {
    const stored = window.localStorage.getItem(CAMERA_STORAGE_KEY);
    if (stored && stored in CAMERA.presets) return stored as CameraPreset;
  } catch {
    // Armazenamento indisponível (modo privativo): usa o padrão.
  }
  return 'perto';
}

function loadHapticsEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(HAPTICS_STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // Sem armazenamento: vibração ligada por padrão.
  }
  return true;
}

function loadTouchMode(): TouchStickMode {
  try {
    const stored = window.localStorage.getItem(TOUCH_MODE_STORAGE_KEY);
    if (stored === 'aim' || stored === 'steer') return stored;
  } catch {
    // Armazenamento indisponível (modo privativo): usa o padrão.
  }
  return 'aim';
}

function loadCameraMode(): CameraMode {
  try {
    const stored = window.localStorage.getItem(BALL_CAM_STORAGE_KEY);
    if (stored === 'ball' || stored === 'car') return stored;
  } catch {
    // Armazenamento indisponível (modo privativo): usa o padrão.
  }
  return 'car';
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export default function App() {
  const shell = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef(createControlFrame());
  const stickZone = useRef<HTMLDivElement>(null);
  const stickBase = useRef<HTMLDivElement>(null);
  const stickKnob = useRef<HTMLDivElement>(null);
  const stick = useRef({ ...IDLE_STICK });
  const clusterZone = useRef<HTMLDivElement>(null);
  const turboButton = useRef<HTMLButtonElement>(null);
  const kickButton = useRef<HTMLButtonElement>(null);
  const cluster = useRef({ pointerId: -1, hit: null as ClusterHit });
  const indicator = useRef<HTMLDivElement>(null);
  const indicatorArrow = useRef<HTMLSpanElement>(null);
  const indicatorLabel = useRef<HTMLSpanElement>(null);
  const wantsFullscreen = useRef(false);
  const [kickCooldown, setKickCooldown] = useState(false);
  const [kickFlash, setKickFlash] = useState(false);
  const [haptics, setHaptics] = useState(loadHapticsEnabled);
  const hapticsEnabled = useRef(haptics);
  const [error, setError] = useState(false);
  const [match, setMatch] = useState<MatchState>({ red: 0, blue: 0, redCars: 1, blueCars: 1, message: 'Faça 3 gols para vencer', finished: false });
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [round, setRound] = useState(1);
  const [session, setSession] = useState(0);
  const [menu, setMenu] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>(loadCameraPreset);
  const [cameraMode, setCameraMode] = useState<CameraMode>(loadCameraMode);
  const [touchMode, setTouchMode] = useState<TouchStickMode>(loadTouchMode);
  const touchStick = useRef(createTouchStickLive(touchMode));
  const [sound, setSound] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<AudioPlayer | null>(null);
  const portrait = useMediaQuery('(pointer: coarse) and (orientation: portrait)');
  const playing = !menu;
  const rotateBlocked = playing && portrait;

  const showIndicator = (state: BallIndicator | null) => {
    const element = indicator.current;
    if (!element) return;
    element.hidden = !state;
    if (!state) return;
    element.style.transform = `translate(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px)`;
    if (indicatorArrow.current) indicatorArrow.current.style.transform = `rotate(${state.angleRad.toFixed(3)}rad)`;
    const label = state.distance > CAMERA.indicatorMinDistance ? `${Math.round(state.distance)} m` : '';
    if (indicatorLabel.current && indicatorLabel.current.textContent !== label) indicatorLabel.current.textContent = label;
  };
  const controls = useRef<GameControls>({
    cameraPreset,
    cameraMode,
    running: false,
    restart: () => {},
    resetTiming: () => {},
    sound: (kind) => audio.current?.sound(kind),
    haptic: (kind: HapticKind) => { tryVibrate(kind, hapticsEnabled.current); },
    indicator: showIndicator,
    onTurboFrame: () => {},
    touchStick: touchStick.current,
  });

  const resetStick = useCallback(() => {
    stick.current = { ...IDLE_STICK };
    resetTouchStickLive(touchStick.current);
    input.current.throttle = 0;
    input.current.steer = 0;
    input.current.boost = false;
    cluster.current = { pointerId: -1, hit: null };
    turboButton.current?.classList.remove('is-pressed');
    kickButton.current?.classList.remove('is-pressed');
    stickZone.current?.classList.remove('stick-zone--active');
  }, []);
  const focusGame = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== container.current) {
      document.activeElement.blur();
    }
    container.current?.focus({ preventScroll: true });
  }, []);
  const changePaused = useCallback((nextPaused: boolean) => {
    if (menu || match.finished) return;
    resetStick();
    controls.current.running = !nextPaused;
    controls.current.resetTiming();
    setPaused(nextPaused);
    if (!nextPaused) focusGame();
  }, [resetStick, focusGame, match.finished, menu]);
  useEffect(() => {
    controls.current.onTurboFrame = ({ meter, active }) => {
      const el = turboButton.current;
      if (!el) return;
      el.style.setProperty('--turbo', meter.toFixed(1));
      el.classList.toggle('is-active', active);
    };
  }, []);
  const previousPad = useRef({ pause: false, cam: false });
  const togglePause = () => changePaused(!paused);
  const changeBallCam = useCallback((value: CameraMode) => {
    controls.current.cameraMode = value;
    setCameraMode(value);
    try {
      window.localStorage.setItem(BALL_CAM_STORAGE_KEY, value);
    } catch {
      // Sem armazenamento: a escolha vale só nesta sessão.
    }
  }, []);
  const toggleBallCam = useCallback(() => {
    changeBallCam(controls.current.cameraMode === 'ball' ? 'car' : 'ball');
  }, [changeBallCam]);
  useEffect(() => {
    let frame = 0;
    const poll = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      let pad: Gamepad | null = null;
      for (let i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }
      const mapped = readGamepadMapping(pad);
      if (mapped.pause && !previousPad.current.pause) togglePause();
      if (mapped.ballCam && !previousPad.current.cam) toggleBallCam();
      previousPad.current.pause = mapped.pause;
      previousPad.current.cam = mapped.ballCam;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [togglePause, toggleBallCam]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.repeat || menu) return;
      if (key === 'c' && !match.finished) {
        event.preventDefault();
        toggleBallCam();
        return;
      }
      if ((key !== 'p' && key !== 'escape') || match.finished) return;
      event.preventDefault();
      togglePause();
    };
    const onVisibilityChange = () => {
      if (document.hidden && controls.current.running) changePaused(true);
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && wantsFullscreen.current && controls.current.running) changePaused(true);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [changePaused, match.finished, menu, paused, toggleBallCam]);

  useEffect(() => {
    if (rotateBlocked && !match.finished && !paused) changePaused(true);
  }, [changePaused, match.finished, paused, rotateBlocked]);

  useEffect(() => {
    document.body.classList.toggle('is-playing', playing);
    return () => document.body.classList.remove('is-playing');
  }, [playing]);

  useEffect(() => {
    let active = true;
    let player: AudioPlayer | undefined;
    void import('./game/audio').then(({ createAudio }) => {
      if (!active) return;
      player = createAudio();
      audio.current = player;
      setAudioReady(true);
    }).catch((cause: unknown) => {
      console.error(cause);
      if (active) setAudioError(true);
    });
    return () => {
      active = false;
      player?.dispose();
      if (player && audio.current === player) audio.current = null;
    };
  }, []);
  useEffect(() => {
    void audio.current?.setScene(menu ? 'menu' : 'match');
  }, [menu, audioReady]);

  useEffect(() => {
    if (!container.current) return;
    let active = true;
    let dispose: (() => void) | undefined;
    setError(false);
    controls.current.restart = () => {};
    void import('./game/scene').then(({ createScene }) => {
      if (!active || !container.current) return null;
      return createScene(container.current, input.current, controls.current, (state) => { if (active) setMatch(state); }, difficulty, round);
    }).then((game) => {
      if (!game) return;
      if (active) {
        dispose = game.dispose;
        controls.current.restart = game.restart;
        controls.current.sound = (kind) => {
          audio.current?.sound(kind);
          if (kind === 'kick' || kind === 'dash') {
            setKickCooldown(true);
            setKickFlash(true);
            window.setTimeout(() => setKickFlash(false), TOUCH.haptics.buttonFlashMs);
            window.setTimeout(() => setKickCooldown(false), KICK.cooldownSeconds * 1000);
          }
        };
      }
      else game.dispose();
    }).catch((cause: unknown) => {
      console.error(cause);
      if (active) setError(true);
    });
    window.addEventListener('blur', resetStick);
    return () => { active = false; resetStick(); window.removeEventListener('blur', resetStick); dispose?.(); };
  }, [resetStick, difficulty, round, session]);

  const placeStick = (event: PointerEvent<HTMLDivElement>, zone: HTMLDivElement) => {
    const rect = zone.getBoundingClientRect();
    const radius = TOUCH.stick.radiusPx;
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (stick.current.pointerId !== event.pointerId) {
      stick.current = { pointerId: event.pointerId, base: clampStickBase(pointer, { left: 0, top: 0, right: rect.width, bottom: rect.height }, radius) };
    } else {
      stick.current.base = followBase(stick.current.base, pointer, radius, TOUCH.stick.baseFollowFactor);
    }
    const { base } = stick.current;
    const vector = normalizeStick(pointer.x - base.x, pointer.y - base.y, radius);
    touchStick.current.stick = vector;
    if (touchStick.current.mode === 'steer') {
      const drive = stickToDrive(vector);
      input.current.throttle = drive.throttle;
      input.current.steer = drive.steer;
    }
    if (stickBase.current) stickBase.current.style.transform = `translate(${(base.x - radius).toFixed(1)}px, ${(base.y - radius).toFixed(1)}px)`;
    if (stickKnob.current) stickKnob.current.style.transform = `translate(${(vector.x * radius).toFixed(1)}px, ${(-vector.y * radius).toFixed(1)}px)`;
  };
  const stickDown = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current.pointerId !== -1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('stick-zone--active');
    placeStick(event, event.currentTarget);
  };
  const stickMove = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    placeStick(event, event.currentTarget);
  };
  const stickUp = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current.pointerId === event.pointerId) resetStick();
  };
  const clusterCircles = () => {
    const zone = clusterZone.current;
    const boostEl = turboButton.current;
    const kickEl = kickButton.current;
    if (!zone || !boostEl || !kickEl) return null;
    const zoneRect = zone.getBoundingClientRect();
    const boostRect = boostEl.getBoundingClientRect();
    const kickRect = kickEl.getBoundingClientRect();
    return {
      boost: { x: boostRect.left + boostRect.width / 2 - zoneRect.left, y: boostRect.top + boostRect.height / 2 - zoneRect.top, r: boostRect.width / 2 },
      kick: { x: kickRect.left + kickRect.width / 2 - zoneRect.left, y: kickRect.top + kickRect.height / 2 - zoneRect.top, r: kickRect.width / 2 },
    };
  };
  const applyClusterHit = (hit: ClusterHit) => {
    const previous = cluster.current.hit;
    input.current.boost = hit === 'boost' || hit === 'both';
    if ((hit === 'kick' || hit === 'both') && previous !== 'kick' && previous !== 'both') input.current.kickPresses += 1;
    cluster.current.hit = hit;
    turboButton.current?.classList.toggle('is-pressed', input.current.boost);
    kickButton.current?.classList.toggle('is-pressed', hit === 'kick' || hit === 'both');
  };
  const clusterDown = (event: PointerEvent<HTMLDivElement>) => {
    if (cluster.current.pointerId !== -1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cluster.current.pointerId = event.pointerId;
    const circles = clusterCircles();
    if (!circles) return;
    const rect = event.currentTarget.getBoundingClientRect();
    applyClusterHit(hitActionCluster(event.clientX - rect.left, event.clientY - rect.top, circles.boost, circles.kick, TOUCH.dualPressSlackPx));
  };
  const clusterMove = (event: PointerEvent<HTMLDivElement>) => {
    if (cluster.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const circles = clusterCircles();
    if (!circles) return;
    const rect = event.currentTarget.getBoundingClientRect();
    applyClusterHit(hitActionCluster(event.clientX - rect.left, event.clientY - rect.top, circles.boost, circles.kick, TOUCH.dualPressSlackPx));
  };
  const clusterUp = (event: PointerEvent<HTMLDivElement>) => {
    if (cluster.current.pointerId !== event.pointerId) return;
    cluster.current.pointerId = -1;
    applyClusterHit(null);
  };

  const enterFullscreen = () => {
    const element = shell.current;
    if (!window.matchMedia('(pointer: coarse)').matches || !element || document.fullscreenElement || typeof element.requestFullscreen !== 'function') return;
    wantsFullscreen.current = true;
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };
    void element.requestFullscreen({ navigationUI: 'hide' }).then(() => orientation.lock?.('landscape')).catch(() => {});
  };
  const leaveFullscreen = () => {
    wantsFullscreen.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  const start = () => {
    resetStick();
    enterFullscreen();
    controls.current.running = !portrait;
    controls.current.resetTiming();
    setPaused(portrait);
    setRound(1);
    setSession((current) => current + 1);
    setMenu(false);
    focusGame();
  };
  const openMenu = () => {
    resetStick();
    leaveFullscreen();
    controls.current.running = false;
    controls.current.resetTiming();
    setPaused(false);
    setMenu(true);
  };
  const nextRound = () => { controls.current.running = true; controls.current.resetTiming(); setPaused(false); setMatch((current) => ({ ...current, finished: false })); setRound((current) => current + 1); focusGame(); };
  const changeTouchMode = (value: TouchStickMode) => {
    resetTouchStickLive(touchStick.current);
    touchStick.current.mode = value;
    input.current.throttle = 0;
    input.current.steer = 0;
    setTouchMode(value);
    try {
      window.localStorage.setItem(TOUCH_MODE_STORAGE_KEY, value);
    } catch {
      // Sem armazenamento: a escolha vale só nesta sessão.
    }
  };
  const changeCamera = (value: CameraPreset) => {
    controls.current.cameraPreset = value;
    setCameraPreset(value);
    try {
      window.localStorage.setItem(CAMERA_STORAGE_KEY, value);
    } catch {
      // Sem armazenamento: a escolha vale só nesta sessão.
    }
  };
  const toggleSound = () => {
    setAudioError(false);
    void audio.current?.toggle().then(setSound).catch(() => { setSound(false); setAudioError(true); });
  };
  const toggleHaptics = () => {
    const next = !hapticsEnabled.current;
    hapticsEnabled.current = next;
    setHaptics(next);
    try {
      window.localStorage.setItem(HAPTICS_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Sem armazenamento: a escolha vale só nesta sessão.
    }
  };
  const touchModeSelector = (className: string) => (
    <div className={className} role="group" aria-label="Controle">
      <span>CONTROLE</span>
      {(['aim', 'steer'] as const).map((mode) => (
        <button type="button" key={mode} aria-pressed={touchMode === mode} onClick={() => changeTouchMode(mode)}>{TOUCH_MODE_LABELS[mode]}</button>
      ))}
    </div>
  );
  const soundLabel = sound ? '♫ SOM LIGADO' : audioReady ? '♫ LIGAR SOM' : 'CARREGANDO SOM…';
  const levelLabel = difficulty === 'easy' ? 'FÁCIL' : difficulty === 'medium' ? 'MÉDIO' : 'DIFÍCIL';
  const shellStyle = { ['--stick-radius' as string]: `${TOUCH.stick.radiusPx}px`, ['--primary-button' as string]: `${TOUCH.primaryButtonPx}px`, ['--secondary-button' as string]: `${TOUCH.secondaryButtonPx}px`, ['--small-button' as string]: `${TOUCH.smallButtonPx}px`, ['--hud-height' as string]: `${TOUCH.hudHeightPx}px`, ['--edge-margin' as string]: `${TOUCH.edgeMarginPx}px`, ['--stick-zone-width' as string]: `${TOUCH.stick.zoneWidthFraction * 100}%` };

  return <main className={`app${playing ? ' app--playing' : ''}`}>
    <header className="topbar" inert={playing}><a className="brand" href="#inicio"><span className="brand-icon" aria-hidden="true">★</span><span>BATE-BATE <strong>SOCCER</strong></span></a><span className="top-tag">FUTEBOL DE CARRINHO · PARTIDA RÁPIDA</span></header>
    <section className="game" id="inicio" aria-labelledby="title">
      <div className="game-heading" inert={playing}><div><p className="eyebrow">ENTRE EM CAMPO</p><h1 id="title">É HORA DO <span>JOGO.</span></h1></div><p className="game-hint"><strong>PRIMEIRO A MARCAR 3 VENCE</strong><br /><span className="keyboard-control-hint">Use W A S D ou as setas para jogar</span><span className="touch-control-hint">{touchMode === 'aim' ? 'Aponte o polegar esquerdo para onde o carrinho deve ir' : 'Joystick-volante à esquerda'}. TURBO e TOQUE à direita</span></p></div>
      <div ref={shell} className={`scene-frame${playing ? ' scene-frame--playing' : ''}`} style={shellStyle} onContextMenu={(event) => { if (playing) event.preventDefault(); }}>
        <div ref={container} className="scene" tabIndex={-1} role="img" aria-label="Campo de futebol 3D visto de trás do carrinho vermelho. Faça gols na trave azul." />
        {error && <p className="scene-error" role="alert">Não foi possível carregar o jogo. Confira sua conexão e tente recarregar a página.</p>}
        {playing && <div className="hud">
          <button className="hud-pause" type="button" aria-label="Pausar" disabled={match.finished || rotateBlocked} onClick={togglePause}>II</button>
          <div className="match-bar" aria-label="Placar"><div className="team red">VOCÊ <small>{match.redCars} {match.redCars === 1 ? 'CARRINHO' : 'CARRINHOS'}</small></div><div className="score" aria-live="polite">{match.red} <span>:</span> {match.blue}</div><div className="team blue">AZUL <small>{match.blueCars} {match.blueCars === 1 ? 'CARRINHO' : 'CARRINHOS'}</small></div></div>
          <p className="hud-status">● {match.message} · RODADA {round} · {levelLabel}</p>
          <button
            className="ball-cam-button"
            type="button"
            aria-pressed={cameraMode === 'ball'}
            aria-label="Câmera na bola"
            aria-keyshortcuts="C"
            disabled={match.finished || rotateBlocked}
            onClick={toggleBallCam}
          >BOLA</button>
        </div>}
        <div ref={indicator} className="ball-indicator" aria-hidden="true" hidden><span ref={indicatorArrow} className="ball-indicator-arrow">▶</span><span ref={indicatorLabel} className="ball-indicator-label" /></div>
        {menu && <div className="start-menu" role="region" aria-label="Escolha a dificuldade"><div className="menu-card"><p className="menu-kicker">BATE-BATE SOCCER</p><h2>ESCOLHA SEU DESAFIO</h2><p>Comece em 1 contra 1. A cada vitória, o próximo adversário fica mais forte.</p><div className="keyboard-guide"><span><kbd>W</kbd> <kbd>↑</kbd> acelerar</span><span><kbd>S</kbd> <kbd>↓</kbd> ré</span><span><kbd>A</kbd> <kbd>D</kbd> <kbd>←</kbd> <kbd>→</kbd> virar</span><span><kbd>Espaço</kbd> toque</span></div><p className="mobile-control-guide">{touchMode === 'aim' ? <>Jogue deitado: <strong>aponte</strong> o polegar esquerdo para onde o carrinho deve ir. TOQUE e TURBO ficam no direito.</> : <>Jogue deitado: o <strong>volante</strong> nasce sob o polegar esquerdo (para cima acelera, para trás dá ré). TOQUE e TURBO ficam no direito.</>}</p>{touchModeSelector('control-mode')}<div className="difficulty" role="group" aria-label="Dificuldade">{([['easy', 'Fácil', 'Para começar'], ['medium', 'Médio', 'Jogo equilibrado'], ['hard', 'Difícil', 'Ritmo intenso']] as const).map(([value, label, description]) => <button type="button" key={value} aria-pressed={difficulty === value} onClick={() => { setRound(1); setDifficulty(value); }}><strong>{label}</strong><small>{description}</small></button>)}</div><button className="play-button" type="button" onClick={start}>ENTRAR EM CAMPO →</button></div></div>}
        {!menu && match.finished && <div className="finish"><strong>{match.message}</strong>{match.red >= 3 ? <button type="button" onClick={nextRound}>PRÓXIMA RODADA →</button> : <button type="button" onClick={() => controls.current.restart()}>TENTAR NOVAMENTE</button>}<button type="button" onClick={openMenu}>VOLTAR AO MENU</button></div>}
        {paused && !menu && !match.finished && <div className="finish pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <strong id="pause-title">PAUSADO</strong>
          <div className="pause-camera" role="group" aria-label="Câmera"><span>CÂMERA</span>{(Object.keys(CAMERA.presets) as CameraPreset[]).map((preset) => <button type="button" key={preset} aria-pressed={cameraPreset === preset} onClick={() => changeCamera(preset)}>{CAMERA_LABELS[preset]}</button>)}</div>
          {touchModeSelector('pause-camera')}
          <button type="button" disabled={rotateBlocked} onClick={() => changePaused(false)}>CONTINUAR</button>
          <button className="pause-sound" type="button" aria-pressed={sound} disabled={!audioReady} onClick={toggleSound}>{soundLabel}</button>
          <button className="pause-sound" type="button" aria-pressed={haptics} onClick={toggleHaptics}>Vibração</button>
          <button type="button" onClick={openMenu}>MENU</button>
        </div>}
        {!menu && !match.finished && !paused && <div className="touch-controls" aria-label="Controles do carrinho">
          <div
            ref={stickZone}
            className="stick-zone"
            data-mode={touchMode}
            onPointerDown={stickDown}
            onPointerMove={stickMove}
            onPointerUp={stickUp}
            onPointerCancel={stickUp}
            onLostPointerCapture={stickUp}
          ><div ref={stickBase} className="stick-base"><div ref={stickKnob} className="stick-knob" /></div></div>
          <div
            ref={clusterZone}
            className="action-cluster"
            onPointerDown={clusterDown}
            onPointerMove={clusterMove}
            onPointerUp={clusterUp}
            onPointerCancel={clusterUp}
            onLostPointerCapture={clusterUp}
          >
            <button ref={turboButton} className="turbo-button" type="button" tabIndex={-1} aria-label="Turbo" aria-keyshortcuts="Shift L">TURBO</button>
            <button
              ref={kickButton}
              className={`kick-button${kickCooldown ? ' kick-button--cooldown' : ''}${kickFlash ? ' kick-button--flash' : ''}`}
              type="button"
              tabIndex={-1}
              aria-label="Tocar na bola"
              aria-keyshortcuts="Space K"
              style={{ ['--kick-cooldown' as string]: `${KICK.cooldownSeconds}s` }}
            >TOQUE</button>
          </div>
        </div>}
        {rotateBlocked && <div className="rotate-notice" role="alert"><span className="rotate-icon" aria-hidden="true">⟳</span><strong>Gire o celular para jogar</strong><small>A partida só funciona com o celular deitado.</small><button type="button" onClick={openMenu}>VOLTAR AO MENU</button></div>}
      </div>
      <div className="game-tools" inert={playing}><button className="sound-toggle" type="button" aria-pressed={sound} disabled={!audioReady} onClick={toggleSound}>{soundLabel}</button></div>
      <div className="match-notes" inert={playing}><p className="rules">ALIADO DISPONÍVEL AO MARCAR A PARTIR DA RODADA 2 · TOQUE COM ESPAÇO, K OU BOTÃO TOQUE · SHIFT OU L TURBO · C CÂMERA DA BOLA · P OU ESC PAUSA</p><p className="keyboard-shortcuts"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> PILOTAR <kbd>Shift</kbd> TURBO <kbd>Espaço</kbd> TOQUE <kbd>C</kbd> BOLA</p></div>{audioError && <p role="alert" className="audio-error">Não foi possível carregar o áudio. O jogo pode continuar sem som; tente recarregar a página.</p>}
    </section>
  </main>;
}
