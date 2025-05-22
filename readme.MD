# Guia de Instalação e Solução de Problemas - XcondoAutoPrinter

Este guia contém instruções detalhadas para instalar, configurar e resolver problemas comuns do sistema de impressão automática de pedidos XcondoAutoPrinter.

## 1. Pré-requisitos

- Windows 7 ou superior (recomendado Windows 10)
- Node.js versão 16.x ou superior instalado (https://nodejs.org/)
- NPM (vem com o Node.js)
- Impressora térmica conectada e configurada no sistema
- Conta de vendedor em loja WooCommerce com plugin Dokan

## 2. Instalação

### 2.1 Instalação do zero (código fonte)

1. Clone ou baixe o repositório para sua máquina
2. Abra um terminal na pasta do projeto
3. Execute o seguinte comando para instalar as dependências:

```bash
npm install
```

4. Após a instalação, verifique se a pasta `node_modules` foi criada
5. Garanta que todas as dependências estão presentes, executando:

```bash
npm install axios winston electron-store node-thermal-printer socket.io-client date-fns date-fns-tz is-online
```

6. Execute o aplicativo:

```bash
npm start
```

### 2.2 Instalação a partir do instalador (arquivo .exe)

1. Baixe o arquivo de instalação (.exe) da versão mais recente
2. Execute o instalador e siga as instruções na tela
3. Após a instalação, o aplicativo estará disponível no menu Iniciar e como ícone na área de trabalho

## 3. Configuração

1. Na primeira execução, você deverá configurar:
   - URL da loja WooCommerce (ex: https://sualoja.com.br)
   - Nome de usuário e senha (com permissões para acessar pedidos)
   - ID do vendedor (opcional, será detectado automaticamente se possível)
   - Impressora para impressão térmica dos pedidos

2. O ID do vendedor pode ser detectado automaticamente se suas credenciais tiverem as permissões corretas. Você também pode usar o botão "Listar Vendedores" para escolher o vendedor correto.

3. Use o botão "Testar API" para verificar se a conexão com a loja está funcionando corretamente.

4. Salve as configurações antes de iniciar o monitoramento.

## 4. Estrutura de diretórios e arquivos

```
xcondo-autoprinter-sales/
├── src/
│   ├── api.js             # Comunicação com a API do WooCommerce/Dokan
│   ├── printer.js         # Funções de impressão de pedidos
│   └── utils.js           # Utilitários gerais
├── assets/                # Ícones e recursos visuais
│   └── icon.png           # Ícone do aplicativo
├── build/                 # Recursos para o empacotamento do aplicativo
│   └── icon.ico           # Ícone do aplicativo para Windows
├── data/                  # Arquivos de dados e estado (criado em runtime)
├── logs/                  # Logs de operação (criado em runtime)
│   └── orders/            # Logs de pedidos processados
├── node_modules/          # Dependências instaladas (gerado pelo npm install)
├── main.js                # Código principal do Electron
├── preload.js             # Arquivo de pré-carregamento para segurança do Electron
├── renderer.js            # Código da interface do usuário
├── index.html             # Interface do usuário
├── config.json            # Arquivo de configuração
└── package.json           # Manifesto do projeto e dependências
```

## 5. Solução de problemas comuns

### 5.1 Problemas de instalação

#### Erro ao executar `npm install`

**Problema**: Falha durante a instalação de dependências.

**Solução**:
- Verifique se você tem o Node.js e NPM atualizados
- Tente executar como administrador
- Limpe o cache do NPM:
  ```bash
  npm cache clean --force
  ```
- Instale o Visual Studio Build Tools para Windows (necessário para algumas dependências nativas)
- Execute novamente:
  ```bash
  npm install
  ```

### 5.2 Problemas de conexão com a API

#### Não é possível conectar à loja

**Problema**: Erro ao tentar acessar a API da loja.

**Soluções**:
1. Verifique se a URL da loja está correta e inclui o protocolo (https:// ou http://)
2. Certifique-se de que suas credenciais (usuário e senha) estão corretas
3. Verifique se a loja está online e acessível em um navegador web
4. Verifique se o plugin Dokan está ativo na loja
5. Certifique-se de que seu usuário tem permissões para acessar a API REST

#### Não detecta o ID do vendedor automaticamente

**Problema**: O sistema não consegue detectar o ID do vendedor.

**Soluções**:
1. Verifique se você está usando credenciais de um usuário associado à loja do vendedor
2. Use o botão "Listar Vendedores" para ver os vendedores disponíveis e selecionar o correto
3. Se você conhece o ID do vendedor, insira-o manualmente
4. Certifique-se de que o plugin Dokan está configurado corretamente na loja

### 5.3 Problemas de impressão

#### Impressora não é detectada

**Problema**: A impressora não aparece na lista ou não é reconhecida pelo sistema.

**Soluções**:
1. Verifique se a impressora está conectada e ligada
2. Certifique-se de que a impressora está configurada corretamente no Windows
3. Verifique se você tem os drivers corretos instalados
4. Reinicie o aplicativo e o computador
5. Teste se a impressora funciona com outros aplicativos (como Bloco de Notas)

#### Falha ao imprimir pedidos

**Problema**: O sistema detecta os pedidos, mas falha ao imprimir.

**Soluções**:
1. Verifique se a impressora selecionada é compatível (impressora térmica)
2. Faça um teste de impressão usando o botão "Imprimir Teste"
3. Verifique os logs do aplicativo para identificar erros específicos
4. Certifique-se de que o papel está corretamente carregado na impressora
5. Ajuste a configuração de largura de impressão (padrão: 48 caracteres)

### 5.4 Problemas com o monitoramento

#### O monitoramento não inicia

**Problema**: O sistema não inicia o monitoramento de pedidos.

**Soluções**:
1. Verifique se todas as configurações estão corretas e salvas
2. Certifique-se de que você tem uma conexão estável com a internet
3. Verifique se o ID do vendedor está configurado corretamente
4. Consulte os logs do aplicativo para identificar erros específicos

#### O monitoramento inicia mas não detecta pedidos

**Problema**: O sistema está monitorando, mas não detecta novos pedidos.

**Soluções**:
1. Verifique se há pedidos no status "Em processamento" para o vendedor configurado
2. Confirme se o ID do vendedor está correto
3. Use o botão "Testar API" para verificar se a conexão está funcionando
4. Aumente o intervalo de verificação (se a loja tiver muitos pedidos)
5. Limpe os pedidos processados usando o botão "Limpar Pedidos Processados"

## 6. Logs e diagnóstico

O aplicativo mantém diversos arquivos de log que podem ajudar a diagnosticar problemas:

- **api.log** / **api-error.log**: Logs da comunicação com a API da loja
- **printer-log.txt**: Logs das operações de impressão
- **utils.log** / **utils-error.log**: Logs gerais e utilitários
- **combined.log** / **error.log**: Logs do aplicativo principal

Estes arquivos estão localizados na pasta onde o aplicativo está instalado ou em execução.

## 7. Contato e suporte

Se você continuar tendo problemas após tentar as soluções acima, entre em contato com o suporte técnico:

- **Email**: suporte@xcondo.com.br
- **Website**: https://xcondo.com.br
- **Telefone**: (62) 98102-1322

Tenha à mão os arquivos de log para ajudar no diagnóstico.

## 8. Detalhes técnicos adicionais

O aplicativo XcondoAutoPrinter é construído usando:

- **Electron**: Framework para criar aplicativos desktop com tecnologias web
- **Node.js**: Ambiente de execução JavaScript
- **API WooCommerce/Dokan**: Para comunicação com a loja online
- **Windows Printer API**: Para comunicação com impressoras térmicas

Ele utiliza o método de impressão via Notepad para máxima compatibilidade com diversos modelos de impressoras térmicas.


# Lista de Verificação para Solução de Problemas

Use esta lista para verificar sistematicamente os problemas mais comuns no XcondoAutoPrinter.

## 1. Dependências e ambiente

- [ ] Node.js instalado (versão 16.x ou superior)
- [ ] NPM instalado corretamente
- [ ] Todas as dependências instaladas (`npm install`)
- [ ] Windows Build Tools instalado (se necessário para componentes nativos)
- [ ] Estrutura de diretórios correta (conforme o documento de estrutura)

## 2. Arquivos do sistema

- [ ] Pasta `src` contém os arquivos corretos (`api.js`, `printer.js`, `utils.js`)
- [ ] Arquivo `main.js` existe e está completo
- [ ] Arquivo `preload.js` existe e está correto
- [ ] Arquivo `renderer.js` existe e está completo
- [ ] Arquivo `index.html` existe e está correto
- [ ] Arquivo `config.json` existe e está acessível
- [ ] Pasta `node_modules` contém todas as dependências necessárias

## 3. Verificação de componentes específicos

### API e conexão com a loja

- [ ] URL da loja está correta e acessível (tente abrir no navegador)
- [ ] Credenciais (nome de usuário e senha) estão corretas
- [ ] A loja usa o plugin Dokan corretamente configurado
- [ ] Usuário tem permissões para acessar a API REST
- [ ] ID do vendedor está correto ou pode ser detectado automaticamente
- [ ] O botão "Testar API" funciona e encontra pedidos

### Impressora

- [ ] Impressora está conectada e ligada
- [ ] Impressora está instalada e configurada no Windows
- [ ] Drivers da impressora estão instalados corretamente
- [ ] Impressora é compatível (térmica ou suporta o formato de impressão usado)
- [ ] Impressora pode imprimir a partir de outros aplicativos (como Bloco de Notas)
- [ ] O botão "Imprimir Teste" funciona corretamente

### Monitoramento

- [ ] Configurações estão salvas corretamente
- [ ] Computador tem conexão estável com a internet
- [ ] O botão "Iniciar Monitoramento" funciona sem erros
- [ ] Sistema pode detectar novos pedidos no status "Em processamento"
- [ ] Impressão automática funciona quando novos pedidos são detectados

## 4. Verificação de logs

- [ ] Verificar `api.log` e `api-error.log` para problemas de conexão com a API
- [ ] Verificar `printer-log.txt` para problemas de impressão
- [ ] Verificar `utils.log` e `utils-error.log` para problemas gerais
- [ ] Verificar `combined.log` e `error.log` para problemas do aplicativo principal

## 5. Soluções para problemas comuns encontrados nos logs

### Erros de conexão

**Erro**: "Cannot connect to host" ou "Connection timeout"
- Verifique a conexão com a internet
- Verifique se a URL da loja está correta e acessível
- Verifique se a loja não está bloqueando conexões da sua rede

**Erro**: "Authentication failed" ou "Invalid credentials"
- Verifique se o nome de usuário e senha estão corretos
- Certifique-se de que o usuário tem permissões para acessar a API

### Erros de API

**Erro**: "Vendor ID not found" ou "Cannot detect vendor ID"
- Configure manualmente o ID do vendedor
- Use o botão "Listar Vendedores" para encontrar o ID correto
- Verifique se o plugin Dokan está ativo e configurado

**Erro**: "No orders found" ou "Empty response from API"
- Verifique se existem pedidos no status "Em processamento"
- Confirme se o ID do vendedor está correto
- Limpe o histórico de pedidos processados

### Erros de impressão

**Erro**: "Printer not found" ou "Cannot connect to printer"
- Verifique se a impressora está conectada e ligada
- Reinstale os drivers da impressora
- Tente selecionar outra impressora compatível

**Erro**: "Failed to print" ou "Printing error"
- Verifique se a impressora tem papel
- Tente imprimir um arquivo de teste pelo Bloco de Notas
- Verifique a configuração de largura da impressão

## 6. Verificações de sistema após correções

- [ ] Reiniciar o aplicativo após fazer alterações
- [ ] Tentar salvar as configurações novamente
- [ ] Executar o teste de API novamente
- [ ] Executar o teste de impressão novamente
- [ ] Iniciar o monitoramento para verificar se os problemas foram resolvidos

## 7. Backup e reinstalação

Se os problemas persistirem após todas as verificações:

- [ ] Fazer backup do arquivo `config.json`
- [ ] Fazer backup dos logs para análise posterior
- [ ] Desinstalar completamente o aplicativo
- [ ] Reinstalar usando o instalador mais recente ou reconstruir a partir do código fonte
- [ ] Restaurar o arquivo `config.json` após a reinstalação

## Notas adicionais

- Certifique-se de executar o aplicativo como administrador em caso de problemas de permissão
- Em sistemas Windows mais recentes, pode ser necessário adicionar exceções no firewall para o aplicativo
- Se estiver usando uma impressora conectada via rede, verifique se ela está acessível e com IP fixo
- Verifique se o diretório de instalação não contém caracteres especiais ou espaços no caminho

Marque cada item conforme for verificando para garantir uma abordagem sistemática na resolução do problema.