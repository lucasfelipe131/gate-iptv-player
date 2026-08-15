# GATE TV para LG webOS

Cliente separado para TVs LG. O pacote abre a aplicacao oficial com
`platform=webos`, registra o comportamento do controle e inclui um contrato de
player com watchdog. Se a reproducao para de avancar por 15 segundos, o mesmo
canal e reaberto com retentativas limitadas.

## Compatibilidade atual

Este pacote com o nucleo JavaScript moderno requer **webOS TV 22 ou superior**
(modelos de 2022 em diante). O webOS TV 22 usa Chromium 87; o webOS TV 6.x de
2021 usa Chromium 79 e nao e alvo deste bundle. A LG nao oferece no
`appinfo.json` um campo oficial para bloquear uma versao minima, por isso a
exigencia tambem aparece em `appDescription` e deve ser aplicada na selecao de
modelos do Seller Lounge. TVs anteriores exigirao um bundle legado transpilado,
mantido como uma trilha separada.

## Empacotar em `.ipk`

Instale a CLI oficial `@webos-tools/cli` e execute na raiz:

```bash
npm install -g @webos-tools/cli
sh scripts/package-webos.sh
```

O arquivo e criado em `dist/webos/`. Para testar no aparelho:

```bash
ares-install -d myTV dist/webos/com.gateone.app.gateiptvplayer_0.6.0_all.ipk
ares-launch -d myTV com.gateone.app.gateiptvplayer
```

## Ponte de player

`bridge.js` expoe `window.GateWebOSBridge` com `play`, `stop`, `recover` e
`setNativeProvider`. O fallback usa o decoder HTML5 do webOS e monitora
`waiting`, `stalled`, `error`, `ended` e o avanco real do relogio do video.
Um adaptador Luna/decoder nativo futuro pode ser instalado por
`setNativeProvider({ play, stop, recover, getProgress })` sem mudar a interface
do aplicativo.

### Contrato para o nucleo web remoto

O carregamento usa `location.replace`, pois a pagina de producao proibe iframe
por CSP. Portanto, ao receber `platform=webos`, o `public/app.js` remoto deve
instalar o adapter novamente e seguir este contrato:

```js
await adapter.play({ src, live: true, mimeType, rect });
await adapter.recover("watchdog");
await adapter.stop();
```

- O `src` pode ser a rota segura `/api/stream/...`, resolvida contra a origem de
  producao. Nunca grave ou imprima essa URL.
- Use um unico elemento `<video playsinline>` por sessao; reutilize-o entre
  canais para reduzir pressao de memoria.
- Escute `playing`, `timeupdate`, `progress`, `waiting`, `stalled`, `error` e
  `ended`. Em canal ao vivo, `ended` e falha recuperavel.
- A cada 3 segundos, confira `currentTime`. Se ficar igual por 15 segundos com o
  video ativo, remova o `src`, chame `load()`, reatribua o mesmo `src` e execute
  `play()`. Limite a cinco tentativas com backoff.
- Se um provider nativo for adicionado, ele deve implementar `play(source)`,
  `stop()`, `recover(source)` e opcionalmente `getProgress()`.

Teclas que o nucleo deve tratar: Voltar `461`, OK `13`, setas `37/38/39/40`,
Play `415`, Pause `19`, Stop `413`, Retroceder `412`, Avancar `417` e canal
anterior/proximo `34/33`. Ao receber Voltar durante o video, pare o player e
retorne a lista; fora do video, permita o fechamento do aplicativo.

O shell nunca armazena lista, usuario, senha ou URL de canal em logs. O GATE TV
nao fornece conteudo; use apenas fontes autorizadas.
