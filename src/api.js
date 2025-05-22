/**
 * Obtém detalhes completos de um pedido específico
 * @param {Object} config - Configurações da API
 * @param {number} orderId - ID do pedido
 * @returns {Object} Detalhes do pedido
 */
async function getOrderDetails(config, orderId) {
  try {
    logger.info(`Obtendo detalhes do pedido #${orderId}`);
    
    if (!config || !config.apiUrl || !config.username || !config.password) {
      throw new Error('Configurações incompletas para obter detalhes do pedido');
    }
    
    if (!orderId) {
      throw new Error('ID do pedido é obrigatório');
    }
    
    // Cria o token de autenticação
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
    
    // URL da API
    const url = `${config.apiUrl}/wp-json/wc/v3/orders/${orderId}`;
    
    // Faz a requisição para obter detalhes do pedido
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${token}`
      }
    });
    
    // Verifica se obteve uma resposta válida
    if (!response.data || !response.data.id) {
      throw new Error(`Não foi possível obter detalhes válidos para o pedido #${orderId}`);
    }
    
    logger.info(`Detalhes do pedido #${orderId} obtidos com sucesso`);
    
    // Verificação de segurança para garantir que o pedido é do vendedor correto
    if (config.vendorId && !orderBelongsToVendor(response.data, config.vendorId)) {
      logger.error(`SEGURANÇA: Tentativa de acesso ao pedido #${orderId} que não pertence ao vendedor ${config.vendorId}`);
      throw new Error(`Pedido #${orderId} não pertence ao vendedor ${config.vendorId}`);
    }
    
    return response.data;
  } catch (error) {
    // Registra o erro
    logger.error(`Erro ao obter detalhes do pedido #${orderId}: ${error.message}`);
    
    // Se houver detalhes adicionais no erro, registra-os também
    if (error.response) {
      logger.error(`Status do erro: ${error.response.status}`);
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
    
    // Propaga o erro
    throw error;
  }
}

module.exports = {
  startOrderListener,
  stopOrderListener,
  getOrderDetails,
  getVendorIdFromCredentials,
  loadProcessedOrdersState,
  saveProcessedOrdersState,
  getWooCommerceOrders,
  getDokanOrders,
  orderBelongsToVendor,
  verifyOrdersBelongToVendor,
  getAllOrdersAndFilter
};/**
 * Obtém pedidos do WooCommerce
 * @param {Object} config - Configurações da API
 * @param {Object} params - Parâmetros da consulta
 * @returns {Array} Lista de pedidos
 */
async function getWooCommerceOrders(config, params = {}) {
  try {
    // Registra os parâmetros para debug
    logger.info(`Buscando pedidos com parâmetros: ${JSON.stringify(params)}`);

    const url = `${config.apiUrl}/wp-json/wc/v3/orders`;
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');

    // Primeira tentativa: Usar os parâmetros fornecidos
    try {
      const response = await axios.get(url, {
        params: params,
        headers: {
          'Authorization': `Basic ${token}`
        }
      });

      if (response.data && response.data.length > 0) {
        logger.info(`Sucesso! Encontrados ${response.data.length} pedidos`);
        return response.data;
      } else {
        logger.warn('API retornou array vazio. Tentando método alternativo...');
      }
    } catch (error) {
      logger.warn(`Primeira tentativa falhou: ${error.message}`);
    }

    // Segunda tentativa: Usar meta_query como parâmetro estruturado
    if (config.vendorId && config.vendorId.trim() !== '') {
      try {
        logger.info('Tentando com meta_query estruturado...');
        const metaParams = {
          status: 'processing',
          per_page: 20,
          meta_query: [
            {
              key: '_dokan_vendor_id',
              value: config.vendorId,
              compare: '='
            }
          ]
        };

        const response = await axios.get(url, {
          params: metaParams,
          headers: {
            'Authorization': `Basic ${token}`,
            'Content-Type': 'application/json'
          },
          paramsSerializer: params => {
            return Object.entries(params)
              .map(([key, value]) => {
                if (key === 'meta_query') {
                  return `meta_query=${encodeURIComponent(JSON.stringify(value))}`;
                }
                return `${key}=${encodeURIComponent(value)}`;
              })
              .join('&');
          }
        });

        if (response.data && response.data.length > 0) {
          logger.info(`Sucesso com meta_query! Encontrados ${response.data.length} pedidos`);
          return response.data;
        } else {
          logger.warn('API retornou array vazio com meta_query.');
        }
      } catch (error) {
        logger.warn(`Segunda tentativa falhou: ${error.message}`);
      }
    }

    // Terceira tentativa: Buscar todos os pedidos e filtrar manualmente
    try {
      logger.info('Tentando buscar todos os pedidos e filtrar...');
      const response = await axios.get(url, {
        params: {
          status: 'processing',
          per_page: 50 // Aumentamos o limite para ter mais chances de encontrar pedidos do vendedor
        },
        headers: {
          'Authorization': `Basic ${token}`
        }
      });

      if (response.data && response.data.length > 0) {
        logger.info(`Obtidos ${response.data.length} pedidos no total, filtrando para o vendedor ${config.vendorId}`);

        // Filtra os pedidos pelo vendedor ID nos metadados
        const vendorOrders = response.data.filter(order => {
          if (!order.meta_data || !Array.isArray(order.meta_data)) {
            return false;
          }

          return order.meta_data.some(meta =>
            (meta.key === '_dokan_vendor_id' || meta.key === 'dokan_vendor_id') &&
            meta.value.toString() === config.vendorId.toString()
          );
        });

        logger.info(`Filtrados ${vendorOrders.length} pedidos para o vendedor ${config.vendorId}`);
        return vendorOrders;
      } else {
        logger.warn('API retornou array vazio na busca geral.');
        return [];
      }
    } catch (error) {
      logger.error(`Terceira tentativa falhou: ${error.message}`);
      throw error;
    }
  } catch (error) {
    logger.error(`Erro geral ao obter pedidos do WooCommerce: ${error.message}`);
    if (error.response) {
      logger.error(`Status da resposta: ${error.response.status}`);
      logger.error(`Corpo da resposta: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}const axios = require('axios');
const winston = require('winston');

const fs = require('fs');
const path = require('path');

// Função para salvar o estado dos pedidos processados
function saveProcessedOrdersState() {
  try {
    // Cria o diretório se não existir
    const stateDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    
    // Caminho do arquivo de estado
    const stateFile = path.join(stateDir, 'processed_orders.json');
    
    // Converte o Set para Array para armazenamento
    const processedOrders = Array.from(global.processedOrders || []);
    
    // Salva no arquivo
    fs.writeFileSync(stateFile, JSON.stringify({
      orders: processedOrders,
      lastUpdate: new Date().toISOString()
    }));
    
    logger.info(`Estado de ${processedOrders.length} pedidos processados salvo com sucesso.`);
    return true;
  } catch (error) {
    logger.error(`Erro ao salvar estado de pedidos processados: ${error.message}`);
    return false;
  }
}

// Função para carregar o estado dos pedidos processados
function loadProcessedOrdersState() {
  try {
    // Caminho do arquivo de estado
    const stateFile = path.join(process.cwd(), 'data', 'processed_orders.json');
    
    // Verifica se o arquivo existe
    if (!fs.existsSync(stateFile)) {
      logger.info('Arquivo de estado não encontrado. Criando novo registro.');
      global.processedOrders = new Set();
      return true;
    }
    
    // Carrega o arquivo
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    
    // Converte a lista de volta para Set
    global.processedOrders = new Set(data.orders);
    
    logger.info(`Estado de ${global.processedOrders.size} pedidos processados carregado. Última atualização: ${data.lastUpdate}`);
    return true;
  } catch (error) {
    logger.error(`Erro ao carregar estado de pedidos processados: ${error.message}`);
    global.processedOrders = new Set();
    return false;
  }
}

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
 * Função aprimorada para verificação rigorosa de segurança de pedidos
 * Garante que um pedido pertence a um vendedor específico
 * @param {Object} order - Dados do pedido
 * @param {string} vendorId - ID do vendedor
 * @returns {boolean} True se o pedido pertence ao vendedor
 */
function orderBelongsToVendor(order, vendorId) {
  try {
    // Verificações básicas
    if (!order || !vendorId) {
      logger.warn('Verificação de segurança: pedido ou ID de vendedor ausente');
      return false;
    }

    // Garante que o vendorId seja uma string para comparações
    const vendorIdStr = vendorId.toString();
    
    // Registro para auditoria de segurança
    logger.info(`Verificando propriedade do pedido #${order.id} para vendedor ${vendorIdStr}`);
    
    // VERIFICAÇÃO 1: Metadados do pedido
    if (order.meta_data && Array.isArray(order.meta_data)) {
      // Busca por todas as possíveis chaves de metadados que identificam o vendedor
      const vendorMeta = order.meta_data.find(meta => 
        // Lista de todas as possíveis chaves de metadados para verificação
        (meta.key === '_dokan_vendor_id' || 
         meta.key === 'dokan_vendor_id' || 
         meta.key === '_vendor_id' || 
         meta.key === 'vendor_id' ||
         meta.key === '_store_id' ||
         meta.key === 'store_owner_id') && 
        meta.value && meta.value.toString() === vendorIdStr
      );
      
      if (vendorMeta) {
        logger.info(`Verificação de segurança: Pedido #${order.id} confirmado para vendedor ${vendorIdStr} via metadados`);
        return true;
      }
    }
    
    // VERIFICAÇÃO 2: Itens do pedido
    if (order.line_items && Array.isArray(order.line_items)) {
      for (const item of order.line_items) {
        if (item.meta_data && Array.isArray(item.meta_data)) {
          const vendorMeta = item.meta_data.find(meta => 
            (meta.key === '_dokan_vendor_id' || 
             meta.key === 'vendor_id' || 
             meta.key === '_vendor_id') && 
            meta.value && meta.value.toString() === vendorIdStr
          );
          
          if (vendorMeta) {
            logger.info(`Verificação de segurança: Pedido #${order.id} confirmado para vendedor ${vendorIdStr} via itens do pedido`);
            return true;
          }
        }
        
        // Verificação de produto do vendedor
        if (item.vendor_id && item.vendor_id.toString() === vendorIdStr) {
          logger.info(`Verificação de segurança: Pedido #${order.id} confirmado para vendedor ${vendorIdStr} via vendor_id do item`);
          return true;
        }
      }
    }
    
    // VERIFICAÇÃO 3: Outros campos possíveis onde o ID do vendedor pode estar
    const possibleFields = [
      'store_id',
      'vendor_id',
      'seller_id',
      'store_owner_id',
      'dokan_vendor_id'
    ];
    
    for (const field of possibleFields) {
      if (order[field] && order[field].toString() === vendorIdStr) {
        logger.info(`Verificação de segurança: Pedido #${order.id} confirmado para vendedor ${vendorIdStr} via campo ${field}`);
        return true;
      }
    }
    
    // Se chegou até aqui, o pedido não pertence ao vendedor
    logger.warn(`Verificação de segurança FALHOU: Pedido #${order.id} NÃO pertence ao vendedor ${vendorIdStr}`);
    return false;
  } catch (error) {
    logger.error(`Erro na verificação de segurança para pedido: ${error.message}`);
    return false; // Em caso de erro, por segurança retorna falso
  }
}

/**
 * Função para verificar pedidos de um vendedor - versão melhorada com segurança
 * @param {Array} orders - Lista de pedidos
 * @param {string} vendorId - ID do vendedor
 * @returns {Array} Lista filtrada de pedidos
 */
function verifyOrdersBelongToVendor(orders, vendorId) {
  if (!orders || !Array.isArray(orders) || !vendorId) {
    logger.warn('Verificação de segurança em lote: parâmetros inválidos');
    return [];
  }
  
  logger.info(`Verificação de segurança em lote: filtrando ${orders.length} pedidos para vendedor ${vendorId}`);
  
  // Filtrar pedidos que pertencem ao vendedor
  const verifiedOrders = orders.filter(order => orderBelongsToVendor(order, vendorId));
  
  logger.info(`Verificação de segurança em lote: ${verifiedOrders.length} pedidos confirmados para vendedor ${vendorId} de ${orders.length} total`);
  
  // Registrar aviso se houver pedidos descartados
  if (verifiedOrders.length < orders.length) {
    const discardedCount = orders.length - verifiedOrders.length;
    logger.warn(`Verificação de segurança em lote: ${discardedCount} pedidos BLOQUEADOS por não pertencerem ao vendedor ${vendorId}`);
    
    // Registrar IDs dos pedidos bloqueados para auditoria
    const blockedIds = orders
      .filter(order => !verifiedOrders.some(vo => vo.id === order.id))
      .map(order => order.id);
    
    logger.warn(`Pedidos bloqueados por segurança: ${blockedIds.join(', ')}`);
  }
  
  return verifiedOrders;
}
/**
 * Obtém o ID do vendedor Dokan automaticamente a partir das credenciais do usuário
 * @param {Object} config - Objeto com apiUrl, username e password
 * @returns {Promise<string>} ID do vendedor ou string vazia em caso de erro
 */
async function getVendorIdFromCredentials(config) {
  try {
    if (!config.apiUrl || !config.username || !config.password) {
      logger.warn('Credenciais incompletas para determinar o ID do vendedor');
      return '';
    }

    logger.info('Obtendo ID do vendedor a partir das credenciais');

    // Cria um token básico para autenticação
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');

    // Primeiro tenta acessar lista de vendedores para encontrar o vendedor correto
    try {
      logger.info('Tentando buscar lista completa de vendedores...');
      // Lista todos os vendedores
      const vendorsResponse = await axios.get(`${config.apiUrl}/wp-json/dokan/v1/stores`, {
        params: {
          per_page: 100 // Busca até 100 vendedores
        },
        headers: {
          'Authorization': `Basic ${token}`
        }
      });

      // Verifica se retornou dados
      if (vendorsResponse.data && Array.isArray(vendorsResponse.data) && vendorsResponse.data.length > 0) {
        const vendors = vendorsResponse.data;
        logger.info(`Encontrados ${vendors.length} vendedores`);

        // Registra todos os vendedores para debug
        vendors.forEach(vendor => {
          logger.info(`Vendedor ID: ${vendor.id}, Nome: ${vendor.store_name}, Email: ${vendor.email || 'N/A'}`);
        });

        // Verifica se o nome de usuário é um e-mail
        const isEmail = config.username.includes('@');
        let matchedVendor = null;

        if (isEmail) {
          // Busca por correspondência exata com o e-mail
          matchedVendor = vendors.find(vendor =>
            (vendor.email && vendor.email.toLowerCase() === config.username.toLowerCase()) ||
            (vendor.user && vendor.user.email && vendor.user.email.toLowerCase() === config.username.toLowerCase())
          );

          // Se não encontrou correspondência exata, tenta uma correspondência parcial
          if (!matchedVendor) {
            matchedVendor = vendors.find(vendor =>
              (vendor.email && vendor.email.toLowerCase().includes(config.username.toLowerCase())) ||
              (vendor.user && vendor.user.email && vendor.user.email.toLowerCase().includes(config.username.toLowerCase()))
            );
          }
        }

        // Se não encontrou por e-mail, tenta por nome da loja
        if (!matchedVendor) {
          matchedVendor = vendors.find(vendor =>
            vendor.store_name && vendor.store_name.toLowerCase().includes(config.username.toLowerCase())
          );
        }

        // Se encontrou um vendedor correspondente
        if (matchedVendor) {
          logger.info(`Vendedor correspondente encontrado com ID: ${matchedVendor.id}, Nome: ${matchedVendor.store_name}`);
          return matchedVendor.id.toString();
        } else {
          logger.warn('Nenhum vendedor correspondente encontrado na lista');
        }
      }
    } catch (error) {
      logger.warn(`Erro ao buscar lista de vendedores: ${error.message}`);
    }

    // Se não conseguiu pela API de vendedores, tenta a API de usuários
    try {
      logger.info('Tentando obter informação do usuário atual...');
      const response = await axios.get(`${config.apiUrl}/wp-json/wp/v2/users/me`, {
        headers: {
          'Authorization': `Basic ${token}`
        }
      });

      if (response.data && response.data.id) {
        const userId = response.data.id;
        logger.info(`ID do usuário encontrado: ${userId}`);

        // Verifica se este usuário é um vendedor
        try {
          logger.info(`Verificando se o usuário ${userId} é um vendedor...`);
          const vendorStoreResponse = await axios.get(`${config.apiUrl}/wp-json/dokan/v1/stores`, {
            params: {
              owner_id: userId
            },
            headers: {
              'Authorization': `Basic ${token}`
            }
          });

          if (vendorStoreResponse.data && vendorStoreResponse.data.length > 0) {
            const vendorId = vendorStoreResponse.data[0].id;
            logger.info(`O usuário ${userId} é o vendedor com ID: ${vendorId}`);
            return vendorId.toString();
          } else {
            logger.warn(`Usuário ${userId} não tem loja de vendedor associada`);
          }
        } catch (storeError) {
          logger.warn(`Erro ao verificar loja do usuário: ${storeError.message}`);
        }

        // Se não conseguiu confirmar como vendedor, retorna o ID do usuário como fallback
        logger.info(`Usando ID do usuário ${userId} como fallback para ID do vendedor`);
        return userId.toString();
      }
    } catch (error) {
      logger.warn(`Erro ao obter informações do usuário: ${error.message}`);
    }

    // Método final: tentar buscar metadados de pedidos para identificar o vendedor
    try {
      logger.info('Tentando identificar vendedor por metadados de pedidos...');
      const ordersResponse = await axios.get(`${config.apiUrl}/wp-json/wc/v3/orders`, {
        params: {
          per_page: 10
        },
        headers: {
          'Authorization': `Basic ${token}`
        }
      });

      if (ordersResponse.data && ordersResponse.data.length > 0) {
        const foundVendorIds = new Set();

        // Procura IDs de vendedores nos metadados de todos os pedidos
        for (const order of ordersResponse.data) {
          if (order.meta_data && Array.isArray(order.meta_data)) {
            for (const meta of order.meta_data) {
              if (
                meta.key === '_dokan_vendor_id' ||
                meta.key === 'dokan_vendor_id' ||
                meta.key === '_vendor_id' ||
                meta.key.includes('vendor_id')
              ) {
                foundVendorIds.add(meta.value.toString());
                logger.info(`Encontrado ID de vendedor ${meta.value} nos metadados do pedido #${order.id}`);
              }
            }
          }
        }

        // Se encontrou apenas um ID de vendedor, provavelmente é o correto
        if (foundVendorIds.size === 1) {
          const vendorId = Array.from(foundVendorIds)[0];
          logger.info(`Identificado ID de vendedor ${vendorId} pelos metadados de pedidos`);
          return vendorId;
        }
        // Se encontrou múltiplos IDs, não podemos ter certeza
        else if (foundVendorIds.size > 1) {
          logger.warn(`Múltiplos IDs de vendedores encontrados: ${Array.from(foundVendorIds).join(', ')}`);
        }
      }
    } catch (error) {
      logger.warn(`Erro ao buscar pedidos para identificar vendedor: ${error.message}`);
    }

    logger.error('Não foi possível determinar o ID do vendedor automaticamente');
    return '';
  } catch (error) {
    logger.error(`Erro geral ao detectar ID do vendedor: ${error.message}`);
    return '';
  }
}

/**
 * Inicia o monitoramento de pedidos para um vendedor específico
 * @param {Object} config - Configurações da API e do vendedor
 * @param {Function} callback - Função a ser chamada quando um novo pedido for encontrado
 */
async function startOrderListener(config, callback) {
  if (isListening) {
    stopOrderListener();
  }

  // Se o vendorId não estiver definido, tenta obtê-lo automaticamente
  if (!config.vendorId || config.vendorId.trim() === '') {
    try {
      logger.info('ID do vendedor não informado, tentando detecção automática');
      const autoVendorId = await getVendorIdFromCredentials(config);

      if (autoVendorId) {
        logger.info(`ID do vendedor detectado automaticamente: ${autoVendorId}`);
        config.vendorId = autoVendorId;
      } else {
        logger.error('Não foi possível detectar o ID do vendedor automaticamente');
        throw new Error('ID do vendedor não fornecido e não foi possível detectar automaticamente');
      }
    } catch (error) {
      logger.error(`Erro na detecção automática de ID do vendedor: ${error.message}`);
      throw error;
    }
  }

  isListening = true;

  // Carrega o estado dos pedidos processados
  loadProcessedOrdersState();

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

  // Salva o estado dos pedidos processados antes de limpar
  if (global.processedOrders) {
    logger.info(`Salvando estado de ${global.processedOrders.size} pedidos processados`);
    saveProcessedOrdersState();
  }

  isListening = false;
  logger.info('Monitoramento de pedidos parado');

  return true;
}

/**
 * Versão melhorada do método que obtém pedidos e filtra para o vendedor
 * Implementa verificações rigorosas de segurança
 * @param {Object} config - Configurações da API
 * @param {string} vendorId - ID do vendedor
 * @returns {Promise<Array>} Lista de pedidos filtrados
 */
async function getAllOrdersAndFilter(config, vendorId) {
  try {
    // Verificações de segurança iniciais
    if (!config || !config.apiUrl || !config.username || !config.password) {
      logger.error('Configurações de API incompletas para buscar pedidos');
      throw new Error('Configurações de API incompletas');
    }
    
    if (!vendorId || vendorId.trim() === '') {
      logger.error('ID do vendedor não fornecido para filtrar pedidos');
      throw new Error('ID do vendedor obrigatório para buscar pedidos');
    }
    
    logger.info(`Buscando pedidos e aplicando filtro rigoroso para vendedor: ${vendorId}`);
    
    const url = `${config.apiUrl}/wp-json/wc/v3/orders`;
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
    
    // Buscar pedidos recentes em processamento
    const response = await axios.get(url, {
      params: {
        status: 'processing',
        per_page: 50,
        // Ordenar por data de criação, mais recentes primeiro
        orderby: 'date',
        order: 'desc'
      },
      headers: {
        'Authorization': `Basic ${token}`
      }
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      logger.warn('Resposta da API inválida ao buscar pedidos');
      return [];
    }
    
    const allOrders = response.data;
    logger.info(`Obtidos ${allOrders.length} pedidos no total, aplicando filtro de segurança para vendedor ${vendorId}`);
    
    // Aplicar verificação rigorosa de segurança
    const vendorOrders = verifyOrdersBelongToVendor(allOrders, vendorId);
    
    // Registrar resultados da filtragem
    logger.info(`Após verificação de segurança: ${vendorOrders.length} pedidos confirmados para o vendedor ${vendorId}`);
    
    return vendorOrders;
  } catch (error) {
    logger.error(`Erro ao buscar e filtrar pedidos com segurança: ${error.message}`);
    // Em caso de erro, retorna array vazio por segurança
    return [];
  }
}

/**
 * Verifica se há novos pedidos
 * @param {Object} config - Configurações da API e do vendedor
 * @param {Function} callback - Função a ser chamada quando um novo pedido for encontrado
 */
async function checkForNewOrders(config, callback) {
  try {
    // Verifica se o ID do vendedor está configurado
    if (!config.vendorId || config.vendorId.trim() === '') {
      logger.error('ID do vendedor não configurado. Não é possível filtrar pedidos corretamente.');
      return;
    }

    // Parâmetros para a API do WooCommerce
    const apiParams = {
      per_page: 20, // Aumentamos o limite para garantir que pegamos todos os pedidos recentes
      status: 'processing', // Filtra apenas pedidos em processamento
    };
    
    // Usa diferentes parâmetros para tentar obter pedidos específicos do vendedor
    const vendorId = config.vendorId.trim();
    
    // Primeiro tenta com o parâmetro da API (variável dependendo da configuração do site)
    apiParams.vendor_id = vendorId;
    
    // Conjunto para armazenar IDs de pedidos já processados
    if (!global.processedOrders) {
      global.processedOrders = new Set();
    }

    // Obtém os pedidos recentes
    logger.info(`Verificando novos pedidos para vendedor ${vendorId}...`);
    
    // Tenta obter pedidos pela API
    let orders = [];
    let foundMethod = '';
    
    // Tenta diferentes métodos para obter pedidos do vendedor
    try {
      // Método 1: parâmetro vendor_id
      orders = await getWooCommerceOrders(config, apiParams);
      
      if (orders && orders.length > 0) {
        logger.info(`Encontrados ${orders.length} pedidos usando parâmetro vendor_id`);
        foundMethod = 'vendor_id';
      } else {
        logger.info('Nenhum pedido encontrado com parâmetro vendor_id, tentando método alternativo');
        
        // Método 2: API específica do Dokan
        try {
          orders = await getDokanOrders(config);
          
          if (orders && orders.length > 0) {
            logger.info(`Encontrados ${orders.length} pedidos usando API Dokan`);
            foundMethod = 'dokan_api';
          } else {
            logger.info('Nenhum pedido encontrado com API Dokan, tentando método de filtro manual');
            
            // Método 3: Buscar todos os pedidos e filtrar manualmente
            orders = await getAllOrdersAndFilter(config, vendorId);
            
            if (orders && orders.length > 0) {
              logger.info(`Encontrados ${orders.length} pedidos usando filtro manual`);
              foundMethod = 'filtro_manual';
            } else {
              logger.info('Nenhum pedido encontrado com nenhum método');
            }
          }
        } catch (dokanError) {
          logger.error(`Erro ao tentar API Dokan: ${dokanError.message}`);
          
          // Se falhar, tenta o último método
          orders = await getAllOrdersAndFilter(config, vendorId);
          
          if (orders && orders.length > 0) {
            logger.info(`Encontrados ${orders.length} pedidos usando filtro manual após falha no Dokan`);
            foundMethod = 'filtro_manual';
          }
        }
      }
    } catch (error) {
      logger.error(`Erro ao obter pedidos: ${error.message}`);
      // Tenta o último método como fallback
      try {
        orders = await getAllOrdersAndFilter(config, vendorId);
        
        if (orders && orders.length > 0) {
          logger.info(`Encontrados ${orders.length} pedidos usando filtro manual após erro`);
          foundMethod = 'filtro_manual';
        }
      } catch (fallbackError) {
        logger.error(`Também falhou no método de fallback: ${fallbackError.message}`);
      }
    }

    if (orders.length > 0) {
      // SEGURANÇA ADICIONAL: Verificar se todos os pedidos são realmente deste vendedor
      orders = verifyOrdersBelongToVendor(orders, vendorId);
      logger.info(`Após verificação de segurança: ${orders.length} pedidos confirmados para vendedor ${vendorId}`);
      
      // Filtra para obter apenas pedidos que ainda não foram processados
      const newOrders = orders.filter(order => !global.processedOrders.has(order.id));
      
      if (newOrders.length > 0) {
        logger.info(`${newOrders.length} novos pedidos encontrados para vendedor ${vendorId}`);

        // Processa cada novo pedido
        for (const order of newOrders) {
          // Última verificação de segurança - confirma que este pedido pertence ao vendedor
          if (orderBelongsToVendor(order, vendorId)) {
            // Marca o pedido como processado para evitar duplicação
            global.processedOrders.add(order.id);
            
            // Registra o pedido encontrado
            logger.info(`Processando pedido #${order.id} para o vendedor ${vendorId}`);
            
            // Chama o callback com o pedido
            callback(order);
          } else {
            logger.warn(`SEGURANÇA: Bloqueado pedido #${order.id} que não pertence ao vendedor ${vendorId}`);
          }
        }
        
        // Salva o estado a cada batch de novos pedidos
        saveProcessedOrdersState();
        
        // Se houver muitos pedidos no conjunto, podemos limpar os mais antigos
        if (global.processedOrders.size > 1000) {
          logger.info(`Limpando cache de pedidos processados (tamanho: ${global.processedOrders.size})`);
          // Convertemos para array, pegamos os 500 mais recentes, e recriamos o conjunto
          const ordersArray = Array.from(global.processedOrders);
          global.processedOrders = new Set(ordersArray.slice(-500));
          logger.info(`Cache de pedidos reduzido para ${global.processedOrders.size} itens`);
          // Salva o estado após a limpeza
          saveProcessedOrdersState();
        }
      } else {
        logger.info(`Nenhum novo pedido encontrado para vendedor ${vendorId}`);
      }
    } else {
      logger.info(`Nenhum pedido em processamento encontrado para vendedor ${vendorId}`);
    }
  } catch (error) {
    logger.error(`Erro ao verificar novos pedidos: ${error.message}`);
    if (error.response) {
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
  }
}

/**
 * Obtém pedidos diretamente pela API do Dokan
 * Útil quando a API do WooCommerce não retorna os pedidos do vendedor corretamente
 * @param {Object} config - Configurações da API
 * @returns {Array} Lista de pedidos
 */
async function getDokanOrders(config) {
  try {
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
    
    // Primeiro, tenta pela API específica do Dokan
    try {
      logger.info(`Tentando endpoint Dokan para vendedor ${config.vendorId}`);
      const response = await axios.get(`${config.apiUrl}/wp-json/dokan/v1/orders`, {
        headers: {
          'Authorization': `Basic ${token}`
        },
        params: {
          status: 'processing',
          per_page: 20
        }
      });
      
      return response.data;
    } catch (dokanError) {
      logger.warn(`Erro na API do Dokan: ${dokanError.message}`);
      
      // Se a API do Dokan falhar, tenta a API do WooCommerce com filtro de meta_query
      const response = await axios.get(`${config.apiUrl}/wp-json/wc/v3/orders`, {
        headers: {
          'Authorization': `Basic ${token}`
        },
        params: {
          status: 'processing',
          per_page: 20,
          meta_query: JSON.stringify([
            {
              key: '_dokan_vendor_id',
              value: config.vendorId,
              compare: '='
            }
          ])
        }
      });
      
      return response.data;
    }
  } catch (error) {
    logger.error(`Erro ao obter pedidos do Dokan: ${error.message}`);
    if (error.response) {
      logger.error(`Detalhes: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}