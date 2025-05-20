const axios = require('axios');
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
    new winston.transports.File({ filename: 'api-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'api.log' })
  ]
});

// Variáveis globais
let isListening = false;
let intervalId = null;
let lastOrderTimestamp = null;

/**
 * Inicia o monitoramento de pedidos para um vendedor específico
 * @param {Object} config - Configurações da API e do vendedor
 * @param {Function} callback - Função a ser chamada quando um novo pedido for encontrado
 */
function startOrderListener(config, callback) {
  if (isListening) {
    stopOrderListener();
  }

  isListening = true;

  // Inicializa o conjunto global de pedidos processados se não existir
  if (!global.processedOrders) {
    global.processedOrders = new Set();
  }

  logger.info(`Monitoramento iniciado para o vendedor ${config.vendorId} com intervalo de ${config.checkInterval} segundos`);

  // Primeira verificação imediata
  checkForNewOrders(config, callback);

  // Configuração do intervalo
  const intervalMs = (config.checkInterval || 60) * 1000;
  intervalId = setInterval(() => {
    checkForNewOrders(config, callback);
  }, intervalMs);

  return true;
}

/**
 * Para o monitoramento de pedidos
 */
function stopOrderListener() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // Limpa o cache de pedidos processados
  if (global.processedOrders) {
    logger.info(`Limpando cache de ${global.processedOrders.size} pedidos processados`);
    global.processedOrders.clear();
  }

  isListening = false;
  logger.info('Monitoramento de pedidos parado');

  return true;
}
/**
 * Verifica se há novos pedidos
 * @param {Object} config - Configurações da API e do vendedor
 * @param {Function} callback - Função a ser chamada quando um novo pedido for encontrado
 */
async function checkForNewOrders(config, callback) {
  try {
    // Parâmetros para a API do WooCommerce - sem filtro de data
    const apiParams = {
      per_page: 20, // Aumentamos o limite para garantir que pegamos todos os pedidos recentes
      status: 'processing', // Filtra apenas pedidos em processamento
      vendor_id: config.vendorId // Filtra apenas pedidos do vendedor especificado
    };

    // Conjunto para armazenar IDs de pedidos já processados
    if (!global.processedOrders) {
      global.processedOrders = new Set();
    }

    // Obtém os pedidos recentes
    logger.info(`Verificando novos pedidos...`);
    const orders = await getWooCommerceOrders(config, apiParams);
    logger.info(`Encontrados ${orders.length} pedidos em processamento`);

    if (orders.length > 0) {
      // Filtra para obter apenas pedidos que ainda não foram processados
      const newOrders = orders.filter(order => !global.processedOrders.has(order.id));
      
      if (newOrders.length > 0) {
        logger.info(`${newOrders.length} novos pedidos encontrados`);

        // Processa cada novo pedido
        for (const order of newOrders) {
          // Marca o pedido como processado para evitar duplicação
          global.processedOrders.add(order.id);
          
          // Registra o pedido encontrado
          logger.info(`Processando pedido #${order.id} para o vendedor ${config.vendorId}`);
          
          // Chama o callback com o pedido
          callback(order);
        }
        
        // Se houver muitos pedidos no conjunto, podemos limpar os mais antigos
        // para evitar consumo excessivo de memória ao longo do tempo
        if (global.processedOrders.size > 1000) {
          logger.info(`Limpando cache de pedidos processados (tamanho: ${global.processedOrders.size})`);
          // Convertemos para array, pegamos os 500 mais recentes, e recriamos o conjunto
          const ordersArray = Array.from(global.processedOrders);
          global.processedOrders = new Set(ordersArray.slice(-500));
          logger.info(`Cache de pedidos reduzido para ${global.processedOrders.size} itens`);
        }
      } else {
        logger.info('Nenhum novo pedido encontrado');
      }
    } else {
      logger.info('Nenhum pedido em processamento encontrado');
    }
  } catch (error) {
    logger.error(`Erro ao verificar novos pedidos: ${error.message}`);
    if (error.response) {
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
  }
}

/**
 * Obtém pedidos do WooCommerce
 * @param {Object} config - Configurações da API
 * @param {Object} params - Parâmetros da consulta
 * @returns {Array} Lista de pedidos
 */
async function getWooCommerceOrders(config, params = {}) {
  try {
    const url = `${config.apiUrl}/wp-json/wc/v3/orders`;

    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');

    const response = await axios.get(url, {
      params: params,
      headers: {
        'Authorization': `Basic ${token}`
      }
    });

    return response.data;
  } catch (error) {
    logger.error(`Erro ao obter pedidos do WooCommerce: ${error.message}`);
    if (error.response) {
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Obtém detalhes completos de um pedido específico
 * @param {Object} config - Configurações da API
 * @param {number} orderId - ID do pedido
 * @returns {Object} Detalhes do pedido
 */
async function getOrderDetails(config, orderId) {
  console.log(`Obtendo detalhes do pedido #${orderId}`);
  try {
    const url = `${config.apiUrl}/wp-json/wc/v3/orders/${orderId}`;
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${token}`
      }
    });

    return response.data;
  } catch (error) {
    logger.error(`Erro ao obter detalhes do pedido #${orderId}: ${error.message}`);
    if (error.response) {
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = {
  startOrderListener,
  stopOrderListener,
  getOrderDetails
};