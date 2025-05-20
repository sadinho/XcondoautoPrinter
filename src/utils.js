const fs = require('fs');
const path = require('path');
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
    new winston.transports.File({ filename: 'utils-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'utils.log' })
  ]
});

/**
 * Converte o timestamp ISO para uma data formatada em PT-BR
 * @param {string} isoTimestamp - Timestamp ISO 8601
 * @returns {string} Data formatada
 */
function formatDate(isoTimestamp) {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR');
  } catch (error) {
    logger.error(`Erro ao formatar data ${isoTimestamp}: ${error.message}`);
    return isoTimestamp; // Retorna o original em caso de erro
  }
}

/**
 * Formata valores monetários
 * @param {string|number} value - Valor a ser formatado
 * @returns {string} Valor formatado como moeda BRL
 */
function formatCurrency(value) {
  try {
    const numValue = parseFloat(value);
    return numValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch (error) {
    logger.error(`Erro ao formatar valor monetário ${value}: ${error.message}`);
    return `R$ ${value}`; // Fallback em caso de erro
  }
}

/**
 * Garante que um diretório existe, criando-o se necessário
 * @param {string} dirPath - Caminho do diretório
 * @returns {boolean} Verdadeiro se o diretório existe ou foi criado
 */
function ensureDirectoryExists(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Diretório criado: ${dirPath}`);
    }
    return true;
  } catch (error) {
    logger.error(`Erro ao criar diretório ${dirPath}: ${error.message}`);
    return false;
  }
}

/**
 * Traduz o status do pedido para português
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
    'failed': 'Falhou'
  };
  
  return statusMap[status] || status;
}

/**
 * Valida se uma URL está no formato correto
 * @param {string} url - URL a ser validada
 * @returns {boolean} Verdadeiro se a URL for válida
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Verifica se a conexão com a Internet está ativa
 * @returns {Promise<boolean>} Verdadeiro se estiver conectado
 */
async function checkInternetConnection() {
  try {
    const { default: isOnline } = await import('is-online');
    return await isOnline();
  } catch (error) {
    logger.error(`Erro ao verificar conexão com a Internet: ${error.message}`);
    return false;
  }
}

/**
 * Salva um log do pedido para histórico
 * @param {Object} order - Dados do pedido
 * @param {string} printStatus - Status da impressão (success, failed, pending)
 * @returns {boolean} Sucesso da operação
 */
function saveOrderLog(order, printStatus = 'success') {
  try {
    // Garante que o diretório de logs existe
    const logDir = path.join(process.cwd(), 'logs', 'orders');
    ensureDirectoryExists(logDir);
    
    // Nome do arquivo baseado na data e ID do pedido
    const now = new Date();
    const fileName = `${now.toISOString().split('T')[0]}_order_${order.id}.json`;
    const filePath = path.join(logDir, fileName);
    
    // Adiciona timestamp da impressão e status
    const orderWithTimestamp = {
      ...order,
      printed_at: now.toISOString(),
      print_status: printStatus
    };
    
    // Salva o arquivo
    fs.writeFileSync(filePath, JSON.stringify(orderWithTimestamp, null, 2));
    logger.info(`Log do pedido #${order.id} salvo em ${filePath}`);
    return true;
  } catch (error) {
    logger.error(`Erro ao salvar log do pedido #${order.id}: ${error.message}`);
    return false;
  }
}

/**
 * Carrega o histórico de pedidos do armazenamento local
 * @returns {Array} Array de pedidos
 */
function loadOrderHistory() {
  try {
    const logDir = path.join(process.cwd(), 'logs', 'orders');
    
    // Se o diretório não existe, retorne um array vazio
    if (!fs.existsSync(logDir)) {
      return [];
    }
    
    // Obtém a lista de arquivos de log
    const files = fs.readdirSync(logDir).filter(file => file.endsWith('.json'));
    
    // Carrega os arquivos mais recentes (máximo de 50)
    const orders = [];
    const sortedFiles = files.sort().reverse().slice(0, 50);
    
    for (const file of sortedFiles) {
      const filePath = path.join(logDir, file);
      const orderData = fs.readFileSync(filePath, 'utf8');
      try {
        const order = JSON.parse(orderData);
        orders.push(order);
      } catch (parseError) {
        logger.error(`Erro ao analisar arquivo de log ${file}: ${parseError.message}`);
      }
    }
    
    logger.info(`Carregados ${orders.length} pedidos do histórico`);
    return orders;
  } catch (error) {
    logger.error(`Erro ao carregar histórico de pedidos: ${error.message}`);
    return [];
  }
}

/**
 * Limpa o histórico de pedidos mais antigos que o número de dias especificado
 * @param {number} days - Número de dias para manter o histórico (padrão: 7)
 * @returns {number} Número de arquivos removidos
 */
function cleanOrderHistory(days = 7) {
  try {
    const logDir = path.join(process.cwd(), 'logs', 'orders');
    
    // Se o diretório não existe, retorne 0
    if (!fs.existsSync(logDir)) {
      return 0;
    }
    
    // Obtém a lista de arquivos de log
    const files = fs.readdirSync(logDir).filter(file => file.endsWith('.json'));
    let removedCount = 0;
    
    // Se days for 0, remove todos os arquivos (limpeza completa)
    if (days === 0) {
      for (const file of files) {
        fs.unlinkSync(path.join(logDir, file));
        removedCount++;
      }
      
      logger.info(`Limpeza completa do histórico: ${removedCount} arquivos removidos`);
      return removedCount;
    }
    
    // Data limite (hoje menos o número de dias)
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - days);
    
    for (const file of files) {
      try {
        // Extrai a data do nome do arquivo (formato: YYYY-MM-DD_order_XXX.json)
        const datePart = file.split('_')[0];
        const fileDate = new Date(datePart);
        
        // Se a data do arquivo for anterior à data limite, remove o arquivo
        if (fileDate < limitDate) {
          fs.unlinkSync(path.join(logDir, file));
          removedCount++;
        }
      } catch (parseError) {
        logger.error(`Erro ao processar arquivo ${file} durante limpeza: ${parseError.message}`);
      }
    }
    
    logger.info(`Limpeza de histórico: ${removedCount} arquivos removidos (mais antigos que ${days} dias)`);
    return removedCount;
  } catch (error) {
    logger.error(`Erro ao limpar histórico de pedidos: ${error.message}`);
    return 0;
  }
}

/**
 * Gera uma senha baseada na data atual
 * A senha muda diariamente
 * @returns {string} A senha do dia
 */
function generateDailyPassword() {
  // Obter a data atual
  const now = new Date();
  
  // Usar o ano, mês e dia como base para a senha
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // Mês começa em 0
  const day = now.getDate();
  
  // Palavra-base para a senha (pode ser alterada para qualquer palavra)
  const baseWord = "suporte";
  
  // Criar uma semente baseada na data
  const seed = (year * 10000) + (month * 100) + day;
  
  // Função simples de hash para converter a semente em string
  function simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.toString().length; i++) {
      const char = input.toString().charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Converter para inteiro de 32 bits
    }
    return Math.abs(hash);
  }
  
  // Gerar um número a partir da semente
  const hashValue = simpleHash(seed);
  
  // Converter o hash para uma string alfanumérica usando uma base simples
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  let tempHash = hashValue;
  
  // Pegar 4 caracteres do alfabeto baseado no hash
  for (let i = 0; i < 4; i++) {
    const index = tempHash % alphabet.length;
    result += alphabet[index];
    tempHash = Math.floor(tempHash / alphabet.length);
  }
  
  // Combinar a palavra base com o resultado do hash
  return `${baseWord}${result}`;
}

/**
 * Verifica se a senha fornecida corresponde à senha do dia
 * @param {string} password - A senha a ser verificada
 * @returns {boolean} Verdadeiro se a senha estiver correta
 */
function verifyDailyPassword(password) {
  const dailyPassword = generateDailyPassword();
  return password === dailyPassword;
}
// Exporta as funções
module.exports = {
  formatDate,
  formatCurrency,
  ensureDirectoryExists,
  translateOrderStatus,
  isValidUrl,
  checkInternetConnection,
  saveOrderLog,
  loadOrderHistory,
  cleanOrderHistory,
  generateDailyPassword,
  verifyDailyPassword
};