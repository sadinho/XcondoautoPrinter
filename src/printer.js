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
 * Configura o tamanho do papel da impressora
 * @param {string} printerName - Nome da impressora
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function configurePrinterPaperSize(printerName) {
  try {
    log(`Configurando tamanho do papel para impressora "${printerName}"`);

    // Executa um comando para configurar o tamanho do papel
    // Isso usa o DevMode via PowerShell para modificar a configuração
    const psCommand = `
      Add-Type -AssemblyName System.Drawing.Printing;
      $printers = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters;
      $found = $false;
      foreach ($printer in $printers) {
        if ($printer -eq "${printerName}") {
          $found = $true;
          $settings = New-Object System.Drawing.Printing.PrinterSettings;
          $settings.PrinterName = "${printerName}";
          $ticket = $settings.DefaultPageSettings;
          $ticket.PaperSize = New-Object System.Drawing.Printing.PaperSize("Custom", 800, 1100);
          break;
        }
      }
      if (-not $found) { Write-Output "Impressora não encontrada"; exit 1; }
      Write-Output "Configuração aplicada com sucesso";
    `;

    // Salva o comando em um arquivo temporário
    const psScriptPath = path.join(os.tmpdir(), 'configure_printer.ps1');
    fs.writeFileSync(psScriptPath, psCommand);

    // Executa o script PowerShell
    await execPromise(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`);

    log('Configuração do tamanho do papel aplicada com sucesso');
    return true;
  } catch (error) {
    log(`Erro ao configurar tamanho do papel: ${error.message}`);
    return false;
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
 * Cria um arquivo com o conteúdo do pedido com layout otimizado para economizar papel
 * @param {Object} order - Dados do pedido
 * @returns {string} Caminho do arquivo
 */
function createOrderFile(order) {
  try {
    log(`Criando arquivo para o pedido #${order.id}`);
    let contentWidth = 48; // Reduzido de 56 para 48 para economizar papel

    try {
      // Tenta obter o valor da configuração
      const config = require('./config.json');
      if (config && config.printWidth) {
        contentWidth = parseInt(config.printWidth);
        log(`Usando largura configurada: ${contentWidth} caracteres`);
      }
    } catch (configError) {
      log(`Erro ao carregar configuração de largura: ${configError.message}`);
    }

    // Criar diretório temporário se não existir
    const tempDir = path.join(os.tmpdir(), 'print-temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Formata a data do pedido
    const orderDate = new Date(order.date_created || new Date());
    const formattedDate = orderDate.toLocaleDateString('pt-BR');
    const formattedTime = orderDate.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Função para centralizar texto
    const centerText = (text) => {
      const spaces = Math.max(0, Math.floor((contentWidth - text.length) / 2));
      return ' '.repeat(spaces) + text;
    };

    // Função para abreviar métodos de pagamento
    const abbreviatePaymentMethod = (methodTitle, methodCode) => {
      // Mapeamento de abreviações comuns
      const abbreviations = {
        'Pagamento via PIX': 'PIX',
        'Pagar na entrega com cartão de débito/crédito': 'Cartão na entrega',
        'Cartão de crédito': 'Cartão crédito',
        'Cartão de débito': 'Cartão débito',
        'Boleto bancário': 'Boleto',
        'Transferência bancária': 'Transferência',
        'Pagamento na entrega': 'Na entrega',
        'Dinheiro na entrega': 'Dinheiro',
        'Mercado Pago': 'MP',
        'PayPal': 'PayPal',
        'PagSeguro': 'PagSeguro'
      };

      let abbreviated = methodTitle;

      // Verifica se existe uma abreviação específica
      if (abbreviations[methodTitle]) {
        abbreviated = abbreviations[methodTitle];
      } else {
        // Se a descrição for muito longa, trunca mantendo palavras-chave
        if (methodTitle && methodTitle.length > 25) {
          // Procura por palavras-chave importantes
          if (methodTitle.toLowerCase().includes('pix')) {
            abbreviated = 'PIX';
          } else if (methodTitle.toLowerCase().includes('cartão') && methodTitle.toLowerCase().includes('entrega')) {
            abbreviated = 'Cartão na entrega';
          } else if (methodTitle.toLowerCase().includes('cartão')) {
            abbreviated = methodTitle.toLowerCase().includes('débito') ? 'Cartão débito' : 'Cartão crédito';
          } else if (methodTitle.toLowerCase().includes('boleto')) {
            abbreviated = 'Boleto';
          } else if (methodTitle.toLowerCase().includes('entrega')) {
            abbreviated = 'Na entrega';
          } else {
            // Trunca para as primeiras 20 caracteres + "..."
            abbreviated = methodTitle.substring(0, 20) + '...';
          }
        }
      }

      return abbreviated;
    };

    // Separadores mais compactos
    const separator = '='.repeat(contentWidth);
    const lightSeparator = '-'.repeat(contentWidth);

    // Conteúdo do pedido formatado
    let content = '';

    // Cabeçalho compacto
    content += separator + '\n';
    content += centerText('NOVO PEDIDO - Xcondo Shop') + '\n';
    content += separator + '\n';

    // Informações básicas em uma linha
    content += `#${order.id} | ${formattedDate} ${formattedTime}\n`;
    if (order.number) {
      content += `Nº: ${order.number} | `;
    }
    if (order.status) {
      content += `Status: ${translateOrderStatus(order.status)}\n`;
    }

    // PAGAMENTO - Seção compacta
    content += lightSeparator + '\n';
    content += 'PAGAMENTO: ';

    if (order.payment_method_title) {
      const abbreviatedMethod = abbreviatePaymentMethod(order.payment_method_title, order.payment_method);
      content += abbreviatedMethod;
    } else if (order.payment_method) {
      content += order.payment_method.toUpperCase();
    }

    // Status do pagamento na mesma linha
    let paymentStatus = 'Não confirmado';
    if (order.date_paid) {
      const datePaid = new Date(order.date_paid);
      paymentStatus = `Pago em ${datePaid.toLocaleDateString('pt-BR')}`;
    } else if (order.status === 'processing' || order.status === 'completed') {
      paymentStatus = 'Confirmado';
    } else if (order.status === 'on-hold') {
      paymentStatus = 'Aguardando';
    } else if (order.status === 'failed') {
      paymentStatus = 'Falhou';
    } else if (order.status === 'pending') {
      paymentStatus = 'Pendente';
    } else if (order.status === 'refunded') {
      paymentStatus = 'Reembolsado';
    }

    content += ` | ${paymentStatus}`;

    // Transação se disponível
    if (order.transaction_id) {
      content += ` | ID: ${order.transaction_id}`;
    }

    // Verificar se tem informações úteis de pagamento nos metadados
    if (order.meta_data) {
      const paymentMeta = order.meta_data.filter(m => {
        // Filtrar apenas metadados úteis de pagamento
        const isPaymentRelated = (
          m.key.includes('payment') ||
          m.key.includes('_paid') ||
          m.key.includes('transaction')
        );

        // Excluir metadados inúteis ou objetos complexos
        const isUseful = (
          !m.key.includes('dokan_commission') &&
          !m.key.includes('_dokan_') &&
          typeof m.value === 'string' &&
          m.value !== '[object Object]' &&
          m.value.length > 0 &&
          m.value.length < 100 // Evitar valores muito longos
        );

        return isPaymentRelated && isUseful;
      });

      // Só exibe se houver metadados realmente úteis
      if (paymentMeta.length > 0) {
        const additionalInfo = paymentMeta.map(meta => {
          const keyName = meta.key
            .replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .trim();
          return `${keyName}: ${meta.value}`;
        }).join(' | ');

        if (additionalInfo) {
          content += ` | ${additionalInfo}`;
        }
      }
    }

    content += '\n';

    // CLIENTE - Informações condensadas
    content += lightSeparator + '\n';
    content += 'CLIENTE:\n';

    if (order.billing) {
      // Nome e contato em uma linha
      content += `${order.billing.first_name || ''} ${order.billing.last_name || ''}`;
      if (order.billing.phone) {
        content += ` | ${order.billing.phone}`;
      }
      content += '\n';

      if (order.billing.email) {
        content += `${order.billing.email}\n`;
      }

      // Endereço compacto
      let addressParts = [];
      if (order.billing.address_1) addressParts.push(order.billing.address_1);
      if (order.billing.address_2) addressParts.push(order.billing.address_2);
      if (order.billing.neighborhood) addressParts.push(order.billing.neighborhood);

      if (addressParts.length > 0) {
        content += `${addressParts.join(', ')}\n`;
      }

      // Cidade, Estado, CEP em uma linha
      let locationParts = [];
      if (order.billing.city) locationParts.push(order.billing.city);
      if (order.billing.state) locationParts.push(order.billing.state);
      if (order.billing.postcode) locationParts.push(`CEP: ${order.billing.postcode}`);

      if (locationParts.length > 0) {
        content += `${locationParts.join(' | ')}\n`;
      }
    }

    // VENDEDOR (se aplicável) - mais compacto
    if (order.store_name || (order.meta_data && order.meta_data.find(m => m.key === '_dokan_vendor_id'))) {
      content += `Loja: ${order.store_name || 'N/A'}`;

      if (order.meta_data) {
        const vendorIdMeta = order.meta_data.find(m => m.key === '_dokan_vendor_id');
        if (vendorIdMeta) {
          content += ` | ID: ${vendorIdMeta.value}`;
        }
      }
      content += '\n';
    }

    // ITENS - Layout mais compacto
    content += lightSeparator + '\n';
    content += 'ITENS:\n';

    if (order.line_items && order.line_items.length > 0) {
      for (const item of order.line_items) {
        // Linha principal: Qtd, Nome, Código (se houver)
        let itemLine = `${item.quantity || 1}x ${item.name || 'Produto'}`;

        // Adicionar código/SKU do produto se disponível
        if (item.sku) {
          itemLine += ` [${item.sku}]`;
        } else if (item.product_id) {
          itemLine += ` [ID:${item.product_id}]`;
        }

        content += `${itemLine}\n`;

        // // Variações em linha única (se houver)
        // if (item.meta_data && item.meta_data.length > 0) {
        //   const variations = item.meta_data
        //     .filter(meta => !meta.key.startsWith('_'))
        //     .map(meta => `${meta.key}: ${meta.value}`)
        //     .join(' | ');

        //   if (variations) {
        //     content += `  ${variations}\n`;
        //   }
        // }

        // Preços na mesma linha
        let priceInfo = [];
        if (item.price) {
          priceInfo.push(`Unit: R$ ${parseFloat(item.price).toFixed(2)}`);
        }
        if (item.subtotal) {
          priceInfo.push(`Total: R$ ${parseFloat(item.subtotal).toFixed(2)}`);
        }

        if (priceInfo.length > 0) {
          content += `  ${priceInfo.join(' | ')}\n`;
        }
      }
    } else {
      content += 'Nenhum item\n';
    }

    // RESUMO FINANCEIRO - Uma linha cada
    content += lightSeparator + '\n';

    // Valores em formato compacto
    const financialItems = [];

    if (order.subtotal) {
      financialItems.push(`Subtotal: R$ ${parseFloat(order.subtotal).toFixed(2)}`);
    }

    if (order.shipping_total && parseFloat(order.shipping_total) > 0) {
      financialItems.push(`Frete: R$ ${parseFloat(order.shipping_total).toFixed(2)}`);
    }

    if (order.discount_total && parseFloat(order.discount_total) > 0) {
      financialItems.push(`Desconto: -R$ ${parseFloat(order.discount_total).toFixed(2)}`);
    }

    if (order.total_tax && parseFloat(order.total_tax) > 0) {
      financialItems.push(`Impostos: R$ ${parseFloat(order.total_tax).toFixed(2)}`);
    }

    // Mostrar itens financeiros em uma ou duas linhas
    if (financialItems.length > 0) {
      content += financialItems.join(' | ') + '\n';
    }

    // Total destacado
    content += `TOTAL: R$ ${parseFloat(order.total || 0).toFixed(2)}\n`;

    // ENVIO (se disponível) - formato compacto
    if (order.shipping_lines && order.shipping_lines.length > 0) {
      const shippingInfo = order.shipping_lines.map(shipping => {
        let info = shipping.method_title || 'Envio';
        if (shipping.total && parseFloat(shipping.total) > 0) {
          info += ` (R$ ${parseFloat(shipping.total).toFixed(2)})`;
        }
        return info;
      }).join(' | ');

      content += `Envio: ${shippingInfo}\n`;
    }

    // OBSERVAÇÕES (se houver)
    if (order.customer_note) {
      content += `Obs: ${order.customer_note}\n`;
    }

    // Rodapé minimalista
    content += separator + '\n';
    content += `Impresso: ${new Date().toLocaleString('pt-BR')}\n`;

    // Apenas 3 linhas em branco para corte (reduzido de 10)
    content += '\n\n\n';

    // Caminho do arquivo
    const filePath = path.join(tempDir, `order-${order.id}-${Date.now()}.txt`);

    // Salvar conteúdo no arquivo
    fs.writeFileSync(filePath, content, 'utf8');

    log(`Arquivo otimizado criado: ${filePath}`);
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

    // Tenta configurar o tamanho do papel (opcional)
    await configurePrinterPaperSize(printerName);

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