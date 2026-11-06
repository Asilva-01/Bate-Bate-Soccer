# BATE-BATE SOCCER

Jogo de futebol de carrinhos para navegador, com Three.js e física Rapier.

## Como jogar

Escolha entre **Fácil**, **Médio** e **Difícil** no menu e faça três gols na trave azul para vencer. A primeira rodada começa com um carrinho por equipe. Cada vitória abre uma nova rodada com adversários mais rápidos e agressivos; o azul recebe mais carrinhos nas rodadas 2, 4 e 6 (até quatro). A partir da segunda rodada, ao marcar um gol você ganha um aliado (até dois carrinhos vermelhos); ao sofrer um gol, perde esse aliado. Após cada gol, ou quando a bola ficar presa por quatro segundos perto da borda, todos voltam para posições centrais e o placar é preservado.

### Controles

Teclado (o jogo mostra a câmera atrás do carrinho):

- **W/S** ou **setas para cima/baixo**: acelerar e dar ré (a entrada sobe em rampa, sem tranco).
- **A/D** ou **setas para esquerda/direita**: virar.
- **Espaço** ou **K**: TOQUE na bola (o chute atual), quando ela estiver na frente do carrinho.
- **P** ou **Escape**: pausar/continuar (no menu de pausa também se escolhe a câmera).

Celular (jogue **deitado**; em retrato a partida pausa e pede para girar o aparelho):

- **Joystick flutuante** na metade esquerda da tela: ele nasce onde o polegar toca. Empurrar para a frente acelera (a intensidade é o acelerador, a distância até ~85% do raio é o máximo), para os lados faz a curva e puxar para trás dá ré.
- **TOQUE** no canto inferior direito: o chute atual do jogo.
- Ao tocar em **ENTRAR EM CAMPO**, a partida abre em tela cheia (Android) ou cobre a tela toda (iPhone, que não tem a Fullscreen API). Para esconder a barra do Safari, use "Adicionar à Tela de Início".
- Uma seta amarela na borda da tela indica a bola quando ela sai do campo de visão, com a distância em metros quando passa de 20.

### Câmera, som e depuração

- No menu de pausa, escolha a câmera **Perto** (padrão, atrás do carrinho) ou **Alta** (visão 3/4, mais ampla). A escolha fica salva no navegador.
- Clique em **Ligar som** para ativar trilha sintetizada inspirada em rock e efeitos de colisão e gol. O áudio começa após a interação do jogador.
- Abra o jogo com `?debug=1` na URL para ver o painel de desempenho: FPS (média de 60 quadros e p95), draw calls, triângulos, `pixelRatio`, tempo de `physics.update`, atuações da rede de segurança, reinícios por bola presa, toques na bola e chutes ao gol.

## Executar localmente

Requisitos: Node.js 20.19+ ou 22.12+ e npm.

```bash
npm install
npm run dev
```

Abra o endereço informado pelo Vite no Chrome ou Edge com WebGL habilitado. Para gerar a versão de produção, use `npm run build`; para conferi-la, use `npm run preview`.

## Publicação no GitHub Pages

O workflow em `.github/workflows/pages.yml` gera e publica o jogo quando há um push na branch `main`. No repositório do GitHub, abra **Settings → Pages** e selecione **GitHub Actions** em **Build and deployment → Source**. Depois acompanhe a execução na aba **Actions**.

## Organização

- `src/game/arena.ts`: campo, traves, redes e estádio.
- `src/game/objects.ts`: modelos da bola e dos carrinhos.
- `src/game/physics-runtime.ts`: simulação física, controles de jogador, lógica de IA (atacantes/defensores), poses anterior e atual para interpolação, detecção de gols e recuperação após impactos.
- `src/game/kick.ts`: zona de chute, força, recarga e impulso (jogador e IA).
- `src/game/vehicle-dynamics.ts`: respostas de acelerador, freio e inércia, direção analógica e correção de derrapagem lateral.
- `src/game/chase-camera.ts`: câmera de perseguição (presets `perto`/`alta`, FOV, assistência de bola) e indicador de bola fora da tela.
- `src/game/touch-stick.ts`: matemática do joystick flutuante (zona morta, ré, base que segue o dedo).
- `src/game/input.ts`: `ControlFrame` analógico e teclado com rampa.
- `src/game/render-interpolation.ts`: interpolação das poses entre passos de física.
- `src/game/perf-monitor.ts`: média móvel de FPS e p95 para o painel `?debug=1`.
- `src/game/scene.ts`: câmera em perspectiva, iluminação, renderização, indicador de bola e painel de depuração.
- `src/game/match-rules.ts`: progressão de rodadas, dificuldades, seleção de atacante e mensagens de jogo.
- `src/game/stuck-monitor.ts`: detecção de bola presa perto das bordas.
- `src/game/config.ts`: parâmetros de física, IA, campo e balanceamento do jogo.
- `src/app.tsx`: interface React, placar, controles touch e menus.


## Testes

Execute `npm test` para validar regras de gol, IA, progressão, recuperação da bola, controles e reinício. `npm run build` verifica TypeScript e a versão de produção.

A configuração de massas, aderência, limites de velocidade, dimensões dos gols e passo fixo está centralizada em `src/game/config.ts`. A IA escolhe estrategicamente o atacante considerando distância e posicionamento em relação ao gol, enquanto os defensores reagem dinamicamente à posição da bola. Dificuldades (Fácil/Médio/Difícil) alteram velocidade, agressividade e tempo de reação dos adversários.

Colisões fortes ativam uma correção breve de derrapagem, e cada gol dispara uma comemoração visual na trave correspondente. Controles de toque são otimizados com safe-area para notches e barras de navegação em dispositivos móveis.

## Próxima versão do gameplay

A direção atual do produto está em [`docs/visao-e-arquitetura-v3.md`](docs/visao-e-arquitetura-v3.md): futebol de carrinhos 3D com câmera atrás do carro, pensado primeiro para o celular deitado. O documento traz a visão de produto, as regras da partida (2 minutos, 1 contra 1 e depois 2 contra 2 contra a IA), o novo controle por toque (joystick analógico, TOQUE e TURBO), a câmera, a arena fechada com bola maior e mais quicante, a IA, as metas de desempenho, o plano em oito PRs pequenos e as decisões abertas. Ele substitui em parte a v2 abaixo.

A arquitetura da v2 está em [`docs/arquitetura-gameplay-v2.md`](docs/arquitetura-gameplay-v2.md). Ela cobre o botão de chute (Espaço ou botão **CHUTE**, com recarga e a mesma regra para jogador e IA), os times de até três carrinhos com papéis de atacante, apoio e goleiro, e o campo 25% maior com câmera e colliders derivados das dimensões. O documento também traz os riscos, o plano em três PRs pequenos e os critérios de aceite.
