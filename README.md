# GATE TV 0.6.4

Player multiplataforma para listas e fontes de mídia autorizadas. O GATE TV não
fornece, hospeda ou vende canais, filmes, séries ou credenciais.

## Produtos

| Produto | Subprojeto | Motor de reprodução |
|---|---|---|
| Web/PWA | `platforms/web` + `public` | HLS.js, mpegts.js e vídeo HTML5 |
| Android e Android TV | `platforms/android-native` | Media3/ExoPlayer, com LibVLC como último fallback |
| LG webOS TV | `platforms/webos` | vídeo webOS com watchdog e recuperação |
| Samsung Tizen | `platforms/tizen` | AVPlay nativo com watchdog e recuperação |

Todos consomem a mesma API em `server.mjs`, mas têm manifesto, ciclo de vida,
empacotamento e recuperação próprios. O diretório antigo `platforms/lg-webos`
mantém apenas assets e material de loja usados pelo empacotamento; o cliente LG
ativo é `platforms/webos`.

## O que mudou nesta versão

- detecção de tela preta mesmo quando o áudio e o relógio do stream continuam;
- recriação da superfície/decoder e reconexão com callbacks isolados por tentativa;
- recuperação por relógio, buffer, fim inesperado e frames realmente renderizados;
- buffers menores para evitar pressão de memória em TVs com pouca RAM;
- limite global e validade curta para tickets de segmentos HLS, evitando crescimento de memória;
- pareamento da lista por QR Code e código temporário de uso único;
- página profissional de assinatura anual em `/assinar`;
- página de assinatura pronta, com cobrança bloqueada até existir ativação persistente;
- interface Web e TV responsiva de 720p a 4K, com alvos maiores para controle remoto;
- opção configurável para abrir o APK após a inicialização da Android TV;
- cache versionado para o APK não manter uma interface antiga;
- preparação para anúncios VAST/Google IMA, desativados até receber uma tag real.

## Executar e testar

Requer Node.js 20 ou superior.

```bash
npm ci
npm test
npm start
```

Abra `http://localhost:3000`. O teste automatizado inclui o cenário de 300
segundos de reprodução seguido por encerramento do servidor e confirma que o
mesmo canal é reaberto sem intervenção do usuário.

Copie `.env.example` somente como referência e cadastre os valores reais no
provedor de deploy; nunca versione tokens ou credenciais.

## Pareamento por QR

A TV cria uma sessão de cinco minutos e exibe um QR. O celular envia um
descriptor Xtream ou M3U cifrado; somente o dispositivo que possui o token
secreto pode consumi-lo, e isso ocorre uma única vez. Usuário e senha não são
expostos na consulta pública de status.

O armazenamento de pareamento atual é cifrado e mantido em memória. Em uma
implantação com mais de uma réplica, substitua-o por Redis ou Postgres
compartilhado antes de habilitar escala horizontal.

## Cobrança anual

O plano é fixado pelo servidor em **R$ 30 por ano** e cobre a licença do
aplicativo, não conteúdo. A tela está pronta, mas o backend mantém o checkout
bloqueado até existir webhook autenticado e armazenamento persistente de
licenças; assim o sistema nunca recebe dinheiro sem conseguir ativar o aparelho.
As variáveis reservadas para a próxima etapa são:

- `MERCADOPAGO_ACCESS_TOKEN`: credencial futura do Checkout Pro;
- `PAYMENT_LINK_URL`: fallback HTTPS futuro;
- `PAYMENT_RETURN_URL`: origem HTTPS das páginas de retorno;
- `PUBLIC_APP_URL`: origem pública usada no QR e em links absolutos.

Mesmo com essas variáveis, a versão 0.6.4 não cria cobrança enquanto a etapa de
entitlement estiver pendente. Uma versão destinada à Google Play deve usar um
flavor com Google Play Billing conforme a política da loja.

## Anúncios

Use `VAST_AD_TAG_URL` com uma tag HTTPS criada no Google Ad Manager/IMA ou em
outra plataforma VAST confiável. A tag atende Web, LG webOS e Samsung Tizen;
Android mantém o anúncio institucional até receber a integração IMA nativa.
Sem essa variável, nenhum SDK publicitário de terceiros é carregado. Falha,
timeout ou bloqueio do anúncio nunca impede o canal de iniciar.

Não coloque ID do AdSense de páginas no player: para pré-roll de vídeo em Web e
TV, o contrato correto é VAST/Google IMA. Credenciais e tags reais não devem ser
commitidas no repositório.

## Empacotamento

Android/Android TV, com Java 17 e Android SDK:

```bash
cd platforms/android-native
gradle --no-daemon :app:lintDebug :app:assembleDebug
```

LG webOS TV 22+:

```bash
npm install -g @webos-tools/cli
npm run package:webos
```

Samsung Tizen 6.5+, com perfil de assinatura criado no Tizen Studio:

```bash
TIZEN_SECURITY_PROFILE=GateTvSamsung npm run package:tizen
```

Os pacotes LG e Samsung exigem as CLIs proprietárias e certificados da conta da
loja. O workflow de Android executa testes, lint, build, verificação da assinatura
e checksum do APK.

## Limites reais de compatibilidade

Nenhum player corrige uma lista expirada, servidor fora do ar, limite de
conexões, DRM não autorizado ou codec ausente no hardware. Nesses casos o GATE
TV preserva o canal selecionado, tenta as rotas e motores compatíveis e apresenta
um erro recuperável, sem criar loops ou conexões paralelas ilimitadas.
