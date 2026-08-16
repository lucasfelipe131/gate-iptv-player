# GATE TV para LG webOS

Cliente separado para TVs LG. O shell local mantém a aplicação oficial em um
iframe e o elemento de vídeo no contexto assinado do pacote. Assim o watchdog e
o decoder webOS permanecem ativos durante toda a sessão, inclusive depois que a
interface hospedada termina de carregar.

## Compatibilidade atual

Este pacote requer **webOS TV 22 ou superior** (modelos de 2022 em diante). O
webOS TV 22 usa Chromium 87; aparelhos anteriores exigem um
bundle legado transpilado, mantido como uma trilha de distribuição separada. A
restrição deve ser aplicada também na seleção de modelos do LG Seller Lounge.

A rota hospedada `?platform=webos` mantém o modo seguro leve: sem Service Worker
e sem as camadas visuais pesadas do navegador, mas agora com o pequeno adaptador
que entrega o vídeo ao decoder e ao watchdog do shell local.

## Empacotar em `.ipk`

Instale a CLI oficial `@webos-tools/cli` e execute na raiz:

```bash
npm install -g @webos-tools/cli
sh scripts/package-webos.sh
```

O arquivo é criado em `dist/webos/`. Para testar no aparelho:

```bash
ares-install -d myTV dist/webos/com.gateone.app.gateiptvplayer_0.6.2_all.ipk
ares-launch -d myTV com.gateone.app.gateiptvplayer
```

## Ponte de player

`bridge.js` expõe `window.GateWebOSBridge` e recebe comandos de reprodução por
`postMessage`. Cada recuperação destrói e recria o elemento `<video>`, renova a
rota segura e ignora callbacks de tentativas antigas. O watchdog monitora o
relógio, o buffer e os quadros realmente apresentados para detectar inclusive o
caso em que o áudio continua, mas a imagem fica preta.

Ao receber `platform=webos`, `public/platform-player.js` publica o mesmo
contrato `GateNativePlayer` usado pelo núcleo compartilhado:

```js
window.GateNativePlayer.preview(url, fallbackUrl, name, type, x, y, width, height);
window.GateNativePlayer.playFullscreen(url, fallbackUrl, name, type);
window.GateNativePlayer.close();
```

- O iframe aceita somente a origem oficial de produção. O servidor libera como
  ancestrais apenas o próprio site e esquemas locais de aplicativos de TV.
- A cada tentativa, o shell cria uma nova superfície e acrescenta um
  identificador de renovação somente às rotas internas do GATE.
- A recuperação alterna as rotas principal e reserva indefinidamente com
  backoff limitado, sem deixar timers de um canal antigo abrirem outro fluxo.
- O shell não registra lista, usuário, senha ou URL de canal em logs.

Teclas principais: Voltar `461`, OK `13`, setas `37/38/39/40`, Play `415`,
Pause `19` e Stop `413`. O GATE TV não fornece conteúdo; use apenas fontes
autorizadas.
