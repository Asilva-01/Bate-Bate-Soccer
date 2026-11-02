import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createScene } from './game/scene';
import type { DriveInput } from './game/physics';

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

  useEffect(() => {
    if (!container.current) return;
    let active = true;
    let dispose: (() => void) | undefined;
    createScene(container.current, input.current).then((cleanup) => {
      if (active) dispose = cleanup;
      else cleanup();
    }).catch((cause: unknown) => {
      console.error(cause);
      if (active) setError(true);
    });
    const clear = () => {
      pointers.current.clear();
      Object.assign(input.current, { forward: false, reverse: false, left: false, right: false });
    };
    window.addEventListener('blur', clear);
    return () => { active = false; clear(); window.removeEventListener('blur', clear); dispose?.(); };
  }, []);

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

  return <main className="app">
    <header className="topbar"><a className="brand" href="#inicio"><span className="brand-icon" aria-hidden="true">★</span><span>BATE-BATE <strong>SOCCER</strong></span></a><span className="top-tag"><span className="live-dot" /> PROTÓTIPO · FASE 02</span></header>
    <section className="game" id="inicio" aria-labelledby="title">
      <div className="game-heading"><div><p className="eyebrow">ENTRE NA ARENA <span> / 02</span></p><h1 id="title">BATE DIFERENTE<span>.</span></h1></div><p className="game-hint"><strong>CARRINHO VERMELHO</strong><br />WASD ou setas para dirigir</p></div>
      <div className="scene-frame"><div ref={container} className="scene" role="img" aria-label="Arena 3D com quatro carrinhos e uma bola. Controle o carrinho vermelho com WASD, setas ou botões de toque." />{error && <p className="scene-error" role="alert">Não foi possível iniciar a cena 3D. Verifique se o WebGL está habilitado no navegador.</p>}
        <div className="scene-overlay"><span><i className="live-dot" /> ARENA NEON</span><span>VISÃO AMPLA DA ARENA</span></div>
        <div className="touch-controls" aria-label="Controles do carrinho">
          <div className="control-group steering">{directions.slice(0, 2).map(({ key, label, symbol }) => <button key={key} type="button" aria-label={label} onPointerDown={(event) => press(event, key)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>{symbol}</button>)}</div>
          <div className="control-group pedals">{directions.slice(2).map(({ key, label, symbol }) => <button key={key} type="button" aria-label={label} onPointerDown={(event) => press(event, key)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><span>{symbol}</span><small>{key === 'forward' ? 'ACELERAR' : 'RÉ'}</small></button>)}</div>
        </div>
      </div>
      <div className="game-footer"><p><span className="red-dot" /> VOCÊ CONTROLA O VERMELHO</p><p>FÍSICA E COLISÕES <span>·</span> GOLS E PLACAR NA PRÓXIMA FASE</p></div>
    </section>
  </main>;
}
