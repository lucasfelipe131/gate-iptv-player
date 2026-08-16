# Google Play — rascunho de Segurança de Dados

Este documento é um roteiro para preencher o formulário do Play Console. Ele deve ser revisado novamente quando a rede de publicidade e o processador de pagamento forem definidos, porque os SDKs e contratos desses fornecedores podem alterar as respostas.

## Coleta e compartilhamento

### Dados processados pelo GATE TV

| Categoria | Coletado | Compartilhado | Finalidade | Observação |
|---|---:|---:|---|---|
| Informações e desempenho do app | Sim | Não, salvo infraestrutura técnica | Análise de falhas, segurança e funcionamento | Plataforma, versão e mensagem curta de diagnóstico; evitar dados da lista nos registros. |
| Identificadores de dispositivo ou outros IDs | Sim quando anúncios estiverem ativos | Sim, com o fornecedor de anúncios | Publicidade, medição e prevenção de fraude | Confirmar os dados exatos no contrato/SDK da rede VAST. |
| Endereço IP | Sim, tecnicamente | Sim com hospedagem e, quando ativo, fornecedor de anúncios | Comunicação de rede, segurança, publicidade e fraude | Endereços IP são processados pelos servidores envolvidos na conexão. |
| Dados fornecidos pelo usuário para acessar uma fonte | Sim, temporariamente | Somente com o provedor indicado pelo próprio usuário | Funcionalidade principal do app | URL, usuário e senha são usados para autenticar a fonte; sessões expiram e não são vendidas. |
| Atividade no app | Local; eventos de anúncio podem ser coletados | Com o fornecedor de anúncios | Favoritos/experiência local, medição de anúncio | Favoritos e preferências ficam no aparelho; eventos VAST seguem a política da rede. |
| Informações financeiras | Não pelo GATE TV nesta versão | Não | — | Compras no app não estão ativas. Atualizar quando houver assinatura. |
| Localização precisa | Não | Não | — | Não solicitar permissão de localização. |
| Contatos, fotos, áudio, saúde e mensagens | Não | Não | — | O app não solicita essas permissões. |

## Segurança

- Dados em trânsito: **Sim, criptografados por HTTPS quando o destino suporta HTTPS**. Algumas fontes autorizadas antigas podem usar HTTP; o usuário é alertado pelos riscos do provedor externo.
- Usuário pode solicitar exclusão: **Sim**, pelo e-mail de suporte para dados eventualmente mantidos pelo serviço.
- Dados locais podem ser apagados: limpar dados ou desinstalar o app.
- Conta própria no GATE TV: **Não nesta versão**.
- Revisão independente de segurança: **Não declarar**, salvo se uma auditoria formal for realizada.

## Publicidade

Antes de publicar com anúncios programáticos:

1. confirmar quais dados a rede VAST/IMA declara coletar;
2. marcar que o aplicativo contém anúncios;
3. publicar as linhas oficiais em `app-ads.txt`;
4. configurar consentimento nos países em que for obrigatório;
5. conferir se a rede usa Advertising ID e atualizar este formulário;
6. manter a tag de teste fora da versão de produção.

## Exclusão de conta

O aplicativo não permite criação de conta própria nesta versão. Portanto, o requisito de exclusão de conta dentro e fora do app não se aplica. Caso uma conta GATE seja adicionada no futuro, será necessário implementar exclusão completa e publicar uma URL dedicada antes da atualização.
