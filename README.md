# BATE-BATE SOCCER

Jogo de futebol de carrinhos para navegador, com Three.js e física Rapier.

## Como jogar

Escolha entre fácil, médio e difícil no menu e faça três gols na trave azul para vencer. A primeira rodada começa com um carrinho por equipe. Cada vitória abre uma nova rodada com adversários mais rápidos; a partir da segunda rodada, o azul entra com dois carrinhos. Ao marcar um gol, você ganha um aliado (até dois carrinhos vermelhos); ao sofrer um gol, perde esse aliado. A bola e os carrinhos voltam à posição inicial após cada gol.

- **W/S** ou **setas para cima/baixo**: acelerar e dar ré.
- **A/D** ou **setas para esquerda/direita**: virar.
- Em telas sensíveis ao toque, use os botões na tela.
- Alterne entre as câmeras **Arena**, **Carrinho** e **Alto** nos controles abaixo do campo.
- Clique em **Ligar som** para ativar música eletrônica sintetizada e efeitos de colisão e gol. O áudio começa após a interação do jogador.

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
- `src/game/physics.ts`: física, controles, equipes, gols e regras da partida.
- `src/game/scene.ts`: câmera, iluminação, renderização e limpeza de recursos.
- `src/game/audio.ts`: música e efeitos sintetizados.
- `src/game/match-rules.ts`: progressão e dificuldades.
- `src/app.tsx`: interface, placar e controles.
