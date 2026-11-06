# Bate-Bate Soccer — Arquitetura de gameplay v2

Documento de design para três mudanças pedidas pelo produto: **botão de chute**, **times de 2 a 3 carrinhos** e **campo maior**. Parte do estado atual de `main` (commit `48890f8`, com o ajuste de controles, IA e câmera). Nada aqui troca a stack: continua Three.js + Rapier + React + Vitest.

O objetivo é que cada PR de implementação possa ser feito por quem não participou deste design: as interfaces estão definidas, todos os números ficam em `src/game/config.ts` e cada regra tem um teste unitário associado.

---

## 0. Resumo das decisões

| Tema | Decisão recomendada |
| --- | --- |
| Chute | Impulso na bola ao **apertar** Espaço/K ou o botão **CHUTE**, se a bola estiver na zona frontal do carrinho. Buffer de 0,12 s, recarga de 0,45 s (0,25 s se errar). Sem posse "grudada". |
| Força / ângulo | Força = `14 + 0,5 × velocidade frontal`, limitada a 22 u/s. Direção = 70% para onde o carrinho aponta e 30% na normal de contato. Elevação pequena (12%), sempre abaixo do travessão. |
| Justiça | A IA usa **a mesma função** de chute, com a mesma zona e a mesma recarga. A dificuldade muda só o tempo de reação, a exigência de mira e a força (≤ 100% da força do jogador). |
| Times | Limite rígido de **3 por time**, sempre simétrico. Rodada 1 = 2×2, rodada 2 em diante = 3×3. A progressão sobe a **pressão** da IA, não a quantidade de carrinhos. Sai a mecânica "ganha aliado ao marcar / perde ao sofrer". |
| Papéis | Atacante (o jogador é sempre o atacante vermelho), Apoio e Goleiro leve. Um único "perseguidor" por time, com histerese. |
| Campo | Escala uniforme **×1,25** (área ×1,56), derivada de uma função pura. Velocidade máxima ×√1,25 ≈ ×1,12. Câmera passa a calcular o enquadramento a partir do campo. |
| Limites físicos | Novos colliders: paredes de fundo, laterais das redes, chanfros de canto e uma "cortina" no gol que bloqueia só carrinhos. |
| Ordem dos PRs | PR 1 Chute → PR 2 Campo maior → PR 3 Times e IA por papel. |

---

## 1. Diagnóstico do modelo atual

### 1.1 Input (`input.ts`, `app.tsx`)

- `DriveInput` tem só quatro booleanos (`forward`, `reverse`, `left`, `right`). Não existe espaço para uma ação.
- A física **amostra o estado** a cada passo fixo (`keyboard.read(input)` em `physics-runtime.ts:97`). Não há eventos de borda (apertou/soltou). Um toque mais curto que um quadro (keydown e keyup entre dois `requestAnimationFrame`) se perde. Isso não importa para pedais, mas inviabiliza um botão de ação.
- Touch: `app.tsx` mapeia `pointerId → tecla de DriveInput` e usa `setPointerCapture`. O mesmo dedo não consegue "deslizar" de um botão para outro. `clearInput` zera os booleanos ao pausar ou perder o foco.
- `Espaço` não está mapeado. Hoje, se um `<button>` da barra de ferramentas (câmera, pausa) estiver com foco, Espaço o aciona.

### 1.2 Contato carro ↔ bola (`physics-runtime.ts`)

- O carrinho é um **cilindro vertical** (r = 1,5, meia-altura 0,34, `physics-runtime.ts:40`) com rotação liberada só no eixo Y. Fisicamente é um disco: **não existe "frente"**. O resultado do contato depende apenas da velocidade relativa e da normal.
- O centro da bola (y ≈ 0,96) fica acima do topo do cilindro (y ≈ 0,74). O contato ocorre abaixo do equador da bola e gera um empurrão levemente para cima e para frente.
- Só existe empurrão. Parado, o carrinho não move a bola. A 15 u/s, o empurrão frontal dá no máximo ≈ (1 + e)·m_c/(m_c + m_b)·v ≈ **17 u/s** à bola. Não há como "bater" na bola com intenção.
- O som e o anel de impacto já usam eventos de colisão (`drainCollisionEvents`). Dá para reaproveitar o padrão para o feedback do chute.

### 1.3 Movimento da IA

- O jogador anda por **impulsos** (aderência lateral e aceleração amortecida). A IA usa **`setLinvel` a cada passo** (`physics-runtime.ts:177`). Na prática a IA ignora massa, empurrões e recuo: ela funciona como um trator. Essa assimetria pesa em qualquer regra de recuo de chute ou de "ser derrubado". Por isso este design deixa o recuo em 0 por padrão (seção 4.6).

### 1.4 Times e progressão (`config.ts`, `match-rules.ts`)

- Os papéis estão codificados por **índice**: 0 = jogador, 1 = adversário, 2 = aliado vermelho, 3 a 5 = azuis extras (`AI.*Index` e `enabled()` em `physics-runtime.ts:46`).
- A progressão é assimétrica. O azul chega a 4 carrinhos (`opponentCars`: rodadas 2, 4 e 6), o vermelho a no máximo 2. O aliado aparece ao marcar (a partir da rodada 2) e some ao sofrer gol (`awardGoal`, `match-rules.ts:28`).
- As posições iniciais estão **duplicadas** em `scene.ts:17`, em `CAR.spawnPositions` e no teste de integração.
- A IA escolhe o atacante como o mais próximo da bola prevista, sem histerese. Com distâncias parecidas, o papel troca a cada passo. Os defensores vão todos para o mesmo `defendX` (só os índices 3 ou mais recebem deslocamento lateral), o que causa **empilhamento** na frente do gol. Não existe goleiro nem separação entre companheiros.
- O cálculo do atacante é refeito para cada carrinho a cada passo (O(n²)). Com n ≤ 6 isso é desprezível. CPU não é o gargalo.

### 1.5 Campo e limites (`config.ts`, `arena.ts`, `physics-runtime.ts`)

- A arena visual é construída em "unidades de maquete" (base 30 × 18) e escalada de forma **não uniforme** (`scaleX` 2,8 e `scaleZ` 2,45). Os valores físicos de `FIELD` foram **multiplicados à mão** (por exemplo, `goalLineX` = 13,7 × 2,8 = 38,36). Mudar o tamanho hoje exige editar uns dez números de forma coerente. A escala não uniforme também deforma o círculo central e as traves, que viram elipses.
- Nome confuso: `halfWidth` é o eixo X (comprimento do campo) e `halfLength` é o eixo Z.
- Colliders físicos existentes: chão, **paredes laterais** (z = ±20,09), traves, travessão e fundo da rede. **Não há paredes de fundo fora da boca do gol nem laterais da rede.** O fundo do campo é na verdade o *clamp* manual `containPlanarBody` em `goalBackX − raio` (`physics-runtime.ts:220-251`). Consequências:
  - existe um "bolsão" atrás da linha de fundo, fora do gol, onde a bola fica presa;
  - a bola pode entrar no gol **pela lateral**, vindo desse bolsão;
  - a parede de fundo visual (`walls.supportX` ≈ x 39,5) fica antes do clamp da bola (40,26), então a bola atravessa a parede visualmente;
  - carrinhos entram até 1,3 u dentro do gol.
- Área jogável atual: 76,7 × 40,2 (entre as linhas de gol e entre as paredes laterais).

### 1.6 Câmera (`scene.ts`)

- Câmera ortográfica com `halfHeight = max(29, 48 / aspect)` (`scene.ts:72`). São constantes mágicas, **não derivadas de `FIELD`**. Aumentar o campo quebra o enquadramento.
- O modo "Carrinho" (`follow`) só desloca a câmera. Em projeção ortográfica isso **não aproxima**, então não existe zoom de verdade.
- Em celular deitado (844 × 390, cena com ~341 px de altura) a câmera mostra ~5,9 px por unidade: a bola fica com ~11 px e o carrinho com ~22 px. Os botões de toque cobrem ~70 px da parte de baixo do campo.

### 1.7 Bola presa (`stuck-monitor.ts`)

- O detector só olha perto das bordas (margens de 6 u em X e 4 u em Z). Não detecta uma bola **imprensada entre carrinhos no meio do campo**. Isso fica mais provável com 6 carrinhos e com a IA usando `setLinvel`.

### 1.8 Outros achados

- Bug de codificação: a mensagem inicial está gravada como `'FaÃ§a 3 gols para vencer'` em `physics-runtime.ts:45` e `:277`. O HUD mostra o texto corrompido assim que a cena carrega. Correção trivial no PR 1.
- Desempenho estimado contando `createCar` e `createArena`: ~24 meshes por carrinho, 88 assentos (cada um com material próprio) e ~54 tubos de rede. São ~240 draw calls em 1×1 e ~335 em 3×3. Não há sombras e `pixelRatio` vai até 1,5. A física é barata: a suíte atual (incluindo ~450 passos do Rapier) roda em ~0,1 s.

---

## 2. Princípios da v2

1. **Regra pura, integração fina.** Toda regra nova (zona de chute, recarga, elenco por rodada, papéis, escala do campo, enquadramento) é uma função pura em arquivo próprio, testada sem Rapier e sem DOM. `physics-runtime.ts` só orquestra.
2. **Knobs em `config.ts`.** Nenhum número de gameplay fica fora dele. Cada knob tem comentário curto só quando a unidade não é óbvia.
3. **Distâncias absolutas × relativas.** Distâncias ligadas ao tamanho do carrinho ou da bola (alcance do chute, `behindBallDistance`, `attackRange`, `wallClearance`) continuam **absolutas**. Distâncias ligadas ao layout do campo (spawns, profundidade do goleiro, faixas do apoio, limite de avanço do goleiro) passam a ser **frações de `FIELD`**. Assim o campo pode mudar de escala sem reajustar a IA.
4. **Mesma regra para humano e IA.** A IA não ganha atalhos de física. Ela decide *quando* apertar, e o resto é igual.
5. **Determinismo em teste.** Dado o mesmo input, a simulação é reproduzível. É isso que permite os testes headless de 3×3 (seção 10).

Novos arquivos (kebab-case, uma responsabilidade cada):

| Arquivo | Responsabilidade | PR |
| --- | --- | --- |
| `src/game/kick.ts` | Zona de chute, força, direção, recarga e buffer, chutes simultâneos | 1 |
| `src/game/field-geometry.ts` | `createFieldDimensions(scale)` e invariantes do campo | 2 |
| `src/game/camera-framing.ts` | Enquadramento ortográfico derivado do campo e do aspecto | 2 |
| `src/game/teams.ts` | Elenco por rodada, slots, cores, números e spawns por papel | 3 |
| `src/game/team-ai.ts` | Perseguidor por time, alvo por papel, decisão de chute da IA, pressão por rodada | 3 |

---

## 3. Modelo de input v2

### 3.1 Tipo

```ts
// src/game/input.ts
export type DriveInput = {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;       // segurando (reservado para carga futura e para o feedback do botão)
  kickPresses: number; // contador monotônico: +1 a cada aperto (keydown sem repeat ou pointerdown)
};
```

**Por que um contador e não um booleano:** a física roda em passos fixos de 1/60 s e lê o input várias vezes por quadro. Com um contador, a física guarda `lastKickPresses` e consome cada aperto **exatamente uma vez**, mesmo que keydown e keyup aconteçam entre dois quadros. Pausar ou retomar (`resetAccumulator`) faz `lastKickPresses = kickPresses` e descarta apertos pendentes. `clearInput` em `app.tsx` zera `kick`, mas **não** o contador.

### 3.2 Teclado

| Ação | Teclas | Observações |
| --- | --- | --- |
| Chutar | `Space` (principal), `KeyK` | Ignora `event.repeat`, porque segurar não pode virar metralhadora. |
| Pedais e direção | Sem mudança | — |
| Pausa | `P` / `Esc` (sem mudança) | — |

- Com a partida rodando, `keydown` **e** `keyup` de `Space` chamam `preventDefault()`. Em alguns navegadores o botão focado é ativado no keyup. Além disso, ao iniciar ou retomar a partida, o foco sai do elemento ativo (`(document.activeElement as HTMLElement | null)?.blur()`). Isso evita que Espaço troque a câmera ou pause.
- `createKeyboardInput` ganha `kickPresses` interno, somado ao contador de `DriveInput` em `read()`. A interface pública não muda de forma: `read(input)` passa a devolver também `kick` e `kickPresses`.

### 3.3 Touch

- Novo botão **CHUTE** no grupo da direita, circular, com 76 px (64 px no layout deitado de pouca altura). Fica **acima e à esquerda** do ACELERAR, dentro do arco natural do polegar direito. O RÉ continua à esquerda do ACELERAR.
- `onPointerDown` → `input.kick = true; input.kickPresses++` (sem `setPointerCapture` de direção). `onPointerUp`, `onPointerCancel` e `onLostPointerCapture` → `kick = false`.
- O multi-toque já funciona (um `pointerId` por botão). O caso difícil é **um único polegar** alternando entre ACELERAR e CHUTE. O buffer de 0,12 s (seção 4.4) cobre a troca rápida. Se o teste com usuários mostrar dificuldade, o knob `KICK.coastSeconds` mantém a velocidade sem arrasto por um instante depois de soltar o acelerador para chutar. Fica desligado (0) por padrão.

### 3.4 Força e ângulo no input

- **v2 recomendada: chute instantâneo no aperto.** A força vem da velocidade frontal do carrinho e o ângulo vem da direção do carrinho (seção 4). Um botão, uma decisão, zero latência.
- "Segurar para carregar" fica como evolução (decisão aberta 1). O tipo já tem `kick` (segurando) e o config reserva `KICK.chargeSeconds = 0`. Se ativado, o chute sai **ao soltar**, com `power = lerp(base, max, held/chargeSeconds)`.

---

## 4. Física do chute

### 4.1 Zona de chute ("contato" sem posse)

Não existe estado de posse. Um chute é válido quando, **no passo em que é consumido**, a bola está na zona frontal do carrinho:

```
d        = bola.xz − carro.xz
f        = (−sin heading, −cos heading)          // frente do carrinho (mesma convenção do código atual)
gap      = |d| − CAR.radius − BALL.radius        // distância entre superfícies
ângulo   = acos(d̂ · f)
válido  ⇔ gap ≤ KICK.reach  e  ângulo ≤ KICK.coneHalfAngleDeg  e  bola.y ≤ KICK.maxBallHeight
```

Com os valores propostos (`reach` 1,0 e cone de 55°), a bola precisa estar a até 3,4 u do centro do carrinho e no semicírculo frontal "largo". Como o collider é redondo, essa zona é o que dá **frente** ao carrinho, sem trocar o collider por uma caixa (que seria menos estável em quinas).

### 4.2 Direção

```
n   = d̂                                                  // normal de contato
dir = normalize(f × KICK.headingWeight + n × (1 − KICK.headingWeight))   // headingWeight = 0,7
```

O jogador mira **virando o carrinho**. Os 30% de normal deixam o resultado fisicamente crível: bola tocada de lado sai de lado. Não há mira automática para o gol, nem para o jogador nem para a IA.

### 4.3 Força e impulso Rapier

```
v_frente = max(0, v_carro · f)
power    = min(KICK.maxPower, KICK.basePower + KICK.speedTransfer × v_frente) × powerFactor   // powerFactor = 1 (jogador)
alvo     = (dir.x × power,  max(v_bola.y, power × KICK.lift),  dir.z × power)
J        = BALL.mass × (alvo − v_bola)                       // ballBody.applyImpulse(J, true)
```

- O chute **define** a velocidade de saída, independentemente de como a bola chegava. Isso dá um resultado previsível ("vai para onde mirei, com a força que eu esperava") e fácil de testar.
- Valores: parado → 14 u/s; a 15 u/s → 21,5 u/s; teto 22 u/s. O chute sempre supera o empurrão máximo (~17 u/s). Com `linearDamping` 0,3, a bola chutada a 22 u/s percorre no máximo ~73 u (`v0/c`). Do meio-campo ×1,25 (48 u do gol), ela chega a ~7,6 u/s em ~3,5 s: dá para marcar de longe, mas um goleiro atento defende.
- **Elevação:** `lift` 0,12 dá vy = 2,6 u/s e sobe ~0,35 u. O topo da bola fica em ~2,2 u, abaixo do travessão (3,5). Invariante testado: `apex(maxPower) + BALL.radius < FIELD.goalHeight`. Isso impede chutes "por cima do gol" que cairiam no bolsão.
- Aplicar **antes** de `world.step`. O Rapier então resolve a sobreposição com o próprio carrinho no mesmo passo. Bola com CCD ativo: a 22 u/s ela anda 0,37 u por passo, menos que o raio de 0,9, então não atravessa paredes de 0,2 u.
- Novo `BALL.maxSpeed` (28) é aplicado depois do passo, como já ocorre com `CAR.maxSpeed`, para evitar somas extremas de empurrão com chute.
- **Chute contra a parede:** se a bola está a menos de `KICK.wallGuard` (0,3 u) de uma parede e `dir` aponta para dentro dela, a componente normal à parede é zerada e o chute sai rente à parede. Isso evita bola "esmagada" contra o collider e saltos estranhos.

### 4.4 Recarga, buffer e anti-spam

Estado por carrinho, puro, em `kick.ts`:

```ts
export type KickTimer = { cooldown: number; buffer: number };
export function stepKickTimer(timer: KickTimer, delta: number, pressed: boolean, inZone: boolean):
  { timer: KickTimer; fire: boolean; whiff: boolean };
```

| Situação | Efeito |
| --- | --- |
| Aperto com `cooldown > 0` | Ignorado (o botão mostra a recarga). |
| Aperto com bola na zona | Chuta. `cooldown = KICK.cooldownSeconds` (0,45). |
| Aperto sem bola na zona | Abre `buffer = KICK.bufferSeconds` (0,12). Se a bola entrar na zona nesse tempo, chuta. |
| Buffer expira sem bola | "Chute no ar": `cooldown = KICK.whiffCooldownSeconds` (0,25). |
| Segurar a tecla | Nada além do primeiro aperto. |

O custo do chute no ar torna o "aperta sem parar" pior do que acertar o tempo. Apertar a cada 0,12 s dá, no máximo, um chute a cada ~0,37 s, sempre com risco de pegar a recarga no momento errado.

### 4.5 Chutes simultâneos ("dividida")

Se mais de um carrinho chuta no mesmo passo, a velocidade-alvo é a **média vetorial** dos alvos individuais, calculados a partir da mesma `v_bola` pré-chute. A componente vertical usa o maior `lift`. Se os chutes forem opostos, eles se anulam no plano e a bola sobe um pouco, como numa dividida. O resultado **não depende da ordem dos índices**, o que é justo para os dois times. Função pura: `resolveSimultaneousKicks(targets)`.

### 4.6 Justiça

- A IA chama `evaluateKick` e `stepKickTimer` com os mesmos parâmetros. As diferenças de dificuldade (tabela da seção 5.5) ficam no **quando apertar** (reação e exigência de alinhamento) e em `powerFactor ≤ 1`.
- `KICK.recoil` (recuo no carrinho que chuta) existe, mas fica em **0**. Como a IA usa `setLinvel`, o recuo só afetaria o jogador. Ligar o recuo depende de migrar a IA para o mesmo modelo de impulsos (fora do escopo, registrado nos riscos).
- Para mensagens e futura estatística, o runtime registra `lastTouch = { team, slot, time }` em cada chute e em cada colisão carro↔bola. Não há regra de jogo associada a isso.

### 4.7 Ordem dentro do passo fixo

1. Ler o input (contador de chutes).
2. Dirigir o carrinho do jogador (sem mudança).
3. IA: "pensar" (se for o tick dela) e depois dirigir.
4. Resolver chutes (jogador e IA): zona → timers → `resolveSimultaneousKicks` → `applyImpulse`.
5. `world.step(events)`.
6. Eventos de colisão, limites de velocidade (carrinhos e **bola**), recuperação de impacto, contenção.
7. Gol, bola presa e bola imprensada.

Eventos novos para a cena: `onKick(position, power, team, isPlayer)` → anel de impacto em outra cor, som `'kick'` em `audio.ts` e, só para o jogador, `navigator.vibrate?.(12)`.

---

## 5. Modelo de equipe (2 a 3 por time)

### 5.1 Tipos e slots

```ts
// src/game/teams.ts
export type TeamId = 'red' | 'blue';
export type Role = 'striker' | 'support' | 'keeper';
export type CarSlot = {
  index: number;   // índice fixo do corpo Rapier / modelo Three
  team: TeamId;
  role: Role;
  human: boolean;  // só o slot 0
  number: string;  // número de camisa no capô
  color: number;
};
export function teamSizes(round: number): { red: number; blue: number };
export function activeSlots(round: number): CarSlot[];
export function spawnFor(slot: CarSlot, field?: FieldDimensions, kickoffTeam?: TeamId): { x: number; z: number; heading: number };
```

Os 6 corpos continuam criados uma vez e ligados ou desligados com `body.setEnabled` (custo zero quando desligados). O que muda é **quem é quem**: os slots passam a ser definidos por time e papel, numa tabela em `config.ts` (`TEAM.slots`), e não mais por índices soltos (`AI.playerIndex`, `AI.redAllyIndex` etc. saem).

| Slot | Time | Papel | Nº | Ordem de entrada |
| --- | --- | --- | --- | --- |
| 0 | Vermelho | Atacante (**você**) | 10 | 1º |
| 1 | Vermelho | Goleiro | 01 | 2º |
| 2 | Vermelho | Apoio | 08 | 3º |
| 3 | Azul | Atacante | 09 | 1º |
| 4 | Azul | Goleiro | 01 | 2º |
| 5 | Azul | Apoio | 05 | 3º |

Os números de camisa codificam o papel (01 = goleiro), como no futebol. O goleiro usa um tom diferente da cor do time, mas sempre no mesmo matiz.

### 5.2 Elenco por rodada e progressão

```ts
TEAM = {
  maxPerTeam: 3,
  sizesByRound: [[2, 2], [3, 3]],  // a última linha se repete nas rodadas seguintes
  kickoffAdvantage: 3,             // u: quem sofreu o gol sai com o atacante mais perto da bola
}
```

- Sempre simétrico, nunca acima de 3. `teamSizes` é testado para todas as rodadas de 1 a 20.
- A progressão depois da rodada 2 vem só de `aiPressure(difficulty, round)` (seção 5.5).
- Sai a regra "aliado ao marcar / perde ao sofrer". Ela conflita com times fixos e é a regra mais difícil de explicar no HUD hoje. `awardGoal` deixa de mexer em `redCars` e `blueCars`, que passam a vir de `teamSizes(round)` e continuam no `MatchState` para o placar.
- Saída de bola: depois de um gol, o atacante do time que sofreu começa `kickoffAdvantage` unidades mais perto da bola. É um *catch-up* leve, como a saída de bola do futebol.

### 5.3 Spawns por papel (frações do campo)

```ts
TEAM.spawnFractions = {
  striker: { x: -0.30, z: 0 },
  support: { x: -0.50, z: 0.40 },
  keeper:  { x: -0.88, z: 0 },
} // x em frações de goalLineX, z em frações de sideWallZ; o azul é espelhado por ponto: (x, z) → (−x, −z)
```

No campo ×1,25 isso dá: atacante (−14,4; 0), apoio (−24,0; 10,0), goleiro (−42,2; 0). O espelhamento por ponto mantém a simetria e evita que os dois apoios fiquem na mesma faixa (o código atual já usa esse padrão: (−18, 9) contra (18, −9)). Teste: todos os spawns de todas as composições ficam dentro do campo, a pelo menos `2 × CAR.radius + 1` de qualquer outro spawn e da bola.

### 5.4 IA por papel

```ts
// src/game/team-ai.ts
export type CarCommand = { targetX: number; targetZ: number; speedFactor: number; kick: boolean };
export type AiMode = 'chase' | 'hold' | 'rush' | 'recover';
export function selectChaser(candidates: ChaserCandidate[], ball: BallSample, attackDirX: 1 | -1, previous: number | undefined): number;
export function roleTarget(slot: CarSlot, ctx: AiContext): { x: number; z: number; mode: AiMode };
export function shouldAiKick(ctx: AiContext, kick: KickResult, pressure: AiPressure, reactionElapsed: number): boolean;
export function aiPressure(difficulty: Difficulty, round: number): AiPressure;
```

**Perseguidor único por time (anti-empilhamento).** Uma vez por tick de IA e por time:

- custo = distância até o ponto de aproximação (bola prevista − `attackDir × behindBallDistance`) + `AI.wrongSidePenalty` (4) se o carrinho estiver do lado errado da bola (entre a bola e o gol adversário);
- o goleiro só é candidato quando a bola está dentro do raio de saída dele (`rush`);
- **histerese**: só troca de perseguidor se o novo custo for menor que o atual em mais de `AI.chaserHysteresis` (3 u);
- **time vermelho**: o jogador entra como candidato. Se ele for o perseguidor, os aliados IA seguram posição. Um aliado só persegue se vencer o jogador por `AI.allyYieldMargin` (6 u). A IA aliada não rouba a bola de quem está jogando.

**Alvo por papel** (quando não é o perseguidor):

| Papel | Alvo | Comportamento |
| --- | --- | --- |
| Atacante | Lógica atual de "ir para trás da bola e empurrar", mais o chute. | Quando é perseguidor: `chase`. Quando não: posição ofensiva no meio-campo, na faixa central. |
| Apoio | x = bola.x − attackDir × `supportTrail` (10 u), limitado ao próprio campo + `pressLine`; z = faixa oposta à da bola (−sinal(bola.z) × 0,35 × sideWallZ). | Fica disponível para rebote. Quando a bola está no terço defensivo, recua entre a bola e o gol, com z = bola.z × 0,5 para bloquear. |
| Goleiro leve | x = gol próprio + attackDir × `keeperDepth` (0,07 × goalLineX ≈ 3,4 u); z = clamp(bola prevista.z × 0,6, ±(goalHalfWidth − 1)). | `rush` quando a bola está a menos de `keeperRushDistance` do gol. Afasta a bola com chute (mira com dot ≥ 0,2 para longe do próprio gol). Nunca passa de `keeperLeash` (0,35 × goalLineX). Velocidade × 0,85 e força × 0,8: é "leve" porque dá para driblar e vencer. |

**Separação:** se o alvo de um carrinho estiver a menos de `AI.separationRadius` (5 u) de um companheiro, o alvo é deslocado lateralmente por `AI.separationOffset` (4 u). A recuperação de "travado" (`blockedTime`/`recoveryTime`) continua igual.

**Chute da IA:** `shouldAiKick` retorna verdadeiro quando a bola está na zona, o tempo desde a entrada na zona é ≥ `reaction` e dot(`dir`, rumo ao gol adversário) ≥ `kickAimDot`. Na defesa (bola no terço do próprio gol), qualquer direção com dot ≥ 0 para longe do próprio gol serve (é um afastamento). A imprecisão da IA **sai do próprio erro de direção dela**, sem ruído artificial no chute.

**CPU:** a decisão (perseguidor e alvos) roda a `AI.thinkHz` = 20 Hz, escalonada por slot (`step % 3 === slot % 3`). A direção e a velocidade continuam a 60 Hz. São no máximo 5 carrinhos IA × O(6) operações por tick: desprezível. O tick reduzido também dá um tempo de reação "humano". O movimento da IA segue com `setLinvel`, como hoje (migrar para impulsos fica fora do escopo).

### 5.5 Pressão por rodada (substitui "mais carrinhos")

| Campo | Fácil / Médio / Difícil (rodada 1) | Por rodada | Limite |
| --- | --- | --- | --- |
| `speed` | `opponentSpeed` atual (0,8 / 0,95 / 1,1) | +0,1 | 1,5 |
| `reaction` (s) | 0,30 / 0,18 / 0,10 | −0,02 | mín. 0,06 |
| `kickAimDot` | 0,55 / 0,70 / 0,80 | +0,02 | máx. 0,85 |
| `powerFactor` | 0,80 / 0,90 / 1,00 | +0,03 | máx. 1,00 |
| `pressLine` (fração do campo) | 0,05 | +0,05 | 0,25 |
| `keeperRushDistance` (u) | 10 | +1 | 16 |

Teste: todos os campos são monotônicos com a rodada e respeitam os limites. `powerFactor` nunca passa de 1.

---

## 6. Redimensionamento do campo

### 6.1 Proposta de escala

Fonte: a área jogável atual (76,7 × 40,2) e a câmera atual. Os valores de px/u vêm da fórmula de enquadramento da seção 6.3, aplicada a uma cena de desktop de 1204 × 690 px e a um celular deitado de 828 × 341 px.

| Opção | Área jogável | Área por carro em 3×3 | Travessia a 15 u/s | Travessia com velocidade ×√s | px/u desktop (hoje 11,9) | px/u celular deitado (hoje 5,9) |
| --- | --- | --- | --- | --- | --- | --- |
| ×1,00 | 76,7 × 40,2 | 514 | 5,1 s | 5,1 s | 14,0 | 8,4 |
| ×1,15 | 88,2 × 46,2 | 680 | 5,9 s | 5,5 s | 12,2 | 7,4 |
| **×1,25** | **95,9 × 50,2** | **803** | 6,4 s | **5,7 s** | **11,3 (−5%)** | **6,9 (+17%)** |
| ×1,40 | 107,4 × 56,3 | 1007 | 7,2 s | 6,1 s | 10,1 (−15%) | 6,2 (+6%) |

**Recomendação: ×1,25 uniforme.** A área cresce 56% e a densidade de 3×3 fica ~36% menor que a densidade máxima de hoje (2×4 em 76,7 × 40,2). Com o enquadramento derivado do campo, o tamanho na tela **praticamente não cai no desktop (−5%) e melhora no celular deitado (+17%)**, porque hoje a câmera desperdiça largura e usa um `halfHeight` mínimo fixo de 29. ×1,40 só vale se o produto quiser partidas mais longas: reduz 15% o tamanho na tela e deixa o campo vazio em 2×2.

A escala é **uniforme**: os mesmos fatores atuais de X e Z, ambos multiplicados por `s`. O gol cresce junto (largura 14,7 → 18,4). Há um knob separado (`FIELD_SCALE.goal`, padrão 1) caso seja preciso ajustar a taxa de gols depois da chegada dos goleiros. A altura do gol (3,5) **não** escala, porque depende da bola, que não muda.

### 6.2 Geometria derivada

```ts
// src/game/field-geometry.ts
export type FieldDimensions = { scaleX: number; scaleZ: number; halfWidth: number; halfLength: number; sideWallZ: number;
  goalLineX: number; goalBackX: number; goalHalfWidth: number; goalHeight: number; cornerChamfer: number; /* ... */ };
export function createFieldDimensions(scale: number, goalScale = 1): FieldDimensions;

// src/game/config.ts
export const FIELD_SCALE = { field: 1.25, goal: 1, speed: Math.sqrt(1.25) } as const;
export const FIELD = { ...createFieldDimensions(FIELD_SCALE.field, FIELD_SCALE.goal), visual: { /* inalterado */ } } as const;
```

- Base em "unidades de maquete" (constantes atuais): `scaleX = 2.8·s`, `scaleZ = 2.45·s`, `goalLineX = 13.7·scaleX`, `goalBackX = 14.7·scaleX`, `sideWallZ = 8.2·scaleZ`, `goalHalfWidth = 3·scaleZ·goalScale`, `halfWidth = 15·scaleX`, `halfLength = 9·scaleZ`.
- **Teste de regressão:** `createFieldDimensions(1)` reproduz exatamente os números atuais. Esse teste é a rede de segurança do refactor.
- Invariantes testados para s ∈ {1; 1,15; 1,25; 1,4}: `goalLineX < goalBackX < halfWidth`, `goalHalfWidth < sideWallZ`, profundidade do gol > `2 × CAR.radius`, todos os spawns dentro do campo.
- A arena visual segue escalada pelo grupo (`arena.scale.set(FIELD.scaleX, 1, FIELD.scaleZ)`). Com `s` uniforme, nenhum objeto da arena ganha draw call nova: assentos, listras e tubos continuam na mesma quantidade. As marcações da área do gol passam a usar `goalScale`. A distorção elíptica que já existe (2,8 × 2,45) se mantém. Corrigi-la é opcional, fora destes PRs.

### 6.3 Câmera

```ts
// src/game/camera-framing.ts
export function fitArenaHalfHeight(args: {
  aspect: number; field: FieldDimensions; tiltCos: number; margin: number;
  insetTopPx?: number; insetBottomPx?: number; viewportHeightPx?: number;
}): { halfHeight: number; targetOffsetZ: number };
```

- `halfHeight = max((sideWallZ + margin) × tiltCos + CAMERA.wallAllowance, (goalBackX + margin) / aspect)`. `tiltCos` = 95/√(95² + 52²) ≈ 0,877 para a câmera "Arena" atual. Os assentos da arquibancada podem ficar cortados, porque são só decoração.
- **Insets:** no touch, a altura dos botões é lida via `getBoundingClientRect` dos grupos ao redimensionar e multiplicada por `CAMERA.touchInsetFactor` (0,5), porque os botões ocupam só os cantos de baixo. O resultado entra como `insetBottomPx`. A linha de fundo próxima fica acima dos botões. Custo: o celular deitado vai de ~6,9 para ~6,2 px/u, ainda acima de hoje (5,9). Com o fator em 1 (campo inteiro acima dos botões), cairia para ~5,5 px/u.
- **"Carrinho" vira zoom de verdade:** em `follow`, `camera.zoom` é ajustado para mostrar `CAMERA.followHalfWidth` (22 u) ao redor do carrinho, com interpolação suave. É o modo recomendado em **retrato**, onde o enquadramento completo dá ~3,5 px/u (hoje ~3,9). A dica "Gire o celular" continua.
- `top` usa a mesma fórmula com `tiltCos` = 1. O `far` (210) continua suficiente. As `PointLight` passam a ter posição e alcance multiplicados por `s`.
- Teste: para aspectos de 0,5 a 2,6, os quatro cantos do campo (`±goalBackX`, `±sideWallZ`) projetados caem dentro do frustum.

### 6.4 Colliders e limites

Novos colliders fixos em `physics-runtime.ts`, todos derivados de `FIELD`:

| Collider | Onde | Por quê |
| --- | --- | --- |
| Paredes de fundo | x = ±goalLineX, z ∈ [goalHalfWidth, sideWallZ] nos dois lados do gol | Acaba com o bolsão atrás da linha de fundo e com a bola atravessando a parede visual. |
| Laterais da rede | z = ±goalHalfWidth, x ∈ [goalLineX, goalBackX], altura do gol | A bola só entra pela boca do gol. |
| Chanfros de canto | Caixas a 45° nos 4 cantos, `FIELD.cornerChamfer` = 3 u | Cantos de 90° são o principal lugar onde a bola fica presa entre parede e carrinho. |
| Cortina do gol (só carrinhos) | Plano em x = ±goalLineX na boca do gol, com *collision groups* que interagem só com carrinhos | Impede que o goleiro (ou o jogador) estacione dentro da rede. A bola passa livre. |

- *Collision groups* (Rapier: 16 bits de associação + 16 bits de filtro): `WORLD`, `BALL`, `CAR`, `CAR_BLOCKER`. O helper `groups(member, filter)` fica em `physics-runtime.ts`. A cortina é membro de `CAR_BLOCKER` e filtra só `CAR`.
- A parede de fundo visual (`walls.supportX`) é realinhada a `goalLineX`, e os chanfros ganham mesh correspondente.
- `containPlanarBody` continua como **rede de segurança**. Num modo de depuração, um contador mostra quantas vezes ela atuou (deve ser ~0).
- Velocidades: `CAR.maxSpeed` 15 → 15 × √s ≈ 16,8; `CAR.acceleration` 18 → ≈ 20,1; `AI.speedMultiplier` 8 → ≈ 8,9. Todos derivados de `FIELD_SCALE.speed`. Ré e direção não mudam, porque dependem do carrinho e não do campo.
- `stuck-monitor.ts` não muda: ele lê `FIELD.halfWidth`/`halfLength`, que passam a ser derivados da escala, e as margens (6 u e 4 u) continuam **absolutas**, porque são relativas à bola.

---

## 7. UI, HUD e acessibilidade

- **Botão CHUTE** (touch): `aria-label="Chutar a bola"`, `aria-keyshortcuts="Space K"`, alvo ≥ 64 px (acima do mínimo de 44 px da WCAG 2.5.5) e ≥ 8 px de distância de outros botões.
- **Recarga visível:** ao chutar, a cena chama `onKick`. O app adiciona uma classe ao botão com animação CSS de varredura (`conic-gradient`) com duração `--kick-cooldown` vinda de `KICK.cooldownSeconds`. Sem setState a 60 Hz.
- **"Pronto para chutar":** o halo da bola (`ballHalo`) muda de ciano para amarelo quando a bola está na zona do **jogador**. É o feedback de aprendizado mais barato possível: um material e uma troca de cor.
- **Achar o próprio carrinho em 3×3:** anel amarelo no chão sob o slot 0 (um mesh). Números de camisa por papel. Legenda no menu: "01 goleiro · 05/08 apoio · 09/10 atacante".
- **Textos (pt-BR):**
  - teclado: adicionar `<kbd>Espaço</kbd> chutar` em `keyboard-guide` e `keyboard-shortcuts`;
  - menu: "Times de 2 contra 2 na primeira rodada e 3 contra 3 depois. A cada vitória o adversário joga com mais pressão.";
  - linha de regras: "ATÉ 3 CARRINHOS POR TIME · CHUTE COM ESPAÇO OU BOTÃO CHUTE" (substitui a linha do aliado);
  - placar: "VOCÊ · 3 CARRINHOS" é mantido, com os números vindos de `teamSizes`;
  - corrigir a mensagem inicial corrompida (seção 1.8).
- **Movimento reduzido:** com `prefers-reduced-motion: reduce`, o anel e o flash do chute ficam com metade da intensidade, e a câmera `follow` interpola mais devagar.
- **Vibração:** `navigator.vibrate?.(12)` só no chute do jogador e só se existir (Android). Sem efeito no iOS.
- **Cores:** vermelho × azul é distinguível na maioria dos tipos de daltonismo. O papel não depende só da cor (número e anel).

---

## 8. Orçamento de desempenho

| Item | 1×1 hoje | 3×3 v2 (estimado) | Alavanca se faltar folga |
| --- | --- | --- | --- |
| Draw calls | ~240 | ~335 + anel do jogador + chanfros ≈ 345 | Assentos com `InstancedMesh` (88 → 2), tubos da rede mesclados (~54 → 4), carrinho mesclado por material (24 → ~8). |
| Corpos Rapier dinâmicos | 3 | 7 | — (custo desprezível) |
| IA | 1 carrinho × 60 Hz | 5 × 20 Hz (decisão) + 60 Hz (direção) | `thinkHz` |
| `pixelRatio` | ≤ 1,5 | ≤ 1,5 | Baixar para 1,25 com `pointer: coarse` |

Instrumentação (PR 2): `?debug=1` mostra FPS (média móvel), `renderer.info.render.calls`, tempo médio de `physics.update` e o contador do clamp de contenção. Não aparece em produção sem o parâmetro.

---

## 9. Riscos e mitigação

| Risco | Onde aparece | Mitigação |
| --- | --- | --- |
| Bola atravessando parede ou trave | Chute forte | CCD já ativo, `BALL.maxSpeed` 28 (0,47 u/passo < raio), colliders ≥ 0,2 u, regra de chute contra a parede, clamp como rede de segurança. |
| Bola presa (cantos, bolsão, gol pela lateral) | Campo atual e maior | Paredes de fundo, laterais da rede, chanfros. O detector de borda continua. |
| Bola imprensada entre carrinhos no meio | 3×3 com IA via `setLinvel` | Novo detector: bola < 0,5 u/s com carrinhos dos **dois** times a < 3,5 u por `STUCK.scrumSeconds` (2,5 s) → "bola ao alto" (impulso vertical + afastamento leve dos carrinhos), sem reiniciar o lance. |
| IA empilhada | Defesa e ataque | Perseguidor único com histerese, alvos por papel, separação. Métrica no teste headless (seção 10). |
| IA roubando a bola do jogador | Aliados vermelhos | `allyYieldMargin`: aliado não persegue se o jogador estiver mais perto. |
| Goleiro dentro da rede | Cortina e alvo do goleiro | Cortina só para carrinhos e alvo do goleiro em x ≥ linha + `keeperDepth`. |
| FPS em celular | 3×3, ~345 draw calls | Orçamento da seção 8, painel `?debug=1`, PR 4 de contingência (instancing e merge) se o critério de FPS falhar. |
| Polegar único ACELERAR ↔ CHUTE | Touch | Buffer de 0,12 s, posição do botão, knob `coastSeconds`. |
| Espaço acionando botão focado | Desktop | `preventDefault` em keydown e keyup e `blur` ao iniciar ou retomar. |
| Injustiça IA × jogador | Chute e colisões | Mesma função de chute, `powerFactor ≤ 1`, recuo 0. Migrar a IA para impulsos fica registrado como dívida. |
| Retuning em cascata ao mudar a escala | IA e spawns | Princípio da seção 2.3 (frações × absolutos) e teste de regressão da escala 1. |
| Teste de integração frágil | Posições fixas no teste atual | Testes passam a usar `activeSlots` e `spawnFor` em vez de coordenadas fixas. |

---

## 10. Plano de implementação (3 PRs pequenos)

Ordem: **Chute → Campo → Times.** O chute é o que mais muda o *feeling* e não depende dos outros dois. O campo vem antes dos times porque o ajuste da IA por papel (profundidade do goleiro, faixas do apoio) depende das dimensões finais. Os três PRs mexem em `physics-runtime.ts` e `config.ts`, então são **sequenciais**, não paralelos.

### PR 1 — Chute

**Arquivos:** `src/game/kick.ts` (novo), `input.ts`, `config.ts` (`KICK`, `BALL.maxSpeed`, `AI.kick*` básico), `physics-runtime.ts` (passo 4 da seção 4.7, chute básico da IA para o atacante atual, correção do texto corrompido), `scene.ts` (`onKick`, anel, halo "pronto"), `audio.ts` (`'kick'`), `app.tsx` (botão CHUTE, dicas de Espaço, foco), `style.css`, `README.md` (controles).

**Testes (`tests/kick.test.ts` e ajustes em `tests/game-systems.test.ts`):**
- bola parada a 0,5 u na frente do carrinho parado, chute → velocidade planar da bola em [13,3; 14,7] e direção a ≤ 5° da direção esperada;
- bola atrás (ângulo > cone) ou acima de `maxBallHeight` → não chuta; buffer expira e aplica `whiffCooldown`;
- dois apertos dentro da recarga → um único chute;
- aperto 0,1 s antes de a bola entrar na zona → chuta (buffer);
- keydown e keyup no mesmo quadro (contador) → um chute;
- `apex(maxPower) + BALL.radius < FIELD.goalHeight`;
- dividida: dois alvos opostos e iguais → velocidade planar ≈ 0 e vy > 0; resultado igual com a ordem invertida;
- integração Rapier: com o chute, a bola percorre pelo menos o dobro da distância do empurrão sem chute, em 1 s, na mesma situação inicial.

**Aceite:** `npm test` e `npm run build` verdes; chute funciona com teclado e toque; a IA também chuta.

### PR 2 — Campo maior

**Arquivos:** `src/game/field-geometry.ts` (novo), `src/game/camera-framing.ts` (novo), `config.ts` (`FIELD_SCALE`, `FIELD` derivado, `CAMERA`, velocidades derivadas, `CAR.spawnPositions` em frações), `arena.ts` (parede de fundo alinhada, chanfros, marcações), `physics-runtime.ts` (colliders novos, collision groups, cortina), `scene.ts` (`resize` com `fitArenaHalfHeight`, zoom em `follow`, luzes, `?debug=1`), `app.tsx` (insets do touch).

**Testes (`tests/field.test.ts`, `tests/camera-framing.test.ts`):**
- `createFieldDimensions(1)` igual aos números atuais (tolerância 1e-9);
- invariantes para s ∈ {1; 1,15; 1,25; 1,4};
- cantos do campo dentro do frustum para aspectos de 0,5 a 2,6;
- integração: bola lançada a 28 u/s contra a parede de fundo fora do gol → nunca passa de `goalLineX + BALL.radius` e não marca gol; bola lançada de lado contra a rede → não entra;
- carrinho dirigido contra a boca do gol por 2 s → nunca passa de `goalLineX`; bola passa;
- testes existentes de gol e contenção passam com o campo novo.

### PR 3 — Times de 2 a 3 e IA por papel

**Arquivos:** `src/game/teams.ts` e `src/game/team-ai.ts` (novos), `config.ts` (`TEAM`, knobs de papel, tabela de pressão; remove `AI.*Index`, `maxCars`, `allyUnlockRound`, `playerCarsWithAlly`, `roundsPerAdditionalCar`), `match-rules.ts` (remove a lógica do aliado, `teamSizes`, mensagens), `physics-runtime.ts` (ativação por elenco, loop da IA via `team-ai`, detector de bola imprensada, opção `humanSlots`), `scene.ts` (carrinhos criados a partir de `TEAM.slots`, sem lista duplicada; anel do jogador), `objects.ts` (a cor do farol hoje depende de `color === 0x148fff`; passa a receber o time como parâmetro), `app.tsx` (textos), `README.md` ("Como jogar").

`createPhysics` ganha um último parâmetro opcional `options?: { humanSlots?: number[]; seed?: number }`. Com `humanSlots: []`, todos os carrinhos são IA, o que permite a simulação headless.

**Testes (`tests/teams.test.ts`, `tests/team-ai.test.ts`, `tests/simulation.test.ts`):**
- `teamSizes(r)` para r de 1 a 20: simétrico, ≤ 3, conforme a tabela;
- spawns sem sobreposição, dentro do campo, espelhados por ponto, com vantagem de saída aplicada ao time certo;
- `selectChaser`: mantém o perseguidor quando a diferença de custo < histerese; troca quando > histerese; o goleiro só entra em `rush`; o aliado cede ao jogador;
- `aiPressure`: monotônico e com limites (`powerFactor ≤ 1`);
- `shouldAiKick`: respeita reação, mira e recarga;
- **simulação headless 3×3** (IA contra IA, 120 s de jogo, seed fixa, < 3 s de execução): nenhum NaN; todos os corpos dentro dos limites; no máximo 1 perseguidor por time em ≥ 99% dos ticks; fração de ticks com ≥ 2 carrinhos do mesmo time a < 4 u da bola ≤ 15%; reinícios por bola presa ≤ 2 por minuto; ao menos 1 chute por time.

### PR 4 (contingência, só se o critério de FPS falhar)

Assentos com `InstancedMesh`, tubos da rede mesclados e merge de geometria dos carrinhos por material. Nenhuma mudança de gameplay.

---

## 11. Critérios de aceite mensuráveis

**Chute**
1. Do aperto ao impulso: ≤ 1 passo fixo (16,7 ms) quando a bola está na zona; ≤ 120 ms de buffer quando não está.
2. Saída da bola parada: 14 ± 0,7 u/s com o carrinho parado e ≤ 22 u/s em qualquer caso; direção a ≤ 5° do esperado.
3. No máximo 1 chute a cada 0,45 s por carrinho; segurar a tecla gera 1 chute.
4. Nenhum chute passa por cima do travessão (teste analítico) e nenhum atravessa parede (teste de integração).
5. A IA usa a mesma função e a mesma recarga (teste com recarga ativa → a IA não chuta).

**Times**
6. Nunca mais de 3 por time; times sempre simétricos; elenco conforme `TEAM.sizesByRound`.
7. Na simulação headless: as métricas de perseguidor, empilhamento, bola presa e NaN do PR 3 são atendidas.
8. O jogador identifica o próprio carrinho por anel e número em qualquer câmera.

**Campo**
9. `createFieldDimensions(1)` igual ao campo atual; área jogável ×1,25 com `FIELD_SCALE.field = 1,25`.
10. Celular deitado 844 × 390, câmera Arena, com insets: px/u ≥ 5,9 (o valor de hoje), ou seja, bola ≥ 10 px e carrinho (collider) ≥ 18 px. Desktop 1280 × 720: queda de no máximo 10% no px/u em relação a hoje.
11. Campo inteiro visível (linha a linha de fundo, parede a parede) para aspectos de 0,5 a 2,6, acima dos botões de toque.
12. Zero entradas de bola pela lateral do gol e zero carrinhos dentro da rede nos testes de integração.

**Desempenho** (medido com `?debug=1`)
13. Desktop (Chrome, GPU integrada, 1280 × 720, 3×3): ≥ 58 FPS de média em 60 s.
14. Celular intermediário (Android com Chrome, deitado, 3×3): ≥ 45 FPS de média em 60 s; ≤ 360 draw calls; `physics.update` ≤ 2 ms de média.

**Geral**
15. `npm test` e `npm run build` verdes em cada PR; nenhum texto novo fora de pt-BR na UI.

---

## 12. Decisões abertas para o produto

1. **Estilo do chute:** chute **instantâneo no aperto**, com força pela velocidade (recomendado: mais simples no toque e sem latência), ou **segurar para carregar e soltar para chutar** (mais controle, mais difícil no celular)? A arquitetura suporta as duas opções (`KICK.chargeSeconds`).
2. **Composição por rodada:** **R1 2×2 → R2+ 3×3** (recomendado; "time de verdade" desde o início, com você de atacante e um goleiro aliado) ou **R1 1×1 tutorial → R2 2×2 → R3+ 3×3**? Nos dois casos sai a regra "ganha aliado ao marcar / perde ao sofrer".
3. **Tamanho do campo:** **×1,25** (recomendado; partidas no mesmo ritmo e tamanho na tela praticamente igual) ou **×1,40** (campo bem maior, travessia ~6 s e carrinhos ~15% menores no desktop)?

Decisões já tomadas neste documento (sem necessidade de confirmação, mas registradas): o jogador controla sempre o carrinho 10 (sem troca de jogador); não existe posse "grudada"; limite rígido de 3 por time; sem online, ranking, anúncios ou login.

---

## Apêndice — knobs novos em `config.ts`

```ts
export const KICK = {
  reach: 1.0,               // u entre superfícies
  coneHalfAngleDeg: 55,
  maxBallHeight: 2.2,       // y do centro da bola
  basePower: 14,            // u/s
  speedTransfer: 0.5,
  maxPower: 22,             // u/s
  headingWeight: 0.7,
  lift: 0.12,
  cooldownSeconds: 0.45,
  whiffCooldownSeconds: 0.25,
  bufferSeconds: 0.12,
  wallGuard: 0.3,
  recoil: 0,
  chargeSeconds: 0,         // 0 = chute instantâneo
  coastSeconds: 0,
} as const;

// BALL.maxSpeed = 28
// FIELD_SCALE = { field: 1.25, goal: 1, speed: Math.sqrt(1.25) }
// CAMERA = { margin: 2, wallAllowance: 1, followHalfWidth: 22, touchInsetFactor: 0.5 }
// STUCK.scrumSeconds = 2.5, STUCK.scrumRadius = 3.5, STUCK.scrumBallSpeed = 0.5
// AI += { thinkHz: 20, chaserHysteresis: 3, wrongSidePenalty: 4, allyYieldMargin: 6,
//         separationRadius: 5, separationOffset: 4, supportTrail: 10,
//         keeperDepthFraction: 0.07, keeperLeashFraction: 0.35, keeperSpeedFactor: 0.85, keeperPowerFactor: 0.8,
//         pressure: { /* tabela da seção 5.5 */ } }
// TEAM = { maxPerTeam: 3, sizesByRound: [[2, 2], [3, 3]], kickoffAdvantage: 3, slots: [ /* seção 5.1 */ ], spawnFractions: { /* seção 5.3 */ } }
```
