# GATE TV para LG webOS

Cliente separado para TVs LG. A versão **0.6.6** remove o redirecionamento de
janela que podia ficar preso na tela inicial do IPK. O shell local agora mantém a
aplicação de produção dentro de um `iframe` de tela cheia, autorizado pela política
de segurança do servidor. Assim, a interface abre mesmo quando o webOS bloqueia
`location.replace()` para uma origem externa.

## Compatibilidade atual

Este pacote requer **webOS TV 22 ou superior** (modelos de 2022 em diante). O
webOS TV 22 usa Chromium 87; aparelhos anteriores exigem um
bundle legado transpilado, mantido como uma trilha de distribuição separada. A
restrição deve ser aplicada também na seleção de modelos do LG Seller Lounge.

A rota hospedada `?platform=webos` mantém o modo seguro leve: sem Service Worker
e sem as camadas visuais pesadas do navegador. O player webOS usa o watchdog do
núcleo compartilhado para refazer a conexão, alternar rotas e recriar a superfície
de vídeo quando a imagem parar ou ficar preta.

## Empacotar em `.ipk`

Instale a CLI oficial `@webos-tools/cli` e execute na raiz:

```bash
npm install -g @webos-tools/cli
sh scripts/package-webos.sh
```

O arquivo é criado em `dist/webos/`. Para testar no aparelho:

```bash
ares-install -d myTV dist/webos/com.gateone.app.gateiptvplayer_0.6.6_all.ipk
ares-launch -d myTV com.gateone.app.gateiptvplayer
```

## Inicialização e recuperação

- `index.html` já contém o endereço hospedado no `iframe`; portanto, a abertura
  não depende do JavaScript local para sair da tela inicial.
- `bridge.js` aguarda o sinal real de interface pronta, move o foco para o
  conteúdo hospedado e encaminha as teclas do controle caso o foco permaneça no
  shell do IPK.
- Uma animação CSS remove a tela de carregamento depois de oito segundos como
  fallback adicional, mesmo se o script local não iniciar.
- Se a rede falhar, o shell mostra um botão funcional para recarregar somente o
  conteúdo hospedado, sem reinstalar o aplicativo.
- O modo seguro hospedado remove Service Workers antigos e devolve ao shell os
  sinais `gate-webos-booting`, `gate-webos-ready` e `gate-webos-error`.
- A reprodução continua protegida pelo watchdog da aplicação hospedada, que
  acompanha relógio, buffer e quadros apresentados e recria o decoder quando
  detecta vídeo preto.
- O shell não registra lista, usuário, senha ou URL de canal em logs.

Teclas principais: Voltar `461`, OK `13`, setas `37/38/39/40`, Play `415`,
Pause `19` e Stop `413`. O GATE TV não fornece conteúdo; use apenas fontes
autorizadas.
