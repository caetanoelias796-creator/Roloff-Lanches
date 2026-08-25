/* ==========================================================================
   Roloff Lanches - Motor do CardÃ¡pio & Delivery Online
   ========================================================================== */

// Firebase Initialization
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}

// Global State
let menuData = null;
let cart = []; // Array of cart items
let checkoutType = 'delivery'; // 'delivery' or 'pickup'
let customerLocation = null;
let currentCustomizingProduct = null;
let customizerQuantity = 1;

// Storage key isolada para Roloff Lanches
const CART_STORAGE_KEY = 'roloff_lanches_cart';

// Fallback Menu
const DEFAULT_MENU_FALLBACK = {
    "menu_items": {
    "lanches":  [
                    {
                        "id":  "cachorro_big",
                        "name":  "Cachorro Big",
                        "description":  "Molho de carne moída, 1 salsicha, vinagrete, milho, ervilha, catchup, maionese, mostarda e batata palha.",
                        "image":  "assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  18.0,
                        "badge":  "Top",
                        "available":  true,
                        "adicionais": {
                            "sache_maionese": { "name": "Sache Maionese", "price": 0.0 },
                            "sache_mostarda": { "name": "Sache Mostarda", "price": 0.0 },
                            "sache_ketchup": { "name": "Sache Ketchup", "price": 0.0 }
                        }
                    },
                    {
                        "id":  "cachorro_calabresa",
                        "name":  "Cachorro Quente Calabresa",
                        "description":  "Maionese, 120g de calabresa, milho e batata palha.",
                        "image":  "assets/hotdog_calabresa.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "cachorro_simples",
                        "name":  "Cachorro Quente Simples",
                        "description":  "Molho, 1 salsicha, maionese, milho, ervilha e batata palha.",
                        "image":  "assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  14.0,
                        "available":  true
                    },
                    {
                        "id":  "cachorro_duplo",
                        "name":  "Cachorro Quente Duplo",
                        "description":  "Molho, 2 salsichas, maionese, milho, ervilha e batata palha.",
                        "image":  "assets/hotdog.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_carne",
                        "name":  "Pastel de Carne",
                        "description":  "120g de carne bovina moída temperada, sequinho e crocante.",
                        "image":  "assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  17.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_queijo",
                        "name":  "Pastel de Queijo",
                        "description":  "120g de queijo mussarela derretido.",
                        "image":  "assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_frango_catupiry",
                        "name":  "Pastel de Frango com Catupiry",
                        "description":  "120g de frango desfiado suculento com Catupiry original.",
                        "image":  "assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "pastel_carioca",
                        "name":  "Pastel Carioca",
                        "description":  "120g de frango, queijo mussarela, presunto e orégano.",
                        "image":  "assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  19.0,
                        "badge":  "Especial",
                        "available":  true
                    },
                    {
                        "id":  "pastel_calabresa_queijo",
                        "name":  "Pastel de Calabresa com Queijo",
                        "description":  "120g de calabresa fatiada com queijo mussarela.",
                        "image":  "assets/pastel.jpg",
                        "category":  "lanches",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "misto_quente",
                        "name":  "Misto Quente",
                        "description":  "Pão fatiado tostado na chapa, maionese, queijo, presunto e orégano.",
                        "image":  "assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  13.0,
                        "available":  true
                    },
                    {
                        "id":  "torrada_pao_fatiado",
                        "name":  "Torrada Pão Fatiado",
                        "description":  "Pão fatiado tostado, maionese, queijo, presunto, alface e tomate.",
                        "image":  "assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  11.0,
                        "available":  true
                    },
                    {
                        "id":  "torrada_pao_xis",
                        "name":  "Torrada Pão de Xis",
                        "description":  "Pão de xis prensado, maionese, queijo, presunto, alface, tomate e ovo.",
                        "image":  "assets/torrada.jpg",
                        "category":  "lanches",
                        "price":  13.0,
                        "available":  true
                    },
                    {
                        "id":  "x_bacon",
                        "name":  "X-Bacon",
                        "description":  "140g de hambúrguer + 80g de bacon, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  31.0,
                        "badge":  "Favorito",
                        "available":  true
                    },
                    {
                        "id":  "x_bagunca",
                        "name":  "X-Bagunça",
                        "description":  "115g (frango, bacon, carne e calabresa), maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "badge":  "Completo",
                        "available":  true
                    },
                    {
                        "id":  "x_calabresa",
                        "name":  "X-Calabresa",
                        "description":  "115g de calabresa, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  25.0,
                        "available":  true
                    },
                    {
                        "id":  "x_carne",
                        "name":  "X-Carne",
                        "description":  "115g de iscas de carne, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "available":  true
                    },
                    {
                        "id":  "x_casa",
                        "name":  "X-Casa",
                        "description":  "140g de hambúrguer, maionese, milho, ervilha, alface, tomate, queijo, presunto, ovo e batata-frita.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  28.0,
                        "badge":  "Especialidade",
                        "available":  true
                    },
                    {
                        "id":  "x_coracao_especial",
                        "name":  "X-Coração Especial",
                        "description":  "140g de hambúrguer + 115g de coração, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Super",
                        "available":  true
                    },
                    {
                        "id":  "x_coracao_simples",
                        "name":  "X-Coração",
                        "description":  "115g de coração, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  29.0,
                        "available":  true
                    },
                    {
                        "id":  "x_costela",
                        "name":  "X-Costela",
                        "description":  "115g de costela, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Premium",
                        "available":  true
                    },
                    {
                        "id":  "x_file_acebolado",
                        "name":  "X-Filé Acebolado",
                        "description":  "115g de filé, maionese, milho, ervilha, alface, tomate, queijo, presunto, ovo, cebola e batata-frita.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  35.0,
                        "badge":  "Premium",
                        "available":  true
                    },
                    {
                        "id":  "x_frango",
                        "name":  "X-Frango",
                        "description":  "115g de frango, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  21.0,
                        "available":  true
                    },
                    {
                        "id":  "x_frango_acebolado",
                        "name":  "X-Frango Acebolado",
                        "description":  "115g frango + cebola, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  23.0,
                        "available":  true
                    },
                    {
                        "id":  "x_salada",
                        "name":  "X-Salada",
                        "description":  "Hambúrguer 140g, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
                        "category":  "lanches",
                        "price":  25.0,
                        "badge":  "Clássico",
                        "available":  true
                    },
                    {
                        "id":  "x_strogonoff",
                        "name":  "X-Strogonoff",
                        "description":  "115g de iscas de carne, molho de strogonoff, maionese, milho, ervilha, alface, tomate, queijo, presunto e ovo.",
                        "image":  "assets/xis.jpg",
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
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  30.0,
                        "available":  true
                    },
                    {
                        "id":  "batata_frita_p",
                        "name":  "Batata Frita P (500g)",
                        "description":  "Porção de 500g de batatas fritas crocantes e sequinhas.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  23.0,
                        "available":  true
                    },
                    {
                        "id":  "polenta_frita",
                        "name":  "Polenta Frita (600g)",
                        "description":  "Porção de 600g de polenta frita dourada e crocante.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  18.0,
                        "available":  true
                    },
                    {
                        "id":  "polenta_frita_queijo",
                        "name":  "Polenta Frita c/ Queijo (600g)",
                        "description":  "Porção de 600g de polenta frita coberta com queijo derretido.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  25.0,
                        "available":  true
                    },
                    {
                        "id":  "batata_bacon_800",
                        "name":  "Batata com Bacon G (800g + 120g bacon)",
                        "description":  "800g de batata frita com 120g de bacon crocante por cima.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  42.0,
                        "badge":  "Mais Pedida",
                        "available":  true
                    },
                    {
                        "id":  "batata_bacon_500",
                        "name":  "Batata com Bacon P (500g + 80g bacon)",
                        "description":  "500g de batata frita com 80g de bacon crocante por cima.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  32.0,
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_p",
                        "name":  "Torre de Batata P",
                        "description":  "800g Batata, 60g carne bovina, 60g calabresa, 120g carne suína, 120g frango, 80g bacon, Molho 4 queijos + queijo.",
                        "image":  "assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  62.0,
                        "badge":  "Especial",
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_g",
                        "name":  "Torre de Batata G",
                        "description":  "1.300 kg Batata, 120g carne suína, 120g frango, 120g carne bovina, 120g calabresa, 80g bacon, Molho 4 queijos + queijo.",
                        "image":  "assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  82.0,
                        "badge":  "Super",
                        "available":  true
                    },
                    {
                        "id":  "torre_batata_gg",
                        "name":  "Torre de Batata GG",
                        "description":  "1.600 kg Batata, 120g carne suína, 120g frango, 120g carne bovina, 120g calabresa, 120g coração, 80g bacon, Molho 4 queijos + queijo + orégano.",
                        "image":  "assets/torre_de_batata.jpg",
                        "category":  "porcoes",
                        "price":  105.0,
                        "badge":  "Gigante",
                        "available":  true
                    },
                    {
                        "id":  "picadao",
                        "name":  "Picadão Roloff",
                        "description":  "120g carne bovina, 120g frango, 120g suína, 120g calabresa, ovo de codorna, batata frita, polenta frita, queijo, pepino e azeitona.",
                        "image":  "assets/picadao.jpg",
                        "category":  "porcoes",
                        "price":  62.0,
                        "badge":  "Completo",
                        "available":  true
                    },
                    {
                        "id":  "aneis_cebola",
                        "name":  "Porção Anéis de Cebola (380g)",
                        "description":  "380g de anéis de cebola empanados e super crocantes.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  22.0,
                        "available":  true
                    },
                    {
                        "id":  "porcao_viola",
                        "name":  "Porção Viola",
                        "description":  "500g de viola, 400g de polenta frita e 300g de pepino em conserva.",
                        "image":  "assets/porcoes_hero.jpg",
                        "category":  "porcoes",
                        "price":  60.0,
                        "available":  true
                    },
                    {
                        "id":  "coxinha_asa",
                        "name":  "Porção Coxinha da Asa (6 peças)",
                        "description":  "6 peças de coxinhas da asa crocantes e bem temperadas.",
                        "image":  "assets/porcoes_hero.jpg",
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
                        "image":  "assets/bebidas/chopp_300.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "chopp_500",
                        "name":  "Chopp 500ml",
                        "description":  "Chopp claro geladinho na caneca 500ml.",
                        "image":  "assets/bebidas/chopp_500.jpg",
                        "category":  "bebidas",
                        "price":  12.0,
                        "available":  true
                    },
                    {
                        "id":  "suco_uva_300",
                        "name":  "Suco de Uva 300ml",
                        "description":  "Suco de uva integral no copo 300ml.",
                        "image":  "assets/bebidas/suco_uva_300.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "suco_uva_garrafa_500",
                        "name":  "Suco de Uva Garrafa 500ml",
                        "description":  "Garrafa de 500ml de suco de uva integral natural.",
                        "image":  "assets/bebidas/suco_uva_garrafa_500.jpg",
                        "category":  "bebidas",
                        "price":  16.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_zero_350",
                        "name":  "Coca-Cola Zero Lata 350ml",
                        "description":  "Refrigerante Coca-Cola sem açúcar lata 350ml.",
                        "image":  "assets/bebidas/coca_zero_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_350",
                        "name":  "Coca-Cola Lata 350ml",
                        "description":  "Refrigerante Coca-Cola tradicional lata 350ml.",
                        "image":  "assets/bebidas/coca_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "tonica_350",
                        "name":  "Água Tônica 350ml",
                        "description":  "Refrigerante água tônica lata 350ml.",
                        "image":  "assets/bebidas/tonica_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_laranja_350",
                        "name":  "Fanta Laranja Lata 350ml",
                        "description":  "Refrigerante Fanta Laranja lata 350ml.",
                        "image":  "assets/bebidas/fanta_laranja_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_uva_350",
                        "name":  "Fanta Uva Lata 350ml",
                        "description":  "Refrigerante Fanta Uva lata 350ml.",
                        "image":  "assets/bebidas/fanta_uva_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_350",
                        "name":  "Guaraná Antarctica Lata 350ml",
                        "description":  "Refrigerante Guaraná Antarctica lata 350ml.",
                        "image":  "assets/bebidas/guarana_350.jpg",
                        "category":  "bebidas",
                        "price":  6.0,
                        "available":  true
                    },
                    {
                        "id":  "brahma_zero_350",
                        "name":  "Cerveja Brahma Zero Lata 350ml",
                        "description":  "Cerveja sem álcool Brahma lata 350ml.",
                        "image":  "assets/bebidas/brahma_zero_350.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "brahma_latao_473",
                        "name":  "Cerveja Brahma Latão 473ml",
                        "description":  "Cerveja Brahma latão 473ml trincando de gelada.",
                        "image":  "assets/bebidas/brahma_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "polar_latao_473",
                        "name":  "Cerveja Polar Latão 473ml",
                        "description":  "Cerveja Polar latão 473ml gelada.",
                        "image":  "assets/bebidas/polar_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "amstel_latao_473",
                        "name":  "Cerveja Amstel Latão 473ml",
                        "description":  "Cerveja puro malte Amstel latão 473ml.",
                        "image":  "assets/bebidas/amstel_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "heineken_latao_473",
                        "name":  "Cerveja Heineken Latão 473ml",
                        "description":  "Cerveja Heineken puro malte latão 473ml.",
                        "image":  "assets/bebidas/heineken_latao_473.jpg",
                        "category":  "bebidas",
                        "price":  10.0,
                        "available":  true
                    },
                    {
                        "id":  "agua_sem_gas_500",
                        "name":  "Água Mineral s/ Gás 500ml",
                        "description":  "Garrafa de água mineral 500ml sem gás.",
                        "image":  "assets/bebidas/agua_sem_gas_500.jpg",
                        "category":  "bebidas",
                        "price":  4.0,
                        "available":  true
                    },
                    {
                        "id":  "agua_com_gas_500",
                        "name":  "Água Mineral c/ Gás 500ml",
                        "description":  "Garrafa de água mineral 500ml com gás.",
                        "image":  "assets/bebidas/agua_com_gas_500.jpg",
                        "category":  "bebidas",
                        "price":  4.0,
                        "available":  true
                    },
                    {
                        "id":  "h2o_limao_500",
                        "name":  "H2OH! Limão 500ml",
                        "description":  "Bebida levemente gaseificada H2OH! sabor limão 500ml.",
                        "image":  "assets/bebidas/h2o_limao_500.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_600",
                        "name":  "Coca-Cola 600ml",
                        "description":  "Refrigerante Coca-Cola garrafa 600ml.",
                        "image":  "assets/bebidas/coca_600.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_600",
                        "name":  "Guaraná Antarctica 600ml",
                        "description":  "Refrigerante Guaraná garrafa 600ml.",
                        "image":  "assets/bebidas/guarana_600.jpg",
                        "category":  "bebidas",
                        "price":  8.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_1l",
                        "name":  "Coca-Cola 1 Litro",
                        "description":  "Refrigerante Coca-Cola garrafa 1L.",
                        "image":  "assets/bebidas/coca_1l.jpg",
                        "category":  "bebidas",
                        "price":  10.0,
                        "available":  true
                    },
                    {
                        "id":  "coca_2l",
                        "name":  "Coca-Cola 2 Litros",
                        "description":  "Refrigerante Coca-Cola garrafa 2L.",
                        "image":  "assets/bebidas/coca_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_laranja_2l",
                        "name":  "Fanta Laranja 2 Litros",
                        "description":  "Refrigerante Fanta Laranja garrafa 2L.",
                        "image":  "assets/bebidas/fanta_laranja_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "fanta_uva_2l",
                        "name":  "Fanta Uva 2 Litros",
                        "description":  "Refrigerante Fanta Uva garrafa 2L.",
                        "image":  "assets/bebidas/fanta_uva_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "guarana_2l",
                        "name":  "Guaraná Antarctica 2 Litros",
                        "description":  "Refrigerante Guaraná Antarctica garrafa 2L.",
                        "image":  "assets/bebidas/guarana_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "sprite_2l",
                        "name":  "Sprite 2 Litros",
                        "description":  "Refrigerante Sprite garrafa 2L.",
                        "image":  "assets/bebidas/sprite_2l.jpg",
                        "category":  "bebidas",
                        "price":  15.0,
                        "available":  true
                    },
                    {
                        "id":  "caipira_pequena",
                        "name":  "Caipira Pequena",
                        "description":  "Caipirinha artesanal de frutas tamanho pequeno.",
                        "image":  "assets/bebidas/caipira_pequena.jpg",
                        "category":  "bebidas",
                        "price":  14.0,
                        "available":  true
                    },
                    {
                        "id":  "caipira_grande",
                        "name":  "Caipira Grande",
                        "description":  "Caipirinha artesanal de frutas tamanho grande.",
                        "image":  "assets/bebidas/caipira_grande.jpg",
                        "category":  "bebidas",
                        "price":  17.0,
                        "available":  true
                    },
                    {
                        "id":  "torre_chopp_25l",
                        "name":  "Torre de Chopp 2,5 Litros",
                        "description":  "Torre de chopp com refil de gelo térmico 2,5L.",
                        "image":  "assets/bebidas/torre_chopp_25l.jpg",
                        "category":  "bebidas",
                        "price":  55.0,
                        "badge":  "Galera",
                        "available":  true
                    },
                    {
                        "id":  "torre_chopp_35l",
                        "name":  "Torre de Chopp 3,5 Litros",
                        "description":  "Torre de chopp com refil de gelo térmico 3,5L.",
                        "image":  "assets/bebidas/torre_chopp_35l.jpg",
                        "category":  "bebidas",
                        "price":  75.0,
                        "badge":  "Top Galera",
                        "available":  true
                    }
                ]
},
    "adicionais":  {
                       "sache_maionese":  {
                                              "name":  "Sache Maionese",
                                              "price":  0.0
                                          },
                       "sache_mostarda":  {
                                              "name":  "Sache Mostarda",
                                              "price":  0.0
                                          },
                       "sache_ketchup":  {
                                             "name":  "Sache Ketchup",
                                             "price":  0.0
                                         }
                   },
    "settings":  {
                     "companyName":  "Roloff Lanches",
                     "slogan":  "Lanches Artesanais | PorÃ§Ãµes | Bebidas",
                     "whatsapp":  "",
                     "whatsappFormatted":  "",
                     "address":  "",
                     "operatingHours":  "TerÃ§a a Domingo das 18h Ã s 23h30",
                     "deliveryFees":  {

                                      },
                     "tracking":  {
                                      "metaPixelId":  "",
                                      "gtmId":  "",
                                      "ga4MeasurementId":  "",
                                      "googleAdsConversionId":  ""
                                  }
                 },
    "promo_config":  {
                         "show_popup":  false,
                         "facebook_url":  ""
                     }
};

/* ==========================================================================
   Initialization
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    loadCartFromStorage();
    fetchMenu();
    listenToStoreStatus();
    initTracking();
});

function initTracking() {
    if (typeof TrackingService !== 'undefined') {
        const trConfig = menuData?.settings?.tracking || {};
        TrackingService.init(trConfig);
        TrackingService.trackPageView();
    }
}

function listenToStoreStatus() {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('status/isOpen').on('value', (snapshot) => {
            const isOpen = snapshot.val();
            updateStoreStatusUI(isOpen !== false);
        });
    }
}

function updateStoreStatusUI(isOpen) {
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (isOpen) {
        badge.className = 'status-badge open';
        badge.innerHTML = '<span class="dot animate-pulse"></span> Aberto agora para pedidos';
    } else {
        badge.className = 'status-badge closed';
        badge.innerHTML = '<span class="dot closed-dot"></span> Fechado no momento';
    }
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */
function fetchMenu() {
    showGlobalLoading('Carregando cardápio...');
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const menuRef = firebase.database().ref('menu');
        menuRef.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val && val.menu_items) {
                menuData = val;
            } else {
                menuData = DEFAULT_MENU_FALLBACK;
            }
            applyMenuSettings();
            renderAllSections();
            hideGlobalLoading();
        }, (err) => {
            console.warn("Erro ao ler Firebase, usando fallback:", err);
            loadLocalMenuFallback();
        });
    } else {
        loadLocalMenuFallback();
    }
}

function loadLocalMenuFallback() {
    fetch('menu.json')
        .then(res => res.json())
        .then(data => {
            menuData = data || DEFAULT_MENU_FALLBACK;
            applyMenuSettings();
            renderAllSections();
            hideGlobalLoading();
        })
        .catch(() => {
            menuData = DEFAULT_MENU_FALLBACK;
            applyMenuSettings();
            renderAllSections();
            hideGlobalLoading();
        });
}

function applyMenuSettings() {
    const s = menuData?.settings || {};
    
    if (s.companyName) {
        const hTitle = document.getElementById('headerCompanyName');
        const fTitle = document.getElementById('footerCompanyName');
        if (hTitle) hTitle.innerText = s.companyName;
        if (fTitle) fTitle.innerText = s.companyName;
    }
    if (s.slogan) {
        const hSlogan = document.getElementById('headerCompanySlogan');
        const fSlogan = document.getElementById('footerCompanySlogan');
        if (hSlogan) hSlogan.innerText = s.slogan;
        if (fSlogan) fSlogan.innerText = s.slogan;
    }
    if (s.address) {
        const fAddr = document.getElementById('footerAddress');
        if (fAddr) fAddr.innerHTML = `<span class="material-symbols-rounded">location_on</span> ${s.address}`;
    }
    if (s.whatsappFormatted || s.whatsapp) {
        const fPhone = document.getElementById('footerCompanyPhone');
        if (fPhone) fPhone.innerHTML = `<span class="material-symbols-rounded">phone</span> ${s.whatsappFormatted || s.whatsapp}`;
    }
    if (s.operatingHours) {
        const fHours = document.getElementById('footerHours');
        if (fHours) fHours.innerHTML = `<span class="material-symbols-rounded">schedule</span> ${s.operatingHours}`;
    }

    populateNeighborhoodSelect(s.deliveryFees);
}

function populateNeighborhoodSelect(deliveryFees) {
    const select = document.getElementById('addressBairro');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Selecione seu bairro</option>';
    
    if (deliveryFees && typeof deliveryFees === 'object' && Object.keys(deliveryFees).length > 0) {
        const sortedKeys = Object.keys(deliveryFees).sort((a, b) => {
            const itemA = deliveryFees[a];
            const itemB = deliveryFees[b];
            const nameA = typeof itemA === 'object' && itemA ? (itemA.name || a) : a;
            const nameB = typeof itemB === 'object' && itemB ? (itemB.name || b) : b;
            return nameA.localeCompare(nameB, 'pt-BR', { sensitivity: 'base' });
        });

        let hasActive = false;
        sortedKeys.forEach(key => {
            const item = deliveryFees[key];
            if (!item) return;

            const isActive = typeof item === 'object' ? (item.active !== false) : true;
            if (!isActive) return;

            const name = (typeof item === 'object' && item.name) ? item.name : key;
            const rawFee = typeof item === 'object' ? (item.fee !== undefined ? item.fee : (item.valor !== undefined ? item.valor : 0)) : item;
            const fee = isNaN(Number(rawFee)) ? 0 : Number(rawFee);
            const feeStr = fee === 0 ? 'Grátis' : `R$ ${fee.toFixed(2).replace('.', ',')}`;

            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = `${name} (${feeStr})`;
            opt.dataset.fee = fee;
            opt.dataset.id = key;
            select.appendChild(opt);
            hasActive = true;
        });

        if (!hasActive) {
            const opt = document.createElement('option');
            opt.value = "Centro";
            opt.innerText = "Centro (Taxa a combinar)";
            opt.dataset.fee = "0";
            select.appendChild(opt);
        }
    } else {
        const opt = document.createElement('option');
        opt.value = "Centro";
        opt.innerText = "Centro (Taxa a combinar)";
        opt.dataset.fee = "0";
        select.appendChild(opt);
    }
}

/* ==========================================================================
   Catalog Rendering
   ========================================================================== */
function resolveProductImage(item, categoryKey) {
    if (!item) return 'assets/lanches_hero.jpg';
    const id = (item.id || '').toLowerCase();
    const name = (item.name || item.titulo || item.nome || '').toLowerCase();
    const currentImg = item.image || item.imagem || '';

    const bebidaMap = {
        'chopp_300': 'assets/bebidas/chopp_300.jpg',
        'chopp_500': 'assets/bebidas/chopp_500.jpg',
        'suco_uva_300': 'assets/bebidas/suco_uva_300.jpg',
        'suco_uva_garrafa_500': 'assets/bebidas/suco_uva_garrafa_500.jpg',
        'coca_zero_350': 'assets/bebidas/coca_zero_350.jpg',
        'coca_350': 'assets/bebidas/coca_350.jpg',
        'tonica_350': 'assets/bebidas/tonica_350.jpg',
        'fanta_laranja_350': 'assets/bebidas/fanta_laranja_350.jpg',
        'fanta_uva_350': 'assets/bebidas/fanta_uva_350.jpg',
        'guarana_350': 'assets/bebidas/guarana_350.jpg',
        'brahma_zero_350': 'assets/bebidas/brahma_zero_350.jpg',
        'brahma_latao_473': 'assets/bebidas/brahma_latao_473.jpg',
        'polar_latao_473': 'assets/bebidas/polar_latao_473.jpg',
        'amstel_latao_473': 'assets/bebidas/amstel_latao_473.jpg',
        'heineken_latao_473': 'assets/bebidas/heineken_latao_473.jpg',
        'agua_sem_gas_500': 'assets/bebidas/agua_sem_gas_500.jpg',
        'agua_com_gas_500': 'assets/bebidas/agua_com_gas_500.jpg',
        'h2o_limao_500': 'assets/bebidas/h2o_limao_500.jpg',
        'coca_600': 'assets/bebidas/coca_600.jpg',
        'guarana_600': 'assets/bebidas/guarana_600.jpg',
        'coca_1l': 'assets/bebidas/coca_1l.jpg',
        'coca_2l': 'assets/bebidas/coca_2l.jpg',
        'fanta_laranja_2l': 'assets/bebidas/fanta_laranja_2l.jpg',
        'fanta_uva_2l': 'assets/bebidas/fanta_uva_2l.jpg',
        'guarana_2l': 'assets/bebidas/guarana_2l.jpg',
        'sprite_2l': 'assets/bebidas/sprite_2l.jpg',
        'caipira_pequena': 'assets/bebidas/caipira_pequena.jpg',
        'caipira_grande': 'assets/bebidas/caipira_grande.jpg',
        'torre_chopp_25l': 'assets/bebidas/torre_chopp_25l.jpg',
        'torre_chopp_35l': 'assets/bebidas/torre_chopp_35l.jpg'
    };

    if (categoryKey === 'bebidas' || (item && item.category === 'bebidas') || bebidaMap[id]) {
        if (bebidaMap[id]) return bebidaMap[id];
        if (currentImg && currentImg !== 'assets/gourmet_bebida.png' && currentImg !== 'assets/lanches_hero.jpg') {
            return currentImg;
        }
        return 'assets/bebidas/chopp_300.jpg';
    }

    // Mapeamento especÃ­fico e preciso para lanches e porÃ§Ãµes
    if (id === 'cachorro_calabresa' || (name.includes('cachorro') && name.includes('calabresa'))) {
        return 'assets/hotdog_calabresa.jpg';
    }
    if (id.includes('cachorro') || name.includes('cachorro') || name.includes('hotdog') || name.includes('hot dog')) {
        return 'assets/hotdog.jpg';
    }
    if (id.includes('pastel') || name.includes('pastel')) {
        return 'assets/pastel.jpg';
    }
    if (id.includes('torrada') || name.includes('torrada') || id.includes('misto') || name.includes('misto')) {
        return 'assets/torrada.jpg';
    }
    if (id.includes('picadao') || name.includes('picad')) {
        return 'assets/picadao.jpg';
    }
    if (id.includes('torre') || name.includes('torre')) {
        return 'assets/torre_de_batata.jpg';
    }
    if (id.includes('xis') || name.startsWith('x-') || name.includes(' xis') || name.includes('hambÃºrguer') || name.includes('hamburguer')) {
        return 'assets/xis.jpg';
    }
    if (currentImg && currentImg !== 'assets/lanches_hero.jpg' && currentImg !== 'assets/pizza_hero.png') {
        return currentImg;
    }
    if (categoryKey === 'porcoes') return 'assets/porcoes_hero.jpg';
    return 'assets/lanches_hero.jpg';
}

function renderAllSections() {
    renderCategoryGrid('lanches', 'lanchesGrid');
    renderCategoryGrid('porcoes', 'porcoesGrid');
    renderCategoryGrid('bebidas', 'bebidasGrid');
    updateCartUI();
}

function renderCategoryGrid(categoryKey, gridElementId) {
    const grid = document.getElementById(gridElementId);
    if (!grid) return;

    const itemsObj = menuData?.menu_items?.[categoryKey] || DEFAULT_MENU_FALLBACK.menu_items[categoryKey] || [];
    const items = Array.isArray(itemsObj) ? itemsObj : Object.values(itemsObj);

    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = '<p class="empty-category" style="color: var(--text-muted); font-size: 14px; grid-column: 1/-1;">Nenhum produto disponível no momento.</p>';
        return;
    }

    items.forEach(item => {
        if (item.available === false) return;

        const card = document.createElement('div');
        card.className = 'menu-item-card';
        card.onclick = (e) => {
            if (!e.target.closest('button')) {
                openProductCustomizer(categoryKey, item.id);
            }
        };

        const badgeHTML = item.badge ? `<span class="product-badge">${item.badge}</span>` : '';
        const priceFormatted = Number(item.price || 0).toFixed(2).replace('.', ',');
        const fallbackImg = resolveProductImage(item, categoryKey);
        const imgSrc = resolveProductImage(item, categoryKey);

        card.innerHTML = `
            <div class="product-image-wrapper">
                <img src="${imgSrc}" alt="${item.name}" loading="lazy" onerror="this.onerror=null; this.src='${fallbackImg}'">
                ${badgeHTML}
            </div>
            <div class="product-details">
                <h3 class="product-title">${item.name}</h3>
                <p class="product-desc">${item.description || ''}</p>
                <div class="product-footer">
                    <div class="product-price-wrapper">
                        <span class="product-price-prefix">R$</span>
                        <span class="product-price">${priceFormatted}</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary" onclick="openProductCustomizer('${categoryKey}', '${item.id}')" title="Personalizar e pedir">
                        <span class="material-symbols-rounded">add</span>
                        <span>Pedir</span>
                    </button>
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}

/* ==========================================================================
   Product Customizer / Adicionais Modal
   ========================================================================== */
function openProductCustomizer(categoryKey, itemId) {
    const itemsObj = menuData?.menu_items?.[categoryKey] || DEFAULT_MENU_FALLBACK.menu_items[categoryKey] || [];
    const items = Array.isArray(itemsObj) ? itemsObj : Object.values(itemsObj);
    const item = items.find(i => String(i.id) === String(itemId));

    if (!item) return;

    currentCustomizingProduct = { ...item, categoryKey };
    customizerQuantity = 1;

    const modal = document.getElementById('customizerModal');
    const title = document.getElementById('customizerTitle');
    const desc = document.getElementById('customizerDesc');
    const img = document.getElementById('customizerHeaderImg');
    const qtySpan = document.getElementById('customizerQty');
    const notesInput = document.getElementById('itemCustomNotes');

    if (title) title.innerText = item.name;
    if (desc) desc.innerText = item.description || 'Escolha os adicionais e observações.';
    if (img) img.src = resolveProductImage(item, categoryKey);
    if (qtySpan) qtySpan.innerText = '1';
    if (notesInput) notesInput.value = '';

    // Render Adicionais Checklist
    const adicionaisList = document.getElementById('customizerAdicionaisList');
    if (adicionaisList) {
        adicionaisList.innerHTML = '';
        
        // Prioriza adicionais específicos configurados no item (ex: Cachorro Big), caso existam, ou fallback geral
        let ads = item.adicionais || item.opcionais;
        if (!ads || Object.keys(ads).length === 0) {
            ads = menuData?.adicionais || DEFAULT_MENU_FALLBACK.adicionais || {
                "sache_maionese": { "name": "Sache Maionese", "price": 0.0 },
                "sache_mostarda": { "name": "Sache Mostarda", "price": 0.0 },
                "sache_ketchup": { "name": "Sache Ketchup", "price": 0.0 }
            };
        }
        
        Object.keys(ads).forEach(adKey => {
            const ad = ads[adKey];
            const priceVal = Number(ad.price) || 0;
            const priceLabel = priceVal > 0 ? `<strong>+ R$ ${priceVal.toFixed(2)}</strong>` : '';
            
            const adRow = document.createElement('label');
            adRow.className = 'adicional-checkbox-row';
            adRow.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" name="customizer_adicionais" value="${adKey}" data-name="${ad.name}" data-price="${priceVal}">
                    <span>${ad.name}</span>
                </div>
                ${priceLabel}
            `;
            adicionaisList.appendChild(adRow);
        });
    }

    if (modal) modal.classList.add('active');
}

function closeProductCustomizer() {
    currentCustomizingProduct = null;
    const modal = document.getElementById('customizerModal');
    if (modal) modal.classList.remove('active');
}

function adjustCustomizerQty(delta) {
    customizerQuantity += delta;
    if (customizerQuantity < 1) customizerQuantity = 1;
    const span = document.getElementById('customizerQty');
    if (span) span.innerText = customizerQuantity;
}

function addCustomizedProductToCart() {
    if (!currentCustomizingProduct) return;

    const notesInput = document.getElementById('itemCustomNotes');
    const notes = notesInput ? notesInput.value.trim() : '';

    // Coleta adicionais selecionados
    const checkedBoxes = document.querySelectorAll('input[name="customizer_adicionais"]:checked');
    let selectedAdicionais = [];
    let adicionaisTotal = 0;

    checkedBoxes.forEach(cb => {
        const adName = cb.dataset.name;
        const adPrice = parseFloat(cb.dataset.price) || 0;
        selectedAdicionais.push({ name: adName, price: adPrice });
        adicionaisTotal += adPrice;
    });

    const basePrice = Number(currentCustomizingProduct.price || 0);
    const unitPrice = basePrice + adicionaisTotal;
    const totalPrice = unitPrice * customizerQuantity;

    const cartItem = {
        cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        id: currentCustomizingProduct.id,
        name: currentCustomizingProduct.name,
        category: currentCustomizingProduct.category || currentCustomizingProduct.categoryKey,
        singlePrice: unitPrice,
        basePrice: basePrice,
        adicionais: selectedAdicionais,
        quantity: customizerQuantity,
        totalPrice: totalPrice,
        notes: notes
    };

    cart.push(cartItem);
    saveCartToStorage();
    closeProductCustomizer();
    updateCartUI();
    toggleCart(true);
    showToast(`${cartItem.quantity}x ${cartItem.name} adicionado ao pedido!`, 'success');

    if (typeof TrackingService !== 'undefined') {
        TrackingService.trackAddToCart(cartItem);
    }
}

/* ==========================================================================
   Cart Management
   ========================================================================== */
function saveCartToStorage() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function loadCartFromStorage() {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
        try {
            cart = JSON.parse(stored);
        } catch (e) {
            cart = [];
        }
    } else {
        cart = [];
    }
}

function updateCartUI() {
    const countBadges = document.querySelectorAll('.cart-badge-count, #cartCountBadge');
    let totalItems = 0;
    let subtotal = 0;

    cart.forEach(item => {
        totalItems += item.quantity;
        subtotal += item.totalPrice;
    });

    countBadges.forEach(b => {
        b.innerText = totalItems;
        if (totalItems > 0) b.classList.remove('display-none');
    });

    const emptyState = document.getElementById('cartEmptyState');
    const content = document.getElementById('cartContent');
    const itemsList = document.getElementById('cartItemsList');

    if (cart.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        if (content) content.style.display = 'none';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (content) content.style.display = 'flex';

    if (itemsList) {
        itemsList.innerHTML = '';

        cart.forEach(item => {
            const itemElem = document.createElement('div');
            itemElem.className = 'cart-item-row';

            let adicionaisHTML = '';
            if (item.adicionais && item.adicionais.length > 0) {
                adicionaisHTML = `<div class="cart-item-adicionais" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">+ ${item.adicionais.map(a => a.name).join(', ')}</div>`;
            }

            let notesHTML = item.notes ? `<div class="cart-item-notes" style="font-size: 11px; color: #f5a623; margin-top: 2px;">Obs: "${item.notes}"</div>` : '';

            itemElem.innerHTML = `
                <div class="cart-item-info">
                    <h4 class="cart-item-title">${item.name}</h4>
                    ${adicionaisHTML}
                    ${notesHTML}
                    <span class="cart-item-price">R$ ${item.totalPrice.toFixed(2)}</span>
                </div>
                <div class="cart-item-actions">
                    <div class="qty-stepper">
                        <button type="button" onclick="updateCartItemQty('${item.cartItemId}', -1)">
                            <span class="material-symbols-rounded">remove</span>
                        </button>
                        <span>${item.quantity}</span>
                        <button type="button" onclick="updateCartItemQty('${item.cartItemId}', 1)">
                            <span class="material-symbols-rounded">add</span>
                        </button>
                    </div>
                </div>
            `;

            itemsList.appendChild(itemElem);
        });
    }

    const subtotalElem = document.getElementById('cartSubtotal');
    const deliveryElem = document.getElementById('cartDeliveryFee');
    const totalElem = document.getElementById('cartTotal');

    let deliveryFee = getCalculatedDeliveryFee();
    let total = subtotal + deliveryFee;

    if (subtotalElem) subtotalElem.innerText = `R$ ${subtotal.toFixed(2)}`;
    if (deliveryElem) deliveryElem.innerText = deliveryFee === 0 ? 'Grátis' : `R$ ${deliveryFee.toFixed(2)}`;
    if (totalElem) totalElem.innerText = `R$ ${total.toFixed(2)}`;
}

function updateCartItemQty(cartItemId, delta) {
    const index = cart.findIndex(i => i.cartItemId === cartItemId);
    if (index === -1) return;

    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    } else {
        cart[index].totalPrice = cart[index].singlePrice * cart[index].quantity;
    }

    saveCartToStorage();
    updateCartUI();
}

function toggleCart(open) {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (open) {
        if (drawer) drawer.classList.add('active');
        if (overlay) overlay.classList.add('active');
    } else {
        if (drawer) drawer.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
}

function getCalculatedDeliveryFee() {
    if (checkoutType === 'pickup') return 0;
    const select = document.getElementById('addressBairro');
    if (!select || !select.selectedOptions || select.selectedOptions.length === 0) return 0;
    const opt = select.selectedOptions[0];
    return opt && opt.dataset.fee ? parseFloat(opt.dataset.fee) : 0;
}

function onNeighborhoodChange() {
    updateCartUI();
    const checkoutTotal = document.getElementById('checkoutTotalValue');
    if (checkoutTotal) {
        let subtotal = 0;
        cart.forEach(i => subtotal += i.totalPrice);
        let total = subtotal + getCalculatedDeliveryFee();
        checkoutTotal.innerText = `R$ ${total.toFixed(2)}`;
    }
}

/* ==========================================================================
   Checkout Logic
   ========================================================================== */
function openCheckoutModal() {
    if (cart.length === 0) {
        showToast('Seu carrinho está vazio!', 'warning');
        return;
    }
    toggleCart(false);
    const modal = document.getElementById('checkoutModal');
    if (modal) modal.classList.add('active');
    onNeighborhoodChange();

    if (typeof TrackingService !== 'undefined') {
        TrackingService.trackInitiateCheckout(cart);
    }
}

function closeCheckoutModal() {
    const modal = document.getElementById('checkoutModal');
    if (modal) modal.classList.remove('active');
}

function setCheckoutType(type) {
    checkoutType = type;
    const delTab = document.getElementById('deliveryTab');
    const pickTab = document.getElementById('pickupTab');
    const addrSec = document.getElementById('addressSection');

    if (type === 'delivery') {
        if (delTab) delTab.classList.add('active');
        if (pickTab) pickTab.classList.remove('active');
        if (addrSec) addrSec.style.display = 'block';
    } else {
        if (pickTab) pickTab.classList.add('active');
        if (delTab) delTab.classList.remove('active');
        if (addrSec) addrSec.style.display = 'none';
    }

    onNeighborhoodChange();
}

function togglePaymentFields() {
    const selected = document.querySelector('input[name="payment-method"]:checked')?.value;
    const changeGroup = document.getElementById('cashChangeGroup');
    const pixInst = document.getElementById('pixInstructions');

    if (changeGroup) changeGroup.classList.toggle('display-none', selected !== 'cash');
    if (pixInst) pixInst.classList.toggle('display-none', selected !== 'pix');
}

function captureCustomerLocation() {
    const statusDiv = document.getElementById('locationStatus');
    const btn = document.getElementById('btnGetLocation');

    if (!navigator.geolocation) {
        alert("Geolocalização não suportada no seu navegador.");
        return;
    }

    if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.innerText = 'Obtendo localização GPS...';
    }

    navigator.geolocation.getCurrentPosition((pos) => {
        customerLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
        };
        if (statusDiv) {
            statusDiv.style.color = '#25d366';
            statusDiv.innerText = '✓ Localização GPS capturada com sucesso!';
        }
        if (btn) btn.classList.add('location-success');
    }, (err) => {
        if (statusDiv) {
            statusDiv.style.color = '#ef5350';
            statusDiv.innerText = 'Não foi possível obter a localização. Preencha seu endereço normalmente.';
        }
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function submitOrder() {
    const nameInput = document.getElementById('clientName');
    const phoneInput = document.getElementById('clientPhone');

    const clientName = nameInput ? nameInput.value.trim() : '';
    const clientPhone = phoneInput ? phoneInput.value.trim() : '';

    if (!clientName || !clientPhone) {
        showToast('Preencha seu nome e telefone para continuar!', 'warning');
        return;
    }

    let addressData = null;
    if (checkoutType === 'delivery') {
        const street = document.getElementById('addressStreet')?.value.trim();
        const number = document.getElementById('addressNumber')?.value.trim();
        const selectBairro = document.getElementById('addressBairro');
        const neighborhood = selectBairro?.value || 'Centro';
        const reference = document.getElementById('addressRef')?.value.trim() || '';

        if (!street || !number) {
            showToast('Preencha a rua e o número da sua entrega!', 'warning');
            return;
        }

        addressData = { street, number, neighborhood, reference };
    }

    const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value || 'pix';
    const cashChange = document.getElementById('cashChange')?.value.trim() || '';

    let subtotal = 0;
    cart.forEach(i => subtotal += i.totalPrice);
    const deliveryFee = getCalculatedDeliveryFee();
    const total = subtotal + deliveryFee;

    const orderId = Date.now();
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = now.toLocaleDateString('pt-BR');

    const orderData = {
        id: orderId,
        clientName: clientName,
        clientPhone: clientPhone,
        checkoutType: checkoutType,
        address: addressData,
        location: customerLocation,
        cart: cart,
        subtotal: subtotal,
        deliveryFee: deliveryFee,
        total: total,
        paymentMethod: paymentMethod,
        cashChange: cashChange,
        status: 'Pendente',
        timestamp: orderId,
        time: timeFormatted,
        date: dateFormatted
    };

    showGlobalLoading('Gravando seu pedido...');

    function proceedToWhatsApp() {
        hideGlobalLoading();
        closeCheckoutModal();
        cart = [];
        saveCartToStorage();
        updateCartUI();

        if (typeof TrackingService !== 'undefined') {
            TrackingService.trackPurchase(orderData);
        }

        // WhatsApp do restaurante ou fallback
        let targetPhone = (menuData?.settings?.whatsapp || '').replace(/\D/g, '');
        if (!targetPhone) targetPhone = '5554999999999';
        if (targetPhone.length === 10 || targetPhone.length === 11) targetPhone = '55' + targetPhone;

        const message = buildOrderWhatsAppMessage(orderData);
        const url = `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(message)}`;
        try {
            const win = window.open(url, '_blank');
            if (!win || win.closed || typeof win.closed === 'undefined') {
                window.location.href = url;
            }
        } catch (e) {
            window.location.href = url;
        }
    }

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('orders/' + orderId).set(orderData)
            .then(() => proceedToWhatsApp())
            .catch(() => proceedToWhatsApp());
    } else {
        proceedToWhatsApp();
    }
}

function buildOrderWhatsAppMessage(order) {
    let text = `🍔 *NOVO PEDIDO - ROLOFF LANCHES* 🍔\n`;
    text += `*Pedido:* #${order.id}\n`;
    text += `*Data:* ${order.date} às ${order.time}\n\n`;
    text += `👤 *Cliente:* ${order.clientName}\n`;
    text += `📱 *Telefone:* ${order.clientPhone}\n`;
    text += `📍 *Tipo:* ${order.checkoutType === 'delivery' ? 'Entrega (Delivery)' : 'Retirada no Balcão'}\n`;

    if (order.checkoutType === 'delivery' && order.address) {
        text += `🏠 *Endereço:* ${order.address.street}, Nº ${order.address.number} - Bairro ${order.address.neighborhood}\n`;
        if (order.address.reference) text += `📌 *Ref:* ${order.address.reference}\n`;
    }

    text += `\n📋 *ITENS DO PEDIDO:*\n`;
    order.cart.forEach(item => {
        text += `• *${item.quantity}x ${item.name}* - R$ ${item.totalPrice.toFixed(2)}\n`;
        if (item.adicionais && item.adicionais.length > 0) {
            text += `   + Adicionais: ${item.adicionais.map(a => a.name).join(', ')}\n`;
        }
        if (item.notes) {
            text += `   Obs: "${item.notes}"\n`;
        }
    });

    text += `\n💰 *VALORES:*\n`;
    text += `Subtotal: R$ ${order.subtotal.toFixed(2)}\n`;
    text += `Taxa de Entrega: ${order.deliveryFee === 0 ? 'Grátis' : `R$ ${order.deliveryFee.toFixed(2)}`}\n`;
    text += `*TOTAL: R$ ${order.total.toFixed(2)}*\n\n`;

    const payMap = { pix: 'Pix', card: 'Cartão na Entrega', cash: 'Dinheiro' };
    text += `💳 *Forma de Pagamento:* ${payMap[order.paymentMethod] || order.paymentMethod}\n`;
    if (order.paymentMethod === 'cash' && order.cashChange) {
        text += `💵 *Troco para:* ${order.cashChange}\n`;
    }

    return text;
}

/* ==========================================================================
   Helpers
   ========================================================================= */
function setActiveCategoryTab(event, sectionId) {
    if (event) event.preventDefault();
    const links = document.querySelectorAll('.categories-nav .nav-link');
    links.forEach(l => l.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');

    const target = document.getElementById(sectionId);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
    }
}

function onSearchInput() {
    const input = document.getElementById('searchInput');
    const term = (input ? input.value : '').toLowerCase().trim();
    const cards = document.querySelectorAll('.menu-item-card');

    cards.forEach(card => {
        const title = card.querySelector('.product-title')?.innerText.toLowerCase() || '';
        const desc = card.querySelector('.product-desc')?.innerText.toLowerCase() || '';
        if (title.includes(term) || desc.includes(term)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function openPromoModal() {
    const modal = document.getElementById('promoModal');
    if (modal) modal.classList.add('active');
}

function closePromoModal() {
    const modal = document.getElementById('promoModal');
    if (modal) modal.classList.remove('active');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="material-symbols-rounded">check_circle</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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


