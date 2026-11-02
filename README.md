# BATE-BATE SOCCER

Protótipo da **Fase 2**: arena 3D, quatro carrinhos, bola e física com Rapier. O carrinho vermelho é controlável; os demais reagem às colisões. A partida ainda não tem gols nem placar.

## Executar localmente

Requisitos: Node.js 20.19+ ou 22.12+ e npm.

```bash
npm install
npm run dev
```

Abra o endereço informado pelo Vite no Chrome ou Edge com WebGL habilitado. Para gerar a versão de produção, use `npm run build`; para conferi-la, use `npm run preview`.

## Publicação no GitHub Pages

O workflow em `.github/workflows/pages.yml` gera e publica o jogo quando há um push na branch `main`. No repositório do GitHub, abra **Settings → Pages** e selecione **GitHub Actions** em **Build and deployment → Source**. Depois acompanhe a execução na aba **Actions**. O endereço publicado aparece nas configurações do Pages e no resultado da implantação.

## Controles

- **W/S** ou **setas para cima/baixo**: avançar e recuar com o carrinho vermelho.
- **A/D** ou **setas para esquerda/direita**: virar.
- Arraste a cena para girar a câmera e use a roda do mouse para aproximar ou afastar.
- Em telas sensíveis ao toque, use os botões para virar, acelerar e dar ré. Combine direção e aceleração e arraste a arena para girar a câmera.

## Organização

- `src/game/arena.ts`: campo, traves, redes e estádio.
- `src/game/objects.ts`: modelos da bola e dos carrinhos.
- `src/game/physics.ts`: corpos, colisores e controles.
- `src/game/scene.ts`: câmera, iluminação, renderização e limpeza de recursos.
- `src/app.tsx`: interface do protótipo.

## Próxima fase

A Fase 3 adicionará detecção de gol, placar e reinício. Até lá, as extremidades da arena estão fechadas por colisores e não há contagem de gols. Os outros três carrinhos ainda não têm controles ou inteligência artificial.

