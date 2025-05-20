const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { startOrderListener, stopOrderListener } = require('./src/api');
const { getPrinters, printOrder, printTest } = require('./src/printer');
const { loadOrderHistory, saveOrderLog, cleanOrderHistory, verifyDailyPassword } = require('./src/utils');
const winston = require('winston');

// Configuração do logger
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

// Configurações do aplicativo
const store = new Store();
let mainWindow;
let tray;
let isRunning = false;

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
      startMonitoring();
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
        click: () => startMonitoring(),
        enabled: !isRunning
      },
      {
        label: 'Parar Monitoramento',
        click: () => stopMonitoring(),
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
        click: () => startMonitoring(),
        enabled: !isRunning
      },
      {
        label: 'Parar Monitoramento',
        click: () => stopMonitoring(),
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

// Inicia o monitoramento de pedidos
async function startMonitoring() {
  const config = store.get('config');

  if (!config || !config.apiUrl || !config.username || !config.password ||
    !config.vendorId || !config.printerId) {
    if (mainWindow) {
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: 'Configurações incompletas. Verifique as configurações da API e impressora.'
      });
    }
    logger.error('Tentativa de iniciar com configurações incompletas');
    return;
  }

  try {
    // Inicia o listener de pedidos
    startOrderListener(config, async (order) => {
      try {
        logger.info(`Novo pedido recebido: #${order.id}`);
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

    logger.info('Monitoramento de pedidos iniciado');
  } catch (error) {
    logger.error(`Erro ao iniciar monitoramento: ${error.message}`);
    if (mainWindow) {
      mainWindow.webContents.send('notification', {
        type: 'error',
        message: `Erro ao iniciar monitoramento: ${error.message}`
      });
    }
  }
}

// Para o monitoramento de pedidos
function stopMonitoring() {
  try {
    // Tenta parar o monitoramento
    stopOrderListener();
    
    isRunning = false;
    updateTrayMenu();

    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', isRunning);
      mainWindow.webContents.send('notification', {
        type: 'info',
        message: 'Monitoramento de pedidos parado'
      });
    }

    logger.info('Monitoramento de pedidos parado');
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

// Comunicação IPC entre o processo principal e o renderer
ipcMain.handle('get-printers', async () => {
  try {
    return await getPrinters();
  } catch (error) {
    logger.error(`Erro ao obter impressoras: ${error.message}`);
    throw new Error(`Não foi possível obter a lista de impressoras: ${error.message}`);
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    store.set('config', config);
    logger.info('Configurações salvas com sucesso');
    return { success: true };
  } catch (error) {
    logger.error(`Erro ao salvar configurações: ${error.message}`);
    throw new Error(`Não foi possível salvar as configurações: ${error.message}`);
  }
});

ipcMain.handle('start-monitoring', async () => {
  try {
    await startMonitoring();
    return { success: true, isRunning };
  } catch (error) {
    logger.error(`Erro ao iniciar monitoramento via IPC: ${error.message}`);
    throw new Error(`Não foi possível iniciar o monitoramento: ${error.message}`);
  }
});

ipcMain.handle('stop-monitoring', () => {
  try {
    stopMonitoring();
    return { success: true, isRunning };
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
ipcMain.handle('clear-order-history', () => {
  try {
    // Limpa todos os registros (dias = 0)
    const removedCount = cleanOrderHistory(0);
    logger.info(`Histórico de pedidos limpo manualmente: ${removedCount} arquivos removidos`);
    return { success: true, removedCount };
  } catch (error) {
    logger.error(`Erro ao limpar histórico de pedidos via IPC: ${error.message}`);
    throw new Error(`Não foi possível limpar o histórico de pedidos: ${error.message}`);
  }
});

// Impede que o aplicativo feche ao clicar em fechar, apenas minimiza para a bandeja
app.on('window-all-closed', function(e) {
  e.preventDefault();
  if (mainWindow) {
    mainWindow.hide();
  }
  return false;
});

// Limpa recursos ao sair do aplicativo
app.on('before-quit', () => {
  try {
    stopMonitoring();
  } catch (error) {
    logger.error(`Erro ao parar monitoramento durante saída: ${error.message}`);
  }
});