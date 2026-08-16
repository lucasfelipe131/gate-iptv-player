# GATE TV para LG webOS

Cliente separado para TVs LG. A versão 0.6.4 segue o modelo oficial de aplicativo
hospedado do webOS: o shell local redireciona a janela principal para a aplicação
de produção. O JavaScript faz a abertura imediata e um `meta refresh` independente
funciona como fallback caso o motor da TV não execute o script inicial.

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
ares-install -d myTV dist/webos/com.gateone.app.gateiptvplayer_0.6.4_all.ipk
ares-launch -d myTV com.gateone.app.gateiptvplayer
```

## Inicialização e recuperação

- `bridge.js` abre a origem oficial com `location.replace`, como app hospedado.
- `index.html` contém um segundo redirecionamento declarativo após quatro
  segundos; assim o IPK não permanece preso na abertura se o script local falhar.
- Sem internet, o shell mantém uma mensagem clara e deixa o botão de nova
  tentativa focado para o controle remoto.
- A reprodução continua protegida pelo watchdog da aplicação hospedada, que
  acompanha relógio, buffer e quadros apresentados e recria o decoder quando
  detecta vídeo preto.
- O shell não registra lista, usuário, senha ou URL de canal em logs.

Teclas principais: Voltar `461`, OK `13`, setas `37/38/39/40`, Play `415`,
Pause `19` e Stop `413`. O GATE TV não fornece conteúdo; use apenas fontes
autorizadas.
