/* ==========================================================================
   Garçom - Atendimento de Mesas & Lanches
   ========================================================================== */

// Firebase Initialization
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}

// Global State
let allProducts = [];
let activeCategory = 'todos';
let selectedTable = null; // e.g. "02"
let selectedComandaId = null; // ID or firebaseKey of the active comanda on selectedTable, or null if new comanda
let selectedClientName = ''; // Client/Group identification, e.g. "João"
let selectedComandaNum = 1; // Comanda number index within the table, e.g. 1, 2, 3
let waiterName = localStorage.getItem('garcom_waiter_name') || 'Garçom';
let tableCart = []; // Items in current table comanda cart
let editingItemCartId = null;
let activeTableOrders = {}; // Active open comandas keyed by table
let currentOpenComanda = null; // Currently selected comanda entity
let firebaseTablesState = {}; // Realtime /tables node from Firebase (tables 01 to 20)
let rawFirebaseOrders = []; // Raw orders array directly from Firebase /orders
let pendingModalTableNum = null; // Table currently being inspected in modals

/* ==========================================================================
   Table & Comanda Canonical Identification Helpers
   ========================================================================== */
function getCanonicalTableNumber(orderOrVal) {
    if (!orderOrVal && orderOrVal !== 0) return '';
    
    let rawVal = orderOrVal;
    if (typeof orderOrVal === 'object' && orderOrVal !== null) {
        // Extrai de campos de um pedido na ordem de prioridade
        rawVal = orderOrVal.mesa || orderOrVal.table || orderOrVal.tableSessionId || orderOrVal.comandaId || '';
    }
    
    const str = String(rawVal).trim();
    if (!str) return '';
    
    // 1. Padrão com prefixo de sessão: "mesa-01-xyz", "mesa_01_123", "mesa-01", "mesa_1"
    const sessionMatch = str.match(/^mesa[-_](\d+)(?:[-_].*)?$/i);
    if (sessionMatch && sessionMatch[1]) {
        return sessionMatch[1].padStart(2, '0');
    }
    
    // 2. Padrão "Mesa 01", "Mesa 1", "Mesa01", "mesa 1"
    const numMatch = str.match(/^mesa\s*(\d+)$/i);
    if (numMatch && numMatch[1]) {
        return numMatch[1].padStart(2, '0');
    }
    
    // 3. Qualquer formato com a palavra 'mesa' e dígitos (ex: "Mesa 01 (Garçom)", "mesa: 1", etc.)
    const genericMesaMatch = str.match(/mesa\D*(\d+)/i);
    if (genericMesaMatch && genericMesaMatch[1]) {
        return genericMesaMatch[1].padStart(2, '0');
    }
    
    // 4. Apenas dígitos (ex: "01", "1", 1, 01)
    const onlyDigitsMatch = str.match(/^(\d+)$/);
    if (onlyDigitsMatch && onlyDigitsMatch[1]) {
        return onlyDigitsMatch[1].padStart(2, '0');
    }
    
    // 5. Extração de 1 a 3 dígitos (ex: "#1", "T01")
    const onlyDigits = str.replace(/\D/g, '');
    if (onlyDigits && onlyDigits.length <= 3) {
        return onlyDigits.padStart(2, '0');
    }
    
    return str.toLowerCase().replace(/\s+/g, '_');
}

function normalizeTableNumber(val) {
    return getCanonicalTableNumber(val);
}

function isTableOrderEntity(order) {
    if (!order) return false;
    if (order.checkoutType && /mesa/i.test(String(order.checkoutType))) return true;
    if (order.origin && /gar[cç][aã]o/i.test(String(order.origin))) return true;
    if (order.mesa !== undefined && order.mesa !== null && String(order.mesa).trim() !== '') return true;
    if (order.tableSessionId || order.comandaId) return true;
    if (order.table && String(order.table).trim() !== '') return true;
    return false;
}

function isTableComandaOpen(order) {
    if (!order || !isTableOrderEntity(order)) return false;
    if (order.status === 'Cancelado' || order.status === 'Encerrado' || order.status === 'Finalizado') {
        return false;
    }
    if (order.comandaStatus === 'fechada' || order.comandaStatus === 'encerrada' || order.comandaStatus === 'paga') {
        return false;
    }
    if (order.closedAt) {
        return false;
    }
    if (order.comandaStatus === 'aberta') {
        return true;
    }
    return order.status !== 'Entregue';
}

function getTableComandas(tableIdentifier) {
    const num = getCanonicalTableNumber(tableIdentifier);
    if (!num) return [];

    if (!Array.isArray(rawFirebaseOrders) || rawFirebaseOrders.length === 0) {
        return [];
    }

    const comandas = rawFirebaseOrders.filter(ord => {
        if (!isTableOrderEntity(ord)) return false;
        if (!isTableComandaOpen(ord)) return false;
        return getCanonicalTableNumber(ord) === num;
    });

    comandas.sort((a, b) => (Number(a.timestamp || a.id) || 0) - (Number(b.timestamp || b.id) || 0));
    return comandas;
}

function getTableTotal(tableIdentifier) {
    const comandas = getTableComandas(tableIdentifier);
    if (comandas.length === 0) return 0;
    return comandas.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
}

function isTableOccupied(tableIdentifier) {
    const num = getCanonicalTableNumber(tableIdentifier);
    if (!num) return false;

    const comandas = getTableComandas(num);
    if (comandas.length > 0) return true;

    const tData = firebaseTablesState[num];
    if (tData && (tData.status === 'aberta' || (tData.tableSessionId && tData.tableSessionId !== 'null'))) {
        return true;
    }

    return false;
}

function getActiveTableComanda(tableIdentifier, specificComandaId = null) {
    const num = getCanonicalTableNumber(tableIdentifier);
    if (!num) return null;

    const comandas = getTableComandas(num);
    if (comandas.length === 0) {
        const tData = firebaseTablesState[num];
        if (tData && (tData.status === 'aberta' || tData.tableSessionId)) {
            return {
                id: (tData.orderIds && tData.orderIds[0]) || `mesa-${num}`,
                table: tData.tableName || `Mesa ${num}`,
                mesa: num,
                tableSessionId: tData.tableSessionId || `mesa-${num}`,
                comandaId: tData.tableSessionId || `mesa-${num}`,
                clientName: `Mesa ${num}`,
                comandaNum: 1,
                total: Number(tData.total || 0),
                waiterName: tData.waiterName || 'Garçom',
                roundsCount: (tData.orderIds || []).length || 1,
                cart: [],
                comandaStatus: 'aberta',
                status: 'Pendente',
                openedAt: tData.openedAt || ''
            };
        }
        return null;
    }

    const searchId = specificComandaId || selectedComandaId;
    if (searchId) {
        const found = comandas.find(c => String(c.id) === String(searchId) || String(c.firebaseKey) === String(searchId) || String(c.tableSessionId) === String(searchId) || String(c.comandaId) === String(searchId));
        if (found) return found;
    }

    return comandas[0];
}

// Fallback Menu Items (Lanches, Bebidas, etc.)
let DEFAULT_MENU_ITEMS = {
    "lanches":  [
                    {
                        "id":  "cachorro_big",
                        "name":  "Cachorro Big",
                        "description":  "Molho de carne moída, 1 salsicha, vinagrete, milho, ervilha, catchup, maionese, mostarda e batata palha.",
                        "image":  "../assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  18.0,
                        "badge":  "Top",
                        "available":  true
                    },
                    {
                        "id":  "cachorro_calabresa",
                        "name":  "Cachorro Quente Calabresa",
                        "description":  "Maionese, 120g de calabresa, milho e batata palha.",
                        "image":  "../assets/hotdog_calabresa.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "cachorro_simples",
                        "name":  "Cachorro Quente Simples",
                        "description":  "Molho, 1 salsicha, maionese, milho, ervilha e batata palha.",
                        "image":  "../assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  14.0,
                        "available":  true
                    },
                    {
                        "id":  "cachorro_duplo",
                        "name":  "Cachorro Quente Duplo",
                        "description":  "Molho, 2 salsichas, maionese, milho, ervilha e batata palha.",
                        "image":  "../assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_carne",
                        "name":  "Pastel de Carne",
                        "description":  "120g de carne bovina moída temperada, sequinho e crocante.",
                        "image":  "../assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  17.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_queijo",
                        "name":  "Pastel de Queijo",
                        "description":  "120g de queijo mussarela derretido.",
                        "image":  "../assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_frango_catupiry",
                        "name":  "Pastel de Frango com Catupiry",
                        "description":  "120g de frango desfiado suculento com Catupiry original.",
                        "image":  "../assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_carioca",
                        "name":  "Pastel Carioca",
                        "description":  "120g de frango, queijo mussarela, presunto e orégano.",
                        "image":  "../assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  19.0,
                        "badge":  "Especial",
                        "available":  true
                    },
                    {
                        "id":  "pastel_calabresa_queijo",
                        "name":  "Pastel de Calabresa com Queijo",
                        "description":  "120g de calabresa fatiada com queijo mussarela.",
                        "image":  "../assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "misto_quente",
                        "name":  "Misto Quente",
                        "description":  "Pão fatiado tostado na chapa, maionese, queijo, presunto e orégano.",
                        "image":  "../assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  13.0,
                        "available":  true
                    },
                    {
                        "id":  "torrada_pao_fatiado",
                        "name":  "Torrada Pão Fatiado",
                        "description":  "Pão fatiado tostado, maionese, queijo, presunto, alface e tomate.",
                        "image":  "../assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  11.0,
                        "available":  true
                    },
                    {
                        "id":  "torrada_pao_xis",
                        "name":  "Torrada Pão de Xis",
                        "description":  "Pão de xis prensado, maionese, queijo, presunto, alface, tomate e ovo.",
                        "image":  "../assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  13.0,
                        "available":  true
                    },
                    {
                        "id":  "x_bacon",
                        "name":  "X-Bacon",
                        "description":  "140g de hambúrguer + 80g de bacon, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  31.0,
                        "badge":  "Favorito",
                        "available":  true
                    },
                    {
                        "id":  "x_bagunca",
                        "name":  "X-Bagunça",
                        "description":  "115g (frango, bacon, carne e calabresa), maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "badge":  "Completo",
                        "available":  true
                    },
                    {
                        "id":  "x_calabresa",
                        "name":  "X-Calabresa",
                        "description":  "115g de calabresa, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  25.0,
                        "available":  true
                    },
                    {
                        "id":  "x_carne",
                        "name":  "X-Carne",
                        "description":  "115g de iscas de carne, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "available":  true
                    },
                    {
                        "id":  "x_casa",
                        "name":  "X-Casa",
                        "description":  "140g de hambúrguer, maionese, milho, ervilha, alface, tomate, queijo, presunto, ovo e batata-frita.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  28.0,
                        "badge":  "Especialidade",
                        "available":  true
                    },
                    {
                        "id":  "x_coracao_especial",
                        "name":  "X-Coração Especial",
                        "description":  "140g de hambúrguer + 115g de coração, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Super",
                        "available":  true
                    },
                    {
                        "id":  "x_coracao_simples",
                        "name":  "X-Coração",
                        "description":  "115g de coração, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "available":  true
                    },
                    {
                        "id":  "x_costela",
                        "name":  "X-Costela",
                        "description":  "115g de costela, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Premium",
                        "available":  true
                    },
                    {
                        "id":  "x_file_acebolado",
                        "name":  "X-Filé Acebolado",
                        "description":  "115g de filé, maionese, milho, ervilha, alface, tomate, queijo, presunto, ovo, cebola e batata-frita.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Premium",
                        "available":  true
                    },
                    {
                        "id":  "x_frango",
                        "name":  "X-Frango",
                        "description":  "115g de frango, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  21.0,
                        "available":  true
                    },
                    {
                        "id":  "x_frango_acebolado",
                        "name":  "X-Frango Acebolado",
                        "description":  "115g frango + cebola, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  23.0,
                        "available":  true
                    },
                    {
                        "id":  "x_salada",
                        "name":  "X-Salada",
                        "description":  "Hambúrguer 140g, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  25.0,
                        "badge":  "Clássico",
                        "available":  true
                    },
                    {
                        "id":  "x_strogonoff",
                        "name":  "X-Strogonoff",
                        "description":  "115g de iscas de carne, molho de strogonoff, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "../assets/xis.jpg",
                        "category":  "lanches",
                        "price":  30.0,
                        "badge":  "Destaque",
                        "available":  true
                    }
                ],
    "porcoes":  [
                    {
                        "id":  "batata_frita_g",
                        "name":  "Batata Frita G (800g)",
                        "description":  "Porção grande de 800g de batatas fritas crocantes e sequinhas.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  30.0,
                        "available":  true
                    },
                    {
                        "id":  "batata_frita_p",
                        "name":  "Batata Frita P (500g)",
                        "description":  "Porção de 500g de batatas fritas crocantes e sequinhas.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  23.0,
                        "available":  true
                    },
                    {
                        "id":  "polenta_frita",
                        "name":  "Polenta Frita (600g)",
                        "description":  "Porção de 600g de polenta frita dourada e crocante.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  18.0,
                        "available":  true
                    },
                    {
                        "id":  "polenta_frita_queijo",
                        "name":  "Polenta Frita c/ Queijo (600g)",
                        "description":  "Porção de 600g de polenta frita coberta com queijo derretido.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  25.0,
                        "available":  true
                    },
                    {
                        "id":  "batata_bacon_800",
                        "name":  "Batata com Bacon G (800g + 120g bacon)",
                        "description":  "800g de batata frita com 120g de bacon crocante por cima.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  42.0,
                        "badge":  "Mais Pedida",
                        "available":  true
                    },
                    {
                        "id":  "batata_bacon_500",
                        "name":  "Batata com Bacon P (500g + 80g bacon)",
                        "description":  "500g de batata frita com 80g de bacon crocante por cima.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  32.0,
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_p",
                        "name":  "Torre de Batata P",
                        "description":  "800g Batata, 60g carne bovina, 60g calabresa, 120g carne suína, 120g frango, 80g bacon, Molho 4 queijos + queijo.",
                        "image":  "../assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  62.0,
                        "badge":  "Especial",
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_g",
                        "name":  "Torre de Batata G",
                        "description":  "1.300 kg Batata, 120g carne suína, 120g frango, 120g carne bovina, 120g calabresa, 80g bacon, Molho 4 queijos + queijo.",
                        "image":  "../assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  82.0,
                        "badge":  "Super",
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_gg",
                        "name":  "Torre de Batata GG",
                        "description":  "1.600 kg Batata, 120g carne suína, 120g frango, 120g carne bovina, 120g calabresa, 120g coração, 80g bacon, Molho 4 queijos + queijo + orégano.",
                        "image":  "../assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  105.0,
                        "badge":  "Gigante",
                        "available":  true
                    },
                    {
                        "id":  "picadao",
                        "name":  "Picadão Roloff",
                        "description":  "120g carne bovina, 120g frango, 120g suína, 120g calabresa, ovo de codorna, batata frita, polenta frita, queijo, pepino e azeitona.",
                        "image":  "../assets/picadao.jpg",
                        "category":  "porcoes",
                        "price":  62.0,
                        "badge":  "Completo",
                        "available":  true
                    },
                    {
                        "id":  "aneis_cebola",
                        "name":  "Porção Anéis de Cebola (380g)",
                        "description":  "380g de anéis de cebola empanados e super crocantes.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  22.0,
                        "available":  true
                    },
                    {
                        "id":  "porcao_viola",
                        "name":  "Porção Viola",
                        "description":  "500g de viola, 400g de polenta frita e 300g de pepino em conserva.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  60.0,
                        "available":  true
                    },
                    {
                        "id":  "coxinha_asa",
                        "name":  "Porção Coxinha da Asa (6 peças)",
                        "description":  "6 peças de coxinhas da asa crocantes e bem temperadas.",
                        "image":  "../assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  28.0,
                        "available":  true
                    }
                ],
    "bebidas":  [
                    {
                        "id":  "chopp_300",
                        "name":  "Chopp 300ml",
                        "description":  "Chopp claro geladinho na caneca 300ml.",
                        "image":  "../assets/bebidas/chopp_300.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "chopp_500",
                        "name":  "Chopp 500ml",
                        "description":  "Chopp claro geladinho na caneca 500ml.",
                        "image":  "../assets/bebidas/chopp_500.jpg",
                        "category":  "bebidas",
                        "price":  12.0,
                        "available":  true
                    },
                    {
                        "id":  "suco_uva_300",
                        "name":  "Suco de Uva 300ml",
                        "description":  "Suco de uva integral no copo 300ml.",
                        "image":  "../assets/bebidas/suco_uva_300.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "suco_uva_garrafa_500",
                        "name":  "Suco de Uva Garrafa 500ml",
                        "description":  "Garrafa de 500ml de suco de uva integral natural.",
                        "image":  "../assets/bebidas/suco_uva_garrafa_500.jpg",
                        "category":  "bebidas",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_zero_350",
                        "name":  "Coca-Cola Zero Lata 350ml",
                        "description":  "Refrigerante Coca-Cola sem açúcar lata 350ml.",
                        "image":  "../assets/bebidas/coca_zero_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_350",
                        "name":  "Coca-Cola Lata 350ml",
                        "description":  "Refrigerante Coca-Cola tradicional lata 350ml.",
                        "image":  "../assets/bebidas/coca_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "tonica_350",
                        "name":  "Água Tônica 350ml",
                        "description":  "Refrigerante água tônica lata 350ml.",
                        "image":  "../assets/bebidas/tonica_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_laranja_350",
                        "name":  "Fanta Laranja Lata 350ml",
                        "description":  "Refrigerante Fanta Laranja lata 350ml.",
                        "image":  "../assets/bebidas/fanta_laranja_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_uva_350",
                        "name":  "Fanta Uva Lata 350ml",
                        "description":  "Refrigerante Fanta Uva lata 350ml.",
                        "image":  "../assets/bebidas/fanta_uva_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_350",
                        "name":  "Guaraná Antarctica Lata 350ml",
                        "description":  "Refrigerante Guaraná Antarctica lata 350ml.",
                        "image":  "../assets/bebidas/guarana_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "brahma_zero_350",
                        "name":  "Cerveja Brahma Zero Lata 350ml",
                        "description":  "Cerveja sem álcool Brahma lata 350ml.",
                        "image":  "../assets/bebidas/brahma_zero_350.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "brahma_latao_473",
                        "name":  "Cerveja Brahma Latão 473ml",
                        "description":  "Cerveja Brahma latão 473ml trincando de gelada.",
                        "image":  "../assets/bebidas/brahma_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "polar_latao_473",
                        "name":  "Cerveja Polar Latão 473ml",
                        "description":  "Cerveja Polar latão 473ml gelada.",
                        "image":  "../assets/bebidas/polar_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "amstel_latao_473",
                        "name":  "Cerveja Amstel Latão 473ml",
                        "description":  "Cerveja puro malte Amstel latão 473ml.",
                        "image":  "../assets/bebidas/amstel_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "heineken_latao_473",
                        "name":  "Cerveja Heineken Latão 473ml",
                        "description":  "Cerveja Heineken puro malte latão 473ml.",
                        "image":  "../assets/bebidas/heineken_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  10.0,
                        "available":  true
                    },
                    {
                        "id":  "agua_sem_gas_500",
                        "name":  "Água Mineral s/ Gás 500ml",
                        "description":  "Garrafa de água mineral 500ml sem gás.",
                        "image":  "../assets/bebidas/agua_sem_gas_500.jpg",
                        "category":  "bebidas",
                        "price":  4.0,
                        "available":  true
                    },
                    {
                        "id":  "agua_com_gas_500",
                        "name":  "Água Mineral c/ Gás 500ml",
                        "description":  "Garrafa de água mineral 500ml com gás.",
                        "image":  "../assets/bebidas/agua_com_gas_500.jpg",
                        "category":  "bebidas",
                        "price":  4.0,
                        "available":  true
                    },
                    {
                        "id":  "h2o_limao_500",
                        "name":  "H2OH! Limão 500ml",
                        "description":  "Bebida levemente gaseificada H2OH! sabor limão 500ml.",
                        "image":  "../assets/bebidas/h2o_limao_500.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_600",
                        "name":  "Coca-Cola 600ml",
                        "description":  "Refrigerante Coca-Cola garrafa 600ml.",
                        "image":  "../assets/bebidas/coca_600.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_600",
                        "name":  "Guaraná Antarctica 600ml",
                        "description":  "Refrigerante Guaraná garrafa 600ml.",
                        "image":  "../assets/bebidas/guarana_600.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_1l",
                        "name":  "Coca-Cola 1 Litro",
                        "description":  "Refrigerante Coca-Cola garrafa 1L.",
                        "image":  "../assets/bebidas/coca_1l.jpg",
                        "category":  "bebidas",
                        "price":  10.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_2l",
                        "name":  "Coca-Cola 2 Litros",
                        "description":  "Refrigerante Coca-Cola garrafa 2L.",
                        "image":  "../assets/bebidas/coca_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_laranja_2l",
                        "name":  "Fanta Laranja 2 Litros",
                        "description":  "Refrigerante Fanta Laranja garrafa 2L.",
                        "image":  "../assets/bebidas/fanta_laranja_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_uva_2l",
                        "name":  "Fanta Uva 2 Litros",
                        "description":  "Refrigerante Fanta Uva garrafa 2L.",
                        "image":  "../assets/bebidas/fanta_uva_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_2l",
                        "name":  "Guaraná Antarctica 2 Litros",
                        "description":  "Refrigerante Guaraná Antarctica garrafa 2L.",
                        "image":  "../assets/bebidas/guarana_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "sprite_2l",
                        "name":  "Sprite 2 Litros",
                        "description":  "Refrigerante Sprite garrafa 2L.",
                        "image":  "../assets/bebidas/sprite_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "caipira_pequena",
                        "name":  "Caipira Pequena",
                        "description":  "Caipirinha artesanal de frutas tamanho pequeno.",
                        "image":  "../assets/bebidas/caipira_pequena.jpg",
                        "category":  "bebidas",
                        "price":  14.0,
                        "available":  true
                    },
                    {
                        "id":  "caipira_grande",
                        "name":  "Caipira Grande",
                        "description":  "Caipirinha artesanal de frutas tamanho grande.",
                        "image":  "../assets/bebidas/caipira_grande.jpg",
                        "category":  "bebidas",
                        "price":  17.0,
                        "available":  true
                    },
                    {
                        "id":  "torre_chopp_25l",
                        "name":  "Torre de Chopp 2,5 Litros",
                        "description":  "Torre de chopp com refil de gelo térmico 2,5L.",
                        "image":  "../assets/bebidas/torre_chopp_25l.jpg",
                        "category":  "bebidas",
                        "price":  55.0,
                        "badge":  "Galera",
                        "available":  true
                    },
                    {
                        "id":  "torre_chopp_35l",
                        "name":  "Torre de Chopp 3,5 Litros",
                        "description":  "Torre de chopp com refil de gelo térmico 3,5L.",
                        "image":  "../assets/bebidas/torre_chopp_35l.jpg",
                        "category":  "bebidas",
                        "price":  75.0,
                        "badge":  "Top Galera",
                        "available":  true
                    }
                ],
    "sobremesas":  [
                       {
                           "id":  "sobremesa_dia",
                           "name":  "Sobremesa do Dia",
                           "description":  "Consulte as opções de doces e sobremesas especiais disponíveis hoje.",
                           "image":  "../assets/gourmet_sobremesa.png",
                           "category":  "sobremesas",
                           "price":  15.0,
                           "available":  true
                       }
                   ]
};

/* ==========================================================================
   Initialization & Realtime State (/tables & /orders)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initWaiterIdentity();
    renderTableSelectorButtons();
    loadActiveTableState();
    fetchMenuData();
    listenToTablesAndOrdersState();
});

function autoProvisionTablesIfEmpty(snapshotVal) {
    if (!snapshotVal || Object.keys(snapshotVal).length === 0) {
        const initialTables = {};
        for (let i = 1; i <= 20; i++) {
            const num = String(i).padStart(2, '0');
            initialTables[num] = {
                tableNum: num,
                tableName: `Mesa ${num}`,
                status: 'livre',
                tableSessionId: null,
                waiterName: null,
                openedAt: null,
                lastOrderAt: null,
                total: 0,
                orderIds: []
            };
        }
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            firebase.database().ref('tables').set(initialTables);
        }
        return initialTables;
    }
    return snapshotVal;
}

function listenToTablesAndOrdersState() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        // 1. Escuta em tempo real do nó centralizado /tables
        try {
            const tablesRef = firebase.database().ref('tables');
            tablesRef.on('value', (snapshot) => {
                const val = snapshot.val();
                if (val && typeof val === 'object') {
                    firebaseTablesState = val;
                }
                renderTableSelectorButtons();
                updateTableUI();
                updateCartUI();
            }, (err) => {
                console.warn("Aviso: /tables escutado em modo fallback via /orders.");
            });
        } catch(e) {
            console.warn("Aviso na conexão de /tables:", e);
        }

        // 2. Escuta em tempo real dos pedidos /orders para conferência de itens do carrinho e mesas ocupadas
        const ordersRef = firebase.database().ref('orders');
        ordersRef.on('value', (snapshot) => {
            const data = snapshot.val();
            rawFirebaseOrders = [];
            const map = {};
            if (data) {
                Object.keys(data).forEach(key => {
                    const order = data[key];
                    if (!order) return;
                    rawFirebaseOrders.push({ ...order, firebaseKey: key });
                    const isTable = isTableOrderEntity(order);
                    const isOpen = isTable && isTableComandaOpen(order);
                    if (isOpen) {
                        const num = getCanonicalTableNumber(order);
                        const tableKey = num ? `mesa_${num}` : `mesa_${order.table || key}`;
                        const cartItems = Array.isArray(order.cart) ? order.cart : Object.values(order.cart || {});

                        if (!map[tableKey]) {
                            map[tableKey] = {
                                id: order.id,
                                tableSessionId: order.tableSessionId || order.comandaId || `mesa-${num}-${order.timestamp || order.id}`,
                                comandaId: order.tableSessionId || order.comandaId || `mesa-${num}-${order.timestamp || order.id}`,
                                firebaseKey: key,
                                orderKeys: [key],
                                table: order.table || `Mesa ${num}`,
                                mesa: num,
                                origin: order.origin || 'Garçom',
                                waiterName: order.waiterName || 'Garçom',
                                status: order.status,
                                comandaStatus: 'aberta',
                                roundsCount: Number(order.roundsCount || order.round) || 1,
                                cart: [...cartItems],
                                generalNotes: order.generalNotes || '',
                                total: Number(order.total || 0),
                                subtotal: Number(order.subtotal || 0),
                                openedAt: order.openedAt || order.timestamp || order.id,
                                time: order.time,
                                date: order.date
                            };
                        } else {
                            const existing = map[tableKey];
                            existing.orderKeys.push(key);
                            if (order.roundsCount && Number(order.roundsCount) > existing.roundsCount) {
                                existing.roundsCount = Number(order.roundsCount);
                            }
                            existing.cart.push(...cartItems);
                            existing.total += Number(order.total || 0);
                            existing.subtotal += Number(order.subtotal || 0);
                            if (order.generalNotes) {
                                existing.generalNotes += (existing.generalNotes ? ' | ' : '') + order.generalNotes;
                            }
                        }

                        if (num) {
                            map[num] = map[tableKey];
                            map[`Mesa ${num}`] = map[tableKey];
                            map[`mesa_${num}`] = map[tableKey];
                        }
                    }
                });
            }
            activeTableOrders = map;
            if (selectedTable) {
                currentOpenComanda = getActiveTableComanda(selectedTable);
            }
            renderTableSelectorButtons();
            updateTableUI();
            updateCartUI();
        });
    }
}


function initWaiterIdentity() {
    const display = document.getElementById('waiterNameDisplay');
    if (display) display.innerText = waiterName;
    const input = document.getElementById('waiterNameInput');
    if (input) input.value = waiterName === 'Garçom' ? '' : waiterName;
}

function openWaiterNameModal() {
    const modal = document.getElementById('waiterModal');
    if (modal) modal.classList.add('active');
}

function closeWaiterNameModal() {
    const modal = document.getElementById('waiterModal');
    if (modal) modal.classList.remove('active');
}

function saveWaiterName() {
    const input = document.getElementById('waiterNameInput');
    const name = input ? input.value.trim() : '';
    waiterName = name || 'Garçom';
    localStorage.setItem('garcom_waiter_name', waiterName);
    initWaiterIdentity();
    closeWaiterNameModal();
    showToast(`Identificação salva: ${waiterName}`, 'success');
}

/* ==========================================================================
   Data Synchronization (Firebase / Local Fallback)
   ========================================================================== */
function fetchMenuData() {
    const statusElem = document.getElementById('systemStatus');

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const menuRef = firebase.database().ref('menu');
        menuRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.menu_items) {
                parseMenuItems(data.menu_items, data.pizza_prices);
            } else {
                // Semeia itens padrões ou consome o fallback
                parseMenuItems(DEFAULT_MENU_ITEMS, null);
            }
            if (statusElem) {
                statusElem.innerHTML = '<span class="status-dot"></span> Firebase Conectado';
            }
        }, (err) => {
            console.warn("Erro ao ler Firebase, usando fallback local:", err);
            loadFallbackMenu();
        });
    } else {
        loadFallbackMenu();
    }
}

function loadFallbackMenu() {
    fetch('../menu.json')
        .then(res => res.json())
        .then(data => {
            if (data && data.menu_items) {
                parseMenuItems(data.menu_items, data.pizza_prices);
            } else {
                parseMenuItems(DEFAULT_MENU_ITEMS, null);
            }
        })
        .catch(() => {
            parseMenuItems(DEFAULT_MENU_ITEMS, null);
        });

    const statusElem = document.getElementById('systemStatus');
    if (statusElem) {
        statusElem.innerHTML = '<span class="status-dot" style="background: #f5a623;"></span> Modo Local';
    }
}

function resolveProductImage(item, categoryKey) {
    if (!item) return '../assets/lanches_hero.jpg';
    const id = (item.id || '').toLowerCase();
    const name = (item.name || item.titulo || item.nome || '').toLowerCase();
    let currentImg = item.image || item.imagem || '';
    if (currentImg && currentImg.startsWith('assets/')) {
        currentImg = '../' + currentImg;
    }

    const bebidaMap = {
        'chopp_300': '../assets/bebidas/chopp_300.jpg',
        'chopp_500': '../assets/bebidas/chopp_500.jpg',
        'suco_uva_300': '../assets/bebidas/suco_uva_300.jpg',
        'suco_uva_garrafa_500': '../assets/bebidas/suco_uva_garrafa_500.jpg',
        'coca_zero_350': '../assets/bebidas/coca_zero_350.jpg',
        'coca_350': '../assets/bebidas/coca_350.jpg',
        'tonica_350': '../assets/bebidas/tonica_350.jpg',
        'fanta_laranja_350': '../assets/bebidas/fanta_laranja_350.jpg',
        'fanta_uva_350': '../assets/bebidas/fanta_uva_350.jpg',
        'guarana_350': '../assets/bebidas/guarana_350.jpg',
        'brahma_zero_350': '../assets/bebidas/brahma_zero_350.jpg',
        'brahma_latao_473': '../assets/bebidas/brahma_latao_473.jpg',
        'polar_latao_473': '../assets/bebidas/polar_latao_473.jpg',
        'amstel_latao_473': '../assets/bebidas/amstel_latao_473.jpg',
        'heineken_latao_473': '../assets/bebidas/heineken_latao_473.jpg',
        'agua_sem_gas_500': '../assets/bebidas/agua_sem_gas_500.jpg',
        'agua_com_gas_500': '../assets/bebidas/agua_com_gas_500.jpg',
        'h2o_limao_500': '../assets/bebidas/h2o_limao_500.jpg',
        'coca_600': '../assets/bebidas/coca_600.jpg',
        'guarana_600': '../assets/bebidas/guarana_600.jpg',
        'coca_1l': '../assets/bebidas/coca_1l.jpg',
        'coca_2l': '../assets/bebidas/coca_2l.jpg',
        'fanta_laranja_2l': '../assets/bebidas/fanta_laranja_2l.jpg',
        'fanta_uva_2l': '../assets/bebidas/fanta_uva_2l.jpg',
        'guarana_2l': '../assets/bebidas/guarana_2l.jpg',
        'sprite_2l': '../assets/bebidas/sprite_2l.jpg',
        'caipira_pequena': '../assets/bebidas/caipira_pequena.jpg',
        'caipira_grande': '../assets/bebidas/caipira_grande.jpg',
        'torre_chopp_25l': '../assets/bebidas/torre_chopp_25l.jpg',
        'torre_chopp_35l': '../assets/bebidas/torre_chopp_35l.jpg'
    };

    if (categoryKey === 'bebidas' || (item && item.category === 'bebidas') || bebidaMap[id]) {
        if (bebidaMap[id]) return bebidaMap[id];
        if (currentImg && currentImg !== '../assets/gourmet_bebida.png' && currentImg !== '../assets/lanches_hero.jpg') {
            return currentImg;
        }
        return '../assets/bebidas/chopp_300.jpg';
    }

    // Mapeamento especÃ­fico e preciso para lanches e porÃ§Ãµes
    if (id === 'cachorro_calabresa' || (name.includes('cachorro') && name.includes('calabresa'))) {
        return '../assets/hotdog_calabresa.jpg';
    }
    if (id.includes('cachorro') || name.includes('cachorro') || name.includes('hotdog') || name.includes('hot dog')) {
        return '../assets/hotdog.jpg';
    }
    if (id.includes('pastel') || name.includes('pastel')) {
        return '../assets/pastel.jpg';
    }
    if (id.includes('torrada') || name.includes('torrada') || id.includes('misto') || name.includes('misto')) {
        return '../assets/torrada.jpg';
    }
    if (id.includes('picadao') || name.includes('picad')) {
        return '../assets/picadao.jpg';
    }
    if (id.includes('torre') || name.includes('torre')) {
        return '../assets/torre_de_batata.jpg';
    }
    if (id.includes('xis') || name.startsWith('x-') || name.includes(' xis') || name.includes('hambÃºrguer') || name.includes('hamburguer')) {
        return '../assets/xis.jpg';
    }
    if (currentImg && currentImg !== '../assets/lanches_hero.jpg' && currentImg !== '../assets/pizza_hero.png') {
        return currentImg;
    }
    if (categoryKey === 'porcoes') return '../assets/porcoes_hero.jpg';
    return '../assets/lanches_hero.jpg';
}

function parseMenuItems(menuItemsObj, pizzaPricesObj) {
    let list = [];
    let categoriesSet = new Set(['todos']);

    if (!menuItemsObj || typeof menuItemsObj !== 'object') {
        menuItemsObj = DEFAULT_MENU_ITEMS;
    }

    Object.keys(menuItemsObj).forEach(categoryKey => {
        const catItems = menuItemsObj[categoryKey];
        if (Array.isArray(catItems) || typeof catItems === 'object') {
            const itemsArr = Array.isArray(catItems) ? catItems : Object.values(catItems);
            
            itemsArr.forEach((item, index) => {
                if (!item) return;

                const itemId = item.id || `${categoryKey}_${index}`;
                const name = item.name || item.titulo || item.nome || 'Produto';
                const description = item.description || item.descricao || '';
                const category = item.category || categoryKey;
                const image = resolveProductImage(item, categoryKey);
                const badge = item.badge || '';
                const available = item.available !== false;

                let price = 0;
                if (typeof item.price === 'number') {
                    price = item.price;
                } else if (item.price) {
                    price = parseFloat(item.price) || 0;
                } else if (categoryKey === 'pizzas' && pizzaPricesObj && pizzaPricesObj.broto) {
                    price = pizzaPricesObj.broto[item.categoryType || 'promocional'] || 65.0;
                } else if (categoryKey === 'lanches') {
                    price = 25.0;
                }

                categoriesSet.add(category);

                list.push({
                    id: itemId,
                    name: name,
                    description: description,
                    category: category,
                    price: price,
                    image: image,
                    badge: badge,
                    available: available
                });
            });
        }
    });

    // Se a lista estiver vazia por qualquer motivo, carregar itens de lanches padrão
    if (list.length === 0) {
        Object.keys(DEFAULT_MENU_ITEMS).forEach(cat => {
            DEFAULT_MENU_ITEMS[cat].forEach(item => {
                categoriesSet.add(cat);
                list.push(item);
            });
        });
    }

    allProducts = list;
    renderCategoryTabs(Array.from(categoriesSet));
    renderProductsGrid();
}

function renderCategoryTabs(categories) {
    const nav = document.getElementById('categoriesNav') || document.getElementById('categoryTabsList') || document.getElementById('categoryTabsNav');
    if (!nav) return;

    nav.innerHTML = '';

    const categoryNames = {
        'todos': 'Todos',
        'lanches': '🍔 Lanches & Xis',
        'porcoes': '🍟 Porções & Torres',
        'bebidas': '🍺 Bebidas & Chopp',
        'sobremesas': '🍰 Sobremesas'
    };

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cat-pill ${activeCategory === cat ? 'active' : ''}`;
        btn.dataset.category = cat;
        btn.onclick = () => filterByCategory(cat);

        const label = categoryNames[cat.toLowerCase()] || (cat.charAt(0).toUpperCase() + cat.slice(1));
        btn.innerHTML = label;
        nav.appendChild(btn);
    });
}

function filterByCategory(cat) {
    activeCategory = cat;
    document.querySelectorAll('.cat-pill, .cat-tab').forEach(btn => {
        if (btn.dataset.category === cat) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderProductsGrid();
}

function onSearchInput() {
    const input = document.getElementById('searchInput') || document.getElementById('quickSearchInput');
    const btnClear = document.getElementById('btnClearSearch');
    if (btnClear) {
        if (input && input.value.trim().length > 0) {
            btnClear.classList.remove('display-none');
        } else {
            btnClear.classList.add('display-none');
        }
    }
    renderProductsGrid();
}

function clearSearch() {
    const input = document.getElementById('searchInput') || document.getElementById('quickSearchInput');
    if (input) {
        input.value = '';
        onSearchInput();
        input.focus();
    }
}

/* ==========================================================================
   Render Products Grid
   ========================================================================== */
function renderProductsGrid() {
    const grid = document.getElementById('productsGrid') || document.getElementById('productsGridContainer');
    const emptyState = document.getElementById('emptyProductsState') || document.getElementById('drawerEmptyState');
    if (!grid) return;

    grid.innerHTML = '';

    const searchInput = document.getElementById('searchInput') || document.getElementById('quickSearchInput');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = allProducts.filter(item => {
        if (activeCategory !== 'todos' && item.category.toLowerCase() !== activeCategory.toLowerCase()) {
            return false;
        }
        if (query) {
            const matchesName = item.name.toLowerCase().includes(query);
            const matchesDesc = (item.description || '').toLowerCase().includes(query);
            const matchesCat = (item.category || '').toLowerCase().includes(query);
            return matchesName || matchesDesc || matchesCat;
        }
        return true;
    });

    if (filtered.length === 0) {
        if (emptyState) emptyState.classList.remove('display-none');
        return;
    }

    if (emptyState) emptyState.classList.add('display-none');

    filtered.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';

        // Verifica se já está no carrinho da mesa
        const inCartItem = tableCart.find(c => c.id === product.id);
        const qtyInCart = inCartItem ? inCartItem.quantity : 0;
        if (qtyInCart > 0) {
            card.classList.add('has-in-cart');
        }

        const badgeHTML = product.badge ? `<span class="product-badge">${product.badge}</span>` : '';
        const fallbackImg = resolveProductImage(product, product.category);

        let actionControlHTML = '';
        if (qtyInCart > 0) {
            actionControlHTML = `
                <div class="product-actions">
                    <button type="button" class="btn-item-note ${inCartItem.notes ? 'has-note' : ''}" onclick="openItemNoteModal('${inCartItem.cartItemId}')" title="Adicionar Observação">
                        <span class="material-symbols-rounded">edit_note</span>
                    </button>
                    <div class="qty-stepper-control">
                        <button type="button" onclick="adjustProductQty('${product.id}', -1)">
                            <span class="material-symbols-rounded">remove</span>
                        </button>
                        <span class="qty-value">${qtyInCart}</span>
                        <button type="button" onclick="adjustProductQty('${product.id}', 1)">
                            <span class="material-symbols-rounded">add</span>
                        </button>
                    </div>
                </div>
            `;
        } else {
            actionControlHTML = `
                <div class="product-actions">
                    <button type="button" class="btn-add-simple" onclick="adjustProductQty('${product.id}', 1)" ${product.available === false ? 'disabled' : ''}>
                        <span class="material-symbols-rounded">add</span>
                        <span>Adicionar</span>
                    </button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="product-header-content">
                <img src="${product.image}" alt="${product.name}" class="product-thumbnail" loading="lazy" onerror="this.onerror=null; this.src='${fallbackImg}';">
                <div class="product-text-info">
                    <div class="product-title-row">
                        <h3 class="product-title">${product.name}</h3>
                        ${badgeHTML}
                    </div>
                    <p class="product-desc">${product.description || ''}</p>
                </div>
            </div>
            
            <div class="product-footer">
                <div class="product-price">
                    <span class="product-price-label">Preço</span>
                    <span class="product-price-val">R$ ${product.price.toFixed(2).replace('.', ',')}</span>
                </div>
                ${actionControlHTML}
            </div>
        `;

        grid.appendChild(card);
    });
}

/* ==========================================================================
   Table & Comanda Selector Logic (Múltiplas Comandas por Mesa)
   ========================================================================== */
function renderTableSelectorButtons() {
    const grid = document.getElementById('tablesGrid') || document.getElementById('tablesButtonsGrid');
    if (!grid) return;

    grid.innerHTML = '';

    // Coleta todas as mesas configuradas a partir do nÃ³ /tables
    const tableKeys = new Set();
    for (let i = 1; i <= 20; i++) {
        tableKeys.add(String(i).padStart(2, '0'));
    }
    Object.keys(firebaseTablesState || {}).forEach(k => {
        const norm = getCanonicalTableNumber(k);
        if (norm) tableKeys.add(norm);
    });

    const tablesList = Array.from(tableKeys).map(key => {
        const tData = (firebaseTablesState && firebaseTablesState[key]) || {};
        const comandas = getTableComandas(key);
        const isOccupied = comandas.length > 0;
        const isActive = tData.active !== false;
        const name = tData.tableName || `Mesa ${key}`;
        return {
            tableNum: key,
            tableName: name,
            isOccupied: isOccupied,
            isActive: isActive,
            comandas: comandas,
            total: getTableTotal(key)
        };
    });

    // OrdenaÃ§Ã£o natural numÃ©rica (01, 02, 03... 20, 21...)
    tablesList.sort((a, b) => {
        const numA = parseInt(a.tableNum, 10);
        const numB = parseInt(b.tableNum, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.tableNum.localeCompare(b.tableNum);
    });

    tablesList.forEach(t => {
        // Exibe apenas mesas ativas OU mesas que possuem comandas abertas
        if (!t.isActive && !t.isOccupied) return;

        const numFormatted = t.tableNum;
        const isSelected = selectedTable === numFormatted;
        const isOccupied = t.isOccupied;
        const tableTotal = t.total;
        const comandas = t.comandas;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn-table-choice ${isSelected ? 'selected' : ''} ${isOccupied ? 'occupied' : 'free'}`;
        btn.disabled = false;
        btn.onclick = () => onTableCardClicked(numFormatted);
        btn.title = isOccupied ? `${t.tableName} (${comandas.length} comanda${comandas.length > 1 ? 's' : ''} â€¢ R$ ${tableTotal.toFixed(2).replace('.', ',')})` : `${t.tableName} (Livre)`;

        const statusBadge = isOccupied
            ? `<span class="table-status-pill occupied">ðŸ”´ ${comandas.length} COMANDA${comandas.length > 1 ? 'S' : ''}</span>`
            : `<span class="table-status-pill free">ðŸŸ¢ LIVRE</span>`;

        btn.innerHTML = `
            <div class="table-choice-top">
                <span class="table-choice-num">${numFormatted}</span>
                <span class="table-choice-label">Mesa</span>
            </div>
            ${statusBadge}
        `;
        
        grid.appendChild(btn);
    });
}

function openTableSelectorModal() {
    const modal = document.getElementById('tableModal') || document.getElementById('tableSelectorModal');
    if (modal) {
        renderTableSelectorButtons();
        modal.classList.add('active');
    }
}

function closeTableSelectorModal() {
    const modal = document.getElementById('tableModal') || document.getElementById('tableSelectorModal');
    if (modal) modal.classList.remove('active');
}

function onTableCardClicked(tableNum) {
    const num = getCanonicalTableNumber(tableNum);
    if (!num) return;

    const comandas = getTableComandas(num);
    if (comandas.length > 0) {
        closeTableSelectorModal();
        openTableComandasModal(num);
    } else {
        closeTableSelectorModal();
        openNewComandaModal(num, 1);
    }
}

/* ==========================================================================
   Modal de Comandas da Mesa & Nova Comanda
   ========================================================================== */
function openTableComandasModal(tableNum) {
    const num = getCanonicalTableNumber(tableNum);
    pendingModalTableNum = num;

    const modal = document.getElementById('tableComandasModal');
    const title = document.getElementById('tableComandasModalTitle');
    const totalVal = document.getElementById('modalTableTotalVal');
    const countBadge = document.getElementById('modalComandasCountBadge');
    const listContainer = document.getElementById('tableComandasList');

    const comandas = getTableComandas(num);
    const totalMesa = getTableTotal(num);

    if (title) title.innerText = `Mesa ${num} — Comandas Abertas`;
    if (totalVal) totalVal.innerText = `R$ ${totalMesa.toFixed(2).replace('.', ',')}`;
    if (countBadge) countBadge.innerText = `${comandas.length} Comanda${comandas.length > 1 ? 's' : ''}`;

    if (listContainer) {
        listContainer.innerHTML = '';
        if (comandas.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhuma comanda aberta nesta mesa.</div>`;
        } else {
            comandas.forEach((cmd, idx) => {
                const card = document.createElement('div');
                const isCurrentActive = selectedTable === num && selectedComandaId && (String(cmd.id) === String(selectedComandaId) || String(cmd.firebaseKey) === String(selectedComandaId));
                card.className = `comanda-choice-card ${isCurrentActive ? 'active-selected' : ''}`;
                
                const cNum = cmd.comandaNum || (idx + 1);
                const cClient = cmd.clientName || `Comanda ${String(cNum).padStart(2, '0')}`;
                const cartItems = Array.isArray(cmd.cart) ? cmd.cart : Object.values(cmd.cart || {});
                const itemsSummary = cartItems.map(it => `${it.quantity}x ${it.name}`).join(', ') || 'Nenhum item';
                const roundsCount = cmd.roundsCount || cmd.round || 1;
                const cmdTotal = Number(cmd.total || 0).toFixed(2).replace('.', ',');

                card.onclick = () => selectSpecificComanda(num, cmd);

                card.innerHTML = `
                    <div class="comanda-choice-header">
                        <div class="comanda-client-title">
                            <span class="comanda-num-tag">#${cNum}</span>
                            <strong class="comanda-client-name">${cClient}</strong>
                        </div>
                        <span class="comanda-round-badge">${roundsCount}ª Rodada</span>
                    </div>
                    <div class="comanda-items-preview">${itemsSummary}</div>
                    <div class="comanda-choice-footer">
                        <span class="comanda-total-price">R$ ${cmdTotal}</span>
                        <span class="btn-select-comanda-action">
                            <span class="material-symbols-rounded" style="font-size: 16px;">restaurant</span>
                            <span>${isCurrentActive ? 'Atendendo' : 'Atender'}</span>
                        </span>
                    </div>
                `;

                listContainer.appendChild(card);
            });
        }
    }

    if (modal) modal.classList.add('active');
}

function closeTableComandasModal() {
    const modal = document.getElementById('tableComandasModal');
    if (modal) modal.classList.remove('active');
}

function selectSpecificComanda(tableNum, comandaObj) {
    const num = getCanonicalTableNumber(tableNum);
    selectedTable = num;
    sessionStorage.setItem('garcom_selected_table', selectedTable);

    selectedComandaId = comandaObj.firebaseKey || comandaObj.id;
    sessionStorage.setItem('garcom_selected_comanda_id', String(selectedComandaId));

    selectedClientName = comandaObj.clientName || `Comanda ${comandaObj.comandaNum || 1}`;
    sessionStorage.setItem('garcom_selected_client_name', selectedClientName);

    selectedComandaNum = comandaObj.comandaNum || 1;
    sessionStorage.setItem('garcom_selected_comanda_num', String(selectedComandaNum));

    currentOpenComanda = comandaObj;

    closeTableComandasModal();
    closeTableSelectorModal();
    updateTableUI();
    loadTableCartFromStorage();
    renderProductsGrid();

    showToast(`Mesa ${num} • ${selectedClientName} selecionada!`, 'success');
}

function openNewComandaModal(tableNum, suggestedNum = null) {
    const num = getCanonicalTableNumber(tableNum);
    pendingModalTableNum = num;

    const existingComandas = getTableComandas(num);
    const nextNum = suggestedNum || (existingComandas.length + 1);

    const modal = document.getElementById('newComandaModal');
    const title = document.getElementById('newComandaModalTitle');
    const input = document.getElementById('newComandaClientNameInput');

    if (title) title.innerText = `Nova Comanda — Mesa ${num}`;
    if (input) {
        input.value = '';
        input.placeholder = `Ex: Comanda ${String(nextNum).padStart(2, '0')}, João, Maria...`;
    }

    if (modal) {
        modal.classList.add('active');
        setTimeout(() => { if (input) input.focus(); }, 150);
    }
}

function openNewComandaModalForCurrentTable() {
    closeTableComandasModal();
    if (pendingModalTableNum) {
        openNewComandaModal(pendingModalTableNum);
    } else if (selectedTable) {
        openNewComandaModal(selectedTable);
    }
}

function closeNewComandaModal() {
    const modal = document.getElementById('newComandaModal');
    if (modal) modal.classList.remove('active');
}

function confirmNewComanda() {
    const num = getCanonicalTableNumber(pendingModalTableNum || selectedTable);
    if (!num) return;

    const input = document.getElementById('newComandaClientNameInput');
    const existingComandas = getTableComandas(num);
    const nextNum = existingComandas.length + 1;

    let clientName = input ? input.value.trim() : '';
    if (!clientName) {
        clientName = `Comanda ${String(nextNum).padStart(2, '0')}`;
    }

    selectedTable = num;
    sessionStorage.setItem('garcom_selected_table', selectedTable);

    selectedComandaId = null; // null indica nova comanda a ser criada no Firebase ao enviar
    sessionStorage.removeItem('garcom_selected_comanda_id');

    selectedClientName = clientName;
    sessionStorage.setItem('garcom_selected_client_name', selectedClientName);

    selectedComandaNum = nextNum;
    sessionStorage.setItem('garcom_selected_comanda_num', String(selectedComandaNum));

    currentOpenComanda = null;

    closeNewComandaModal();
    closeTableComandasModal();
    closeTableSelectorModal();
    updateTableUI();
    loadTableCartFromStorage();
    renderProductsGrid();

    showToast(`Iniciando ${selectedClientName} na Mesa ${selectedTable}!`, 'success');
}

function selectActiveTable(tableNum) {
    onTableCardClicked(tableNum);
}

function setCustomTable() {
    const input = document.getElementById('customTableInput');
    const val = input ? input.value.trim() : '';
    if (!val) {
        alert('Por favor, informe a identificação da mesa ou comanda.');
        return;
    }
    const normalized = getCanonicalTableNumber(val) || val;

    selectedTable = normalized;
    sessionStorage.setItem('garcom_selected_table', selectedTable);
    if (input) input.value = '';

    const comandas = getTableComandas(normalized);
    if (comandas.length > 0) {
        closeTableSelectorModal();
        openTableComandasModal(normalized);
    } else {
        closeTableSelectorModal();
        openNewComandaModal(normalized, 1);
    }
}

function loadActiveTableState() {
    const storedTable = sessionStorage.getItem('garcom_selected_table');
    if (storedTable) {
        selectedTable = normalizeTableNumber(storedTable) || storedTable;
    }
    const storedComandaId = sessionStorage.getItem('garcom_selected_comanda_id');
    if (storedComandaId) {
        selectedComandaId = storedComandaId;
    }
    const storedClient = sessionStorage.getItem('garcom_selected_client_name');
    if (storedClient) {
        selectedClientName = storedClient;
    }
    const storedNum = sessionStorage.getItem('garcom_selected_comanda_num');
    if (storedNum) {
        selectedComandaNum = Number(storedNum) || 1;
    }

    currentOpenComanda = selectedTable ? getActiveTableComanda(selectedTable, selectedComandaId) : null;
    updateTableUI();
    loadTableCartFromStorage();
}

function updateTableUI() {
    const currentTableDisplay = document.getElementById('currentTableDisplay');
    const barTableDisplay = document.getElementById('barTableDisplay');
    const drawerTableDisplay = document.getElementById('drawerTableDisplay') || document.getElementById('drawerTableTitle');
    const warningBanner = document.getElementById('tableWarningBanner');

    const num = normalizeTableNumber(selectedTable);
    const activeOrder = selectedTable ? getActiveTableComanda(selectedTable, selectedComandaId) : null;
    currentOpenComanda = activeOrder;

    const baseTableName = num ? `Mesa ${num}` : (selectedTable ? (selectedTable.toLowerCase().includes('mesa') ? selectedTable : `Mesa ${selectedTable}`) : 'Nenhuma');
    const comandaLabel = selectedClientName || (activeOrder ? (activeOrder.clientName || `Comanda ${activeOrder.comandaNum || 1}`) : 'Nova Comanda');

    if (currentTableDisplay) {
        if (selectedTable) {
            currentTableDisplay.innerHTML = `${baseTableName} <span style="color:#ffb74d; font-size:12px; margin-left:4px;">• ${comandaLabel}</span>`;
        } else {
            currentTableDisplay.innerText = 'Selecionar';
        }
    }
    if (barTableDisplay) {
        if (selectedTable) {
            barTableDisplay.innerHTML = `${baseTableName} <span style="color:#ffb74d;">• ${comandaLabel}</span>`;
        } else {
            barTableDisplay.innerText = 'Mesa --';
        }
    }
    if (drawerTableDisplay) {
        if (selectedTable) {
            drawerTableDisplay.innerHTML = `${baseTableName} • ${comandaLabel} ${activeOrder ? `<span style="color: #f5a623;">(R$ ${Number(activeOrder.total || 0).toFixed(2).replace('.', ',')})</span>` : '<span style="color: #81c784;">(Nova Comanda)</span>'}`;
        } else {
            drawerTableDisplay.innerText = 'Mesa --';
        }
    }

    if (warningBanner) {
        if (selectedTable) {
            warningBanner.classList.add('display-none');
        } else {
            warningBanner.classList.remove('display-none');
        }
    }
}

/* ==========================================================================
   Cart State & Quantity Operations (Isolado por Comanda)
   ========================================================================== */
function getCartStorageKey() {
    if (!selectedTable) return null;
    const cid = selectedComandaId || 'new';
    return `garcom_cart_${selectedTable}_${cid}`;
}

function saveTableCartToStorage() {
    const key = getCartStorageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(tableCart));
}

function loadTableCartFromStorage() {
    const key = getCartStorageKey();
    if (!key) {
        tableCart = [];
        updateCartUI();
        return;
    }
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            tableCart = JSON.parse(stored);
        } catch (e) {
            tableCart = [];
        }
    } else {
        tableCart = [];
    }
    updateCartUI();
}

function adjustProductQty(productId, delta) {
    if (!selectedTable) {
        openTableSelectorModal();
        showToast('Selecione a mesa primeiro!', 'warning');
        return;
    }

    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const existingIndex = tableCart.findIndex(item => item.id === productId);

    if (existingIndex > -1) {
        tableCart[existingIndex].quantity += delta;
        if (tableCart[existingIndex].quantity <= 0) {
            tableCart.splice(existingIndex, 1);
        } else {
            tableCart[existingIndex].totalPrice = tableCart[existingIndex].quantity * tableCart[existingIndex].singlePrice;
        }
    } else if (delta > 0) {
        const cartItemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        tableCart.push({
            cartItemId: cartItemId,
            id: product.id,
            name: product.name,
            category: product.category,
            quantity: 1,
            singlePrice: product.price,
            totalPrice: product.price,
            notes: ''
        });
    }

    saveTableCartToStorage();
    renderProductsGrid();
    updateCartUI();
}

function updateCartItemQtyByCartId(cartItemId, delta) {
    const index = tableCart.findIndex(item => item.cartItemId === cartItemId);
    if (index === -1) return;

    tableCart[index].quantity += delta;
    if (tableCart[index].quantity <= 0) {
        tableCart.splice(index, 1);
    } else {
        tableCart[index].totalPrice = tableCart[index].quantity * tableCart[index].singlePrice;
    }

    saveTableCartToStorage();
    renderProductsGrid();
    updateCartUI();
}

function removeCartItem(cartItemId) {
    const index = tableCart.findIndex(item => item.cartItemId === cartItemId);
    if (index > -1) {
        tableCart.splice(index, 1);
        saveTableCartToStorage();
        renderProductsGrid();
        updateCartUI();
    }
}

function confirmClearCart() {
    if (tableCart.length === 0) return;
    if (confirm("Deseja realmente limpar os novos itens deste pedido?")) {
        tableCart = [];
        saveTableCartToStorage();
        renderProductsGrid();
        updateCartUI();
        showToast("Itens limpos.", "warning");
    }
}

function updateCartUI() {
    const floatingBar = document.getElementById('floatingCartBar') || document.getElementById('garcomBottomBar');
    const barItemsCount = document.getElementById('barItemsCount') || document.getElementById('bottomCartCount');
    const barTotalValue = document.getElementById('barTotalValue') || document.getElementById('bottomCartTotal');

    const drawerEmpty = document.getElementById('drawerEmpty') || document.getElementById('drawerEmptyState');
    const drawerItemsList = document.getElementById('drawerItemsList');
    const orderNotesSection = document.getElementById('orderNotesSection') || document.querySelector('.table-general-notes-box');
    const drawerFooter = document.getElementById('drawerFooter') || document.querySelector('.drawer-footer');
    const drawerTotalValue = document.getElementById('drawerTotalValue');

    const activeOrder = selectedTable ? getActiveTableComanda(selectedTable, selectedComandaId) : null;
    currentOpenComanda = activeOrder;

    let newItemsCount = 0;
    let newItemsSubtotal = 0;

    tableCart.forEach(item => {
        newItemsCount += item.quantity;
        newItemsSubtotal += item.totalPrice;
    });

    const previousTotal = activeOrder ? (Number(activeOrder.total) || 0) : 0;
    const accumulatedTotal = previousTotal + newItemsSubtotal;
    const formattedAccumulatedTotal = `R$ ${accumulatedTotal.toFixed(2).replace('.', ',')}`;

    // Atualiza Barra Flutuante
    if (floatingBar) {
        if (newItemsCount > 0 || (activeOrder && activeOrder.cart && activeOrder.cart.length > 0)) {
            floatingBar.classList.add('active');
            if (barItemsCount) {
                if (newItemsCount > 0) {
                    barItemsCount.innerText = `+${newItemsCount} novo${newItemsCount === 1 ? '' : 's'} (${formattedAccumulatedTotal})`;
                } else {
                    barItemsCount.innerText = `Comanda Aberta (${formattedAccumulatedTotal})`;
                }
            }
            if (barTotalValue) barTotalValue.innerText = formattedAccumulatedTotal;
        } else {
            floatingBar.classList.remove('active');
        }
    }

    // Atualiza Drawer do Carrinho
    const hasAnyItems = tableCart.length > 0 || (activeOrder && activeOrder.cart && activeOrder.cart.length > 0);

    if (!hasAnyItems) {
        if (drawerEmpty) drawerEmpty.classList.remove('display-none');
        if (drawerItemsList) drawerItemsList.classList.add('display-none');
        if (orderNotesSection) orderNotesSection.classList.add('display-none');
        if (drawerFooter) drawerFooter.classList.add('display-none');
    } else {
        if (drawerEmpty) drawerEmpty.classList.add('display-none');
        if (drawerItemsList) drawerItemsList.classList.remove('display-none');
        if (orderNotesSection) orderNotesSection.classList.remove('display-none');
        if (drawerFooter) drawerFooter.classList.remove('display-none');
        if (drawerTotalValue) drawerTotalValue.innerText = formattedAccumulatedTotal;

        const comandaDisplayName = selectedClientName || (activeOrder ? activeOrder.clientName : 'Comanda');

        // Atualiza dinamicamente o texto do botão de envio da comanda
        const submitBtnText = document.getElementById('btnSubmitOrderText') || document.querySelector('.btn-submit-order span:last-child');
        if (submitBtnText) {
            if (activeOrder && activeOrder.cart && activeOrder.cart.length > 0) {
                const nextRound = (Number(activeOrder.roundsCount) || Number(activeOrder.round) || 1) + 1;
                if (tableCart.length === 0) {
                    submitBtnText.innerText = `➕ Adicione itens para a Rodada ${nextRound}`;
                } else {
                    submitBtnText.innerText = `Enviar Rodada ${nextRound} (${tableCart.length} ${tableCart.length === 1 ? 'item' : 'itens'})`;
                }
            } else {
                if (tableCart.length === 0) {
                    submitBtnText.innerText = `➕ Adicione produtos ao pedido`;
                } else {
                    submitBtnText.innerText = `Enviar para Cozinha (${tableCart.length} ${tableCart.length === 1 ? 'item' : 'itens'})`;
                }
            }
        }

        if (drawerItemsList) {
            drawerItemsList.innerHTML = '';

            // Se existe comanda aberta com itens anteriores já enviados
            if (activeOrder && activeOrder.cart && activeOrder.cart.length > 0) {
                const prevHeader = document.createElement('div');
                prevHeader.className = 'comanda-section-header previous';
                prevHeader.innerHTML = `
                    <span>📋 Itens já enviados na Comanda (${comandaDisplayName})</span>
                    <span>R$ ${previousTotal.toFixed(2).replace('.', ',')}</span>
                `;
                drawerItemsList.appendChild(prevHeader);

                activeOrder.cart.forEach(prevItem => {
                    const prevElem = document.createElement('div');
                    prevElem.className = 'previous-item-card';
                    const roundLabel = prevItem.round ? `<small style="color: #ffb74d; margin-left: 4px;">(Rodada ${prevItem.round})</small>` : '';
                    prevElem.innerHTML = `
                        <div>
                            <strong>${prevItem.quantity}x ${prevItem.name}</strong> ${roundLabel}
                            ${prevItem.notes ? `<div style="font-size: 11px; color: #ffb74d;">Obs: ${prevItem.notes}</div>` : ''}
                        </div>
                        <span>R$ ${Number(prevItem.totalPrice || 0).toFixed(2).replace('.', ',')}</span>
                    `;
                    drawerItemsList.appendChild(prevElem);
                });
            }

            // Seção de Novos Itens desta rodada a serem enviados
            if (tableCart.length > 0) {
                if (activeOrder && activeOrder.cart && activeOrder.cart.length > 0) {
                    const newHeader = document.createElement('div');
                    newHeader.className = 'comanda-section-header new-round';
                    const nextRound = (Number(activeOrder.roundsCount) || Number(activeOrder.round) || 1) + 1;
                    newHeader.innerHTML = `
                        <span>➕ Novos Itens a Enviar (Rodada ${nextRound})</span>
                        <span>R$ ${newItemsSubtotal.toFixed(2).replace('.', ',')}</span>
                    `;
                    drawerItemsList.appendChild(newHeader);
                }

                tableCart.forEach(item => {
                    const itemElem = document.createElement('div');
                    itemElem.className = 'cart-item-card';

                    const noteHTML = item.notes ? `<div class="cart-item-note-badge">Obs: ${item.notes}</div>` : '';

                    itemElem.innerHTML = `
                        <div class="cart-item-header">
                            <div>
                                <span class="cart-item-name">${item.name}</span>
                                ${noteHTML}
                            </div>
                            <button type="button" class="btn-remove-item" onclick="removeCartItem('${item.cartItemId}')" title="Remover item">
                                <span class="material-symbols-rounded">delete</span>
                            </button>
                        </div>
                        
                        <div class="cart-item-footer">
                            <span class="cart-item-price">R$ ${item.totalPrice.toFixed(2).replace('.', ',')}</span>
                            <div class="cart-item-controls">
                                <button type="button" class="btn-item-note ${item.notes ? 'has-note' : ''}" onclick="openItemNoteModal('${item.cartItemId}')" title="Editar Observação">
                                    <span class="material-symbols-rounded">edit_note</span>
                                </button>
                                <div class="qty-stepper-control">
                                    <button type="button" onclick="updateCartItemQtyByCartId('${item.cartItemId}', -1)">
                                        <span class="material-symbols-rounded">remove</span>
                                    </button>
                                    <span class="qty-value">${item.quantity}</span>
                                    <button type="button" onclick="updateCartItemQtyByCartId('${item.cartItemId}', 1)">
                                        <span class="material-symbols-rounded">add</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;

                    drawerItemsList.appendChild(itemElem);
                });
            }
        }
    }
}

function openCartDrawer() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (drawer) drawer.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

function closeCartDrawer() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

/* ==========================================================================
   Item Notes Modal Logic
   ========================================================================== */
function openItemNoteModal(cartItemId) {
    editingItemCartId = cartItemId;
    const item = tableCart.find(i => i.cartItemId === cartItemId);
    if (!item) return;

    const modal = document.getElementById('itemNoteModal');
    const title = document.getElementById('noteModalItemTitle');
    const textarea = document.getElementById('itemNoteText');

    if (title) title.innerText = `Obs: ${item.name}`;
    if (textarea) textarea.value = item.notes || '';

    if (modal) modal.classList.add('active');
}

function closeItemNoteModal() {
    editingItemCartId = null;
    const modal = document.getElementById('itemNoteModal');
    if (modal) modal.classList.remove('active');
}

function appendQuickTag(tagText) {
    const textarea = document.getElementById('itemNoteText');
    if (!textarea) return;

    let currentVal = textarea.value.trim();
    if (currentVal.length > 0) {
        if (!currentVal.toLowerCase().includes(tagText.toLowerCase())) {
            textarea.value = `${currentVal}, ${tagText}`;
        }
    } else {
        textarea.value = tagText;
    }
    textarea.focus();
}

function saveItemNote() {
    if (!editingItemCartId) return;
    const item = tableCart.find(i => i.cartItemId === editingItemCartId);
    if (!item) return;

    const textarea = document.getElementById('itemNoteText');
    item.notes = textarea ? textarea.value.trim() : '';

    saveTableCartToStorage();
    closeItemNoteModal();
    renderProductsGrid();
    updateCartUI();
    showToast('Observação adicionada ao item!', 'success');
}

/* ==========================================================================
   Submit Table Order to Firebase Realtime Database (Múltiplas Comandas & Rodadas)
   ========================================================================== */
async function submitTableOrder() {
    if (!selectedTable) {
        openTableSelectorModal();
        showToast('Selecione a mesa antes de enviar o pedido!', 'warning');
        return;
    }

    if (tableCart.length === 0) {
        closeCartDrawer();
        const activeOrder = selectedTable ? getActiveTableComanda(selectedTable, selectedComandaId) : null;
        const nextRound = (activeOrder && (Number(activeOrder.roundsCount) || Number(activeOrder.round) || 1)) ? ((Number(activeOrder.roundsCount) || Number(activeOrder.round) || 1) + 1) : 1;
        showToast(`Clique em "+ Adicionar" nos produtos do cardápio para montar a Rodada ${nextRound}!`, 'info');
        return;
    }

    const tableNum = normalizeTableNumber(selectedTable);
    const formattedTableName = `Mesa ${tableNum}`;

    const generalNotesInput = document.getElementById('orderGeneralNotes');
    const generalNotes = generalNotesInput ? generalNotesInput.value.trim() : '';

    let subtotalNovosItens = 0;
    tableCart.forEach(item => {
        subtotalNovosItens += (Number(item.totalPrice) || (Number(item.singlePrice) * Number(item.quantity)) || 0);
    });

    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = now.toLocaleDateString('pt-BR');

    showGlobalLoading('Verificando comanda da mesa no servidor...');

    let existingOrder = null;
    let existingKey = null;

    // 1. Procura pela comanda específica no Firebase se selectedComandaId estiver definido
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        try {
            const snapshot = await firebase.database().ref('orders').once('value');
            const ordersData = snapshot.val();
            if (ordersData) {
                if (selectedComandaId) {
                    const foundKey = Object.keys(ordersData).find(k => {
                        const ord = ordersData[k];
                        if (!ord) return false;
                        return String(k) === String(selectedComandaId) || String(ord.id) === String(selectedComandaId) || String(ord.tableSessionId) === String(selectedComandaId) || String(ord.comandaId) === String(selectedComandaId);
                    });
                    if (foundKey && isTableComandaOpen(ordersData[foundKey])) {
                        existingKey = foundKey;
                        existingOrder = { ...ordersData[foundKey], firebaseKey: foundKey };
                    }
                }
            }
        } catch (e) {
            console.warn("Aviso na consulta direta ao Firebase /orders:", e);
        }
    }

    // Fallback: busca em memória caso a consulta direta não encontre
    if (!existingOrder && selectedComandaId) {
        const cached = getActiveTableComanda(tableNum, selectedComandaId);
        if (cached && isTableComandaOpen(cached)) {
            existingOrder = cached;
            existingKey = cached.firebaseKey || cached.id;
        }
    }

    const isContinuingComanda = !!existingOrder;
    let targetOrderId;
    let orderPayload;
    let newRoundNum;
    let finalComandaTotal;

    const finalClientName = selectedClientName || (existingOrder && existingOrder.clientName) || `Comanda ${selectedComandaNum || 1}`;

    if (isContinuingComanda) {
        // CONTINUAÇÃO DE COMANDA ESPECÍFICA EXISTENTE
        targetOrderId = existingOrder.id || existingKey;
        const currentRounds = Number(existingOrder.roundsCount) || Number(existingOrder.round) || 1;
        newRoundNum = currentRounds + 1;

        const baseCart = Array.isArray(existingOrder.cart) ? [...existingOrder.cart] : Object.values(existingOrder.cart || {});

        const newCartItems = tableCart.map(item => ({
            id: item.id,
            name: item.name,
            category: item.category || 'lanches',
            quantity: Number(item.quantity) || 1,
            singlePrice: Number(item.singlePrice) || 0,
            totalPrice: Number(item.totalPrice) || (Number(item.singlePrice) * (Number(item.quantity) || 1)),
            notes: item.notes || '',
            round: newRoundNum,
            addedAt: timeFormatted,
            addedBy: waiterName || 'Garçom'
        }));

        const consolidatedCart = [...baseCart, ...newCartItems];
        finalComandaTotal = consolidatedCart.reduce((sum, it) => sum + (Number(it.totalPrice) || (Number(it.singlePrice) * Number(it.quantity)) || 0), 0);

        let combinedNotes = existingOrder.generalNotes || '';
        if (generalNotes) {
            combinedNotes = combinedNotes ? `${combinedNotes} | ${generalNotes}` : generalNotes;
        }

        const sessionTarget = existingOrder.tableSessionId || existingOrder.comandaId || `mesa-${tableNum}-c${selectedComandaNum || 1}-${targetOrderId}`;

        orderPayload = {
            ...existingOrder,
            id: targetOrderId,
            tableSessionId: sessionTarget,
            comandaId: sessionTarget,
            comandaNum: existingOrder.comandaNum || selectedComandaNum || 1,
            clientName: finalClientName,
            clientPhone: 'Mesa / Salão',
            checkoutType: 'mesa',
            table: formattedTableName,
            mesa: tableNum,
            origin: existingOrder.origin || 'Garçom',
            waiterName: waiterName || existingOrder.waiterName || 'Garçom',
            round: newRoundNum,
            roundsCount: newRoundNum,
            comandaStatus: 'aberta',
            cart: consolidatedCart,
            generalNotes: combinedNotes,
            subtotal: finalComandaTotal,
            deliveryFee: 0,
            total: finalComandaTotal,
            paymentMethod: 'mesa',
            status: 'Pendente',
            hasNewItems: true,
            openedAt: existingOrder.openedAt || existingOrder.time || timeFormatted,
            lastOrderAt: timeFormatted,
            timestamp: existingOrder.timestamp || targetOrderId,
            time: timeFormatted,
            date: existingOrder.date || dateFormatted
        };
    } else {
        // ABERTURA DE NOVA COMANDA NESTA MESA
        targetOrderId = Date.now();
        newRoundNum = 1;
        finalComandaTotal = subtotalNovosItens;
        const sessionId = `mesa-${tableNum}-c${selectedComandaNum || 1}-${targetOrderId}`;

        orderPayload = {
            id: targetOrderId,
            tableSessionId: sessionId,
            comandaId: sessionId,
            comandaNum: selectedComandaNum || 1,
            clientName: finalClientName,
            clientPhone: 'Mesa / Salão',
            checkoutType: 'mesa',
            table: formattedTableName,
            mesa: tableNum,
            origin: 'Garçom',
            waiterName: waiterName || 'Garçom',
            round: 1,
            roundsCount: 1,
            comandaStatus: 'aberta',
            cart: tableCart.map(item => ({
                id: item.id,
                name: item.name,
                category: item.category || 'lanches',
                quantity: Number(item.quantity) || 1,
                singlePrice: Number(item.singlePrice) || 0,
                totalPrice: Number(item.totalPrice) || (Number(item.singlePrice) * (Number(item.quantity) || 1)),
                notes: item.notes || '',
                round: 1,
                addedAt: timeFormatted,
                addedBy: waiterName || 'Garçom'
            })),
            generalNotes: generalNotes,
            subtotal: finalComandaTotal,
            deliveryFee: 0,
            total: finalComandaTotal,
            paymentMethod: 'mesa',
            status: 'Pendente',
            hasNewItems: false,
            openedAt: timeFormatted,
            lastOrderAt: timeFormatted,
            timestamp: targetOrderId,
            time: timeFormatted,
            date: dateFormatted
        };
    }

    const saveKey = existingKey || targetOrderId;

    function onOrderSuccess(updatedCombinedTableTotal) {
        hideGlobalLoading();
        closeCartDrawer();

        // Atualiza a comanda ativa para a que acabou de ser salva
        selectedComandaId = saveKey;
        sessionStorage.setItem('garcom_selected_comanda_id', String(selectedComandaId));

        // Limpa o carrinho local de novos itens para esta comanda
        tableCart = [];
        const currentCartKey = getCartStorageKey();
        if (currentCartKey) localStorage.removeItem(currentCartKey);
        if (generalNotesInput) generalNotesInput.value = '';

        renderProductsGrid();
        updateCartUI();

        // Abre modal de sucesso
        const successModal = document.getElementById('orderSuccessModal');
        const successTitle = document.getElementById('successOrderTitle');
        const successMsg = document.getElementById('successOrderMessage');

        if (successTitle) {
            successTitle.innerText = isContinuingComanda ? `Itens Enviados (${finalClientName})!` : `Comanda Aberta (${finalClientName})!`;
        }
        if (successMsg) {
            if (isContinuingComanda) {
                successMsg.innerHTML = `
                    <div class="success-order-desc">
                        Novos itens enviados para <strong>${finalClientName}</strong> na <strong>${formattedTableName}</strong>.
                    </div>
                    <div class="success-summary-card">
                        <div class="success-summary-row primary-row">
                            <span class="summary-name">Total da Comanda:</span>
                            <span class="summary-price">R$ ${finalComandaTotal.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div class="success-round-badge">${newRoundNum}ª rodada enviada</div>
                        <div class="success-summary-divider"></div>
                        <div class="success-summary-row secondary-row">
                            <span class="summary-name">Total Geral da Mesa:</span>
                            <span class="summary-price-muted">R$ ${updatedCombinedTableTotal.toFixed(2).replace('.', ',')}</span>
                        </div>
                    </div>
                `;
            } else {
                successMsg.innerHTML = `
                    <div class="success-order-desc">
                        Comanda <strong>${finalClientName}</strong> aberta na <strong>${formattedTableName}</strong> e enviada para a cozinha.
                    </div>
                    <div class="success-summary-card">
                        <div class="success-summary-row primary-row">
                            <span class="summary-name">Total da Comanda:</span>
                            <span class="summary-price">R$ ${finalComandaTotal.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div class="success-summary-divider"></div>
                        <div class="success-summary-row secondary-row">
                            <span class="summary-name">Total Geral da Mesa:</span>
                            <span class="summary-price-muted">R$ ${updatedCombinedTableTotal.toFixed(2).replace('.', ',')}</span>
                        </div>
                    </div>
                `;
            }
        }

        if (successModal) successModal.classList.add('active');
    }

    function onOrderError(err) {
        hideGlobalLoading();
        console.error("Erro ao enviar pedido para o Firebase:", err);
        showToast('Não foi possível enviar o pedido ao servidor. Verifique a conexão.', 'error', 5000);
    }

    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        // Calcula o total combinado de TODAS as comandas da mesa
        const otherComandas = rawFirebaseOrders.filter(o => isTableOrderEntity(o) && isTableComandaOpen(o) && getCanonicalTableNumber(o) === tableNum && String(o.id) !== String(targetOrderId) && String(o.firebaseKey) !== String(saveKey));
        const otherTotal = otherComandas.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
        const combinedTableTotal = otherTotal + finalComandaTotal;
        const totalComandasCount = otherComandas.length + 1;

        const tableNodePayload = {
            tableNum: tableNum,
            tableName: formattedTableName,
            status: 'aberta',
            tableSessionId: orderPayload.tableSessionId,
            waiterName: waiterName || 'Garçom',
            openedAt: orderPayload.openedAt,
            lastOrderAt: timeFormatted,
            total: combinedTableTotal,
            comandasCount: totalComandasCount,
            orderIds: [...otherComandas.map(c => c.id || c.firebaseKey), targetOrderId]
        };

        const promises = [
            firebase.database().ref(`orders/${saveKey}`).set(orderPayload),
            firebase.database().ref(`tables/${tableNum}`).update(tableNodePayload)
        ];

        Promise.all(promises)
            .then(() => {
                firebaseTablesState[tableNum] = tableNodePayload;
                renderTableSelectorButtons();
                updateTableUI();
                onOrderSuccess(combinedTableTotal);
            })
            .catch(err => {
                console.error("Erro crítico ao salvar pedido/mesa no Firebase:", err);
                onOrderError(err);
            });
    } else {
        fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload)
        }).then(() => onOrderSuccess(finalComandaTotal))
        .catch(() => onOrderSuccess(finalComandaTotal));
    }
}


/* ==========================================================================
   Success Modal Actions
   ========================================================================== */
function continueOnSameTable() {
    const successModal = document.getElementById('orderSuccessModal');
    if (successModal) successModal.classList.remove('active');
    showToast(`Pronto para novos itens na ${selectedTable}!`, 'success');
}

function startNewTable() {
    const successModal = document.getElementById('orderSuccessModal');
    if (successModal) successModal.classList.remove('active');
    selectedTable = null;
    sessionStorage.removeItem('garcom_selected_table');
    updateTableUI();
    loadTableCartFromStorage();
    openTableSelectorModal();
}

/* ==========================================================================
   Toast & Global Loading Helpers
   ========================================================================== */
function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconName = 'check_circle';
    if (type === 'warning') iconName = 'warning';
    if (type === 'error') iconName = 'error';

    toast.innerHTML = `
        <span class="material-symbols-rounded">${iconName}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showGlobalLoading(text = 'Carregando...') {
    const overlay = document.getElementById('globalLoading');
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.innerText = text;
    if (overlay) overlay.classList.remove('display-none');
}

function hideGlobalLoading() {
    const overlay = document.getElementById('globalLoading');
    if (overlay) overlay.classList.add('display-none');
}

/* ==========================================================================
   Backward Compatibility Global Aliases
   ========================================================================== */
window.selectCategoryTab = filterByCategory;
window.onSearchProducts = onSearchInput;
window.applyCustomTable = setCustomTable;


