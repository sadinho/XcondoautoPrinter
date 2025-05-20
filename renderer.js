// Elementos da interface principal
const loginScreen = document.getElementById('loginScreen');
const configForm = document.getElementById('config');
const mainContent = document.getElementById('mainContent');
const tabButtons = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const notificationEl = document.getElementById('notification');
const printerSelect = document.getElementById('printerSelect');
const apiUrlInput = document.getElementById('apiUrl');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const vendorIdInput = document.getElementById('vendorId');
const checkIntervalInput = document.getElementById('checkInterval');
const autostartCheckbox = document.getElementById('autostart');
const saveConfigButton = document.getElementById('saveConfig');
const startMonitoringButton = document.getElementById('startMonitoring');
const stopMonitoringButton = document.getElementById('stopMonitoring');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const ordersTable = document.getElementById('ordersTable');
const testPrintButton = document.getElementById('testPrint');
const refreshOrdersButton = document.getElementById('refreshOrdersButton');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const orderSearchInput = document.getElementById('orderSearchInput');
const clearSearchButton = document.getElementById('clearSearchButton');
const showCredentialsBtn = document.getElementById('showCredentialsBtn');

// Estado do aplicativo
let isMonitoring = false;
let printerId = '';
let orders = []; // Array para armazenar os pedidos

// Função para mostrar a tela principal diretamente (sem login)
function showMainContent() {
  // Oculta a tela de login
  if (loginScreen) loginScreen.style.display = 'none';
  
  // Mostra o conteúdo principal
  mainContent.style.display = 'block';
  
  // A primeira aba (config) fica visível por padrão
  document.getElementById('config').classList.add('active');
  
  // Mostra notificação de boas-vindas
  showNotification('info', 'Bem-vindo ao sistema de impressão automática de pedidos!', 3000);
}

// Event listeners para as abas
tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tabId = button.getAttribute('data-tab');
    
    // Alterna para a aba clicada sem verificação de permissão
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    button.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});

// Função para mostrar notificações
function showNotification(type, message, duration = 5000) {
  notificationEl.textContent = message;
  notificationEl.className = `notification ${type}`;
  notificationEl.style.display = 'block';

  // Oculta a notificação após o tempo especificado
  setTimeout(() => {
    notificationEl.style.display = 'none';
  }, duration);
}

// Função para atualizar o status de monitoramento na interface
function updateMonitoringStatus(status) {
  isMonitoring = status;

  if (status) {
    statusIndicator.className = 'status-indicator status-running';
    statusText.textContent = 'Monitoramento Ativo';
    startMonitoringButton.disabled = true;
    stopMonitoringButton.disabled = false;
  } else {
    statusIndicator.className = 'status-indicator status-stopped';
    statusText.textContent = 'Monitoramento Parado';
    startMonitoringButton.disabled = false;
    stopMonitoringButton.disabled = true;
  }
}

// Função para adicionar um pedido à tabela
function addOrderToTable(order, printStatus = 'pending') {
  // Remove a mensagem "Nenhum pedido processado ainda"
  const emptyMessage = ordersTable.querySelector('.empty-table');
  if (emptyMessage) {
    emptyMessage.parentElement.remove();
  }

  // Verifica se o pedido já existe na tabela
  const existingRow = document.getElementById(`order-row-${order.id}`);
  if (existingRow) {
    // Atualiza o status de impressão
    const statusCell = existingRow.querySelector('.print-status-cell');
    updatePrintStatus(statusCell, printStatus);
    return;
  }

  // Cria nova linha para o pedido
  const tbody = ordersTable.querySelector('tbody');
  const row = document.createElement('tr');
  row.id = `order-row-${order.id}`;

  // Formata a data
  let formattedDate = '';
  let formattedTime = '';
  
  try {
    const orderDate = new Date(order.date_created);
    formattedDate = orderDate.toLocaleDateString('pt-BR');
    formattedTime = orderDate.toLocaleTimeString('pt-BR');
  } catch (error) {
    console.error('Erro ao formatar data:', error);
    formattedDate = 'Data inválida';
    formattedTime = '';
  }

  // Adiciona os dados do pedido com verificações para evitar erros
  const clientName = order.billing ? 
    `${order.billing.first_name || ''} ${order.billing.last_name || ''}`.trim() : 
    'Cliente não especificado';
    
  const total = order.total ? parseFloat(order.total).toFixed(2) : '0.00';

  row.innerHTML = `
    <td>#${order.id}</td>
    <td>${formattedDate}<br>${formattedTime}</td>
    <td>${clientName}</td>
    <td>R$ ${total}</td>
    <td>${order.status || 'Desconhecido'}</td>
    <td class="print-status-cell">
      <span class="print-status print-${printStatus}"></span>
      ${getPrintStatusText(printStatus)}
    </td>
    <td>
      <button class="action-btn print-btn" data-order-id="${order.id}">Imprimir</button>
    </td>
  `;

  // Adiciona o evento de clique no botão de impressão
  row.querySelector('.print-btn').addEventListener('click', () => {
    reprintOrder(order);
  });

  // Adiciona a linha à tabela
  tbody.appendChild(row);

  // Adiciona o pedido ao array se não existir
  if (!orders.find(o => o.id === order.id)) {
    orders.push(order);
  }

  // Ordena a tabela para manter os pedidos mais recentes no topo
  sortOrdersTable();
}

// Atualiza o status de impressão na tabela
function updatePrintStatus(statusCell, status) {
  const statusIcon = statusCell.querySelector('.print-status');
  statusIcon.className = `print-status print-${status}`;
  statusCell.innerHTML = `
    <span class="print-status print-${status}"></span>
    ${getPrintStatusText(status)}
  `;
}

// Retorna o texto do status de impressão
function getPrintStatusText(status) {
  switch (status) {
    case 'success':
      return 'Impresso';
    case 'failed':
      return 'Falha';
    case 'pending':
      return 'Pendente';
    default:
      return status;
  }
}

// Função para reimprimir um pedido
async function reprintOrder(order) {
  try {
    // Obtém a linha da tabela
    const row = document.getElementById(`order-row-${order.id}`);
    if (!row) return;

    // Obtém a célula de status
    const statusCell = row.querySelector('.print-status-cell');

    // Atualiza para pendente
    updatePrintStatus(statusCell, 'pending');

    // Verifica se a impressora está selecionada
    if (!printerSelect.value) {
      showNotification('error', 'Selecione uma impressora para imprimir');
      updatePrintStatus(statusCell, 'failed');
      return;
    }

    // Envia para impressão
    await window.electronAPI.testPrint(order, printerSelect.value);

    // A atualização do status será feita pelo event listener onPrintResult
    showNotification('success', `Pedido #${order.id} enviado para reimpressão`);
  } catch (error) {
    // Atualiza o status para falha
    const row = document.getElementById(`order-row-${order.id}`);
    if (row) {
      const statusCell = row.querySelector('.print-status-cell');
      updatePrintStatus(statusCell, 'failed');
    }
    showNotification('error', `Erro ao reimprimir pedido #${order.id}: ${error.message}`);
  }
}

// Função para ordenar a tabela de pedidos (mais recentes primeiro)
function sortOrdersTable() {
  const tbody = ordersTable.querySelector('tbody');
  if (!tbody) return;

  // Obtém todas as linhas exceto a mensagem vazia
  const rows = Array.from(tbody.querySelectorAll('tr:not(.empty-message-row)'));
  if (rows.length <= 1) return;

  // Ordena as linhas por data (mais recentes primeiro)
  rows.sort((a, b) => {
    const dateA = getOrderDateFromRow(a);
    const dateB = getOrderDateFromRow(b);
    return dateB - dateA;
  });

  // Remove todas as linhas
  rows.forEach(row => row.remove());

  // Adiciona as linhas ordenadas de volta
  rows.forEach(row => tbody.appendChild(row));
}

// Função auxiliar para extrair a data de um pedido a partir da linha da tabela
function getOrderDateFromRow(row) {
  // Tenta obter o ID do pedido da linha
  const orderId = row.id ? row.id.replace('order-row-', '') : '';

  // Encontra o pedido correspondente no array
  const order = orders.find(o => o.id === orderId);

  if (order && order.date_created) {
    return new Date(order.date_created);
  }

  // Fallback: tenta extrair a data da segunda célula
  const dateCell = row.querySelector('td:nth-child(2)');
  if (dateCell) {
    const dateText = dateCell.textContent;
    try {
      // Tenta converter a data no formato brasileiro para um objeto Date
      const [datePart, timePart] = dateText.split('\n');
      const [day, month, year] = datePart.split('/');
      const [hour, minute, second] = timePart ? timePart.split(':') : [0, 0, 0];

      return new Date(year, month - 1, day, hour, minute, second);
    } catch (error) {
      console.error('Erro ao extrair data da linha:', error);
    }
  }

  // Último recurso: usa a data atual
  return new Date();
}

// Função para filtrar pedidos
function filterOrders(searchTerm) {
  const tbody = ordersTable.querySelector('tbody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr');

  // Controla a visibilidade do botão de limpar busca
  if (searchTerm.trim()) {
    clearSearchButton.style.display = 'flex';
  } else {
    clearSearchButton.style.display = 'none';
  }

  // Se não houver linhas ou apenas a mensagem de vazio, não faz nada
  if (rows.length === 0 || (rows.length === 1 && rows[0].querySelector('.empty-table'))) {
    return;
  }

  // Verifica se a busca está vazia
  if (!searchTerm.trim()) {
    // Mostra todas as linhas
    rows.forEach(row => {
      row.style.display = '';
    });
    return;
  }

  // Normaliza o termo de busca (remove acentos, converte para minúsculas)
  const normalizedSearch = searchTerm.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Contador para verificar se todas as linhas estão ocultas
  let hiddenRows = 0;

  // Filtra as linhas
  rows.forEach(row => {
    // Pula a linha de "nenhum resultado"
    if (row.classList.contains('no-results-row')) {
      return;
    }

    // Obtém o texto da linha
    const text = row.textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Verifica se o texto contém o termo de busca
    if (text.includes(normalizedSearch)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
      hiddenRows++;
    }
  });

  // Se todas as linhas estiverem ocultas, mostra uma mensagem
  if (hiddenRows === rows.length) {
    // Remove qualquer mensagem anterior de "nenhum resultado"
    const emptyMessage = tbody.querySelector('.no-results-row');
    if (emptyMessage) {
      emptyMessage.remove();
    }

    // Adiciona a mensagem de "nenhum resultado"
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'no-results-row';
    emptyRow.innerHTML = `<td colspan="7" class="empty-table">Nenhum pedido encontrado com o termo "${searchTerm}"</td>`;
    tbody.appendChild(emptyRow);
  } else {
    // Remove a mensagem de "nenhum resultado" se existir
    const emptyMessage = tbody.querySelector('.no-results-row');
    if (emptyMessage) {
      emptyMessage.remove();
    }
  }
}

// Botão para limpar a busca
clearSearchButton.addEventListener('click', () => {
  orderSearchInput.value = '';
  filterOrders('');
  orderSearchInput.focus();
});

// Evento de digitação na busca (com debounce para melhor performance)
let searchTimeout;
orderSearchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    filterOrders(orderSearchInput.value);
  }, 300); // Aguarda 300ms após o último caractere digitado
});

// Ocultar botão de mostrar credenciais que não é mais necessário
if (showCredentialsBtn) {
  showCredentialsBtn.style.display = 'none';
}

// Inicializa a aplicação mostrando diretamente o conteúdo principal
window.addEventListener('DOMContentLoaded', () => {
  // Oculta a tela de login
  if (loginScreen) {
    loginScreen.style.display = 'none';
  }
  
  // Mostra o conteúdo principal
  mainContent.style.display = 'block';
  
  // Verifica se o monitoramento já está ativo
  window.electronAPI.getMonitoringStatus().then(status => {
    updateMonitoringStatus(status.isRunning);
  }).catch(error => {
    console.error('Erro ao verificar status do monitoramento:', error);
  });
});

// Carrega a lista de impressoras
window.electronAPI.onPrintersList((printers) => {
  printerSelect.innerHTML = '';

  if (!printers || printers.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Nenhuma impressora encontrada';
    printerSelect.appendChild(option);
    return;
  }

  // Adiciona opção vazia no início
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Selecione uma impressora';
  printerSelect.appendChild(emptyOption);

  // Adiciona cada impressora como uma opção
  printers.forEach(printer => {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = printer.name;
    printerSelect.appendChild(option);
  });
});

// Carrega as configurações salvas
window.electronAPI.onLoadConfig((config) => {
  if (config) {
    apiUrlInput.value = config.apiUrl || '';
    usernameInput.value = config.username || '';
    passwordInput.value = config.password || '';
    vendorIdInput.value = config.vendorId || '';
    checkIntervalInput.value = config.checkInterval || '60';
    autostartCheckbox.checked = config.autostart || false;

    // Seleciona a impressora se estiver definida
    if (config.printerId) {
      printerId = config.printerId;
      setTimeout(() => {
        printerSelect.value = config.printerId;
      }, 500); // Pequeno delay para garantir que as impressoras já foram carregadas
    }
  }
});

// Carrega o histórico de pedidos
window.electronAPI.onLoadOrderHistory((orderHistory) => {
  // Se não houver pedidos, não faz nada
  if (!orderHistory || orderHistory.length === 0) {
    return;
  }

  // Adiciona cada pedido à tabela com seu status salvo
  orderHistory.forEach(order => {
    try {
      const printStatus = order.print_status || 'success'; // Assume sucesso se não houver status
      addOrderToTable(order, printStatus);

      // Adiciona o pedido ao array se não existir
      if (!orders.find(o => o.id === order.id)) {
        orders.push(order);
      }
    } catch (error) {
      console.error(`Erro ao adicionar pedido ${order.id} à tabela:`, error);
    }
  });

  // Ordena a tabela por data (mais recentes primeiro)
  try {
    sortOrdersTable();
  } catch (error) {
    console.error('Erro ao ordenar tabela de pedidos:', error);
  }
});

// Escuta por novos pedidos
window.electronAPI.onNewOrder((order) => {
  addOrderToTable(order, 'pending');
});

// Escuta por notificações
window.electronAPI.onNotification((notification) => {
  showNotification(notification.type, notification.message);

  // Se for uma notificação de impressão, atualiza o status na tabela
  if (notification.orderId && notification.printStatus) {
    const row = document.getElementById(`order-row-${notification.orderId}`);
    if (row) {
      const statusCell = row.querySelector('.print-status-cell');
      updatePrintStatus(statusCell, notification.printStatus);
    }
  }
});

// Escuta por resultados de impressão
window.electronAPI.onPrintResult((result) => {
  // Atualiza o status na tabela
  if (result.orderId) {
    const row = document.getElementById(`order-row-${result.orderId}`);
    if (row) {
      const statusCell = row.querySelector('.print-status-cell');
      updatePrintStatus(statusCell, result.printStatus);
    }
  }

  // Mostra notificação
  showNotification(result.success ? 'success' : 'error', result.message);
});

// Escuta por mudanças no status de monitoramento
window.electronAPI.onMonitoringStatus((status) => {
  updateMonitoringStatus(status);
});

// Salva as configurações
saveConfigButton.addEventListener('click', async () => {
  // Valida as entradas
  if (!apiUrlInput.value) {
    showNotification('error', 'URL da loja é obrigatória');
    return;
  }

  if (!usernameInput.value) {
    showNotification('error', 'Nome de usuário é obrigatório');
    return;
  }

  if (!passwordInput.value) {
    showNotification('error', 'Senha é obrigatória');
    return;
  }

  if (!vendorIdInput.value) {
    showNotification('error', 'ID do Vendedor é obrigatório');
    return;
  }

  if (!printerSelect.value) {
    showNotification('error', 'Selecione uma impressora');
    return;
  }

  // Valida o intervalo de verificação
  const checkInterval = parseInt(checkIntervalInput.value);
  if (isNaN(checkInterval) || checkInterval < 10) {
    showNotification('error', 'Intervalo de verificação deve ser no mínimo 10 segundos');
    return;
  }

  // Prepara o objeto de configuração
  const config = {
    apiUrl: apiUrlInput.value.trim(),
    username: usernameInput.value.trim(),
    password: passwordInput.value.trim(),
    vendorId: vendorIdInput.value.trim(),
    checkInterval: checkInterval,
    printerId: printerSelect.value,
    autostart: autostartCheckbox.checked
  };

  try {
    // Salva as configurações
    const result = await window.electronAPI.saveConfig(config);
    if (result.success) {
      showNotification('success', 'Configurações salvas com sucesso');
    }
  } catch (error) {
    showNotification('error', `Erro ao salvar configurações: ${error.message}`);
  }
});

// Inicia o monitoramento
startMonitoringButton.addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.startMonitoring();
    if (result.success) {
      updateMonitoringStatus(result.isRunning);
    }
  } catch (error) {
    showNotification('error', `Erro ao iniciar monitoramento: ${error.message}`);
  }
});

// Para o monitoramento
stopMonitoringButton.addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.stopMonitoring();
    if (result.success) {
      updateMonitoringStatus(result.isRunning);
    }
  } catch (error) {
    showNotification('error', `Erro ao parar monitoramento: ${error.message}`);
  }
});

// Teste de impressão
testPrintButton.addEventListener('click', async () => {
  if (!printerSelect.value) {
    showNotification('error', 'Selecione uma impressora para o teste');
    return;
  }

  // Cria um pedido de teste
  const testOrder = {
    id: 'TESTE-' + Date.now(),
    date_created: new Date().toISOString(),
    status: 'processing',
    total: '99.99',
    billing: {
      first_name: 'Cliente',
      last_name: 'Teste',
      address_1: 'Rua de Teste, 123',
      city: 'Cidade Teste',
      state: 'TE',
      postcode: '12345-678',
      country: 'BR',
      email: 'cliente@teste.com',
      phone: '(99) 99999-9999'
    },
    line_items: [
      {
        name: 'Produto Teste 1',
        quantity: 2,
        price: '29.99',
        subtotal: '59.98'
      },
      {
        name: 'Produto Teste 2',
        quantity: 1,
        price: '39.99',
        subtotal: '39.99'
      }
    ]
  };

  try {
    // Adiciona o pedido à tabela com status pendente
    addOrderToTable(testOrder, 'pending');

    // Envia o pedido de teste para impressão
    await window.electronAPI.testPrint(testOrder, printerSelect.value);

    // A atualização do status será feita pelo event listener onPrintResult
    showNotification('success', 'Teste de impressão enviado com sucesso');
  } catch (error) {
    // Atualiza o status para falha na tabela
    const row = document.getElementById(`order-row-${testOrder.id}`);
    if (row) {
      const statusCell = row.querySelector('.print-status-cell');
      updatePrintStatus(statusCell, 'failed');
    }

    showNotification('error', `Erro no teste de impressão: ${error.message}`);
  }
});

// Botão de atualizar a lista de pedidos
refreshOrdersButton.addEventListener('click', async () => {
  try {
    // Salva o termo de busca atual
    const currentSearchTerm = orderSearchInput.value;

    // Limpa a tabela
    const tbody = ordersTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-table">Carregando pedidos...</td></tr>';
    }

    // Solicita o histórico de pedidos novamente
    const orderHistory = await window.electronAPI.getOrderHistory();

    // Limpa o array de pedidos
    orders = [];

    // Limpa a tabela
    if (tbody) {
      tbody.innerHTML = '';
    }

    // Se não houver pedidos, exibe a mensagem vazia
    if (!orderHistory || orderHistory.length === 0) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table">Nenhum pedido processado ainda.</td></tr>';
      }
      return;
    }

    // Adiciona cada pedido à tabela com seu status salvo
    orderHistory.forEach(order => {
      const printStatus = order.print_status || 'success'; // Assume sucesso se não houver status
      addOrderToTable(order, printStatus);
    });

    // Reaplica o filtro de busca se houver um termo
    if (currentSearchTerm) {
      filterOrders(currentSearchTerm);
    }

    showNotification('success', 'Lista de pedidos atualizada com sucesso');
  } catch (error) {
    showNotification('error', `Erro ao atualizar lista de pedidos: ${error.message}`);
  }
});

// Botão de limpar histórico de pedidos
clearHistoryButton.addEventListener('click', async () => {
  try {
    // Confirmação do usuário
    const confirmClear = confirm('Tem certeza que deseja limpar o histórico de pedidos? Esta ação não pode ser desfeita.');

    if (!confirmClear) {
      return;
    }

    // Solicita a limpeza do histórico
    const result = await window.electronAPI.clearOrderHistory();

    // Limpa a tabela
    const tbody = ordersTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-table">Nenhum pedido processado ainda.</td></tr>';
    }

    // Limpa o array de pedidos
    orders = [];

    // Limpa o campo de busca
    orderSearchInput.value = '';

    showNotification('success', `Histórico de pedidos limpo com sucesso.`);
  } catch (error) {
    showNotification('error', `Erro ao limpar histórico de pedidos: ${error.message}`);
  }
});