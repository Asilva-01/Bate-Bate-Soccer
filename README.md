# BATE-BATE SOCCER

Jogo de futebol de carrinhos para navegador, com Three.js e física Rapier.

## Como jogar

Escolha entre **Fácil**, **Médio** e **Difícil** no menu e faça três gols na trave azul para vencer. A primeira rodada começa com um carrinho por equipe. Cada vitória abre uma nova rodada com adversários mais rápidos e agressivos; o azul recebe mais carrinhos nas rodadas 2, 4 e 6 (até quatro). A partir da segunda rodada, ao marcar um gol você ganha um aliado (até dois carrinhos vermelhos); ao sofrer um gol, perde esse aliado. Após cada gol, ou quando a bola ficar presa por quatro segundos perto da borda, todos voltam para posições centrais e o placar é preservado.

### Controles

- **W/S** ou **setas para cima/baixo**: acelerar e dar ré.
- **A/D** ou **setas para esquerda/direita**: virar.
- **P** ou **Escape**: pausar/continuar.
- Em telas sensíveis ao toque, use os **botões na tela** (otimizados para polegares).

### Câmeras e som

- Alterne entre as câmeras **Arena** (visão ampla), **Carrinho** (acompanha seu carro) e **Alto** (visão aérea) nos controles abaixo do campo.
- Clique em **Ligar som** para ativar trilha sintetizada inspirada em rock e efeitos de colisão e gol. O áudio começa após a interação do jogador.

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
- `src/game/physics-runtime.ts`: simulação física, controles de jogador, lógica de IA (atacantes/defensores), detecção de gols e recuperação após impactos.
- `src/game/vehicle-dynamics.ts`: correção de derrapagem lateral (lateral grip recovery).
- `src/game/scene.ts`: câmeras (Arena/Carrinho/Alto), iluminação, renderização e efeitos visuais.
- `src/game/audio.ts`: música e efeitos sonoros sintetizados.
- `src/game/match-rules.ts`: progressão de rodadas, dificuldades, seleção de atacante e mensagens de jogo.
- `src/game/stuck-monitor.ts`: detecção de bola presa perto das bordas.
- `src/game/config.ts`: parâmetros de física, IA, campo e balanceamento do jogo.
- `src/app.tsx`: interface React, placar, controles touch e menus.


## Testes

Execute `npm test` para validar regras de gol, IA, progressão, recuperação da bola, controles e reinício. `npm run build` verifica TypeScript e a versão de produção.

A configuração de massas, aderência, limites de velocidade, dimensões dos gols e passo fixo está centralizada em `src/game/config.ts`. A IA escolhe estrategicamente o atacante considerando distância e posicionamento em relação ao gol, enquanto os defensores reagem dinamicamente à posição da bola. Dificuldades (Fácil/Médio/Difícil) alteram velocidade, agressividade e tempo de reação dos adversários.

Colisões fortes ativam uma correção breve de derrapagem, e cada gol dispara uma comemoração visual na trave correspondente. Controles de toque são otimizados com safe-area para notches e barras de navegação em dispositivos móveis.

## Próxima versão do gameplay

A arquitetura da v2 está em [`docs/arquitetura-gameplay-v2.md`](docs/arquitetura-gameplay-v2.md). Ela cobre o botão de chute (Espaço ou botão **CHUTE**, com recarga e a mesma regra para jogador e IA), os times de até três carrinhos com papéis de atacante, apoio e goleiro, e o campo 25% maior com câmera e colliders derivados das dimensões. O documento também traz os riscos, o plano em três PRs pequenos e os critérios de aceite.
