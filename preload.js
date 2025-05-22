const { contextBridge, ipcRenderer } = require('electron');

// Expõe funções seguras para o processo de renderização
contextBridge.exposeInMainWorld('electronAPI', {
  // Obter lista de impressoras
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Salvar configurações
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Controle de monitoramento
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),

  // Teste de impressão
  testPrint: (testOrder, printerName) => ipcRenderer.invoke('test-print', testOrder, printerName),

  // Obter histórico de pedidos
  getOrderHistory: () => ipcRenderer.invoke('get-order-history'),

  // Limpar histórico de pedidos
  clearOrderHistory: () => ipcRenderer.invoke('clear-order-history'),

  // Ouvintes de eventos
  onPrintersList: (callback) => ipcRenderer.on('printers-list', (_, printers) => callback(printers)),
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (_, config) => callback(config)),
  onLoadOrderHistory: (callback) => ipcRenderer.on('load-order-history', (_, orders) => callback(orders)),
  onNewOrder: (callback) => ipcRenderer.on('new-order', (_, order) => callback(order)),
  onNotification: (callback) => ipcRenderer.on('notification', (_, notification) => callback(notification)),
  onPrintResult: (callback) => ipcRenderer.on('print-result', (_, result) => callback(result)),
  onMonitoringStatus: (callback) => ipcRenderer.on('monitoring-status', (_, status) => callback(status)),

  // Verificação de senha
  verifySupportPassword: (password) => ipcRenderer.invoke('verifySupportPassword', password),
  authenticate: (password) => ipcRenderer.invoke('authenticate', password),
  isAuthenticated: () => ipcRenderer.invoke('isAuthenticated'),
  tabClicked: (tabId) => ipcRenderer.invoke('tab-clicked', tabId),
  clearAuthentication: () => ipcRenderer.invoke('clear-authentication'),
  clearProcessedOrders: () => ipcRenderer.invoke('clear-processed-orders'),
  listVendors: () => ipcRenderer.invoke('list-vendors'),
  testAPI: (config) => ipcRenderer.invoke('test-api', config),
  diagnoseConfigError: (config) => ipcMain.invoke('diagnose-config-error', config),

  // Obter o status atual do monitoramento
  getMonitoringStatus: () => ipcRenderer.invoke('getMonitoringStatus'),
  // Remover ouvintes (para previnir vazamentos de memória)
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});