const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const axios = require('axios');

// Variável global para armazenar o ID do intervalo de monitoramento
let intervalId = null;

// Configuração do logger
const winston = require('winston');

// Adicionar transporte específico para eventos de segurança
const securityTransport = new winston.transports.File({
  filename: 'security-audit.log',
  level: 'warn',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [SECURITY] ${level}: ${message}`;
    })
  )
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Adicionar ao logger existente
logger.add(securityTransport);

// Importação das dependências dos módulos
const {
  startOrderListener,
  stopOrderListener,
  getOrderDetails,
  getVendorIdFromCredentials,
  loadProcessedOrdersState,
  saveProcessedOrdersState,
  getWooCommerceOrders,
  getDokanOrders,
  orderBelongsToVendor,     // Importando a função do api.js
  verifyOrdersBelongToVendor, // Importando a função do api.js
  getAllOrdersAndFilter      // Importando a função do api.js
} = require('./src/api');

const { getPrinters, printOrder, printTest } = require('./src/printer');
const { loadOrderHistory, saveOrderLog, cleanOrderHistory, verifyDailyPassword } = require('./src/utils');

// Configurações do aplicativo
const store = new Store();
let mainWindow;
let tray;
let isRunning = false;

// Função para limpar pedidos processados
function clearProcessedOrdersState() {
  try {
    // Reinicia o conjunto de pedidos processados
    global.processedOrders = new Set();

    // Salva o estado vazio
    saveProcessedOrdersState();

    logger.info('Histórico de pedidos processados limpo manualmente');
    return true;
  } catch (error) {
    logger.error(`Erro ao limpar pedidos processados: ${error.message}`);
    return false;
  }
}

ipcMain.handle('test-api', async (event, config) => {
  try {
    logger.info('Iniciando teste de API...');

    // Array para armazenar os logs do teste
    const testLogs = [];

    // Função de logging para o teste
    const logTest = (message) => {
      logger.info(`[Teste API] ${message}`);
      testLogs.push(message);
    };

    // SEGURANÇA: Verificar se as configurações básicas estão presentes
    if (!config || !config.apiUrl || !config.username || !config.password) {
      logTest('Erro de segurança: Configurações de API incompletas');
      return {
        success: false,
        message: 'Configurações incompletas. URL, usuário e senha são obrigatórios.',
        logs: testLogs
      };
    }

    // Se o ID do vendedor não foi fornecido, tenta detectá-lo
    let vendorId = config.vendorId;
    if (!vendorId || vendorId.trim() === '') {
      logTest('ID do vendedor não fornecido, tentando detecção automática');
      try {
        vendorId = await getVendorIdFromCredentials(config);

        if (vendorId) {
          logTest(`ID do vendedor detectado: ${vendorId}`);
        } else {
          logTest('SEGURANÇA: Não foi possível detectar o ID do vendedor');
          return {
            success: false,
            message: 'Por motivos de segurança, o ID do vendedor é obrigatório. Não foi possível detectá-lo automaticamente.',
            logs: testLogs
          };
        }
      } catch (error) {
        logTest(`Erro ao detectar ID do vendedor: ${error.message}`);
        return {
          success: false,
          message: 'Por motivos de segurança, o ID do vendedor é obrigatório. Erro na detecção automática.',
          logs: testLogs
        };
      }
    } else {
      logTest(`Usando ID do vendedor fornecido: ${vendorId}`);
    }

    // Tenta obter pedidos com diferentes abordagens
    let orders = [];
    let successMethod = '';

    // Método 1: API WooCommerce com parâmetro vendor_id
    try {
      logTest('Tentativa 1: API WooCommerce com parâmetro vendor_id');

      const params = {
        status: 'processing',
        per_page: 20
      };

      if (vendorId) {
        params.vendor_id = vendorId;
      }

      orders = await getWooCommerceOrders(config, params);

      if (orders && orders.length > 0) {
        logTest(`Sucesso! Método 1 retornou ${orders.length} pedidos`);
        successMethod = 'WooCommerce API com vendor_id';
      } else {
        logTest('Método 1 retornou array vazio');
      }
    } catch (error) {
      logTest(`Método 1 falhou: ${error.message}`);
    }

    // Se o primeiro método não funcionou, tenta o método 2
    if (orders.length === 0) {
      try {
        logTest('Tentativa 2: API Dokan para pedidos');

        // Configura a nova config com o vendorId
        const dokanConfig = { ...config };
        if (vendorId) {
          dokanConfig.vendorId = vendorId;
        }

        orders = await getDokanOrders(dokanConfig);

        if (orders && orders.length > 0) {
          logTest(`Sucesso! Método 2 retornou ${orders.length} pedidos`);
          successMethod = 'Dokan API';
        } else {
          logTest('Método 2 retornou array vazio');
        }
      } catch (error) {
        logTest(`Método 2 falhou: ${error.message}`);
      }
    }

    // Se ainda não tem pedidos, tenta o método 3
    if (orders.length === 0) {
      try {
        logTest('Tentativa 3: Buscar todos os pedidos e filtrar manualmente');

        orders = await getAllOrdersAndFilter(config, vendorId);

        if (orders && orders.length > 0) {
          logTest(`Sucesso! Método 3 retornou ${orders.length} pedidos`);
          successMethod = 'Filtro manual de metadados';
        } else {
          logTest('Método 3 retornou array vazio');
        }
      } catch (error) {
        logTest(`Método 3 falhou: ${error.message}`);
      }
    }

    // Resultado final
    if (orders.length > 0) {
      logTest(`Teste concluído com sucesso! Método que funcionou: ${successMethod}`);
      return {
        success: true,
        message: `Encontrados ${orders.length} pedidos via ${successMethod}`,
        orders,
        logs: testLogs,
        detectedVendorId: vendorId !== config.vendorId ? vendorId : null
      };
    } else {
      logTest('Teste concluído sem sucesso. Nenhum pedido encontrado com nenhum método.');
      return {
        success: false,
        message: 'Não foi possível encontrar pedidos. Verifique as credenciais e o ID do vendedor.',
        logs: testLogs,
        detectedVendorId: vendorId !== config.vendorId ? vendorId : null
      };
    }
  } catch (error) {
    logger.error(`Erro no teste de API: ${error.message}`);
    return {
      success: false,
      message: `Erro no teste de API: ${error.message}`
    };
  }
});

ipcMain.handle('list-vendors', async () => {
  try {
    const config = store.get('config');
    if (!config || !config.apiUrl || !config.username || !config.password) {
      throw new Error('Configurações incompletas. Preencha URL, usuário e senha primeiro.');
    }

    logger.info('Listando vendedores disponíveis...');

    // Cria token de autenticação
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');

    // Busca lista de vendedores
    const response = await axios.get(`${config.apiUrl}/wp-json/dokan/v1/stores`, {
      params: { per_page: 100 },
      headers: { 'Authorization': `Basic ${token}` }
    });

    if (response.data && Array.isArray(response.data)) {
      const vendors = response.data.map(v => ({
        id: v.id,
        name: v.store_name || 'Sem nome',
        email: v.email || (v.user && v.user.email) || 'E-mail não disponível'
      }));

      logger.info(`${vendors.length} vendedores encontrados`);
      return { success: true, vendors };
    }

    return { success: false, message: 'Nenhum vendedor encontrado' };
  } catch (error) {
    logger.error(`Erro ao listar vendedores: ${error.message}`);
    throw new Error(`Não foi possível listar os vendedores: ${error.message}`);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('index.html');

  // Envia a lista de impressoras para a janela
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const printers = await getPrinters();
      mainWindow.webContents.send('printers-list', printers);

      // Carrega as configurações salvas
      const config = store.get('config') || {};
      mainWindow.webContents.send('load-config', config);

      // Carrega o histórico de pedidos
      const orderHistory = loadOrderHistory();
      mainWindow.webContents.send('load-order-history', orderHistory);

      // Definir sempre como autenticado - removendo necessidade de senha
      store.set('authenticated', true);
      mainWindow.webContents.send('authentication-status', true);
    } catch (error) {
      logger.error(`Erro ao carregar dados iniciais: ${error.message}`);
    }
  });
}

// Inicialização do app
app.whenReady().then(() => {
  try {
    // Sempre definir como autenticado ao iniciar
    store.set('authenticated', true);
    loadProcessedOrdersState();
    // Cria a janela principal
    createWindow();

    // Tenta criar o ícone na bandeja
    try {
      createTray();
    } catch (trayError) {
      logger.error(`Falha ao criar ícone na bandeja: ${trayError.message}`);
      // Continue a execução mesmo se a bandeja falhar
    }

    // Configura o comportamento quando o app é ativado
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Limpa pedidos antigos (mantém apenas os últimos 7 dias)
    cleanOrderHistory(7);

    // Carrega as configurações salvas no início e inicia o monitoramento se estiver configurado para autostart
    const config = store.get('config');
    if (config && config.autostart) {
      startMonitoringImproved();
    }
  } catch (error) {
    logger.error(`Erro na inicialização do aplicativo: ${error.message}`);
  }
});

// Criação do ícone na bandeja do sistema
function createTray() {
  try {
    // Verifica se o caminho do ícone existe
    const iconPath = path.join(__dirname, 'assets', 'icon.png');

    // Se não encontrar o ícone, cria um ícone padrão
    if (!fs.existsSync(iconPath)) {
      logger.warn('Ícone não encontrado. Usando ícone padrão do Electron.');
      tray = new Tray(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.png'));
    } else {
      tray = new Tray(iconPath);
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar Aplicativo',
        click: () => mainWindow.show()
      },
      {
        label: 'Iniciar Monitoramento',
        click: () => startMonitoringImproved(),
        enabled: !isRunning
      },
      {
        label: 'Parar Monitoramento',
        click: () => stopMonitoringImproved(),
        enabled: isRunning
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => app.quit()
      }
    ]);

    tray.setToolTip('Xcondo Pedidos auto Print');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });

    logger.info('Ícone na bandeja do sistema criado com sucesso');
  } catch (error) {
    logger.error(`Erro ao criar ícone na bandeja: ${error.message}`);
    // Não propaga o erro, permitindo que o aplicativo continue funcionando mesmo sem o ícone na bandeja
  }
}

// Atualiza o menu de contexto da bandeja
function updateTrayMenu() {
  try {
    // Verifica se o tray existe
    if (!tray) {
      logger.warn('Tentativa de atualizar menu da bandeja, mas o tray não está disponível');
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar Aplicativo',
        click: () => mainWindow.show()
      },
      {
        label: 'Iniciar Monitoramento',
        click: () => startMonitoringImproved(),
        enabled: !isRunning
      },
      {
        label: 'Parar Monitoramento',
        click: () => stopMonitoringImproved(),
        enabled: isRunning
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => app.quit()
      }
    ]);

    tray.setContextMenu(contextMenu);
    logger.info('Menu da bandeja atualizado com sucesso');
  } catch (error) {
    logger.error(`Erro ao atualizar menu da bandeja: ${error.message}`);
    // Não propaga o erro, permitindo que o aplicativo continue funcionando
  }
}

// Função para reiniciar o monitoramento
async function restartMonitoring() {
  try {
    logger.info('Reiniciando monitoramento após mudança de configuração');

    // Verifica se estava rodando antes
    const wasRunning = isRunning;

    // Para o monitoramento atual se estiver rodando
    if (isRunning) {
      logger.info('Parando monitoramento atual antes de reiniciar');
      try {
        await stopMonitoringImproved();
      } catch (stopError) {
        logger.error(`Erro ao parar monitoramento existente: ${stopError.message}`);
        // Continue mesmo com erro para garantir que o novo monitoramento seja iniciado
      }
    }

    // Limpa qualquer temporizador ou intervalo pendente
    clearMonitoringTimers();

    // Recarrega as configurações do armazenamento
    const config = store.get('config');
    if (!config) {
      logger.error('Não foi possível reiniciar o monitoramento: configurações ausentes');
      return false;
    }

    // Se estava rodando antes, inicia novamente com as novas configurações
    if (wasRunning) {
      logger.info('Iniciando monitoramento com novas configurações');
      await startMonitoringImproved();
      return true;
    } else {
      logger.info('Monitoramento não foi reiniciado pois não estava ativo anteriormente');
      return false;
    }
  } catch (error) {
    logger.error(`Erro ao reiniciar monitoramento: ${error.message}`);
    return false;
  }
}

// Função para limpar temporizadores de monitoramento
function clearMonitoringTimers() {
  try {
    // Limpa o intervalId global
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logger.info('Intervalo de monitoramento principal limpo');
    }

    logger.info('Todos os temporizadores de monitoramento foram limpos');

    return true;
  } catch (error) {
    logger.error(`Erro ao limpar temporizadores: ${error.message}`);
    return false;
  }
}

// Inicia o monitoramento com versão melhorada
async function startMonitoringImproved() {
  const config = store.get('config');

  // Verifica configurações básicas
  if (!config || !config.apiUrl || !config.username || !config.password || !config.printerId) {
    if (mainWindow) {
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: 'Configurações incompletas. Verifique as configurações da API e impressora.'
      });
    }
    logger.error('Tentativa de iniciar com configurações incompletas');
    return false;
  }

  // SEGURANÇA: Verificar se o ID do vendedor está configurado
  if (!config.vendorId || config.vendorId.trim() === '') {
    if (mainWindow) {
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: 'ID do vendedor não configurado. Configure o ID do vendedor antes de iniciar.'
      });
    }
    logger.error('Tentativa de iniciar sem ID de vendedor');
    return false;
  }

  try {
    // IMPORTANTE: Certificar-se de que qualquer monitoramento anterior foi parado
    if (isRunning) {
      logger.info('Parando monitoramento anterior antes de iniciar um novo');
      await stopMonitoringImproved();
    }

    // Limpa quaisquer intervalos pendentes para garantir
    clearMonitoringTimers();

    // Inicia o listener de pedidos
    await startOrderListener(config, async (order) => {
      try {
        // Verificação de segurança para cada pedido
        if (!orderBelongsToVendor(order, config.vendorId)) {
          logger.error(`SEGURANÇA: Pedido #${order.id} não pertence ao vendedor ${config.vendorId}. Ignorando.`);
          return;
        }

        logger.info(`Novo pedido recebido: #${order.id} para vendedor ${config.vendorId}`);
        if (mainWindow) {
          mainWindow.webContents.send('new-order', order);
        }

        // Imprime o pedido
        await printOrder(order, config.printerId);
        logger.info(`Pedido #${order.id} impresso com sucesso`);

        // Salva o log do pedido com status de sucesso
        saveOrderLog(order, 'success');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'success',
            message: `Pedido #${order.id} impresso com sucesso!`,
            orderId: order.id,
            printStatus: 'success'
          });
        }
      } catch (error) {
        logger.error(`Erro ao processar pedido #${order.id}: ${error.message}`);

        // Salva o log do pedido com status de falha
        saveOrderLog(order, 'failed');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'error',
            message: `Erro ao imprimir pedido #${order.id}: ${error.message}`,
            orderId: order.id,
            printStatus: 'failed'
          });
        }
      }
    });

    isRunning = true;
    updateTrayMenu();

    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', isRunning);
      mainWindow.webContents.send('notification', {
        type: 'success',
        message: 'Monitoramento de pedidos iniciado'
      });
    }

    logger.info('Monitoramento de pedidos iniciado com sucesso');
    return true;
  } catch (error) {
    // Em caso de erro, garantir que o status está correto
    isRunning = false;

    logger.error(`Erro ao iniciar monitoramento: ${error.message}`);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', isRunning);
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: `Erro ao iniciar monitoramento: ${error.message}`
      });
    }

    return false;
  }
}

// Para o monitoramento com versão melhorada
async function stopMonitoringImproved() {
  try {
    // Verifica se realmente está rodando antes de tentar parar
    if (!isRunning) {
      logger.info('Tentativa de parar monitoramento, mas já está parado');

      // Garante que o status está correto
      isRunning = false;

      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', isRunning);
      }

      return true;
    }

    // Tenta parar o monitoramento
    const stopResult = stopOrderListener();

    // Força a limpeza de qualquer temporizador pendente
    clearMonitoringTimers();

    // Atualiza o estado independentemente do resultado
    isRunning = false;
    updateTrayMenu();

    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', isRunning);
      mainWindow.webContents.send('notification', {
        type: 'info',
        message: 'Monitoramento de pedidos parado'
      });
    }

    logger.info('Monitoramento de pedidos parado com sucesso');
    return true;
  } catch (error) {
    logger.error(`Erro ao parar monitoramento: ${error.message}`);

    // Mesmo com erro, atualizamos o estado
    isRunning = false;

    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', isRunning);
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: `Erro ao parar monitoramento: ${error.message}`
      });
    }

    // Limpeza forçada de temporizadores para garantir
    clearMonitoringTimers();

    return false;
  }
}

// Handler para salvar configurações
// Versão corrigida da função handleSaveConfig para resolver erro de clonagem
async function handleSaveConfig(event, config) {
  try {
    logger.info('Salvando configurações com tratamento para monitoramento');

    // Verificação de segurança - garantir que config é um objeto válido
    if (!config || typeof config !== 'object') {
      logger.error('Erro: Objeto de configuração inválido');
      throw new Error('Configuração inválida recebida');
    }

    // Sanitizar o objeto config para garantir que ele pode ser clonado
    const sanitizedConfig = sanitizeConfigObject(config);

    // Verifica se houve alteração que afeta o monitoramento
    const oldConfig = store.get('config') || {};

    // Flags para determinar se o monitoramento precisa ser reiniciado
    let needsRestart = isRunning && (
      oldConfig.apiUrl !== sanitizedConfig.apiUrl ||
      oldConfig.username !== sanitizedConfig.username ||
      oldConfig.password !== sanitizedConfig.password ||
      oldConfig.vendorId !== sanitizedConfig.vendorId ||
      oldConfig.checkInterval !== sanitizedConfig.checkInterval
    );

    // Tenta detectar o ID do vendedor apenas se não fornecido
    if (!sanitizedConfig.vendorId || sanitizedConfig.vendorId.trim() === '') {
      try {
        logger.info('Tentando detectar ID do vendedor automaticamente');
        const vendorId = await getVendorIdFromCredentials(sanitizedConfig);

        if (vendorId) {
          logger.info(`ID do vendedor detectado automaticamente: ${vendorId}`);

          // Atualiza a configuração com o ID detectado
          sanitizedConfig.vendorId = vendorId;

          // Se o ID do vendedor mudou, precisamos reiniciar
          if (oldConfig.vendorId !== vendorId) {
            needsRestart = isRunning;
          }
        } else {
          logger.warn('Não foi possível detectar o ID do vendedor automaticamente');
        }
      } catch (error) {
        logger.error(`Erro ao detectar ID do vendedor: ${error.message}`);
        // Continua mesmo com erro, mas pode não ter ID do vendedor
      }
    }

    // Salva as configurações sanitizadas
    try {
      store.set('config', sanitizedConfig);
      logger.info('Configurações salvas com sucesso');
    } catch (storeError) {
      logger.error(`Erro ao salvar no electron-store: ${storeError.message}`);
      throw new Error(`Falha ao salvar configurações: ${storeError.message}`);
    }

    // Se o monitoramento estava ativo e houve alterações relevantes, reinicia
    if (needsRestart) {
      logger.info('Configurações relevantes foram alteradas, reiniciando monitoramento');

      // Avisa o usuário pela interface
      if (mainWindow) {
        mainWindow.webContents.send('notification', {
          type: 'info',
          message: 'Reiniciando monitoramento com as novas configurações...'
        });
      }

      // Reinicia o monitoramento com as novas configurações
      const restartSuccess = await restartMonitoring();

      if (restartSuccess) {
        logger.info('Monitoramento reiniciado com sucesso após alteração de configuração');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'success',
            message: 'Monitoramento reiniciado com as novas configurações'
          });
        }
      } else {
        logger.error('Falha ao reiniciar monitoramento após alteração de configuração');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'error',
            message: 'Falha ao reiniciar monitoramento. Por favor, reinicie manualmente.'
          });
        }
      }
    }

    // Retorna o resultado - apenas dados serializáveis
    return {
      success: true,
      detectedVendorId: oldConfig.vendorId !== sanitizedConfig.vendorId ? sanitizedConfig.vendorId : null,
      restarted: needsRestart
    };
  } catch (error) {
    logger.error(`Erro ao salvar configurações: ${error.message}`);
    throw new Error(`Não foi possível salvar as configurações: ${error.message}`);
  }
}


/**
 * Função para sanitizar o objeto de configuração e garantir que ele pode ser clonado
 * Resolve o erro "An object could not be cloned"
 * @param {Object} config - Objeto de configuração original
 * @returns {Object} Objeto de configuração sanitizado
 */
function sanitizeConfigObject(config) {
  // Cria um novo objeto com apenas as propriedades seguras
  const safeConfig = {};

  // Lista de propriedades seguras esperadas no objeto de configuração
  const safeProps = [
    'apiUrl',
    'username',
    'password',
    'vendorId',
    'checkInterval',
    'printerId',
    'autostart',
    'printWidth'
  ];

  // Copia apenas as propriedades seguras
  for (const prop of safeProps) {
    if (config[prop] !== undefined) {
      // Converte para string em caso de tipos complexos
      if (typeof config[prop] === 'object' && config[prop] !== null) {
        try {
          safeConfig[prop] = JSON.stringify(config[prop]);
        } catch (e) {
          // Se não conseguir stringificar, usa representação em string
          safeConfig[prop] = String(config[prop]);
        }
      } else {
        safeConfig[prop] = config[prop];
      }
    }
  }

  // Garante que checkInterval seja um número
  if (safeConfig.checkInterval) {
    safeConfig.checkInterval = Number(safeConfig.checkInterval) || 60;
  }

  // Garante que autostart seja um booleano
  if (safeConfig.autostart !== undefined) {
    safeConfig.autostart = Boolean(safeConfig.autostart);
  }

  // Garante que printWidth seja um número
  if (safeConfig.printWidth) {
    safeConfig.printWidth = Number(safeConfig.printWidth) || 48;
  }

  return safeConfig;
}

// Handler para limpar pedidos processados
async function handleClearProcessedOrders() {
  try {
    logger.info('Limpando pedidos processados com reinício de monitoramento');

    // Verifica se o monitoramento está ativo
    const wasRunning = isRunning;

    // Para o monitoramento se estiver ativo
    if (wasRunning) {
      logger.info('Parando monitoramento para limpar pedidos processados');

      if (mainWindow) {
        mainWindow.webContents.send('notification', {
          type: 'info',
          message: 'Parando monitoramento para limpar pedidos processados...'
        });
      }

      await stopMonitoringImproved();
    }

    // Limpa os pedidos processados
    clearProcessedOrdersState();

    // Reinicia o monitoramento se estava ativo
    if (wasRunning) {
      logger.info('Reiniciando monitoramento após limpar pedidos processados');

      if (mainWindow) {
        mainWindow.webContents.send('notification', {
          type: 'info',
          message: 'Reiniciando monitoramento após limpar pedidos...'
        });
      }

      const restartSuccess = await startMonitoringImproved();

      if (restartSuccess) {
        logger.info('Monitoramento reiniciado com sucesso após limpar pedidos');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'success',
            message: 'Monitoramento reiniciado após limpar pedidos'
          });
        }
      } else {
        logger.error('Falha ao reiniciar monitoramento após limpar pedidos');

        if (mainWindow) {
          mainWindow.webContents.send('notification', {
            type: 'error',
            message: 'Falha ao reiniciar monitoramento. Por favor, reinicie manualmente.'
          });
        }
      }
    }

    return {
      success: true,
      restarted: wasRunning
    };
  } catch (error) {
    logger.error(`Erro ao limpar pedidos processados: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Handler para limpar histórico de pedidos
async function handleClearOrderHistory() {
  try {
    // Verifica se o monitoramento está ativo
    const wasRunning = isRunning;

    // Para o monitoramento temporariamente se estiver ativo
    if (wasRunning) {
      logger.info('Parando monitoramento temporariamente para limpar histórico de pedidos');
      await stopMonitoringImproved();
    }

    // Limpa todos os registros (dias = 0)
    const removedCount = cleanOrderHistory(0);
    logger.info(`Histórico de pedidos limpo manualmente: ${removedCount} arquivos removidos`);

    // Reinicia o monitoramento se estava ativo
    if (wasRunning) {
      logger.info('Reiniciando monitoramento após limpar histórico');
      await startMonitoringImproved();
    }

    return {
      success: true,
      removedCount,
      restarted: wasRunning
    };
  } catch (error) {
    logger.error(`Erro ao limpar histórico de pedidos: ${error.message}`);

    // Tenta reiniciar o monitoramento mesmo em caso de erro, se estava ativo
    if (isRunning === false && wasRunning === true) {
      try {
        logger.info('Tentando reiniciar monitoramento após erro ao limpar histórico');
        await startMonitoringImproved();
      } catch (startError) {
        logger.error(`Erro adicional ao tentar reiniciar monitoramento: ${startError.message}`);
      }
    }

    throw new Error(`Não foi possível limpar o histórico de pedidos: ${error.message}`);
  }
}

// Quando uma aba é clicada - modificado para sempre permitir
ipcMain.handle('tab-clicked', (event, tabId) => {
  try {
    // Sempre permite a troca de aba
    return { success: true };
  } catch (error) {
    logger.error(`Erro ao verificar permissão para aba ${tabId}: ${error.message}`);
    return { success: false, message: error.message };
  }
});

// Autenticação simplificada - sempre retorna válido
ipcMain.handle('authenticate', () => {
  store.set('authenticated', true);
  logger.info('Autenticação automática');
  return { isValid: true };
});

// Verifica se já está autenticado - sempre retorna true
ipcMain.handle('isAuthenticated', () => {
  return { isAuthenticated: true };
});

// Limpar autenticação - mantido para compatibilidade
ipcMain.handle('clear-authentication', () => {
  // Não fazemos nada, sempre mantemos autenticado
  return { success: true };
});

// Handlers IPC
ipcMain.handle('get-printers', async () => {
  try {
    return await getPrinters();
  } catch (error) {
    logger.error(`Erro ao obter impressoras: ${error.message}`);
    throw new Error(`Não foi possível obter a lista de impressoras: ${error.message}`);
  }
});

ipcMain.handle('save-config', async (event, configInput) => {
  try {
    // Se o objeto tiver métodos ou propriedades não serializáveis, eles serão removidos aqui
    const configStr = JSON.stringify(configInput);
    const safeConfig = JSON.parse(configStr);

    return await handleSaveConfig(event, safeConfig);
  } catch (error) {
    logger.error(`Erro ao processar configuração para salvar: ${error.message}`);

    // Tenta extrair propriedades principais manualmente
    try {
      const extractedConfig = {
        apiUrl: configInput.apiUrl || '',
        username: configInput.username || '',
        password: configInput.password || '',
        vendorId: configInput.vendorId || '',
        checkInterval: Number(configInput.checkInterval) || 60,
        printerId: configInput.printerId || '',
        autostart: Boolean(configInput.autostart),
        printWidth: Number(configInput.printWidth) || 48
      };

      logger.info('Tentando salvar configuração extraída manualmente');
      return await handleSaveConfig(event, extractedConfig);
    } catch (secondError) {
      logger.error(`Também falhou na tentativa de extração manual: ${secondError.message}`);
      throw new Error(`Não foi possível salvar as configurações. Erro de clonagem de objeto: ${error.message}`);
    }
  }
});

/**
 * Verifica a etapa em que o erro de clonagem está ocorrendo
 * Função auxiliar para diagnóstico que pode ser usada na interface
 */
ipcMain.handle('diagnose-config-error', async (event, configToTest) => {
  try {
    logger.info('Iniciando diagnóstico de erro de clonagem de configuração');

    const results = {
      steps: [],
      success: false,
      problemFound: false,
      problemDetails: ''
    };

    // Passo 1: Tentar JSON.stringify no objeto completo
    try {
      results.steps.push({ step: 'Serialização JSON completa', status: 'iniciando' });
      const jsonString = JSON.stringify(configToTest);
      results.steps[0].status = 'sucesso';
      results.steps.push({
        step: 'Tamanho da string JSON',
        status: 'info',
        details: `${jsonString.length} caracteres`
      });
    } catch (jsonError) {
      results.steps[0].status = 'falha';
      results.steps[0].error = jsonError.message;
      results.problemFound = true;
      results.problemDetails = `Falha ao serializar o objeto: ${jsonError.message}`;
    }

    // Passo 2: Tentar identificar propriedades problemáticas
    if (results.problemFound) {
      results.steps.push({ step: 'Identificação de propriedades problemáticas', status: 'iniciando' });
      const problematicProps = [];

      for (const prop in configToTest) {
        try {
          JSON.stringify(configToTest[prop]);
        } catch (propError) {
          problematicProps.push({
            property: prop,
            type: typeof configToTest[prop],
            error: propError.message
          });
        }
      }

      if (problematicProps.length > 0) {
        results.steps[results.steps.length - 1].status = 'falha';
        results.steps[results.steps.length - 1].problematicProps = problematicProps;
      } else {
        results.steps[results.steps.length - 1].status = 'sucesso';
        results.steps[results.steps.length - 1].message = 'Nenhuma propriedade individual problemática encontrada';
      }
    }

    // Passo 3: Tentar sanitizar o objeto
    results.steps.push({ step: 'Sanitização do objeto', status: 'iniciando' });
    const sanitizedConfig = sanitizeConfigObject(configToTest);
    results.steps[results.steps.length - 1].status = 'sucesso';

    // Passo 4: Tentar salvar o objeto sanitizado
    results.steps.push({ step: 'Salvamento com objeto sanitizado', status: 'iniciando' });
    try {
      store.set('test_config', sanitizedConfig);
      results.steps[results.steps.length - 1].status = 'sucesso';
      store.delete('test_config'); // Limpa o teste

      results.success = true;
      results.steps.push({
        step: 'Conclusão',
        status: 'sucesso',
        message: 'O objeto sanitizado pode ser salvo com sucesso'
      });
    } catch (storeError) {
      results.steps[results.steps.length - 1].status = 'falha';
      results.steps[results.steps.length - 1].error = storeError.message;
      results.problemFound = true;
      results.problemDetails = `Falha ao salvar o objeto sanitizado: ${storeError.message}`;
    }

    return results;
  } catch (error) {
    logger.error(`Erro no diagnóstico de configuração: ${error.message}`);
    return {
      steps: [],
      success: false,
      error: error.message,
      problemFound: true,
      problemDetails: `Erro no diagnóstico: ${error.message}`
    };
  }
});

ipcMain.handle('clear-processed-orders', async () => {
  return await handleClearProcessedOrders();
});

ipcMain.handle('start-monitoring', async () => {
  try {
    const success = await startMonitoringImproved();
    return { success, isRunning };
  } catch (error) {
    logger.error(`Erro ao iniciar monitoramento via IPC: ${error.message}`);
    throw new Error(`Não foi possível iniciar o monitoramento: ${error.message}`);
  }
});

ipcMain.handle('stop-monitoring', async () => {
  try {
    const success = await stopMonitoringImproved();
    return { success, isRunning };
  } catch (error) {
    logger.error(`Erro ao parar monitoramento via IPC: ${error.message}`);
    throw new Error(`Não foi possível parar o monitoramento: ${error.message}`);
  }
});

// Teste de impressão
ipcMain.handle('test-print', async (event, testOrder, printerName) => {
  try {
    await printTest(testOrder, printerName);
    logger.info(`Teste de impressão realizado com sucesso na impressora ${printerName}`);

    // Envia resultado para a interface
    if (mainWindow) {
      mainWindow.webContents.send('print-result', {
        success: true,
        orderId: testOrder.id,
        message: `Pedido #${testOrder.id} impresso com sucesso!`,
        printStatus: 'success'
      });
    }

    return { success: true };
  } catch (error) {
    logger.error(`Erro no teste de impressão: ${error.message}`);

    // Envia resultado para a interface
    if (mainWindow) {
      mainWindow.webContents.send('print-result', {
        success: false,
        orderId: testOrder.id,
        message: `Erro ao imprimir pedido #${testOrder.id}: ${error.message}`,
        printStatus: 'failed'
      });
    }

    throw new Error(`Falha no teste de impressão: ${error.message}`);
  }
});

// Função para verificar a senha de suporte - mantido para compatibilidade
ipcMain.handle('verifySupportPassword', () => {
  // Sempre retorna true
  return { isValid: true };
});

// Função para obter o status atual do monitoramento
ipcMain.handle('getMonitoringStatus', () => {
  return { isRunning };
});

// Obter histórico de pedidos
ipcMain.handle('get-order-history', () => {
  try {
    const orderHistory = loadOrderHistory();
    logger.info(`Histórico de ${orderHistory.length} pedidos carregado via IPC`);
    return orderHistory;
  } catch (error) {
    logger.error(`Erro ao obter histórico de pedidos via IPC: ${error.message}`);
    throw new Error(`Não foi possível obter o histórico de pedidos: ${error.message}`);
  }
});

// Limpar histórico de pedidos
ipcMain.handle('clear-order-history', async () => {
  return await handleClearOrderHistory();
});

// Impede que o aplicativo feche ao clicar em fechar, apenas minimiza para a bandeja
app.on('window-all-closed', function (e) {
  e.preventDefault();
  if (mainWindow) {
    mainWindow.hide();
  }
  return false;
});

// Limpa recursos ao sair do aplicativo
app.on('before-quit', () => {
  try {
    stopMonitoringImproved();
  } catch (error) {
    logger.error(`Erro ao parar monitoramento durante saída: ${error.message}`);
  }
});