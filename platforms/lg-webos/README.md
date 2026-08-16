# LG webOS TV

Hosted Web App do GATE IPTV PLAYER para TVs LG. O pacote contém apenas a inicialização, os ícones e a tela de abertura. O conteúdo do aplicativo é carregado de `https://gate-iptv-player-production.up.railway.app/`.

## Gerar o IPK

Instale a CLI oficial da LG e empacote a pasta:

```bash
npm install -g @webos-tools/cli
mkdir -p dist/webos
sh scripts/package-webos.sh
```

## Testar em uma TV LG

1. Instale **Developer Mode** pela LG Content Store e ative o modo desenvolvedor.
2. Cadastre a TV na CLI com `ares-setup-device` e obtenha a chave com `ares-novacom --getkey`.
3. Instale o pacote com `ares-install -d myTV dist/webos/com.gateone.app.gateiptvplayer_0.3.2_all.ipk`.
4. Abra com `ares-launch -d myTV com.gateone.app.gateiptvplayer`.

O app não inclui canais, filmes, séries, listas ou credenciais. Cada usuário conecta apenas uma fonte que tenha autorização para utilizar.

> Build 0.6.1: o pacote definitivo agora usa `platforms/webos` e o modo seguro hospedado.
