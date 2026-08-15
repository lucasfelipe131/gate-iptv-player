# GATE TV Web/PWA

Subprojeto do navegador e PWA. A interface compartilhada fica em `public/` e o
serviço HTTP/API em `server.mjs`; este diretório fornece uma entrada independente
para executar e validar somente o produto Web sem duplicar o núcleo.

```bash
cd platforms/web
npm start
```

Rotas de produto:

- `/`: catálogo e player;
- `/pair`: envio seguro de lista do celular para a TV;
- `/assinar`: assinatura anual do aplicativo;
- `/health`: versão e saúde do serviço.

O player usa HLS.js, mpegts.js ou o elemento de vídeo do navegador conforme o
formato. O watchdog observa dados, relógio e estado `ended`; uma interrupção
silenciosa reabre o mesmo canal com backoff e limites, sem acumular instâncias.

O GATE TV não inclui nem comercializa canais ou listas. Conecte apenas fontes
para as quais você tenha autorização.
