# GATE TV para Samsung Tizen

Cliente separado para Samsung Smart TV. O pacote abre a aplicacao oficial com
`platform=tizen`, registra as teclas do controle e disponibiliza uma ponte real
para `webapis.avplay`.

## Compatibilidade atual

O manifesto exige **Tizen 6.5 ou superior**, correspondente aos modelos Samsung
de 2022 em diante. Essa e a primeira geracao assumida por este pacote para o
nucleo JavaScript moderno. TVs de 2021 ou anteriores nao devem receber este
`.wgt`; elas exigirao um bundle legado transpilado e testado separadamente.

## Empacotar em `.wgt`

Instale o Tizen Studio/CLI, crie um perfil de certificado Samsung no Certificate
Manager e informe somente o nome desse perfil no comando (nenhum certificado ou
senha fica no repositorio):

```bash
TIZEN_SECURITY_PROFILE=GateTvSamsung sh scripts/package-tizen.sh
```

O `.wgt` assinado e criado em `dist/tizen/`. Para instalar em uma TV ja
conectada ao Device Manager:

```bash
tizen install -n GATE-TV-Tizen-0.6.5.wgt -t minhaTV
tizen run -p GATEIPTV01.GateTV -t minhaTV
```

## AVPlay e recuperacao

`bridge.js` expoe `window.GateTizenBridge`. `play({ src, live, rect })` abre a
fonte no AVPlay, configura o listener de buffering/erro/conclusao e inicia um
watchdog. Se o relogio de reproducao nao avanca por 15 segundos, a mesma fonte e
fechada e reaberta, com retentativas limitadas. Os eventos `gate:player-*` e
`gate:remote-key` permitem integrar o shell ao layout web sem acoplar a interface
ao SDK da Samsung.

### Contrato para o nucleo web remoto

O carregamento usa `location.replace`, pois a pagina de producao proibe iframe
por CSP. A API Tizen continua disponivel no contexto do pacote, mas o JavaScript
do loader e descarregado. Ao receber `platform=tizen`, o `public/app.js` remoto
deve criar o adapter sobre `window.webapis.avplay` nesta ordem:

```js
const player = window.webapis.avplay;
player.open(src);                         // URL /api/stream/... absoluta
player.setListener(listener);             // antes de prepareAsync
player.setDisplayRect(x, y, width, height);
player.prepareAsync(() => {
  player.play();
}, recoverSameSource);
```

O `listener` precisa implementar `onbufferingstart`, `onbufferingprogress`,
`onbufferingcomplete`, `oncurrentplaytime`, `onstreamcompleted` e `onerror`.
`onstreamcompleted` em canal ao vivo e `onerror` devem chamar a recuperacao:

```js
player.stop();       // somente se o estado permitir
player.close();
// repita open -> setListener -> setDisplayRect -> prepareAsync -> play
```

A cada 3 segundos, compare `player.getCurrentTime()` enquanto
`player.getState() === "PLAYING"`. Sem avanco por 15 segundos, reabra a mesma
fonte. Limite a cinco tentativas com backoff e nunca registre o `src`, pois ele
pode representar uma sessao temporaria.

Na pagina remota, registre novamente as teclas com
`tizen.tvinputdevice.registerKey`: MediaPlay, MediaPause, MediaPlayPause,
MediaStop, MediaRewind, MediaFastForward, ChannelUp e ChannelDown. Codigos:
Voltar `10009`, OK `13`, setas `37/38/39/40`, Play `415`, Pause `19`, Stop `413`,
Play/Pause do Smart Control `10252`, Retroceder `412`, Avancar `417` e canal
anterior/proximo `428/427`. Voltar
durante o video fecha o AVPlay e retorna a lista; fora do video chama
`tizen.application.getCurrentApplication().exit()`.

O shell valida protocolos de midia e nao registra listas, credenciais ou URLs de
canal. O GATE TV nao fornece conteudo; use apenas fontes autorizadas.
