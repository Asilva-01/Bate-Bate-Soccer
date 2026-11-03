import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { GameControls } from './game/scene';
import type { MatchState } from './game/physics';
import type { DriveInput } from './game/physics';
import type { Difficulty } from './game/match-rules';

type AudioPlayer = ReturnType<typeof import('./game/audio').createAudio>;

const directions = [
  { key: 'left', label: 'Virar à esquerda', symbol: '◀' },
  { key: 'right', label: 'Virar à direita', symbol: '▶' },
  { key: 'reverse', label: 'Dar ré', symbol: '▼' },
  { key: 'forward', label: 'Acelerar', symbol: '▲' },
] as const;

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<DriveInput>({ forward: false, reverse: false, left: false, right: false });
  const pointers = useRef(new Map<number, keyof DriveInput>());
  const [error, setError] = useState(false);
  const [match, setMatch] = useState<MatchState>({ red: 0, blue: 0, redCars: 1, blueCars: 1, message: 'Faça 3 gols para vencer', finished: false });
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [round, setRound] = useState(1);
  const [session, setSession] = useState(0);
  const [menu, setMenu] = useState(true);
  const [paused, setPaused] = useState(false);
  const [orientationHintDismissed, setOrientationHintDismissed] = useState(false);
  const [camera, setCamera] = useState<GameControls['camera']>('arena');
  const [sound, setSound] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<AudioPlayer | null>(null);
  const controls = useRef<GameControls>({ camera: 'arena', running: false, restart: () => {}, resetTiming: () => {}, sound: (kind) => audio.current?.sound(kind) });

  const clearInput = useCallback(() => {
    pointers.current.clear();
    Object.assign(input.current, { forward: false, reverse: false, left: false, right: false });
  }, []);
  const changePaused = useCallback((nextPaused: boolean) => {
    if (menu || match.finished) return;
    clearInput();
    controls.current.running = !nextPaused;
    controls.current.resetTiming();
    setPaused(nextPaused);
  }, [clearInput, match.finished, menu]);
  const togglePause = () => changePaused(!paused);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.repeat || (key !== 'p' && key !== 'escape') || menu || match.finished) return;
      event.preventDefault();
      togglePause();
    };
    const onVisibilityChange = () => {
      if (document.hidden && controls.current.running) changePaused(true);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [changePaused, match.finished, menu, paused]);

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
      if (active) { dispose = game.dispose; controls.current.restart = game.restart; }
      else game.dispose();
    }).catch((cause: unknown) => {
      console.error(cause);
      if (active) setError(true);
    });
    window.addEventListener('blur', clearInput);
    return () => { active = false; clearInput(); window.removeEventListener('blur', clearInput); dispose?.(); };
  }, [clearInput, difficulty, round, session]);

  const press = (event: PointerEvent<HTMLButtonElement>, direction: keyof DriveInput) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, direction);
    input.current[direction] = true;
  };
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    const direction = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (direction) input.current[direction] = [...pointers.current.values()].includes(direction);
  };

  const start = () => { clearInput(); controls.current.running = true; controls.current.resetTiming(); setPaused(false); setRound(1); setSession((current) => current + 1); setMenu(false); };
  const openMenu = () => { clearInput(); controls.current.running = false; controls.current.resetTiming(); setPaused(false); setMenu(true); };
  const nextRound = () => { controls.current.running = true; controls.current.resetTiming(); setPaused(false); setMatch((current) => ({ ...current, finished: false })); setRound((current) => current + 1); };
  const changeCamera = (value: GameControls['camera']) => { controls.current.camera = value; setCamera(value); };
  return <main className="app">
    <header className="topbar"><a className="brand" href="#inicio"><span className="brand-icon" aria-hidden="true">★</span><span>BATE-BATE <strong>SOCCER</strong></span></a><span className="top-tag">FUTEBOL DE CARRINHO · PARTIDA RÁPIDA</span></header>
    <section className="game" id="inicio" aria-labelledby="title">
      <div className="game-heading"><div><p className="eyebrow">ENTRE EM CAMPO</p><h1 id="title">É HORA DO <span>JOGO.</span></h1></div><p className="game-hint"><strong>PRIMEIRO A MARCAR 3 VENCE</strong><br /><span className="keyboard-control-hint">Use as setas para jogar</span><span className="touch-control-hint">Use os botões na tela</span></p></div>
      <div className="match-bar" aria-label="Placar"><div className="team red">VOCÊ <small>{match.redCars} {match.redCars === 1 ? 'CARRINHO' : 'CARRINHOS'}</small></div><div className="score" aria-live="polite">{match.red} <span>:</span> {match.blue}</div><div className="team blue">AZUL <small>{match.blueCars} {match.blueCars === 1 ? 'CARRINHO' : 'CARRINHOS'}</small></div></div>
      <div className="scene-frame"><div ref={container} className="scene" role="img" aria-label="Campo de futebol 3D. Dirija o carrinho vermelho e faça gols na trave azul." />{error && <p className="scene-error" role="alert">Não foi possível carregar o jogo. Confira sua conexão e tente recarregar a página.</p>}
        <div className="scene-overlay"><span>● {match.message}</span><span>RODADA {round} · ATAQUE PARA A DIREITA →</span></div>
        {!menu && !match.finished && !paused && !orientationHintDismissed && <div className="orientation-hint" role="status"><span>Gire o celular para jogar melhor</span><button type="button" aria-label="Dispensar aviso de orientação" onClick={() => setOrientationHintDismissed(true)}>×</button></div>}
        {menu && <div className="start-menu" role="region" aria-label="Escolha a dificuldade"><div className="menu-card"><p className="menu-kicker">BATE-BATE SOCCER</p><h2>ESCOLHA SEU DESAFIO</h2><p>Comece em 1 contra 1. A cada vitória, o próximo adversário fica mais forte.</p><div className="keyboard-guide"><span><kbd>↑</kbd> acelerar</span><span><kbd>↓</kbd> ré</span><span><kbd>←</kbd> <kbd>→</kbd> virar</span></div><p className="mobile-control-guide">Use os botões na tela</p><div className="difficulty" role="group" aria-label="Dificuldade">{([['easy', 'Fácil', 'Para começar'], ['medium', 'Médio', 'Jogo equilibrado'], ['hard', 'Difícil', 'Ritmo intenso']] as const).map(([value, label, description]) => <button type="button" key={value} aria-pressed={difficulty === value} onClick={() => { setRound(1); setDifficulty(value); }}><strong>{label}</strong><small>{description}</small></button>)}</div><button className="play-button" type="button" onClick={start}>ENTRAR EM CAMPO →</button></div></div>}
        {!menu && match.finished && <div className="finish"><strong>{match.message}</strong>{match.red >= 3 ? <button type="button" onClick={nextRound}>PRÓXIMA RODADA →</button> : <button type="button" onClick={() => controls.current.restart()}>TENTAR NOVAMENTE</button>}<button type="button" onClick={openMenu}>VOLTAR AO MENU</button></div>}
        {paused && !menu && !match.finished && <div className="finish pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title"><strong id="pause-title">PAUSADO</strong><button type="button" onClick={() => changePaused(false)}>CONTINUAR</button><button type="button" onClick={openMenu}>MENU</button></div>}
        {!menu && !match.finished && !paused && <div className="touch-controls" aria-label="Controles do carrinho">
          <div className="control-group steering">{directions.slice(0, 2).map(({ key, label, symbol }) => <button key={key} type="button" aria-label={label} onPointerDown={(event) => press(event, key)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>{symbol}</button>)}</div>
          <div className="control-group pedals">{directions.slice(2).map(({ key, label, symbol }) => <button key={key} type="button" aria-label={label} onPointerDown={(event) => press(event, key)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><span>{symbol}</span><small>{key === 'forward' ? 'ACELERAR' : 'RÉ'}</small></button>)}</div>
        </div>}
      </div>
      <div className="game-tools"><div className="camera-controls" aria-label="Câmera"><span>VISÃO</span>{([['arena', 'Arena'], ['follow', 'Carrinho'], ['top', 'Alto']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={camera === value} onClick={() => changeCamera(value)}>{label}</button>)}</div><button type="button" aria-pressed={paused} disabled={menu || match.finished} onClick={togglePause}>{paused ? 'Continuar' : 'Pausar'}</button><button className="sound-toggle" type="button" aria-pressed={sound} disabled={!audioReady} onClick={() => { setAudioError(false); void audio.current?.toggle().then(setSound).catch(() => { setSound(false); setAudioError(true); }); }}>{sound ? '♫ SOM LIGADO' : audioReady ? '♫ LIGAR SOM' : 'CARREGANDO SOM…'}</button></div>
      <div className="match-notes"><p className="rules">ALIADO DISPONÍVEL AO MARCAR A PARTIR DA RODADA 2 · SOFRA GOL E PERCA O REFORÇO</p><p className="keyboard-shortcuts"><kbd>↑</kbd> ACELERAR <kbd>↓</kbd> RÉ <kbd>←</kbd> <kbd>→</kbd> VIRAR</p></div>{audioError && <p role="alert" className="audio-error">Não foi possível carregar o áudio. O jogo pode continuar sem som; tente recarregar a página.</p>}
    </section>
  </main>;
}
