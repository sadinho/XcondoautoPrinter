/**
 * Módulo de impressão com layout completo para pedidos WooCommerce com Dokan
 * Inclui observações do cliente, status e forma de pagamento
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuração para logging
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} - ${message}\n`;

  try {
    fs.appendFileSync('printer-log.txt', logLine);
    console.log(message);
  } catch (err) {
    console.error(`Erro ao registrar log: ${err.message}`);
  }
}

/**
 * Define uma impressora como padrão no sistema
 * @param {string} printerName - Nome da impressora
 * @returns {Promise<string>} Nome da impressora padrão anterior
 */
async function setDefaultPrinter(printerName) {
  try {
    // Salva a impressora padrão atual
    const { stdout } = await execPromise('wmic printer where default=true get name');
    let defaultPrinter = '';

    // Extrai o nome da impressora padrão atual
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[0] === 'Name') {
      defaultPrinter = lines[1];
    }

    log(`Impressora padrão atual: "${defaultPrinter}"`);

    // Define a nova impressora como padrão
    log(`Definindo impressora "${printerName}" como padrão`);
    await execPromise(`wmic printer where "name='${printerName}'" call setdefaultprinter`);

    return defaultPrinter;
  } catch (error) {
    log(`Erro ao definir impressora padrão: ${error.message}`);
    return '';
  }
}

/**
 * Traduz o status do pedido WooCommerce para português
 * @param {string} status - Status do pedido em inglês
 * @returns {string} Status traduzido
 */
function translateOrderStatus(status) {
  const statusMap = {
    'pending': 'Pendente',
    'processing': 'Em processamento',
    'on-hold': 'Em espera',
    'completed': 'Concluído',
    'cancelled': 'Cancelado',
    'refunded': 'Reembolsado',
    'failed': 'Falhou',
    'trash': 'Na lixeira'
  };

  return statusMap[status] || status;
}

/**
 * Cria um arquivo com o conteúdo do pedido com layout melhorado
 * @param {Object} order - Dados do pedido
 * @returns {string} Caminho do arquivo
 */
function createOrderFile(order) {
  try {
    log(`Criando arquivo para o pedido #${order.id}`);
    
    // Criar diretório temporário se não existir
    const tempDir = path.join(os.tmpdir(), 'print-temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Formata a data do pedido
    const orderDate = new Date(order.date_created || new Date());
    const formattedDate = orderDate.toLocaleDateString('pt-BR');
    const formattedTime = orderDate.toLocaleTimeString('pt-BR');
    
    // Conteúdo do pedido formatado para impressão
    let content = '';
    
    // Cabeçalho
    content += '=======================================\n';
    content += '           NOVO PEDIDO                 \n';
    content += '          Xcondo Shop                  \n';
    content += '=======================================\n\n';
    
    // Informações do pedido
    content += `PEDIDO #${order.id}\n`;
    content += `Data: ${formattedDate} ${formattedTime}\n`;
    
    // Status do pedido
    if (order.status) {
      content += `Status: ${translateOrderStatus(order.status)}\n`;
    }
    
    // DESTAQUE PARA O PAGAMENTO
    content += '\n';
    content += '---------------------------------------\n';
    content += 'INFORMAÇÕES DE PAGAMENTO:\n';
    
    // Tipo de pagamento (mais detalhado)
    if (order.payment_method_title) {
      content += `Método: ${order.payment_method_title}\n`;
    }
    
    // Código do método de pagamento (útil para referência)
    if (order.payment_method) {
      content += `Tipo: ${order.payment_method}\n`;
    }
    
    // Status do pagamento
    let paymentStatus = 'Não confirmado';
    
    if (order.date_paid) {
      const datePaid = new Date(order.date_paid);
      paymentStatus = `Confirmado em ${datePaid.toLocaleDateString('pt-BR')}`;
    } else if (order.status === 'processing' || order.status === 'completed') {
      paymentStatus = 'Confirmado';
    } else if (order.status === 'on-hold') {
      paymentStatus = 'Aguardando confirmação';
    } else if (order.status === 'failed') {
      paymentStatus = 'Falhou';
    } else if (order.status === 'pending') {
      paymentStatus = 'Pendente';
    } else if (order.status === 'refunded') {
      paymentStatus = 'Reembolsado';
    }
    
    content += `Status: ${paymentStatus}\n`;
    
    // Transação (se disponível)
    if (order.transaction_id) {
      content += `Transação: ${order.transaction_id}\n`;
    }
    
    // Verificar se tem informações de pagamento nos metadados
    if (order.meta_data) {
      const paymentMeta = order.meta_data.filter(m => 
        m.key.includes('payment') || 
        m.key.includes('_paid') || 
        m.key.includes('transaction')
      );
      
      if (paymentMeta.length > 0) {
        content += 'Dados adicionais:\n';
        paymentMeta.forEach(meta => {
          // Formatar o nome da chave para exibição
          const keyName = meta.key
            .replace('_', ' ')
            .replace(/([A-Z])/g, ' $1')
            .trim();
          
          content += `  ${keyName}: ${meta.value}\n`;
        });
      }
    }
    
    content += '\n';
    
    // Informações do cliente
    content += '---------------------------------------\n';
    content += 'CLIENTE:\n';
    
    if (order.billing) {
      content += `Nome: ${order.billing.first_name || ''} ${order.billing.last_name || ''}\n`;
      
      if (order.billing.phone) {
        content += `Tel: ${order.billing.phone}\n`;
      }
      
      if (order.billing.email) {
        content += `Email: ${order.billing.email}\n`;
      }
      
      // Endereço completo
      let address = [];
      
      if (order.billing.address_1) {
        address.push(`Endereço: ${order.billing.address_1}`);
      }
      
      if (order.billing.address_2) {
        address.push(`Complemento: ${order.billing.address_2}`);
      }
      
      if (order.billing.neighborhood) {
        address.push(`Bairro: ${order.billing.neighborhood}`);
      }
      
      if (order.billing.city) {
        address.push(`Cidade: ${order.billing.city}`);
      }
      
      if (order.billing.state) {
        address.push(`Estado: ${order.billing.state}`);
      }
      
      if (order.billing.postcode) {
        address.push(`CEP: ${order.billing.postcode}`);
      }
      
      if (address.length > 0) {
        content += address.join('\n') + '\n';
      }
    }
    
    content += '\n';
    
    // Informações do vendedor Dokan (se disponível)
    if (order.store_name || (order.meta_data && order.meta_data.find(m => m.key === '_dokan_vendor_id'))) {
      content += '---------------------------------------\n';
      content += 'VENDEDOR:\n';
      
      if (order.store_name) {
        content += `Loja: ${order.store_name}\n`;
      }
      
      // Tenta encontrar o ID do vendedor nos metadados
      if (order.meta_data) {
        const vendorIdMeta = order.meta_data.find(m => m.key === '_dokan_vendor_id');
        if (vendorIdMeta) {
          content += `ID do Vendedor: ${vendorIdMeta.value}\n`;
        }
      }
      
      content += '\n';
    }
    
    // Itens do pedido
    content += '---------------------------------------\n';
    content += 'ITENS DO PEDIDO:\n';
    
    if (order.line_items && order.line_items.length > 0) {
      for (const item of order.line_items) {
        // Nome do produto e quantidade
        content += `${item.quantity || 1}x ${item.name || 'Produto'}\n`;
        
        // Variações do produto (se houver)
        if (item.meta_data && item.meta_data.length > 0) {
          for (const meta of item.meta_data) {
            // Filtra apenas metadados visíveis (que não começam com _)
            if (!meta.key.startsWith('_')) {
              content += `   ${meta.key}: ${meta.value}\n`;
            }
          }
        }
        
        // Preço unitário e subtotal
        if (item.price) {
          content += `   Preço: R$ ${parseFloat(item.price).toFixed(2)}\n`;
        }
        
        if (item.subtotal) {
          content += `   Subtotal: R$ ${parseFloat(item.subtotal).toFixed(2)}\n`;
        }
        
        content += '\n';
      }
    } else {
      content += 'Nenhum item no pedido\n\n';
    }
    
    // Resumo financeiro
    content += '---------------------------------------\n';
    content += 'RESUMO:\n';
    
    // Subtotal
    if (order.subtotal) {
      content += `Subtotal: R$ ${parseFloat(order.subtotal).toFixed(2)}\n`;
    }
    
    // Frete
    if (order.shipping_total && parseFloat(order.shipping_total) > 0) {
      content += `Frete: R$ ${parseFloat(order.shipping_total).toFixed(2)}\n`;
    }
    
    // Desconto
    if (order.discount_total && parseFloat(order.discount_total) > 0) {
      content += `Desconto: -R$ ${parseFloat(order.discount_total).toFixed(2)}\n`;
    }
    
    // Impostos
    if (order.total_tax && parseFloat(order.total_tax) > 0) {
      content += `Impostos: R$ ${parseFloat(order.total_tax).toFixed(2)}\n`;
    }
    
    // Total geral
    content += `TOTAL: R$ ${parseFloat(order.total || 0).toFixed(2)}\n\n`;
    
    // Observações do cliente
    if (order.customer_note) {
      content += '---------------------------------------\n';
      content += 'OBSERVAÇÕES DO CLIENTE:\n';
      content += `${order.customer_note}\n\n`;
    }
    
    // Informações sobre o método de envio (se disponível)
    if (order.shipping_lines && order.shipping_lines.length > 0) {
      content += '---------------------------------------\n';
      content += 'MÉTODO DE ENVIO:\n';
      
      for (const shipping of order.shipping_lines) {
        content += `${shipping.method_title || 'Método de envio'}\n`;
        
        if (shipping.method_id) {
          content += `ID do método: ${shipping.method_id}\n`;
        }
        
        if (shipping.total) {
          content += `Custo: R$ ${parseFloat(shipping.total).toFixed(2)}\n`;
        }
      }
      
      content += '\n';
    }
    
    // Rodapé
    content += '=======================================\n';
    content += `Impresso em: ${new Date().toLocaleString('pt-BR')}\n`;
    content += '=======================================\n';
    
    // Adicionar várias linhas em branco para facilitar corte manual
    content += '\n\n\n\n\n\n\n\n\n\n';
    
    // Caminho do arquivo
    const filePath = path.join(tempDir, `order-${order.id}-${Date.now()}.txt`);
    
    // Salvar conteúdo no arquivo
    fs.writeFileSync(filePath, content, 'utf8');
    
    log(`Arquivo criado: ${filePath}`);
    return filePath;
  } catch (error) {
    log(`Erro ao criar arquivo do pedido: ${error.message}`);
    throw error;
  }
}

/**
 * Imprime usando Notepad - método mais confiável para impressão física
 * @param {string} filePath - Caminho do arquivo a ser impresso
 * @returns {Promise<boolean>} Sucesso da impressão
 */
async function printWithNotepad(filePath) {
  try {
    log('Imprimindo com Notepad - método mais confiável');

    // Executa o Notepad com a flag /p para imprimir
    await execPromise(`notepad /p "${filePath}"`);

    log('Comando Notepad executado com sucesso');
    return true;
  } catch (error) {
    log(`Erro ao imprimir com Notepad: ${error.message}`);
    throw error;
  }
}

/**
 * Verifica se a impressão foi enviada para a fila
 * @returns {Promise<boolean>} True se há jobs na fila de impressão
 */
async function checkPrintQueue() {
  try {
    log('Verificando fila de impressão...');

    // Verifica jobs na fila com WMIC
    const { stdout } = await execPromise('wmic printjob list brief');

    // Se há conteúdo além do cabeçalho, existem jobs na fila
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    const hasJobs = lines.length > 1;

    log(`Jobs na fila de impressão: ${hasJobs ? 'Sim' : 'Não'}`);
    return hasJobs;
  } catch (error) {
    log(`Erro ao verificar fila de impressão: ${error.message}`);
    return false; // Assume que não há jobs em caso de erro
  }
}

/**
 * Obtém a lista de impressoras instaladas no sistema
 * Inclui ampla lista de impressoras térmicas como fallback
 * @returns {Promise<Array>} Lista de impressoras
 */
async function getPrinters() {
  try {
    log('Obtendo lista de impressoras');

    // Lista expandida de impressoras térmicas comuns como fallback
    const defaultPrinters = [
      // Impressoras Bematech
      { name: 'BEMATECH MP-4200 TH' },
      { name: 'BEMATECH MP-4000 TH' },
      { name: 'BEMATECH MP-100S TH' },
      { name: 'BEMATECH MP-2800 TH' },
      { name: 'BEMATECH MP-5100 TH' },
      { name: 'BEMATECH MP-2500 TH' },
      { name: 'BEMATECH MP-20 MI' },
      { name: 'BEMATECH MP-2100 TH' },
      { name: 'BEMATECH MP-4200' },
      { name: 'MP-4200 TH' },
      { name: 'MP-4000 TH' },
      { name: 'MP-2800 TH' },

      // Impressoras Epson
      { name: 'EPSON TM-T20' },
      { name: 'EPSON TM-T20II' },
      { name: 'EPSON TM-T20III' },
      { name: 'EPSON TM-T20X' },
      { name: 'EPSON TM-T88V' },
      { name: 'EPSON TM-T88VI' },
      { name: 'EPSON TM-T88VII' },
      { name: 'EPSON TM-m30' },
      { name: 'EPSON TM-m10' },
      { name: 'EPSON TM-m30II' },
      { name: 'EPSON TM-U220' },
      { name: 'EPSON L3210 Series' },
      { name: 'EPSON L3150 Series' },
      { name: 'TM-T20' },
      { name: 'TM-T88V' },
      { name: 'TM-T88VI' },

      // Impressoras Daruma
      { name: 'DARUMA DR800' },
      { name: 'DARUMA DR700' },
      { name: 'DARUMA DR600' },
      { name: 'DARUMA DS348' },
      { name: 'DARUMA DR2000' },
      { name: 'DARUMA DR3000' },
      { name: 'DR800' },
      { name: 'DR700' },

      // Impressoras Elgin
      { name: 'ELGIN i9' },
      { name: 'ELGIN i7' },
      { name: 'ELGIN i5' },
      { name: 'ELGIN VOX' },
      { name: 'ELGIN VOX+' },
      { name: 'ELGIN L42' },
      { name: 'ELGIN L42 PRO' },
      { name: 'ELGIN i9 USB' },
      { name: 'I9' },
      { name: 'I7' },

      // Impressoras Diebold
      { name: 'DIEBOLD TSP-143' },
      { name: 'DIEBOLD IM453' },
      { name: 'DIEBOLD IM433' },
      { name: 'DIEBOLD IM402' },

      // Impressoras Sweda
      { name: 'SWEDA SI-300' },
      { name: 'SWEDA SI-250' },
      { name: 'SWEDA SI-150' },

      // Impressoras Outros Fabricantes
      { name: 'GERTEC G250' },
      { name: 'GERTEC G280' },
      { name: 'TANCA TP-550' },
      { name: 'TANCA TP-650' },
      { name: 'TOSHIBA TRST-A00' },
      { name: 'EVADIN 80mm Printer' },
      { name: 'CONTROLID PRINT iD' },
      { name: 'CITIZEN CMP-20II' },
      { name: 'CITIZEN CMP-30II' },

      // Impressoras genéricas/drivers
      { name: 'POS-58' },
      { name: 'POS-80' },
      { name: 'Thermal Receipt Printer' },
      { name: 'Generic / Text Only' },
      { name: 'Impressora Térmica' },
      { name: 'Impressora Não Fiscal' },
      { name: 'Impressora POS' },
      { name: 'Impressora de Cupom' },

      // Impressoras PDF e XPS
      { name: 'Microsoft Print to PDF' },
      { name: 'Microsoft XPS Document Writer' },
      { name: 'PDFCreator' },
      { name: 'Fax' }
    ];

    try {
      // Tenta listar impressoras com WMIC (mais confiável)
      const { stdout } = await execPromise('wmic printer get name');
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);

      // Remove o cabeçalho "Name"
      if (lines.length > 0 && lines[0] === 'Name') {
        lines.shift();
      }

      // Converte para o formato esperado
      if (lines.length > 0) {
        const printers = lines.map(name => ({ name }));
        log(`${printers.length} impressoras encontradas via WMIC`);
        return printers;
      }
    } catch (wmicError) {
      log(`Erro ao listar impressoras com WMIC: ${wmicError.message}`);

      // Tenta com PowerShell como alternativa
      try {
        const { stdout } = await execPromise('powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"');
        const printers = stdout.split('\n').map(l => l.trim()).filter(Boolean).map(name => ({ name }));

        if (printers.length > 0) {
          log(`${printers.length} impressoras encontradas via PowerShell`);
          return printers;
        }
      } catch (psError) {
        log(`Erro ao listar impressoras com PowerShell: ${psError.message}`);
      }
    }

    // Retorna lista padrão expandida se não conseguir listar
    log('Usando lista padrão expandida de impressoras térmicas');
    return defaultPrinters;
  } catch (error) {
    log(`Erro geral ao listar impressoras: ${error.message}`);
    return defaultPrinters;
  }
}
/**
 * Imprime um pedido na impressora especificada
 * @param {Object} order - Dados do pedido
 * @param {string} printerName - Nome da impressora
 * @returns {Promise<boolean>} Sucesso da impressão
 */
async function printOrder(order, printerName) {
  try {
    log(`==== INICIANDO IMPRESSÃO DO PEDIDO #${order.id} ====`);
    log(`Impressora solicitada: ${printerName}`);

    // Salva a impressora padrão atual
    const defaultPrinter = await setDefaultPrinter(printerName);

    try {
      // Cria o arquivo com o conteúdo do pedido
      const orderFile = createOrderFile(order);

      // Imprime usando Notepad (método mais confiável)
      await printWithNotepad(orderFile);

      // Verifica se a impressão foi enviada para a fila
      const inQueue = await checkPrintQueue();

      if (inQueue) {
        log('Impressão enviada para a fila com sucesso!');
      } else {
        log('Aviso: Nenhum job encontrado na fila de impressão, mas isso nem sempre significa que falhou');
      }

      log(`==== IMPRESSÃO FINALIZADA PARA PEDIDO #${order.id} ====`);
      return true;
    } finally {
      // Restaura a impressora padrão anterior
      if (defaultPrinter) {
        log(`Restaurando impressora padrão anterior: ${defaultPrinter}`);
        await setDefaultPrinter(defaultPrinter);
      }
    }
  } catch (error) {
    log(`ERRO na impressão do pedido #${order.id}: ${error.message}`);
    throw error;
  }
}

/**
 * Imprime um teste
 * @param {Object} testOrder - Dados do pedido de teste
 * @param {string} printerName - Nome da impressora
 * @returns {Promise<boolean>} Sucesso da impressão
 */
async function printTest(testOrder, printerName) {
  return await printOrder(testOrder, printerName);
}

// Exporta as funções necessárias
module.exports = {
  getPrinters,
  printOrder,
  printTest
};