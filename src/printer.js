const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const winston = require('winston');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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
    new winston.transports.File({ filename: 'printer-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'printer.log' })
  ]
});

/**
 * Codifica texto para impressão térmica garantindo compatibilidade com acentos
 * @param {string} text - Texto a ser codificado
 * @returns {string} Texto codificado
 */
function encodeText(text) {
  if (!text) return '';
  
  // Mapeamento de caracteres acentuados para equivalentes sem acento
  const accentMap = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c',
    'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A',
    'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
    'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
    'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O',
    'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
    'Ç': 'C'
  };
  
  return text.replace(/[áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ]/g, 
    match => accentMap[match] || match);
}

/**
 * Obtém a lista de impressoras instaladas no sistema
 * @returns {Promise<Array>} Lista de impressoras
 */
async function getPrinters() {
  try {
    const platform = os.platform();
    let printers = [];
    
    if (platform === 'win32') {
      // Windows - tentando múltiplos métodos em ordem de preferência
      
      // Método 1: Usando PowerShell (mais confiável e disponível em todas as versões do Windows 10)
      try {
        logger.info('Tentando obter impressoras via PowerShell');
        const { stdout } = await execPromise('powershell.exe -command "Get-Printer | Select-Object -ExpandProperty Name"');
        printers = stdout
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(name => ({ name }));
          
        if (printers.length > 0) {
          logger.info(`Encontradas ${printers.length} impressoras via PowerShell`);
          return printers;
        }
      } catch (powershellError) {
        logger.warn(`Erro ao usar PowerShell para listar impressoras: ${powershellError.message}, tentando próximo método...`);
      }
      
      // Método 2: Tentando WMIC (disponível em algumas versões do Windows)
      try {
        logger.info('Tentando obter impressoras via WMIC');
        const { stdout } = await execPromise('wmic printer get name');
        const wmicPrinters = stdout
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && line !== 'Name')
          .map(name => ({ name }));
          
        if (wmicPrinters.length > 0) {
          logger.info(`Encontradas ${wmicPrinters.length} impressoras via WMIC`);
          return wmicPrinters;
        }
      } catch (wmicError) {
        logger.warn(`Erro ao usar WMIC: ${wmicError.message}, tentando próximo método...`);
      }
      
      // Método 3: Método de fallback - retornar uma lista de impressoras comuns
      logger.warn('Nenhum método automático funcionou. Retornando lista de impressoras térmicas comuns');
      return [
        { name: 'MP-4200 TH' },
        { name: 'EPSON TM-T20' },
        { name: 'EPSON TM-T88V' },
        { name: 'EPSON TM-T88VI' },
        { name: 'BEMATECH MP-4200' },
        { name: 'BEMATECH MP-100S' },
        { name: 'ELGIN i9' },
        { name: 'ELGIN i7' },
        { name: 'DARUMA DR800' },
        { name: 'Impressora Térmica' }
      ];
      
    } else if (platform === 'darwin') {
      // macOS
      try {
        const { stdout } = await execPromise('lpstat -p | awk \'{print $2}\'');
        printers = stdout
          .split('\n')
          .filter(Boolean)
          .map(name => ({ name }));
      } catch (error) {
        logger.error(`Erro ao listar impressoras no macOS: ${error.message}`);
        return [];
      }
    } else {
      // Linux e outros
      try {
        const { stdout } = await execPromise('lpstat -a | cut -d \' \' -f1');
        printers = stdout
          .split('\n')
          .filter(Boolean)
          .map(name => ({ name }));
      } catch (error) {
        logger.error(`Erro ao listar impressoras no Linux: ${error.message}`);
        return [];
      }
    }
    
    logger.info(`Encontradas ${printers.length} impressoras no sistema`);
    return printers;
  } catch (error) {
    logger.error(`Erro ao obter lista de impressoras: ${error.message}`);
    // Retorna um array vazio ao invés de lançar erro
    return [];
  }
}

/**
 * Detecta o tipo da impressora com base no nome
 * @param {string} printerName - Nome da impressora
 * @returns {string} Tipo da impressora (EPSON, BEMATECH, GENERIC)
 */
function detectPrinterType(printerName) {
  const name = printerName.toLowerCase();
  
  if (name.includes('epson') || name.includes('tm-')) {
    return 'EPSON';
  }
  
  if (name.includes('bematech') || name.includes('mp-')) {
    return 'BEMATECH';
  }
  
  return 'GENERIC';
}

/**
 * Inicializa a impressora com as configurações adequadas
 * @param {string} printerName - Nome da impressora
 * @returns {ThermalPrinter} Instância da impressora
 */
function initializePrinter(printerName) {
  try {
    const printerType = detectPrinterType(printerName);
    
    let type;
    switch (printerType) {
      case 'EPSON':
        type = PrinterTypes.EPSON;
        break;
      case 'BEMATECH':
        type = PrinterTypes.BEMATECH;
        break;
      default:
        type = PrinterTypes.EPSON; // Fallback para EPSON como padrão
    }
    
    logger.info(`Inicializando impressora ${printerName} do tipo ${printerType}`);
    
    // Configuração mais simples e robusta
    const printer = new ThermalPrinter({
      type,
      interface: printerName,
      width: 42,                    // 42 colunas padrão para impressoras térmicas de 80mm
      characterSet: 'PC850_MULTILINGUAL',
      removeSpecialCharacters: false,
      lineCharacter: '-',
      options: {
        timeout: 5000               // Timeout de 5 segundos para prevenir travamentos
      },
      driver: {
        windows: true
      }
    });
    
    return printer;
  } catch (error) {
    logger.error(`Erro ao inicializar impressora ${printerName}: ${error.message}`);
    throw error;
  }
}

/**
 * Método 1: Impressão usando arquivo de texto simples e comando COPY
 * Este é o método mais simples e direto possível
 */
async function printWithCopy(order, printerName) {
  try {
    logger.info(`Tentando imprimir pedido #${order.id} usando método COPY`);
    
    // Cria um texto simples para impressão
    let content = '';
    content += '================================================\n';
    content += '              NOVO PEDIDO  XCondo Shop                     \n';
    content += '================================================\n';
    content += `PEDIDO #${order.id}\n`;
    content += `Data: ${new Date(order.date_created).toLocaleDateString('pt-BR')}\n`;
    content += '------------------------------------------------\n';
    content += 'CLIENTE:\n';
    if (order.billing) {
      content += `${order.billing.first_name || ''} ${order.billing.last_name || ''}\n`;
      if (order.billing.phone) content += `Tel: ${order.billing.phone}\n`;
      if (order.billing.address_1) content += `End: ${order.billing.address_1}\n`;
    }
    content += '------------------------------------------------\n';
    content += 'ITENS:\n';
    if (order.line_items && order.line_items.length > 0) {
      for (const item of order.line_items) {
        content += `${item.quantity || 1}x ${item.name || 'Produto'}\n`;
        if (item.subtotal) {
          content += `R$ ${parseFloat(item.subtotal).toFixed(2)}\n`;
        }
      }
    }
    content += '------------------------------------------------\n';
    content += `TOTAL: R$ ${parseFloat(order.total || 0).toFixed(2)}\n`;
    content += '================================================\n';
    content += '\n\n\n\n\n'; // Espaçamento para corte
    
    // Salva em arquivo temporário
    const tempFile = path.join(os.tmpdir(), `pedido-${order.id}.txt`);
    fs.writeFileSync(tempFile, content, 'utf8');
    
    // Tenta imprimir usando comando COPY direto para a impressora
    try {
      await execPromise(`copy "${tempFile}" "${printerName}"`);
      logger.info(`Impressão com COPY bem-sucedida para pedido #${order.id}`);
      return true;
    } catch (copyError) {
      logger.warn(`COPY falhou: ${copyError.message}`);
      throw copyError;
    }
  } catch (error) {
    logger.error(`Erro no método COPY: ${error.message}`);
    throw error;
  }
}

/**
 * Método 2: Impressão usando PowerShell de forma mais direta
 */
async function printWithPowerShell(order, printerName) {
  try {
    logger.info(`Tentando imprimir pedido #${order.id} usando PowerShell`);
    
    // Cria conteúdo simples
    const content = `
NOVO PEDIDO
================================================
PEDIDO #${order.id}
Data: ${new Date(order.date_created).toLocaleDateString('pt-BR')}

CLIENTE: ${order.billing ? `${order.billing.first_name || ''} ${order.billing.last_name || ''}` : 'N/A'}
TOTAL: R$ ${parseFloat(order.total || 0).toFixed(2)}
================================================
    `;
    
    // Salva em arquivo
    const tempFile = path.join(os.tmpdir(), `pedido-${order.id}.txt`);
    fs.writeFileSync(tempFile, content, 'utf8');
    
    // Comando PowerShell para imprimir
    const psCommand = `
      $printer = "${printerName}"
      $file = "${tempFile.replace(/\\/g, '\\\\')}"
      
      # Tenta definir como impressora padrão temporariamente
      $defaultPrinter = Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Default = $true"
      (Get-WmiObject -ComputerName . -Class Win32_Printer -Filter "Name='$printer'").SetDefaultPrinter()
      
      # Imprime o arquivo
      cmd /c print "$file"
      
      # Restaura impressora padrão
      if ($defaultPrinter) {
        $defaultPrinter.SetDefaultPrinter()
      }
    `;
    
    const psFile = path.join(os.tmpdir(), `print-script-${Date.now()}.ps1`);
    fs.writeFileSync(psFile, psCommand, 'utf8');
    
    await execPromise(`powershell -ExecutionPolicy Bypass -File "${psFile}"`);
    logger.info(`Impressão com PowerShell bem-sucedida para pedido #${order.id}`);
    return true;
  } catch (error) {
    logger.error(`Erro no método PowerShell: ${error.message}`);
    throw error;
  }
}

/**
 * Método 3: Força a impressora a ser a padrão e usa comando PRINT
 */
async function printAsDefault(order, printerName) {
  try {
    logger.info(`Tentando imprimir pedido #${order.id} definindo como impressora padrão`);
    
    // Primeiro, salva qual é a impressora padrão atual
    let currentDefault = '';
    try {
      const { stdout } = await execPromise('wmic printer where default=true get name /value');
      const match = stdout.match(/Name=(.+)/);
      if (match) {
        currentDefault = match[1].trim();
      }
    } catch (err) {
      logger.warn('Erro ao obter impressora padrão atual:', err.message);
    }
    
    // Define nossa impressora como padrão
    await execPromise(`wmic printer where name="${printerName}" call setdefaultprinter`);
    
    // Cria arquivo de texto
    const content = `
PEDIDO #${order.id}
Data: ${new Date().toLocaleDateString('pt-BR')}
Cliente: ${order.billing ? `${order.billing.first_name || ''} ${order.billing.last_name || ''}` : 'N/A'}
Total: R$ ${parseFloat(order.total || 0).toFixed(2)}
    `;
    
    const tempFile = path.join(os.tmpdir(), `pedido-${order.id}.txt`);
    fs.writeFileSync(tempFile, content, 'utf8');
    
    // Imprime usando comando PRINT (que usa a impressora padrão)
    await execPromise(`print "${tempFile}"`);
    
    // Restaura a impressora padrão anterior
    if (currentDefault) {
      try {
        await execPromise(`wmic printer where name="${currentDefault}" call setdefaultprinter`);
      } catch (restoreError) {
        logger.warn('Aviso: Não foi possível restaurar impressora padrão anterior');
      }
    }
    
    logger.info(`Impressão como padrão bem-sucedida para pedido #${order.id}`);
    return true;
  } catch (error) {
    logger.error(`Erro no método impressora padrão: ${error.message}`);
    throw error;
  }
}

/**
 * Método 4: Usa o método original com thermal-printer
 */
async function printWithThermalPrinter(order, printerName) {
  try {
    logger.info(`Tentando imprimir pedido #${order.id} usando thermal-printer`);
    const printer = initializePrinter(printerName);
    
    // Configuração básica
    printer.alignCenter();
    printer.bold(true);
    printer.println("NOVO PEDIDO");
    printer.bold(false);
    printer.println("--------------------------------");
    
    // Informações do pedido
    printer.bold(true);
    printer.println(`PEDIDO #${order.id}`);
    printer.bold(false);
    
    // Data
    const orderDate = new Date(order.date_created);
    printer.println(`Data: ${orderDate.toLocaleDateString('pt-BR')} ${orderDate.toLocaleTimeString('pt-BR')}`);
    printer.println("--------------------------------");
    
    // Cliente
    printer.bold(true);
    printer.println("CLIENTE");
    printer.bold(false);
    
    if (order.billing) {
      printer.println(`Nome: ${order.billing.first_name || ''} ${order.billing.last_name || ''}`);
      if (order.billing.phone) printer.println(`Telefone: ${order.billing.phone}`);
      if (order.billing.address_1) printer.println(`Endereco: ${order.billing.address_1}`);
    }
    
    printer.println("--------------------------------");
    
    // Itens
    printer.bold(true);
    printer.println("ITENS DO PEDIDO");
    printer.bold(false);
    
    if (order.line_items && order.line_items.length > 0) {
      for (const item of order.line_items) {
        printer.println(`${item.quantity || 1}x ${item.name || 'Produto'}`);
        if (item.subtotal) {
          printer.alignRight();
          printer.println(`R$ ${parseFloat(item.subtotal).toFixed(2)}`);
          printer.alignLeft();
        }
      }
    }
    
    printer.println("--------------------------------");
    
    // Total
    printer.bold(true);
    printer.println(`TOTAL: R$ ${parseFloat(order.total || 0).toFixed(2)}`);
    printer.bold(false);
    
    // Data da impressão
    printer.println("--------------------------------");
    const now = new Date();
    printer.alignCenter();
    printer.println(`Impresso em: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`);
    
    // Corta o papel
    printer.cut();
    
    // Tentativa de impressão com timeout
    const success = await Promise.race([
      printer.execute().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000))
    ]);
    
    if (!success) {
      throw new Error('Timeout na execução da impressão');
    }
    
    logger.info(`Impressão com thermal-printer bem-sucedida para pedido #${order.id}`);
    return true;
  } catch (error) {
    logger.error(`Erro no método thermal-printer: ${error.message}`);
    throw error;
  }
}

/**
 * Função principal que tenta todos os métodos simples
 * Esta é a função que substitui a printOrder original
 */
async function printOrder(order, printerName) {
  logger.info(`=== INICIANDO IMPRESSÃO DO PEDIDO #${order.id} ===`);
  
  // Lista dos métodos que vamos tentar, em ordem
  const methods = [
    { name: 'COPY direto', func: printWithCopy },
    { name: 'PowerShell', func: printWithPowerShell },
    { name: 'Impressora padrão', func: printAsDefault },
    { name: 'Thermal Printer', func: printWithThermalPrinter }
  ];
  
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    logger.info(`Tentativa ${i + 1}: Usando método ${method.name}`);
    
    try {
      const success = await method.func(order, printerName);
      if (success) {
        logger.info(`✓ SUCESSO! Pedido #${order.id} foi impresso usando ${method.name}`);
        return true;
      }
    } catch (error) {
      logger.error(`✗ Método ${method.name} falhou: ${error.message}`);
      
      // Se for o último método, mostra erro final
      if (i === methods.length - 1) {
        logger.error(`=== TODOS OS MÉTODOS FALHARAM PARA PEDIDO #${order.id} ===`);
        throw new Error(`Não foi possível imprimir o pedido #${order.id}. Todos os métodos falharam.`);
      } else {
        logger.info(`Tentando próximo método...`);
      }
    }
  }
  
  return false;
}

/**
 * Imprime um teste para verificar a conexão com a impressora
 * @param {Object} testOrder - Dados do pedido de teste
 * @param {string} printerName - Nome da impressora
 * @returns {Promise<boolean>} Sucesso da impressão
 */
async function printTest(testOrder, printerName) {
  try {
    logger.info(`Iniciando teste de impressão na impressora ${printerName}`);
    
    // Chama a função principal de impressão
    const success = await printOrder(testOrder, printerName);
    
    if (success) {
      logger.info(`Teste de impressão na impressora ${printerName} concluído com sucesso`);
      return true;
    } else {
      throw new Error(`Teste de impressão na impressora ${printerName} falhou por razão desconhecida`);
    }
  } catch (error) {
    logger.error(`Erro no teste de impressão: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getPrinters,
  printOrder,
  printTest
};