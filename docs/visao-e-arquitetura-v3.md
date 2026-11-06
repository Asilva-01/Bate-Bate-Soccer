# Bate-Bate Soccer — Visão de produto e arquitetura v3

Documento de design (sem implementação) para a nova direção escolhida pelo André: **futebol de carrinhos 3D com câmera atrás do carro, no estilo "Rocket League simplificado", mobile-first e jogável no desktop**. Parte do estado de `main` no commit `a508931` (PR #1 overhaul, PR #2 doc v2, PR #3 chute). A stack não muda: Vite + React 19 + Three.js + Rapier + Vitest, publicado como site estático no GitHub Pages.

Este documento **substitui em parte** o [`arquitetura-gameplay-v2.md`](arquitetura-gameplay-v2.md). A seção 8 diz o que da v2 continua valendo. Os PRs 2 (campo ×1,25) e 3 (times 3×3) da v2 não devem ser implementados como estão.

Como na v2, o objetivo é que cada PR possa ser feito por quem não participou do design: interfaces definidas, todos os números em `src/game/config.ts` e cada regra como função pura com teste.

---

## 0. Resumo executivo

### 0.1 Decisões

| Tema | Decisão |
| --- | --- |
| Pitch | Futebol de carrinhos 3D para jogar com dois polegares, em partidas de 2 minutos contra a IA. |
| Modo | 1×1 enquanto o *feeling* é ajustado (PRs 1 a 6); 2×2 (você + aliado IA) vira o modo principal no PR 7. Sem 3×3. |
| Partida | 2:00 de bola rolando, relógio para nos gols; empate vai para gol de ouro de até 60 s. |
| Controle touch | Joystick analógico flutuante no polegar esquerdo (direção relativa ao carro, intensidade = acelerador); **TOQUE** e **TURBO** no polegar direito. Sem pedais. |
| Chute do PR #3 | Vira **TOQUE**: um avanço curto (*dash*) com a mesma matemática de `kick.ts` para acertar a bola; com bola alta, vira uma cabeçada com pulinho. Sem botão de pulo separado no MVP. |
| Câmera | Perspectiva atrás do carro com *follow* suave, FOV horizontal de 95° e leve "assistência de bola". Ball cam como alternância opcional. Indicador de bola fora da tela. |
| Arena | Caixa fechada com paredes altas, teto, cantos chanfrados e gols em caixa. A bola nunca sai e não tem bolsões para ficar presa. Sem dirigir na parede. |
| Bola | Bem maior (raio 0,9 → 1,7), mais quicante e com gravidade reduzida (estilo RL). |
| Física do carro | Controlador único para jogador **e** IA (fim do `setLinvel` da IA); carro sempre de pé (só gira no eixo Y), com pulinho vertical. |
| Turbo | Medidor de 0 a 100, começa em 33 a cada saída de bola, recarga passiva. Sem *boost pads* no MVP. |
| Desempenho | ≥ 45 FPS de média em celular intermediário; ≤ 120 draw calls; sem *shadow maps* (sombras falsas tipo "blob"). |
| Primeiro PR | Câmera atrás do carro + joystick + tela cheia + interpolação + correção da velocidade do carro. É o maior ganho de *feeling* no celular. |

### 0.2 Diagnóstico: por que está ruim no celular hoje

Medido no código de `main` (com simulação headless quando indicado):

1. **O carro do jogador é lento e a IA é mais rápida que ele.** Com o acelerador cheio, o carro do jogador estabiliza em **~4 u/s** (medido: 2,2 u/s aos 0,5 s; 3,9 u/s aos 2 s), embora `CAR.maxSpeed` seja 15. A IA no difícil anda a ~9 u/s. A causa é dupla: o corpo do Rapier tem `linearDamping = CAR.rollingDrag` (2,2/s, `physics-runtime.ts:53`) e, além disso, a aceleração manual usa `damp` com taxa 20/15 ≈ 1,33/s (`physics-runtime.ts:144-145`). Os dois freiam juntos. A IA não sofre isso porque define a velocidade direto com `setLinvel`.
2. **Tudo é minúsculo.** A câmera é ortográfica e enquadra o campo inteiro. Segundo a v2 (seção 1.6), num celular deitado a bola fica com ~11 px e o carrinho com ~22 px.
3. **A cena não ocupa a tela.** No celular deitado, a cena tem `100dvh − 88px` (`style.css`), com barra superior e ferramentas fora dela. Numa tela de 390 px de altura sobram ~300 px para o jogo.
4. **As safe-areas não funcionam no iPhone.** O `index.html` não tem `viewport-fit=cover`, então `env(safe-area-inset-*)` vale 0 no iOS e os botões podem ficar sob o notch ou a barra de gestos.
5. **Os controles são digitais.** São quatro botões liga/desliga (virar esquerda, virar direita, ré, acelerar) mais o CHUTE. O polegar esquerdo alterna entre dois botões de direção e o direito entre pedais e chute. Não há meio-termo de direção nem de velocidade.
6. **Não há interpolação de renderização.** A física roda em passos fixos de 1/60 s e a cena mostra o último passo. Com quadros a 45 FPS, cada quadro anda 1 ou 2 passos. Isso é quase invisível na câmera de cima, mas vira tremedeira numa câmera atrás do carro.
7. **O carregamento é pesado.** O chunk do Rapier tem 2,2 MB (830 kB com gzip), porque o pacote `-compat` embute o WASM em base64.

### 0.3 Leitura crítica da visão "RL simplificado"

A direção é viável nesta stack, mas quatro partes do Rocket League são ruins ou inviáveis aqui. O design já troca cada uma por uma alternativa:

| Parte do RL | Problema no celular / nesta stack | Alternativa adotada |
| --- | --- | --- |
| Aéreos, controle no ar, dirigir na parede e no teto | O carro tem pitch e roll travados (`setEnabledRotations(false, true, false, true)` em `physics-runtime.ts:54`). Liberar isso exige um controlador 6-DoF novo, e o touch não tem entradas sobrando para controle no ar. É o item mais caro e o que mais afasta o jogador casual. | **Fora do MVP.** Carro sempre de pé, com pulinho vertical. A "bola alta" é resolvida pelo TOQUE contextual (cabeçada) e pela gravidade reduzida da bola. |
| Joystick "aponta e o carro vai" em direção **absoluta** | Com a câmera presa atrás do carro, a direção absoluta entra em laço: o carro gira, a câmera gira junto, o alvo gira de novo. Segurar o stick para baixo faz o carro girar sem parar. | Stick **relativo ao carro**. Como a câmera está atrás do carro, isso continua parecendo "aponta e vai": para a direita na tela = curva para a direita. A direção absoluta só faria sentido com câmera fixa. |
| Câmera 3D atrás do carro numa tela de 6" | Perde-se a noção de onde estão a bola e os outros carros. É um sinal forte que a própria Psyonix, no RL Sideswipe (a versão para celular), trocou o 3D por uma visão lateral 2D. | Mitigação em camadas: FOV largo, assistência de bola na câmera, indicador de bola fora da tela, sombra da bola, arena menor que a do RL, 1×1 e 2×2 no máximo. **Plano B barato:** o preset "alta" (câmera de perseguição mais alta, visão 3/4), que já sai no PR 1 só com knobs. |
| *Boost pads*, demolições, replays, flip com cancelamento | Mais regras para explicar, mais objetos na tela, mais testes. | Turbo com recarga passiva; bate-bate entre carros só com física; sem replays. |

Duas restrições de plataforma também moldam o design e não podem ser contornadas:

- **iPhone/Safari:** não existe Fullscreen API para elementos (só vídeo), nem trava de orientação, nem `navigator.vibrate`. O jogo **não pode depender** de nenhum dos três. Eles entram só como melhoria no Android.
- **Marca:** "Rocket League" é marca registrada. Nenhum nome, logo ou asset do RL entra no jogo nem na página. A referência fica só nos documentos internos.

---

## 1. Visão de produto (1 página)

**Pitch:** *Futebol de carrinhos 3D direto no navegador do celular: um polegar pilota, o outro dá turbo e toques numa bola gigante, em partidas de 2 minutos contra a IA.*

**Público-alvo proposto:** jogadores casuais de celular (Brasil, pt-BR) que abrem um link e querem jogar em segundos, em pausas curtas como fila, intervalo ou transporte; e fãs de futebol de carrinho que querem algo sem curva de aprendizado. No desktop, o mesmo jogo com teclado ou controle.

**Sessão típica:**

| Item | Alvo |
| --- | --- |
| Do link ao primeiro toque na bola | ≤ 20 s (menu de 1 tela, contagem de 3 s) |
| Partida | 2:00 de bola rolando ≈ 3 min de relógio, com saídas de bola e comemorações |
| Sessão | 2 a 3 partidas ≈ 10 min |
| Gols por partida | 2 a 5 no total (um gol a cada ~30–60 s), ajustado pelo tamanho do gol |

**"Gostoso de jogar" em critérios observáveis** (medidos em playtest no celular do André e com `?debug=1`):

1. **Tamanho:** no celular deitado (844 × 390), o próprio carro aparece com ≥ 100 px de largura e a bola com ≥ 30 px a 30 u de distância. Hoje são ~22 px e ~11 px.
2. **Resposta:** o carro chega a 90% da velocidade máxima em ≤ 0,8 s com o stick no máximo, e o toque aparece no próximo passo de física (≤ 17 ms) mais um quadro.
3. **Fluidez:** ≥ 45 FPS de média e nenhum quadro acima de 100 ms numa partida de 2 min.
4. **Sem olhar para os dedos:** o joystick nasce onde o polegar toca; nenhum toque fora dos controles rola a página, dá zoom ou abre menu.
5. **Contato com a bola:** um jogador novo toca na bola ≥ 15 vezes e chuta em direção ao gol ≥ 3 vezes por partida (contadores do `?debug=1`).
6. **Saída de bola:** no kickoff, alguém toca na bola em ≤ 3 s depois do "VAI!".
7. **Bola nunca presa:** reinícios por bola presa ≤ 0,5 por partida, em média.
8. **Justiça percebida:** no Fácil, um jogador novo vence pelo menos 1 das 2 primeiras partidas. A IA nunca anda mais rápido nem chuta mais forte que o jogador.

**Fora do escopo (MVP):** jogo online ou multijogador, login, anúncios, loja e compras, ranking, personalização de carros, replays, aéreos (voar com turbo, controle no ar), dirigir na parede ou no teto, *boost pads*, demolições, modo retrato durante a partida, tutorial longo (só dicas no jogo), música licenciada.

---

## 2. Core loop e regras

### 2.1 Loop

```
Menu (dificuldade) → Contagem 3-2-1 → Disputa (dirigir, turbo, toque) → GOL! (2 s) → Contagem → ... → 0:00 → Resultado → Próxima partida / Revanche
```

### 2.2 Tamanho do time

**Recomendação: 1×1 primeiro e 2×2 como modo principal depois.**

- **1×1** nos PRs 1 a 6: é o modo mais fácil de ler, de ajustar e de testar; cada mudança de *feeling* aparece sem ruído. A IA tem uma só responsabilidade.
- **2×2** no PR 7, como padrão do menu (com 1×1 como "Duelo"): um aliado IA cobre o gol e perdoa os erros do novato. Isso é mais divertido no celular, onde errar a bola é comum. O aliado segue as regras da v2 (seção 5.4: perseguidor único com histerese e aliado que cede a bola ao jogador).
- **3×3 sai.** Com a câmera atrás do carro numa tela pequena, seis carros viram confusão visual, o custo de draw calls dobra e a IA por papel (atacante/apoio/goleiro) é o trabalho mais caro da v2.
- Some a regra "ganha aliado ao marcar / perde ao sofrer" (já condenada na v2). Os times são fixos durante a partida.

### 2.3 Tempo × gols

**Recomendação: partida por tempo.** 2:00 de bola rolando; o relógio para durante a comemoração e a contagem. Vence quem tiver mais gols. Empate em 0:00 → **gol de ouro** por até 60 s; se ninguém marcar, a partida termina empatada.

| Formato | A favor | Contra |
| --- | --- | --- |
| **Tempo (2:00 + gol de ouro)** | Sessão previsível (~3 min); cria o "final de jogo" com pressão; um 0×1 continua jogável. | Um empate pode frustrar (mitigado pelo gol de ouro). |
| Primeiro a 3 gols (atual) | Simples; já existe. | Partida sem duração definida; contra uma IA equilibrada pode se arrastar; quem leva 0×2 cedo sente que acabou. |

Essa é a decisão aberta 2 (seção 11).

### 2.4 Saída de bola (kickoff)

- A bola fica parada no centro. Os carros aparecem em posições **espelhadas por ponto** (`(x, z)` → `(−x, −z)`), então as distâncias até a bola são idênticas.
- 1×1: um de três pares sorteados por semente a cada kickoff: centro `(∓20, 0)`, diagonal esquerda `(∓16, ±14)` e diagonal direita `(∓16, ∓14)`. Em 2×2, o segundo carro de cada time sai de `(∓34, 0)`, perto do próprio gol.
- Contagem de 3 s ("3", "2", "1", "VAI!"): os carros ficam travados, mas a câmera e o stick já respondem, para o jogador posicionar os polegares. O turbo de todos começa em 33.
- Quem sofreu o gol **não** ganha vantagem (a `kickoffAdvantage` da v2 sai): a simetria é mais fácil de entender e de testar.

### 2.5 Gol e reinício

1. A bola cruza inteira a linha do gol, dentro da caixa do gol: `GOL!`. O placar sobe, o relógio para e o celular vibra (Android).
2. Por 2 s a bola some com um anel de explosão na cor do time e os carros continuam livres para dirigir (é divertido e não custa nada).
3. Todos são teleportados para o próximo kickoff e começa a contagem.
4. Bola presa (regra de segurança, seção 5.6): reinicia com kickoff neutro, sem gol.

Não existem faltas, impedimento nem lateral: a arena é fechada e a bola está sempre em jogo.

### 2.6 Progressão

Ficam as três dificuldades (Fácil, Médio, Difícil). Ganhar mostra **"Próxima partida"**, que sobe um nível de pressão da IA (reação, mira, uso de turbo; seção 6.4); perder mostra **"Revanche"** no mesmo nível. Não aparecem carros extras por rodada.

---

## 3. Controles mobile-first

Este é o ponto mais crítico. O esquema abaixo busca três coisas: o jogador nunca precisa olhar para os dedos, cada polegar tem uma função, e o teclado, o controle e a IA produzem **o mesmo comando** para a física.

### 3.1 Esquemas avaliados

| Critério | **A. Joystick flutuante, relativo ao carro, intensidade = acelerador (recomendado)** | B. Volante (◀ ▶) + pedais (▲ ▼) — o atual | C. Joystick "aponta e vai" em direção absoluta |
| --- | --- | --- | --- |
| Polegar esquerdo | Direção **e** velocidade num gesto só | Só direção, digital | Direção absoluta |
| Polegar direito | Livre para TOQUE e TURBO | Pedais **e** chute disputam o mesmo polegar | Livre |
| Curvas suaves e meio-gás | Sim (analógico) | Não (liga/desliga) | Sim |
| Funciona com câmera atrás do carro | Sim: "direita na tela" = "direita do carro" | Sim | **Não**: entra em laço (seção 0.3) |
| Precisa olhar para os botões | Não: o stick nasce sob o polegar | Sim: 4 alvos pequenos | Não |
| Ré | Puxar o stick para trás | Botão ▼ | Implícita (meia-volta) |
| Custo | Média: novo componente + função pura | Já existe | Média |

**Decisão: esquema A.** Aceleração por intensidade em vez de aceleração automática: com o polegar pousado sem empurrar, o carro anda devagar ou para, o que dá controle fino perto da bola. Para ir no máximo, basta empurrar até 85% do raio.

### 3.2 Matemática do stick (função pura)

```ts
// src/game/touch-stick.ts
export type StickVector = { x: number; y: number }; // y positivo = para cima na tela, |v| ≤ 1
export type DriveAxes = { throttle: number; steer: number }; // -1..1; steer positivo = direita

export function normalizeStick(dxPx: number, dyPx: number, radiusPx: number): StickVector;
export function stickToDrive(stick: StickVector, params = TOUCH.stick): DriveAxes;
export function followBase(base: { x: number; y: number }, pointer: { x: number; y: number }, radiusPx: number, followFactor: number): { x: number; y: number };
```

`stickToDrive`:

```
m = clamp((|s| − deadzone) / (saturation − deadzone), 0, 1)        // deadzone 0,12; saturation 0,85
θ = atan2(s.x, s.y)                                                // 0° = para cima; +90° = direita
se |θ| ≤ frontHalfAngle (110°):  throttle = m;   steer = clamp(θ / steerFullAngle (75°), −1, 1)
senão (ré, 140° de abertura atrás): throttle = −m;  steer = sinal(θ) × clamp((180° − |θ|) / reverseSteerFullAngle (70°), 0, 1)
```

- Stick para a direita (θ = 90°): `steer = 1` e `throttle = m`. O carro faz a curva para a direita andando. É o "aponta e vai".
- Stick para baixo: ré reta. Para baixo e à direita: ré com a traseira indo para a direita da tela. O controlador já inverte a direção em ré (`reverseSteeringThreshold`), então o sinal de `steer` é o mesmo nas duas zonas.
- Testes de tabela: (0, 0) → (0, 0); (0, 0,1) → (0, 0) (zona morta); (0, 1) → (1, 0); (1, 0) → (1, 1); (0, −1) → (−1, 0); (0,7; −0,7) → throttle −1 e steer ≈ 0,64; continuidade (variação de θ de 1° muda `steer` em ≤ 0,02 fora das fronteiras de zona).

### 3.3 Layout touch (paisagem)

```
┌──────────────────────────────────────────────────────────────┐
│ [II]            VOCÊ 1 : 0 AZUL    1:23            [BOLA]    │  ← HUD (topo, 56 px)
│                                                              │
│                         (cena 3D)                            │
│   zona do stick                                              │
│   (metade esquerda,           carro              (TURBO)     │
│    abaixo do HUD)                                     (TOQUE)│
│        ◯ ← nasce sob o polegar                               │
└──────────────────────────────────────────────────────────────┘
```

| Elemento | Tamanho (px CSS) | Posição |
| --- | --- | --- |
| Zona do stick | Metade esquerda da tela, abaixo do HUD | Toque em qualquer ponto cria o stick ali |
| Base do stick | Raio 64 (diâmetro visual 128); botão interno de 52 | A base é empurrada para ficar ≥ 64 px dentro da safe-area. Se o dedo passa de 1,3 × raio, a base segue o dedo (`followBase`). |
| **TOQUE** | 88 (principal) | Canto inferior direito, a `max(12px, safe-area) + 12px` das bordas |
| **TURBO** | 76, com anel do medidor | Acima e à esquerda do TOQUE, 14 px de folga |
| BOLA (ball cam) | 52 | Canto superior direito, abaixo do HUD |
| Pausa | 48 | Canto superior esquerdo |

- **Mínimos:** nenhum alvo abaixo de 48 px (≈ 9 mm; acima dos 44 pt da Apple e do critério AAA 2.5.5 da WCAG). Botões de ação ≥ 72 px. Folga ≥ 12 px entre alvos.
- **Dois botões com um polegar:** o cluster direito tem **um** handler de ponteiro com teste de acerto próprio, sem `setPointerCapture` por botão. Arrastar o dedo do TURBO para o TOQUE solta um e aperta o outro. Uma faixa de 18 px entre eles (`TOUCH.dualPressSlackPx`) aperta **os dois** ao mesmo tempo (turbo + toque com o polegar "na costura", como se faz no controle).
- **Multitoque:** um `pointerId` por zona (stick ou cluster direito), como o padrão atual de `app.tsx`.
- **Safe-area:** adicionar `viewport-fit=cover` ao `<meta name="viewport">`. Todos os controles usam `env(safe-area-inset-left/right/bottom)`. Em paisagem o notch fica na lateral, então os insets esquerdo e direito são os que importam.
- **Gestos do navegador:** a "casca" do jogo usa `touch-action: none`, `overscroll-behavior: none`, `user-select: none` e `-webkit-touch-callout: none`, e chama `preventDefault` em `contextmenu`. Isso evita rolagem, puxar para atualizar, zoom por toque duplo e o menu de pressão longa.
- **Feedback visual:** o botão apertado acende; o TOQUE mostra a recarga (varredura `conic-gradient`, como hoje); o anel do TURBO mostra o medidor via variável CSS escrita por `ref` (sem `setState` a 60 Hz).

### 3.4 Orientação e tela cheia

- **A partida é só em paisagem** nos aparelhos com toque. Em retrato, com FOV vertical limitado a 75°, sobram ~39° de FOV horizontal: o jogador não veria nada dos lados. Em retrato aparece "Gire o celular para jogar" e a partida pausa sozinha. O menu funciona nas duas orientações.
- Ao tocar em **ENTRAR EM CAMPO**:
  - **Android/Chrome:** `gameShell.requestFullscreen()` e depois `screen.orientation.lock('landscape')`, os dois com `.catch(() => {})`. A trava de orientação só funciona em tela cheia.
  - **iPhone:** sem API; a casca usa `position: fixed; inset: 0; height: 100dvh`. O menu sugere "Adicionar à Tela de Início". Um `manifest.webmanifest` estático com `"display": "fullscreen"` e `"orientation": "landscape"` vale para o app instalado no Android; no iOS o app instalado abre sem a barra do Safari.
- Durante a partida, a casca cobre a página inteira: placar, relógio e botões viram HUD sobre a cena. A página atual (cabeçalho, ferramentas, notas) aparece só no menu.

### 3.5 Háptico

| Evento | Android (`navigator.vibrate`) | iPhone (sem API) |
| --- | --- | --- |
| TOQUE acertou a bola | 15 ms | Clarão no botão + som |
| Gol a favor | `[40, 60, 40]` | Som e texto |
| Gol contra | 80 ms | Som e texto |
| Turbo acabou | 10 ms | Anel do medidor pisca |

Alternância "Vibração" no menu de pausa, salva em `localStorage`. Nada de vibração contínua.

### 3.6 Teclado e controle (gamepad)

| Ação | Teclado | Gamepad (mapeamento *standard* do W3C) |
| --- | --- | --- |
| Acelerar / frear e ré | W ou ↑ / S ou ↓ | RT (`buttons[7]`, analógico) / LT (`buttons[6]`) |
| Virar | A D ou ← → | Analógico esquerdo X (`axes[0]`), zona morta 0,15 |
| TOQUE | Espaço ou K | A (`buttons[0]`) |
| TURBO | Shift ou L | B (`buttons[1]`) ou X (`buttons[2]`) |
| Ball cam | C | Y (`buttons[3]`) |
| Pausa | P ou Esc | Start (`buttons[9]`) |

- O teclado é digital; para não "dar tranco", `steer` e `throttle` sobem em rampa (`KEYBOARD.steerRampPerSecond` = 8, ou seja, ~0,12 s de 0 a 1).
- O gamepad é lido a cada quadro com `navigator.getGamepads()`, sem dependência nova. Fica opcional: se não houver controle, nada muda.
- Todas as fontes (touch, teclado e gamepad) somam no mesmo `ControlFrame` (seção 5.1). Os contadores de aperto (`kickPresses`, `ballCamToggles`) seguem o modelo de contador monotônico da v2 (seção 3.1), que continua válido.

---

## 4. Câmera

### 4.1 Perspectiva atrás do carro

`THREE.PerspectiveCamera` substitui a `OrthographicCamera`. O comportamento fica numa função pura testável:

```ts
// src/game/chase-camera.ts
export type CameraMode = 'car' | 'ball';
export type CameraPreset = 'perto' | 'alta';
export type CameraRig = { x: number; y: number; z: number; yaw: number; fovDeg: number };
export type CameraTarget = {
  carX: number; carY: number; carZ: number; carHeading: number; carSpeed: number; boosting: boolean;
  ballX: number; ballY: number; ballZ: number;
  mode: CameraMode;
};
export function stepChaseCamera(rig: CameraRig, target: CameraTarget, dt: number, aspect: number, arena: ArenaDimensions, preset: CameraPreset): { rig: CameraRig; lookAt: { x: number; y: number; z: number } };
export function verticalFovForAspect(aspect: number, hFovDeg: number, minVDeg: number, maxVDeg: number): number;
export function clampCameraToArena(pos: { x: number; y: number; z: number }, arena: ArenaDimensions, margin: number): { x: number; y: number; z: number; lostDistance: number };
```

| Knob | `perto` (padrão) | `alta` (plano B) |
| --- | --- | --- |
| Distância atrás do carro | 8,5 u (~2,4 comprimentos de carro) | 13 u |
| Altura | 3,6 u | 9 u |
| Ponto de mira | 5 u à frente, a 1,2 u de altura | 6 u à frente, no chão |
| Inclinação resultante | ~10° para baixo | ~25° (visão 3/4) |
| Carro na tela (844 × 390) | ~133 px de largura | ~77 px |

- **FOV:** o alvo é o FOV **horizontal** (95°), porque é a largura que dá noção do campo. O vertical sai de `verticalFovForAspect`, limitado a [50°, 75°]. Celular deitado (aspecto 2,16): ~53,5° vertical. Desktop 16:9: ~63°. Com turbo, +6° de FOV com interpolação (sensação de velocidade); sem isso quando `prefers-reduced-motion`.
- **Follow suave:** a posição converge com taxa de 10/s e o yaw com 6/s (meia-vida de ~0,12 s), com atraso máximo de 35° em curvas fechadas. Sem rolagem (*roll*) e sem tremor de câmera, para não enjoar.
- **Assistência de bola** (só no modo `car`): se a bola está a até 70° da frente da câmera e a menos de 35 u, o yaw se desvia até 15° na direção dela e o ponto de mira sobe um pouco com a altura da bola. O desvio pequeno mantém "direita no stick = direita na tela".
- **Tamanhos esperados** no celular deitado (844 px de largura, FOV horizontal de 95°): bola com raio 1,7 a 10 u à frente do carro ≈ 71 px; a 30 u ≈ 34 px; no fundo da arena (~80 u) ≈ 16 px. Hoje a bola tem ~11 px em qualquer lugar.
- O PR 1 entrega os dois presets, com alternância no menu de pausa ("Câmera: Perto / Alta") e salvamento em `localStorage`. O André compara no próprio celular antes de seguir.

### 4.2 Ball cam

**Recomendada como alternância, desligada por padrão.** Com o carro sempre no chão e uma bola que quica alto, olhar para a bola ajuda a acertar o tempo da cabeçada. Para o novato, porém, a câmera girando em torno da bola desorienta, porque o stick é relativo ao carro e não à tela.

- No modo `ball`, o yaw aponta do carro para a bola (no plano) e a câmera fica atrás do carro, nessa linha. O ponto de mira fica 60% do caminho até a bola, e a altura sobe 0,35 × a altura da bola.
- Com a bola a menos de 4 u no plano (em cima do carro), o yaw congela para não girar loucamente.
- Botão BOLA no touch, C no teclado e Y no gamepad. O estado aparece no botão.

### 4.3 Perto das paredes

A arena é convexa (caixa com chanfros) e só tem duas reentrâncias, os gols. Por isso não precisa de *raycast*:

- `clampCameraToArena` mantém a câmera a `CAMERA.wallMargin` (1 u) dentro das paredes, dos chanfros e do teto. Dentro do gol, os limites são os da caixa do gol.
- Se a câmera "perdeu" distância ao ser empurrada para dentro, ela sobe `0,5 × lostDistance` e nunca fica a menos de 4,5 u do carro. De ré contra a parede, a câmera passa por cima do carro e a visão vira quase de cima, em vez de atravessar a parede.
- As paredes visuais são opacas até 2 u de altura e transparentes acima disso (seção 7). A câmera nunca fica "dentro" de uma parede sólida.
- No PR 1, a arena antiga ainda tem paredes de ~1,1 u, que a câmera (a 3,6 u) passa por cima. O *clamp* entra no PR 2, junto com as paredes altas.

### 4.4 Indicador de bola fora da tela

- A cada quadro, a bola é projetada (`Vector3.project`). Se ficar fora de ±0,9 do NDC ou atrás da câmera, aparece uma **seta amarela** na borda da tela, apontando na direção da bola, com a distância em metros ("12 m") quando passar de 20 u.
- A borda é uma elipse inscrita na tela, recuada pelas safe-areas, pelo HUD e pelos clusters de botões (`CAMERA.indicatorInsetPx` = 56).
- Implementação: um elemento DOM posicionado por `transform`, escrito por `ref`. Zero draw calls. Função pura `offscreenIndicator(ndc, behind, insets) → { x, y, angleRad } | null`, testada para bola atrás, acima e nos quatro lados.
- No 2×2, a mesma seta em versão menor mostra o aliado quando ele está fora da tela (PR 7).

---

## 5. Física do carro e da bola (Rapier)

### 5.1 Um controlador para todos

O maior problema estrutural de hoje é a assimetria: o jogador anda por impulsos (e ficou lento, seção 0.2), e a IA define a velocidade com `setLinvel` a cada passo, ignorando massa e empurrões (v2, seção 1.3). Na v3, **jogador e IA passam pela mesma função**:

```ts
// src/game/controls.ts
export type ControlFrame = { throttle: number; steer: number; boost: boolean; kickPresses: number; ballCamToggles: number };
export type DriveCommand = { throttle: number; steer: number; boost: boolean; kick: boolean }; // kick = aperto já consumido neste passo

// src/game/vehicle-controller.ts
export type VehicleState = { vx: number; vy: number; vz: number; y: number; heading: number; grounded: boolean; boost: number; dashTime: number; kickCooldown: number };
export type VehicleStep = { heading: number; impulse: { x: number; y: number; z: number }; boost: number; dashStarted: boolean };
export function stepVehicle(state: VehicleState, command: DriveCommand, dt: number, params = CAR): VehicleStep;
export function isGrounded(y: number, vy: number, params = CAR): boolean;
```

- O jogador transforma o `ControlFrame` em `DriveCommand`. A IA produz `DriveCommand` direto (seção 6). O runtime aplica `impulse` ao corpo e `heading` à rotação, igual para todos.
- **Correção da velocidade (PR 1):** `linearDamping` do corpo do carro passa a 0. O arrasto vira só o `damp` do controlador, com taxas separadas: `throttleResponse` 3,8/s (90% da velocidade em ~0,6 s; hoje é 1,33/s e ~1,7 s, sem contar o amortecimento extra), `brakeResponse` 8/s e `coastResponse` 0,8/s.
- **Aderência lateral independente do quadro:** hoje há duas fórmulas para a mesma ideia. O carro do jogador aplica `v_lateral × 0,78` como impulso sem multiplicar pela massa (remove ~17% da velocidade lateral por passo), enquanto `getLateralRecoveryImpulse` multiplica pela massa. As duas dependem da taxa de passos. A v3 usa uma fórmula só, como fração removida por segundo: `1 − exp(−lateralGripPerSecond × dt)`.
- **Velocidades:** máxima 20 u/s (~5,7 comprimentos de carro por segundo), ré 8 u/s, turbo até 30 u/s. Atravessar a arena (80 u) leva ~4 s sem turbo e ~2,7 s com turbo.
- **Direção:** 2,6 rad/s em baixa velocidade, caindo para 1,9 rad/s na máxima (raio de curva ~10 u a 20 u/s). Sem freio de mão no MVP: em baixa velocidade o stick já faz curva fechada.
- **Carro sempre de pé:** continua com pitch e roll travados. Nunca capota, nunca precisa de "desvirar".
- **Hitbox:** o cilindro (r = 1,5) vira `ColliderDesc.roundCuboid` com meias-medidas totais de 1,45 × 0,6 × 1,75 (borda arredondada de 0,25), alinhado ao modelo visual (~3,1 × 3,5 u). Isso dá ao carro um **nariz** de verdade para conduzir a bola e para o bate-bate. As quinas arredondadas evitam a instabilidade que a v2 temia nas caixas. Entra no PR 3, com teste de estabilidade contra parede e chanfro.
- **Bate-bate:** colisões entre carros ficam só por física (restituição do carro). Agora que a IA também responde a impulsos, empurrar o adversário funciona dos dois lados. Sem demolição.

### 5.2 Turbo

```ts
// src/game/turbo.ts
export type TurboState = { meter: number; idleTime: number };
export function stepTurbo(state: TurboState, wants: boolean, dt: number, params = TURBO): { state: TurboState; active: boolean };
```

| Knob | Valor | Efeito |
| --- | --- | --- |
| `start` | 33 | Medidor no kickoff |
| `drainPerSecond` | 33 | ~3 s de turbo com o medidor cheio |
| `regenPerSecond` | 10 | Recarga passiva: de 0 a 100 em 10 s |
| `regenDelaySeconds` | 0,6 | Só recarrega depois de 0,6 s sem usar |
| `minToStart` | 5 | Evita "piscar" com o medidor quase vazio |
| `CAR.boostAcceleration` | 14 u/s² | De 20 para 30 u/s em ~0,7 s |

O turbo só empurra para a frente. A IA usa o mesmo medidor. *Boost pads* ficam para depois do MVP.

### 5.3 TOQUE: o que acontece com o chute do PR #3

**Decisão: o chute vira TOQUE, um *dash* curto que acerta a bola.** Hoje o chute é um impulso "mágico" a até 1 u de distância, e apertar sem a bola na zona não faz nada visível. Como *dash*, o botão sempre faz algo: o carro dá um avanço curto com um pulinho e inclina o nariz, e se a bola estiver na zona durante o avanço, ela sai com a força de `kick.ts`. Isso imita o *front flip* do RL com um botão só e continua justo, porque a IA usa a mesma função.

| Elemento de `kick.ts` | Na v3 |
| --- | --- |
| `isInKickZone` | Fica. Ganha parâmetros de geometria (frente da hitbox e raio da bola) em vez de ler `CAR.radius` e `BALL.radius` fixos. `maxBallHeight` sobe para 4,6 (centro da bola). |
| `kickDirection`, `applyWallGuard`, `kickPower`, `computeKickTarget`, `impulseForKickTarget` | Ficam. `basePower` 16, `speedTransfer` 0,6, `maxPower` 34. |
| `KICK.lift` fixo (0,12) | Vira **elevação contextual**: `lift = lerp(liftGround 0,12, liftHigh 0,45, smoothstep(2,0; 4,6; bola.y))`. Bola no chão sai rasteira; bola alta sai em cabeçada. |
| `stepKickTimer` (buffer + recarga) | Fica. O buffer vira a **janela do dash** (`dashSeconds` 0,25): se a bola entrar na zona durante o avanço, o toque acontece uma vez. A recarga sobe para 0,9 s, porque agora o toque também move o carro. O `whiffCooldown` sai: o próprio avanço já é o custo. |
| `resolveSimultaneousKicks` | Fica sem mudança (dividida justa). |
| `shouldAiKick`, `kickAimDotFor`, `kickPowerFactorFor`, `kickReactionFor` | Ficam, alimentados pela tabela de pressão da seção 6.4. |
| Invariante "chute nunca passa do travessão" (v2) | **Sai.** Com teto e parede acima do gol, a bola por cima do gol volta para o jogo. |
| `KICK.recoil` (reservado em 0) | Pode ser ligado (0,15): agora a IA também sofre recuo. |
| `chargeSeconds`, `coastSeconds` | Saem (não usados). |

O avanço: `+dashSpeed` (8 u/s) na direção do nariz, limitado a `boostMaxSpeed + 4`, e `vy = hopSpeed` (3,5 u/s, sobe ~0,6 u). Se a bola estiver alta e na zona no plano, o pulinho é maior (`highBallHopSpeed` 5,5). A inclinação de nariz (25°) é **só visual** no modelo Three; a física continua de pé.

### 5.4 Pulo no MVP

**Sem botão de pulo separado no MVP.** O TOQUE já tem pulinho e cabeçada contextual. Um terceiro botão no polegar direito disputa espaço com TURBO e TOQUE, e "pular, esperar e acertar no ar" é exatamente a habilidade de RL que o casual não tem. O estado `grounded` e `isGrounded` entram mesmo assim no PR 3, então um botão PULO depois custa pouco. Essa é a decisão aberta 3.

### 5.5 Bola

| Knob | Hoje | v3 | Por quê |
| --- | --- | --- | --- |
| `radius` | 0,9 | **1,7** | Diâmetro ~ comprimento do carro: fácil de acertar e de ver. No RL a bola é ~1,5× o carro; 1,7 é um meio-termo que cabe nos gols e na câmera. |
| `mass` | 1 | 1,2 | Empurrões menos "pipoca". |
| `restitution` | 0,42 (média com o chão 0,5) | **0,72**, regra `CoefficientCombineRule.Max` | Quica de verdade em chão, paredes e teto. |
| `friction` | 0,62 | 0,4 | Rola mais. |
| `linearDamping` | 0,3 | **0,08** | A bola "flutua" e atravessa a arena. |
| `angularDamping` | 0 | 0,4 | Evita giro eterno. |
| `gravityScale` | 1 | **0,8** | Quiques mais lentos e legíveis, sem mexer na gravidade dos carros (`RigidBodyDesc.setGravityScale`). |
| `maxSpeed` | 28 | 45 | Acima do turbo (30). |

- **CCD:** continua ativo. A 45 u/s, a bola anda 0,75 u por passo, menos que o raio (1,7). Paredes com 1 u de espessura de collider.
- **Gol:** a bola precisa caber: gol de 22 × 8 u (largura × altura) e 6 u de profundidade (seção 5.6).
- **Altura máxima:** o toque mais forte dá `vy` ≈ 34 × 0,45 = 15,3 u/s; com `g` = 7,85, o pico é ~14,9 u mais o raio, abaixo do teto (20). Teste analítico.

### 5.6 Arena fechada

| Knob | Valor | Hoje |
| --- | --- | --- |
| Linha do gol (`goalLineX`) | ±40 (80 u de gol a gol) | ±38,36 |
| Paredes laterais (`sideWallZ`) | ±28 (56 u de largura) | ±20,09 |
| Teto (`ceilingY`) | 20 | sem teto |
| Chanfro vertical nos 4 cantos | 8 u de cateto, a 45° | sem chanfro |
| Gol | 22 de largura × 8 de altura × 6 de profundidade | 14,7 × 3,5 × 2,8 |
| Parede visual | Opaca até 2 u, vidro até 6 u, collider até o teto | 1,1 u |

```ts
// src/game/arena-dimensions.ts
export type ArenaDimensions = { goalLineX: number; sideWallZ: number; ceilingY: number; cornerChamfer: number; goalHalfWidth: number; goalHeight: number; goalBackX: number };
export function createArenaDimensions(params = ARENA): ArenaDimensions;
export function arenaInvariants(dims: ArenaDimensions, ball: typeof BALL, car: typeof CAR): string[]; // lista vazia = ok

// src/game/physics-world.ts
export function createStaticArena(world: RAPIER.World, dims: ArenaDimensions): void;
export function collisionGroups(member: number, filter: number): number;
```

- Tudo em **unidades de mundo**: sem a "maquete" escalada de forma não uniforme (`scaleX` 2,8, `scaleZ` 2,45) que hoje deforma círculo e traves (v2, seção 1.5). Os nomes ambíguos `halfWidth`/`halfLength` somem.
- Colliders estáticos: chão, 2 paredes laterais, 4 trechos de parede de fundo (dos lados do gol), parede acima do gol, 4 chanfros (cuboides girados 45°), teto e a caixa de cada gol (laterais, fundo e teto). **Sem bolsões:** a bola só entra no gol pela boca. A "cortina" da v2 sai: o carro pode entrar no gol (como no RL).
- `getScoringSide` continua com a mesma regra ("bola inteira além da linha, dentro da boca"), lendo `ArenaDimensions`.
- `containPlanarBody` continua como **rede de segurança**, agora também no eixo Y (teto). Contador no `?debug=1`; o esperado é ~0 atuações.
- **Sanca para a bola (curva entre chão e parede) foi avaliada e descartada no MVP.** Com o carro de pé, a curva teria de ser só para a bola (via *collision groups*), e o carro atravessaria visualmente a curva. Com paredes quicantes e chanfros, a bola já não fica presa.
- **Escala:** a arena v3 tem 80 × 56 u jogáveis (+45% de área sobre os 76,7 × 40,2 de hoje) e proporção 1,43:1 (hoje 1,91:1; o RL tem ~1,25:1). A largura extra dá espaço para contornar a bola com a câmera baixa. Com 2×2, ficam ~1100 u² por carro.

### 5.7 Bola presa

- `stuck-monitor.ts` continua (bola parada perto da borda por 4 s → kickoff neutro), com margens absolutas ajustadas ao novo raio.
- Entra o detector de "bola imprensada" da v2 (seção 9): bola a menos de 0,5 u/s, com carros dos dois times a menos de 4 u, por 2,5 s → impulso vertical na bola ("bola ao alto"), sem reiniciar o lance.

### 5.8 Interpolação de renderização (PR 1)

O runtime guarda a pose anterior e a atual de cada corpo (posição e quaternion em `Float32Array`). A cena desenha `lerp`/`slerp` com `alpha = accumulator / STEP`. A câmera segue a pose **interpolada** do carro. Função pura `interpolatePose(prev, curr, alpha)`, testada. Sem isso, a câmera atrás do carro treme a qualquer taxa de quadros que não seja múltipla de 60.

### 5.9 Ordem dentro do passo fixo (v3)

1. Ler `ControlFrame` e consumir os apertos (contadores).
2. IA: decidir (no tick dela, seção 6.2) e produzir `DriveCommand`.
3. `stepTurbo` e `stepVehicle` para todos → impulsos e rotação.
4. Toques: zona → `stepKickTimer` → `resolveSimultaneousKicks` → impulso na bola (+ recuo).
5. `world.step(events)`.
6. Eventos de colisão (som, háptico), limites de velocidade, rede de segurança.
7. Gol, bola presa, bola imprensada → fase da partida (`match-clock.ts`).
8. Guardar a pose para interpolação.

---

## 6. IA

### 6.1 Princípios

- **Mesmas regras do jogador:** a IA só produz `DriveCommand` (|throttle| ≤ 1, |steer| ≤ 1, turbo e toque). Usa o mesmo `stepVehicle`, o mesmo medidor de turbo e a mesma zona e recarga do toque. Nunca usa `setLinvel` nem lê o input do jogador.
- **A dificuldade muda decisões, não física:** tempo de reação, horizonte de previsão, tolerância de mira, quando usa turbo e um ruído determinístico no alvo. Nenhum nível tem velocidade ou força acima do jogador.
- **Sem *rubber band*** no MVP: não ajusta a IA pelo placar.
- **Determinística em teste:** RNG com semente (`AI.seed`) para o ruído e o sorteio de kickoff.

### 6.2 Estrutura

```ts
// src/game/ball-prediction.ts
export type BallSample = { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
export function predictBall(start: BallSample, horizon: number, step: number, arena: ArenaDimensions, params = BALL): BallSample[];

// src/game/ai-driver.ts
export type AiMode = 'kickoff' | 'attack' | 'reposition' | 'defend' | 'recover';
export type AiMemory = { mode: AiMode; target: { x: number; z: number }; wantsBoost: boolean; wantsKick: boolean; blockedTime: number; recoveryTime: number };
export function thinkAi(memory: AiMemory, ctx: AiContext, level: AiLevel): AiMemory;      // 20 Hz
export function driveToward(car: VehicleState & { x: number; z: number }, memory: AiMemory): DriveCommand; // 60 Hz
```

- `predictBall` é uma simulação analítica barata (gravidade com `gravityScale`, quique no chão, nas paredes e no teto com a restituição da bola, arrasto), com passo de 1/30 s e horizonte de até 1,5 s: ≤ 45 iterações por decisão. Não usa o Rapier.
- A decisão roda a 20 Hz, escalonada por carro; a direção, a 60 Hz. `driveToward`: `steer = clamp(diferençaDeÂngulo / 45°, −1, 1)`; `throttle` reduzido em curvas fechadas; ré se o alvo estiver a mais de 120° e a menos de 6 u.

### 6.3 Comportamento mínimo (1×1)

| Modo | Quando | O que faz |
| --- | --- | --- |
| `kickoff` | Após o "VAI!" | Vai reto na bola com turbo, depois do tempo de reação do nível; dá TOQUE ao entrar na zona. |
| `attack` | A IA está do lado certo da bola (entre a bola e o próprio gol) | Busca o primeiro instante `t` em que a bola prevista está baixa (y ≤ zona) e alcançável (`distância ≤ velocidade estimada × t`). Mira no **ponto de aproximação** = bola(t) − direção ao gol × (raio da bola + frente do carro + 0,5). Dá TOQUE quando `shouldAiKick` aprova. |
| `reposition` | A IA está do lado errado da bola | Contorna: alvo atrás da bola com 6 u de deslocamento lateral, pelo lado oposto ao próprio gol (para não fazer gol contra). |
| `defend` | A bola prevista vai para o terço do próprio gol, ou o adversário está com a bola de frente para o gol | Vai para a "sombra": o ponto a 35% do caminho do próprio gol até a bola. Se a previsão indicar gol em ≤ 1,5 s, intercepta com turbo. Sai do modo quando a bola passa do meio-campo. |
| `recover` | Travado (`blockedTime` > 1,2 s), como hoje | Ré com giro aleatório (semente) por 1,2 s. |

Isso basta para uma IA "divertida e justa": ela erra porque reage tarde, prevê pouco e mira com tolerância, não porque é aleatória. E ela não acampa no gol: o modo `defend` termina quando a bola sai do terço defensivo.

### 6.4 Níveis

Substituem a tabela de pressão da v2 (seção 5.5), que dependia de 3×3.

| Knob | Fácil | Médio | Difícil | Por partida vencida | Limite |
| --- | --- | --- | --- | --- | --- |
| `reactionSeconds` (atraso de percepção) | 0,40 | 0,25 | 0,12 | −0,03 | ≥ 0,08 |
| `predictionHorizon` (s) | 0,5 | 1,0 | 1,5 | +0,1 | ≤ 1,5 |
| `aimToleranceDeg` | 35 | 22 | 12 | −2 | ≥ 10 |
| `throttleCap` | 0,85 | 0,95 | 1,0 | +0,03 | ≤ 1,0 |
| `boostUsage` | só no kickoff | kickoff e defesa | sempre que útil | — | — |
| `targetNoise` (u) | 2,5 | 1,2 | 0,4 | −0,2 | ≥ 0,3 |

"Atraso de percepção" significa que a IA decide olhando o estado de `reactionSeconds` atrás (um *ring buffer* de amostras). Teste: todos os campos são monotônicos com as vitórias e respeitam os limites; `throttleCap` ≤ 1 sempre.

### 6.5 2×2 (PR 7)

- Reaproveita a v2 (seção 5.4): um perseguidor por time escolhido por custo com histerese (`selectAttacker` + `AI.chaserHysteresis` 3 u); o outro carro faz **goleiro-apoio**: sombra defensiva quando a bola está no próprio campo e apoio no meio-campo quando está no campo adversário.
- O aliado vermelho cede a bola ao jogador (`AI.allyYieldMargin` 6 u) e só persegue se estiver bem mais perto.
- Separação: se dois companheiros miram a menos de 5 u um do outro, o não perseguidor desloca o alvo 4 u para o lado.

---

## 7. Arte, legibilidade e desempenho mobile

### 7.1 Escala e legibilidade

| Item | Hoje | v3 |
| --- | --- | --- |
| Arena jogável | 76,7 × 40,2 u, sem teto | 80 × 56 u, teto a 20 u |
| Carro na tela (celular deitado) | ~22 px | ~133 px (`perto`), ~77 px (`alta`) |
| Bola na tela | ~11 px | 34 a 71 px na distância de jogo |
| Área da cena no celular deitado | ~300 px de altura dentro da página | Tela inteira |

- **Contraste bola/campo:** bola branca (`0xf2f5f2`) com gomos escuros sobre gramado verde escuro, com um leve brilho próprio (*emissive* 0,15) para não "apagar" contra o vidro e o céu. Os gomos (hoje 12 meshes) viram uma textura de canvas ou uma geometria mesclada: 1 draw call.
- **Sombra da bola (obrigatória):** um disco escuro no chão sob a bola, com opacidade e tamanho conforme a altura. Com a câmera baixa, é a única pista confiável de onde a bola vai cair. O halo de "pronto para tocar" que já existe (`ballHalo`) vira a borda dessa sombra e fica amarelo quando a bola está na zona do toque.
- **Sombra dos carros:** o mesmo disco, mais suave. Todas as sombras falsas num único `InstancedMesh`.
- **Gols com a cor do time:** a moldura do gol adversário brilha em azul e a do seu, em vermelho. Com a câmera atrás do carro, é o que diz "para onde atacar". O texto "ATAQUE →" do HUD sai.
- **Paredes:** faixa opaca escura até 2 u com neon ciano no topo, vidro de baixa opacidade até 6 u e uma grade sutil no teto. As linhas do campo ficam no chão (mesclar em 1 mesh).
- **Times:** vermelho × azul, com números no capô. No 2×2, o aliado tem um número grande e uma seta pequena fora da tela.
- **`prefers-reduced-motion`:** sem aumento de FOV no turbo, câmera mais lenta, explosão de gol com metade da intensidade.

### 7.2 Metas de desempenho

| Métrica | Alvo | Como medir |
| --- | --- | --- |
| FPS (celular intermediário Android de 2021–2022 e iPhone 11 ou mais novo, deitado, 2×2) | ≥ 45 de média em 60 s; p95 do tempo de quadro ≤ 33 ms | `?debug=1` |
| FPS (desktop com GPU integrada, 1280 × 720) | ≥ 58 de média | `?debug=1` |
| Draw calls | ≤ 120 no 2×2 | `renderer.info.render.calls` |
| Triângulos | ≤ 100 mil | `renderer.info.render.triangles` |
| `physics.update` | ≤ 2 ms de média por quadro | `performance.now()` no debug |
| Carregamento | Menu interativo em ≤ 3 s em 4G; Rapier baixa enquanto o menu está aberto | DevTools com rede lenta |

### 7.3 Orçamento de draw calls (2×2)

| Item | Hoje (estimativa da v2) | v3 | Como |
| --- | --- | --- | --- |
| Carro | ~24 meshes cada | ~9 cada (1 por material) → 36 | `mergeGeometries` (`three/addons/utils/BufferGeometryUtils.js`) por material ao criar o carro |
| Bola | 13 | 2 | Gomos numa textura ou mesclados |
| Arena | ~175 (92 na arquibancada, 54 tubos nos gols, 7 listras) | ~25 | Assentos em `InstancedMesh` (ou fora: com câmera baixa quase não aparecem), rede como plano com textura de grade transparente, linhas e listras mescladas |
| Sombras falsas | 1 | 1 | `InstancedMesh` |
| Efeitos (anéis, halo, comemoração) | ~12 | ≤ 12 | Pool fixo, como hoje |
| **Total** | **~240 (1×1)** | **~75–80** | Folga para o orçamento de 120 |

### 7.4 Sombras, luzes e resolução

- **Sem *shadow maps*:** custam uma passada extra de renderização e fill rate, que é o gargalo no celular. As sombras falsas (7.1) dão a informação de jogo.
- **Luzes:** hemisférica + 1 direcional. As 2 `PointLight` animadas saem; o neon vira `MeshBasicMaterial` (sem custo de luz). `MeshStandardMaterial` só nos carros e na bola; arena em `MeshLambertMaterial` ou `MeshBasicMaterial`.
- **Transparência:** no máximo 2 camadas transparentes grandes na tela (vidro e rede), com `depthWrite: false`.
- **Sem pós-processamento** (sem bloom).
- **Resolução dinâmica:** `pixelRatio` inicial de 1,25 em `pointer: coarse` e 1,5 no desktop. Se a média de FPS ficar abaixo de 45 por 2 s, desce 0,15 (até 0,85); sobe de volta com folga de 10 FPS. Função pura `nextPixelRatio(avgFps, current, params)` com histerese.
- **120 Hz:** a física continua a 60 Hz; a interpolação (5.8) deixa a imagem lisa em telas de 90 e 120 Hz.

---

## 8. O que acontece com o código atual

### 8.1 Por arquivo

| Arquivo | Destino | Detalhe |
| --- | --- | --- |
| `config.ts` | **Fica, com blocos reescritos** | `FIELD` → `ARENA` (unidades de mundo). `CAR`, `BALL`, `KICK` e `AI` com valores novos. Novos `CAMERA`, `TOUCH`, `KEYBOARD`, `GAMEPAD`, `TURBO`, `MATCH`, `RENDER`. Saem `AI.*Index`, `maxCars`, `allyUnlockRound`, `playerCarsWithAlly`, `roundsPerAdditionalCar`, `FIELD.visual` (maquete) e `STUCK` com margens antigas. |
| `kick.ts` | **Fica e evolui** | Vira o TOQUE (seção 5.3). As funções puras e os testes continuam. |
| `vehicle-dynamics.ts` | **Absorvido** | A fórmula de aderência lateral vai para `vehicle-controller.ts`, com a correção de massa e de quadro. |
| `arena-boundaries.ts` | **Fica** | Rede de segurança, agora também com o teto. |
| `stuck-monitor.ts` | **Fica** | Margens ajustadas; ganha o detector de bola imprensada. |
| `match-rules.ts` | **Parcial** | Ficam `getScoringSide` (com `ArenaDimensions`) e `selectAttacker` (2×2). `opponentSpeed` vira a curva de `AiLevel`. Saem `opponentCars` e a lógica de aliado em `awardGoal`. |
| `physics-runtime.ts` | **Reescrito como orquestrador** | Ficam o acumulador de passo fixo, o padrão de eventos de colisão, os limites de velocidade e a detecção de gol. Saem o carro do jogador "inline", a IA via `setLinvel` (o *loop* de 70 linhas) e os colliders antigos. Divide-se em `physics-world.ts`, `vehicle-controller.ts`, `ai-driver.ts` e `match-clock.ts`. |
| `input.ts` | **Reescrito** | `DriveInput` (booleanos) → `ControlFrame` analógico; teclado com rampa; gamepad. O modelo de contador de apertos fica. |
| `scene.ts` | **Reescrito em boa parte** | `PerspectiveCamera` + `chase-camera.ts`; interpolação; sombras falsas; indicador. Ficam os pools de anéis, a comemoração de gol e o `dispose` cuidadoso. Saem a câmera ortográfica, os modos `arena`/`follow`/`top` e as `PointLight`. A lista de carros duplicada (v2, seção 1.4) passa a vir de `config.ts`. |
| `arena.ts` | **Reescrito** | Arena fechada em unidades de mundo (seção 5.6), materiais baratos, rede com textura. |
| `objects.ts` | **Fica, com ajustes** | O modelo do carro fica e é mesclado por material. A cor do farol para de depender de `color === 0x148fff` e passa a receber o time. A bola cresce e os gomos viram 1 draw call. |
| `audio.ts` | **Fica** | Novos sons: `'boost'` (laço curto) e `'whistle'` (fim de partida). |
| `app.tsx` | **Reescrito em parte** | Menu e página ficam. Entram a casca de tela cheia, o HUD sobreposto, o stick e o cluster TOQUE/TURBO. Saem os 4 botões de direção e os pedais, a barra de câmeras e a dica "Gire o celular" atual (vira o bloqueio de retrato). |
| `style.css`, `index.html` | **Ajustes** | `viewport-fit=cover`, casca, HUD, controles novos; `manifest.webmanifest` em `public/`. |
| `tests/kick.test.ts` | **Fica e se adapta** | Sai o teste de "apex abaixo do travessão"; entram dash, elevação contextual e janela. |
| `tests/game-systems.test.ts` | **Parcial** | Saem os testes de `opponentCars` e do aliado ao marcar. O teste de integração "setas movem o carrinho" passa a exigir velocidade real (≥ 13,5 u/s após 1 s no PR 1). |

### 8.2 O que da v2 continua válido

| Seção da v2 | Status |
| --- | --- |
| 1. Diagnóstico | Válido como histórico. O bolsão atrás do gol e as entradas laterais somem com a arena fechada. O texto corrompido já foi corrigido. |
| 2. Princípios (regra pura, knobs em `config.ts`, absolutos × relativos, mesma regra para humano e IA, determinismo) | **Válido** e reforçado. |
| 3.1 Contador monotônico de apertos | **Válido.** |
| 3.2 e 3.3 Teclado e botão CHUTE | Obsoleto (substituído pela seção 3 deste documento). |
| 4. Física do chute | **Válido como base do TOQUE**, exceto o invariante do travessão, o recuo em 0 e `chargeSeconds`/`coastSeconds`. |
| 5.1 a 5.3 Times de 3, slots e spawns por papel | Obsoleto (sem 3×3; kickoff da seção 2.4). |
| 5.4 Perseguidor único, histerese, aliado que cede, separação | **Válido para o 2×2.** |
| 5.5 Pressão por rodada | Substituído pela seção 6.4. |
| 6.1 a 6.3 Campo ×1,25, geometria de maquete, enquadramento ortográfico e critérios em px/u | Obsoleto. A ideia de **dimensões derivadas por função pura com invariantes** continua (`arena-dimensions.ts`). |
| 6.4 Colliders: paredes de fundo, laterais da rede, chanfros, *collision groups* | **Válido** (absorvido pela arena fechada). A cortina do gol sai. |
| 8. Orçamento de desempenho e alavancas (instancing, merge, `?debug=1`) | **Válido**, com metas novas (seção 7). |
| 9. Riscos de bola presa, IA empilhada, Espaço em botão focado | Válidos. |
| 10. PRs 2 e 3 | **Cancelados.** Substituídos pelo plano da seção 9. |

O topo do documento v2 recebe uma nota apontando para este.

---

## 9. Plano de implementação em PRs pequenos

Cada PR é sequencial (todos mexem em `config.ts` e no runtime), sai com `npm test` e `npm run build` verdes e deixa o jogo jogável. As regras novas são funções puras com teste. Os números ficam em `config.ts`. Os critérios "no celular" são verificados pelo André no Pages de preview ou com `npm run dev -- --host`.

| PR | Entrega | Por que nesta ordem |
| --- | --- | --- |
| 1 | Câmera atrás do carro + joystick + tela cheia + interpolação + velocidade corrigida + indicador de bola + `?debug=1` | Maior ganho de *feeling*; não depende de nada. |
| 2 | Arena fechada + bola nova + câmera respeitando paredes + sombras falsas + ball cam | A câmera baixa precisa de paredes altas; a bola quicante precisa da sombra e da ball cam. |
| 3 | Controlador único (jogador e IA) + turbo + hitbox `roundCuboid` + gamepad | Pré-requisito de justiça para TOQUE e IA nova. |
| 4 | TOQUE (chute vira dash/cabeçada) + háptico | Depende do controlador único para mover o carro da IA também. |
| 5 | IA v3 1×1 (previsão de quique, intercepto, modos, níveis) | Depende de bola, arena, controlador e toque finais. |
| 6 | Partida por tempo, kickoff com contagem, comemoração, fim e progressão | Regra de jogo sobre a base pronta. |
| 7 | 2×2 com aliado IA | Só depois de o 1×1 estar bom. |
| 8 | Desempenho: merge, instancing e resolução dinâmica | Antes do 2×2 se o FPS do PR 2 falhar; senão, depois. |

### PR 1 — Câmera atrás do carro, joystick e tela cheia

**Arquivos:** `src/game/chase-camera.ts` (novo), `src/game/touch-stick.ts` (novo), `src/game/render-interpolation.ts` (novo), `src/game/perf-monitor.ts` (novo: média móvel de FPS e p95), `input.ts` (`ControlFrame` com `throttle`/`steer` analógicos, teclado com rampa), `physics-runtime.ts` (jogador lê eixos analógicos; `linearDamping` do carro 0; `throttleResponse`/`brakeResponse`/`coastResponse`; poses anterior e atual), `scene.ts` (`PerspectiveCamera`, presets `perto`/`alta`, interpolação, indicador, `pixelRatio` 1,25 em `pointer: coarse`, painel `?debug=1`), `app.tsx` (casca de tela cheia, HUD, stick, TOQUE com o chute atual, pausa, seleção de câmera no menu de pausa, bloqueio de retrato), `style.css`, `index.html` (`viewport-fit=cover`), `config.ts` (`CAMERA`, `TOUCH`, `KEYBOARD`, novos knobs de `CAR`), `README.md` (controles).

**Fora do escopo:** arena, bola, IA (continua com `setLinvel`), turbo. `CAR.maxSpeed` continua 15 neste PR; o valor 20 entra no PR 3, junto com o controlador único da IA.

**Testes automatizados:**
- `stickToDrive`: a tabela da seção 3.2 e a continuidade.
- `followBase`: com o dedo a 2 × raio, a base fica a exatamente 1,3 × raio do dedo, na mesma direção.
- `verticalFovForAspect(2.164, 95, 50, 75)` ≈ 53,5° (±0,5); aspecto 0,46 → 75°; 16:9 ≈ 63°.
- `stepChaseCamera`: com o carro parado, depois de 2 s a câmera está a 8,5 ± 0,1 u atrás e 3,6 ± 0,1 u acima; num giro de 180° do carro em 0,5 s, o atraso de yaw nunca passa de 35°.
- `interpolatePose`: `alpha` 0 → anterior; 1 → atual; 0,5 → ponto médio e `slerp` normalizado.
- `offscreenIndicator`: bola na tela → `null`; atrás → seta na borda inferior; à direita → ângulo ≈ 0.
- Integração (Rapier): acelerador cheio em linha reta → velocidade ≥ 13,5 u/s (90% de 15) em ≤ 1,0 s. Hoje é ~4 u/s, então este teste falha em `main`.

**Aceite no celular (844 × 390 ou parecido):**
- A partida abre em tela cheia (Android) ou cobre a tela toda (iPhone), sem barras da página.
- O carro aparece com ≥ 100 px de largura no preset `perto`.
- O stick nasce onde o polegar toca na metade esquerda; nenhum toque rola a página ou dá zoom.
- Nenhum botão fica sob o notch ou a barra de gestos.
- `?debug=1` mostra ≥ 45 FPS de média em 60 s de 1×1.
- A câmera não treme com o carro em linha reta.
- O chunk `scene` cresce ≤ 15 kB com gzip.

### PR 2 — Arena fechada e bola nova

**Arquivos:** `src/game/arena-dimensions.ts` (novo), `src/game/physics-world.ts` (novo: colliders e `collisionGroups`), `arena.ts` (reescrito), `objects.ts` (bola nova com gomos em 1 draw call), `physics-runtime.ts` (usa `physics-world`, bola com `gravityScale`, restituição `Max`, contenção 3D), `match-rules.ts` (`getScoringSide` com `ArenaDimensions`), `stuck-monitor.ts`, `chase-camera.ts` (`clampCameraToArena`, modo `ball`), `scene.ts` (sombras falsas em `InstancedMesh`, luzes simplificadas, gols com cor do time), `app.tsx` (botão BOLA, tecla C), `config.ts` (`ARENA`, `BALL`).

**Testes:**
- `arenaInvariants` vazio para os valores padrão; a profundidade do gol é maior que o diâmetro da bola; a altura do gol é maior que o diâmetro da bola + 1; o pico do toque mais forte fica abaixo do teto.
- Integração: bola lançada a 45 u/s em 200 direções aleatórias (semente fixa) por 5 s → nunca sai da caixa da arena, nunca entra no gol pela lateral e a rede de segurança atua 0 vezes.
- Integração: bola solta com o centro a 10 u → no primeiro quique o centro volta a ≥ 5,4 u (restituição efetiva ≥ 0,67, porque a altura do quique cai com e²: 1,7 + 0,45 × 8,3).
- `clampCameraToArena`: câmera desejada fora da parede → fica a ≥ 1 u dentro, e a altura sobe 0,5 × a distância perdida; teto respeitado.
- Modo `ball`: com a bola a menos de 4 u no plano, o yaw não muda.
- Gol: bola inteira além da linha → gol; bola sobre a linha → não.

**Aceite no celular:** bola com ≥ 30 px a 30 u; a sombra deixa claro onde a bola vai cair; nenhuma bola presa em 5 min de jogo; draw calls ≤ 100 no 1×1; ≥ 45 FPS.

### PR 3 — Controlador único, turbo e hitbox

**Arquivos:** `src/game/vehicle-controller.ts` (novo), `src/game/turbo.ts` (novo), `src/game/controls.ts` (novo: `ControlFrame` → `DriveCommand`), `input.ts` (gamepad, Shift/L), `physics-runtime.ts` (todos os carros via `stepVehicle`; a IA atual passa a gerar `DriveCommand` a partir do alvo que já calcula, sem `setLinvel`; collider `roundCuboid`), `app.tsx` (botão TURBO com anel do medidor, cluster com deslizar e "costura"), `config.ts` (`CAR`, `TURBO`, `GAMEPAD`), remove `vehicle-dynamics.ts`.

**Testes:**
- `stepVehicle`: de 0, acelerador 1 → ≥ 90% de 20 u/s em ≤ 0,7 s; turbo com medidor cheio → ≥ 28 u/s em ≤ 1,5 s; derrapagem lateral cai a < 10% em 0,25 s; o resultado é igual com `dt` 1/60 e 2 × 1/120 (±2%).
- `stepTurbo`: 33 → 0 em 1,0 s de uso; recarga só depois de 0,6 s; 0 → 100 em 10 s; não liga abaixo de 5.
- `isGrounded`: no chão → verdadeiro; com `vy` > 0,5 → falso.
- Integração: carro com `roundCuboid` empurrado a 30 u/s contra a parede e contra o chanfro por 3 s → sem NaN, sem atravessar e sem quicar mais de 0,5 u para cima.
- Integração: o carro da IA, com o mesmo comando do jogador, tem velocidade igual (±1%) em 2 s.
- Justiça: com um espião em `setLinvel` dos corpos dos carros, 5 s de IA em campo aberto (sem tocar paredes nem passar do limite de velocidade) geram zero chamadas. A rede de segurança e o limite de velocidade continuam podendo usá-lo.

**Aceite no celular:** TURBO segurado com o polegar direito enquanto o esquerdo pilota; deslizar do TURBO para o TOQUE funciona; empurrar a IA a move de verdade.

### PR 4 — TOQUE

**Arquivos:** `kick.ts` (dash, elevação contextual, janela, recuo), `physics-runtime.ts` (passo 4 da seção 5.9 com dash), `scene.ts` (inclinação visual do nariz, anel do toque), `app.tsx` (botão "TOQUE", háptico, alternância "Vibração"), `audio.ts`, `config.ts` (`KICK`), `tests/kick.test.ts`.

**Testes:**
- Apertar sem bola → o carro ganha +8 u/s (±0,5) e sobe ≥ 0,4 u; nenhum impulso na bola; recarga de 0,9 s.
- Bola parada a 0,5 u na frente, toque com o carro parado → bola sai a 16 ± 0,8 u/s, a ≤ 5° da direção esperada, com `vy` de elevação rasteira.
- Bola a 3,5 u de altura na zona → `lift` ≥ 0,35 e o pulinho maior.
- A bola entra na zona aos 0,2 s do dash → toca uma vez; aos 0,3 s → não toca.
- Dividida simétrica → igual com a ordem invertida (já existe; continua).
- Integração: o toque leva a bola ao gol vazio a partir de 25 u em linha reta.

**Aceite no celular:** o botão sempre faz algo visível; acertar a bola é perceptível pelo som, pela vibração (Android) e pelo anel; cabeçar bola quicando é possível depois de poucas tentativas.

### PR 5 — IA v3 (1×1)

**Arquivos:** `src/game/ball-prediction.ts` e `src/game/ai-driver.ts` (novos), `physics-runtime.ts` (troca o *loop* de IA atual por `thinkAi`/`driveToward`; `createPhysics` ganha `options?: { humanSlots?: number[]; seed?: number }`, como na v2), `match-rules.ts` (`aiLevel(difficulty, wins)`), `config.ts` (`AI` novo).

**Testes:**
- `predictBall` contra o Rapier: bola lançada com 5 velocidades iniciais → erro de posição ≤ 1,0 u em 1 s (inclui um quique no chão e um na parede).
- `thinkAi`: lado errado da bola → `reposition` com alvo do lado oposto ao próprio gol; bola indo para o próprio gol em ≤ 1,5 s → `defend` com turbo.
- `aiLevel`: monotônico e com limites (`throttleCap` ≤ 1).
- **Simulação headless** (IA contra IA, Médio × Médio, 120 s, semente fixa, < 3 s de execução): sem NaN; todos os corpos dentro da arena; ≥ 10 toques na bola por carro; 1 a 10 gols no total; ≤ 1 reinício por bola presa por minuto; alguém toca na bola em ≤ 3 s em ≥ 90% dos kickoffs.
- Simulação Fácil contra um "jogador roteirizado" que só vai na bola e toca: o roteirizado marca pelo menos tantos gols quanto o Fácil em 3 sementes.

**Aceite no celular:** o André vence o Fácil na primeira ou na segunda partida; o Difícil exige esforço; a IA não fica parada no gol.

### PR 6 — Partida

**Arquivos:** `src/game/match-clock.ts` (novo: fases `countdown`, `playing`, `goal`, `overtime`, `finished`), `physics-runtime.ts` (fases, kickoff sorteado com semente), `match-rules.ts` (mensagens; remove `opponentCars` e o aliado), `scene.ts` (explosão de gol), `app.tsx` (relógio no HUD, contagem, tela de resultado com "Próxima partida" / "Revanche"), `audio.ts` (apito), `config.ts` (`MATCH`), `README.md` ("Como jogar").

**Testes:**
- `match-clock`: o relógio não anda em `countdown` nem em `goal`; 0:00 com empate → `overtime`; gol no `overtime` → `finished` com vencedor; 60 s de `overtime` sem gol → `finished` com empate.
- Kickoff: posições espelhadas por ponto, distâncias iguais até a bola (±1e-9), turbo em 33, carros travados durante a contagem.
- Integração: gol → 2 s → teleporte → 3 s de contagem → jogo; o placar se mantém.

**Aceite no celular:** a partida dura ~3 min de relógio; ficou claro quando começa, quando foi gol e quando acabou.

### PR 7 — 2×2

**Arquivos:** `src/game/teams.ts` (novo e enxuto: 2 slots por time, cores, números, kickoff), `ai-driver.ts` (perseguidor com histerese, goleiro-apoio, cessão ao jogador, separação), `physics-runtime.ts`, `scene.ts` (4 carros a partir de `teams.ts`; seta do aliado), `app.tsx` (menu: "2 contra 2" padrão e "Duelo 1 contra 1"), `config.ts`.

**Testes:**
- `selectChaser` com histerese (casos da v2, seção 10, PR 3).
- Simulação headless 2×2: no máximo 1 perseguidor por time em ≥ 99% dos ticks; ≤ 15% dos ticks com 2 carros do mesmo time a menos de 4 u da bola; o aliado não toca na bola quando o jogador roteirizado está mais perto (≥ 90% dos casos).

**Aceite no celular:** ≥ 45 FPS no 2×2; o aliado ajuda sem roubar a bola; dá para saber onde ele está.

### PR 8 — Desempenho

**Arquivos:** `objects.ts` (merge por material), `arena.ts` (instancing de assentos e rede com textura, se ainda não estiverem), `scene.ts` (`nextPixelRatio`), `src/game/render-quality.ts` (novo, função pura).

**Testes:** `nextPixelRatio` com histerese (não oscila com FPS alternando 44/46); o número de meshes de um carro mesclado é ≤ 10; o visual equivale ao do carro original (mesma *bounding box*, ±1%).

**Aceite:** ≤ 120 draw calls no 2×2 e ≥ 45 FPS no celular de referência.

---

## 10. Riscos e mitigação

| Risco | Onde aparece | Mitigação |
| --- | --- | --- |
| A câmera atrás do carro desorienta no celular (perder a bola, enjoo) | PR 1 em diante | Preset `alta` pronto no PR 1 para comparar; indicador de bola; assistência de bola; FOV largo; sem rolagem nem tremor; `prefers-reduced-motion`. Se o playtest falhar com os dois presets, o próximo passo é a câmera alta como padrão, sem reescrever nada. |
| O stick relativo ao carro confunde em ré | Touch | Zona de ré larga (140°) e comportamento "traseira vai para onde o polegar aponta", com teste de tabela. A câmera não vira ao dar ré. |
| Um polegar para TURBO e TOQUE | Touch | Deslizar entre os botões e a faixa de "costura" que aperta os dois; tamanhos e folgas mínimos. |
| iPhone sem tela cheia, sem trava de orientação e sem vibração | iOS Safari | Casca `fixed` com `100dvh`; bloqueio de retrato com aviso; feedback visual e sonoro no lugar da vibração; "Adicionar à Tela de Início". |
| Tremedeira (*judder*) | Câmera atrás do carro | Interpolação de poses no PR 1, com teste. |
| FPS abaixo de 45 | Celular | Orçamento de draw calls, sem *shadow maps*, sem `PointLight`, resolução dinâmica, PR 8 antecipável. |
| Carregamento lento (Rapier com 830 kB gzip) | Primeira visita em 4G | O Rapier baixa enquanto o menu está aberto (já é um import dinâmico). Se o critério de 3 s falhar, avaliar o pacote `@dimforge/rapier3d` (sem `-compat`, carrega o `.wasm` separado), medindo antes de trocar. |
| Bola atravessa paredes | Bola a 45 u/s | CCD, colliders de 1 u, `maxSpeed` com 0,75 u por passo < raio, rede de segurança com contador. |
| Bola presa | Cantos, carros | Arena sem bolsões, chanfros, paredes quicantes, `stuck-monitor` e detector de bola imprensada. |
| `roundCuboid` instável contra paredes | PR 3 | Teste de estabilidade; se falhar, volta ao cilindro com "nariz" só pela zona do toque (já funciona hoje). |
| IA injusta ou burra | PR 5 | Mesmo controlador e mesmas regras; níveis por decisão, não por física; simulação headless com métricas; *playtest* do André. |
| A troca da velocidade do carro desequilibra a IA atual | PR 1 e PR 2 | Temporário: o jogador fica mais rápido que a IA até o PR 3 (melhor que hoje, quando é o mais lento). O PR 3 iguala. |
| Retrabalho em cascata ao mexer em tamanhos | Arena, bola, carro | `arena-dimensions.ts` com invariantes; distâncias de IA ligadas a carro e bola são absolutas, as ligadas à arena são frações (princípio da v2). |
| Escopo cresce para "RL completo" | Todos | Lista de "fora do escopo" da seção 1; aéreos, parede e *boost pads* só depois de o MVP passar nos critérios de "gostoso de jogar". |
| Marca "Rocket League" | Página e jogo | Nenhum nome, logo ou asset do RL no produto. |

---

## 11. Decisões abertas para o André

1. **Modo principal da partida: 2×2 (você + aliado IA) ou 1×1?**
   *Recomendação: 2×2 como padrão quando o PR 7 chegar, com 1×1 como "Duelo".* O aliado cobre o gol e perdoa erros, o que é mais divertido no celular. Até o PR 7, o jogo fica em 1×1 de qualquer forma, para ajustar o *feeling*.

2. **Formato: partida por tempo (2:00 + gol de ouro de até 60 s) ou primeiro a 3 gols (como hoje)?**
   *Recomendação: por tempo.* A sessão fica previsível (~3 min), existe o "final de jogo" com pressão, e quem leva 0×2 cedo continua tendo motivo para jogar.

3. **Botão PULO separado no MVP, ou só o TOQUE contextual (dash + cabeçada com pulinho)?**
   *Recomendação: só o TOQUE no MVP.* Um botão a menos no polegar direito, e a "bola alta" já é resolvida pela cabeçada contextual e pela gravidade reduzida. O estado de "no chão / no ar" entra no PR 3, então acrescentar o PULO depois de um *playtest* custa pouco.

---

## Apêndice A — Knobs em `config.ts` (valores iniciais)

```ts
export const CAMERA = {
  hFovDeg: 95,
  vFovMinDeg: 50,
  vFovMaxDeg: 75,
  boostFovDeg: 6,
  presets: {
    perto: { distance: 8.5, height: 3.6, lookAhead: 5, lookHeight: 1.2 },
    alta: { distance: 13, height: 9, lookAhead: 6, lookHeight: 0 },
  },
  positionResponse: 10, // 1/s
  yawResponse: 6, // 1/s
  maxYawLagDeg: 35,
  ballAssist: { maxYawDeg: 15, coneDeg: 70, maxDistance: 35 },
  ballCam: { lookBallWeight: 0.6, heightPerBallY: 0.35, minPlanarDistance: 4 },
  wallMargin: 1,
  minDistanceNearWall: 4.5,
  heightGainPerLostDistance: 0.5,
  indicatorInsetPx: 56,
} as const;

export const TOUCH = {
  stick: {
    zoneWidthFraction: 0.5,
    radiusPx: 64,
    deadzone: 0.12,
    saturation: 0.85,
    frontHalfAngleDeg: 110,
    steerFullAngleDeg: 75,
    reverseSteerFullAngleDeg: 70,
    baseFollowFactor: 1.3,
  },
  primaryButtonPx: 88,
  secondaryButtonPx: 76,
  smallButtonPx: 52,
  minTargetPx: 48,
  minGapPx: 12,
  edgeMarginPx: 12,
  dualPressSlackPx: 18,
  haptics: { kickHit: 15, goalFor: [40, 60, 40], goalAgainst: 80, boostEmpty: 10 },
} as const;

export const KEYBOARD = { steerRampPerSecond: 8, throttleRampPerSecond: 10 } as const;
export const GAMEPAD = { deadzone: 0.15 } as const;

export const CAR = {
  mass: 4.5,
  maxSpeed: 20,
  reverseMaxSpeed: 8,
  boostMaxSpeed: 30,
  boostAcceleration: 14, // u/s²
  throttleResponse: 3.8, // 1/s (90% em ~0,6 s)
  brakeResponse: 8,
  coastResponse: 0.8,
  bodyLinearDamping: 0,
  steeringRate: 2.6, // rad/s em baixa velocidade
  steeringRateAtMaxSpeed: 1.9,
  reverseSteeringThreshold: 0.4,
  lateralGripPerSecond: 12,
  hitbox: { halfWidth: 1.45, halfHeight: 0.6, halfLength: 1.75, border: 0.25 }, // meias-medidas totais
  groundEpsilon: 0.05,
  friction: 0.8,
  restitution: 0.38,
} as const;

export const TURBO = { start: 33, max: 100, drainPerSecond: 33, regenPerSecond: 10, regenDelaySeconds: 0.6, minToStart: 5 } as const;

export const KICK = {
  reach: 1.2,
  coneHalfAngleDeg: 55,
  maxBallHeight: 4.6,
  basePower: 16,
  speedTransfer: 0.6,
  maxPower: 34,
  headingWeight: 0.7,
  liftGround: 0.12,
  liftHigh: 0.45,
  liftBlendFromY: 2.0,
  liftBlendToY: 4.6,
  cooldownSeconds: 0.9,
  dashSeconds: 0.25, // janela de acerto (substitui bufferSeconds)
  dashSpeed: 8,
  hopSpeed: 3.5,
  highBallHopSpeed: 5.5,
  visualPitchDeg: 25,
  wallGuard: 0.3,
  recoil: 0.15,
} as const;

export const BALL = {
  radius: 1.7,
  mass: 1.2,
  restitution: 0.72, // CoefficientCombineRule.Max
  friction: 0.4,
  linearDamping: 0.08,
  angularDamping: 0.4,
  gravityScale: 0.8,
  maxSpeed: 45,
} as const;

export const ARENA = {
  goalLineX: 40,
  sideWallZ: 28,
  ceilingY: 20,
  cornerChamfer: 8,
  wallThickness: 1,
  wallOpaqueHeight: 2,
  wallGlassHeight: 6,
  goal: { halfWidth: 11, height: 8, depth: 6 },
  floorRestitution: 0.5,
  wallRestitution: 0.6,
} as const;

export const MATCH = {
  mode: '1v1', // '2v2' a partir do PR 7
  durationSeconds: 120,
  overtimeMaxSeconds: 60,
  countdownSeconds: 3,
  goalCelebrationSeconds: 2,
  kickoffSpawns: [
    { x: -20, z: 0 },
    { x: -16, z: 14 },
    { x: -16, z: -14 },
  ], // vermelho; o azul é espelhado por ponto
  secondCarSpawn: { x: -34, z: 0 },
} as const;

export const AI = {
  seed: 1,
  thinkHz: 20,
  predictionStep: 1 / 30,
  reverseAngleDeg: 120,
  reverseDistance: 6,
  repositionOffset: 6,
  defendShadowFraction: 0.35,
  saveHorizon: 1.5,
  blockedSeconds: 1.2,
  recoverySeconds: 1.2,
  levels: { /* tabela da seção 6.4 */ },
  chaserHysteresis: 3, // 2×2
  allyYieldMargin: 6, // 2×2
  separationRadius: 5,
  separationOffset: 4,
} as const;

export const RENDER = {
  pixelRatioCoarse: 1.25,
  pixelRatioFine: 1.5,
  minPixelRatio: 0.85,
  pixelRatioStep: 0.15,
  targetFps: 45,
  recoverFpsMargin: 10,
  lowFpsSeconds: 2,
  drawCallBudget: 120,
} as const;
```

## Apêndice B — Painel `?debug=1`

Visível só com o parâmetro na URL. Mostra: FPS (média de 60 quadros e p95 do tempo de quadro), `renderer.info.render.calls` e `triangles`, `pixelRatio` atual, tempo médio de `physics.update`, contador de atuações da rede de segurança, reinícios por bola presa, toques na bola e chutes ao gol do jogador na partida. É a fonte dos critérios das seções 1 e 7.2.
