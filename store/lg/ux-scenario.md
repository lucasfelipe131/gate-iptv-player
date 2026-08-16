# LG Seller Lounge — cenário de UX para QA

## Dados gerais

- **Aplicativo:** GATE TV
- **Versão do IPK:** conferir a versão em `appinfo.json` no pacote enviado
- **App ID:** `com.gateone.app.gateiptvplayer`
- **Idioma principal:** Português (Brasil)
- **Conta obrigatória:** Não
- **Compra obrigatória:** Não
- **Dispositivo de entrada:** Controle remoto LG

## Objetivo do aplicativo

Reproduzir mídia de uma fonte M3U ou Xtream fornecida pelo próprio usuário ou por um provedor devidamente autorizado. O aplicativo não inclui catálogo próprio.

## Ambiente de teste

- LG webOS TV compatível com a versão declarada no Seller Lounge;
- conexão estável com a internet;
- instalação do IPK assinado submetido;
- controle remoto funcional.

## Cenário 1 — abertura e navegação inicial

1. Inicie o GATE TV pelo Launcher.
2. Aguarde a tela de inicialização.
3. Caso exista uma campanha de publicidade disponível, aguarde a conclusão ou use o botão de pular quando exibido.
4. Caso o servidor de anúncios não responda, confirme que o aplicativo libera a tela inicial automaticamente.
5. Navegue entre as opções usando as setas do controle.
6. Confirme que o foco é visível e que nenhum item exige toque.

**Resultado esperado:** o aplicativo abre sem tela preta permanente, o foco responde ao controle e a tela inicial fica acessível mesmo quando não existe anúncio.

## Cenário 2 — conexão por M3U de demonstração

1. Selecione a opção de conexão por lista M3U.
2. Informe o endereço:

```text
https://gate-iptv-player-production.up.railway.app/review-demo.m3u
```

3. Confirme a conexão.
4. Aguarde o carregamento do catálogo.
5. Abra o grupo “Demonstração técnica”.
6. Selecione “Big Buck Bunny — stream de demonstração”.

**Resultado esperado:** a lista é aceita, um item aparece no catálogo e o vídeo inicia sem exigir usuário ou senha.

## Cenário 3 — reprodução e retorno

1. Durante a reprodução, pressione OK para exibir ou ocultar os controles, quando aplicável.
2. Use Voltar uma vez para fechar controles ou sair da reprodução.
3. Confirme que o aplicativo retorna ao catálogo e mantém o foco em posição previsível.
4. Pressione Voltar novamente para retornar à tela anterior.

**Resultado esperado:** nenhum comando fecha o aplicativo de forma inesperada e o usuário nunca fica sem foco navegável.

## Cenário 4 — fonte inválida

1. Volte à conexão M3U.
2. Informe um endereço inválido, por exemplo `https://example.invalid/lista.m3u`.
3. Confirme.

**Resultado esperado:** o aplicativo exibe mensagem compreensível, não trava e permite corrigir o endereço ou voltar.

## Cenário 5 — política e suporte

1. Acesse em um navegador externo as páginas públicas:
   - `https://gate-iptv-player-production.up.railway.app/privacy.html`
   - `https://gate-iptv-player-production.up.railway.app/terms.html`
   - `https://gate-iptv-player-production.up.railway.app/support.html`
2. Confirme que as páginas estão acessíveis sem login.

## Observações

- O stream de demonstração é usado apenas para validar tecnicamente o player.
- O GATE TV não fornece fontes comerciais aos usuários.
- Não são necessárias credenciais de revisão.
- Se o teste de publicidade não tiver preenchimento, isso não deve ser tratado como falha do player; o aplicativo deve seguir para a tela inicial.
- Contato durante a revisão: lucasfelipe.oliveira@hotmail.com.
