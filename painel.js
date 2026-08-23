/* ==========================================================================
   Firebase Initialization
   ========================================================================== */
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}

/* ==========================================================================
   State Variables
   ========================================================================== */
let orders = [];
let filterStatus = 'Todos';
let soundEnabled = true;
let lastOrdersCount = 0;
let knownOrderIds = new Set();
let firebaseTablesState = {}; // Realtime /tables node from Firebase (tables 01 to 20)

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
    if (order.checkoutType === 'mesa' || order.origin === 'Garçom') return true;
    if (order.mesa !== undefined && order.mesa !== null && String(order.mesa).trim() !== '') return true;
    if (order.tableSessionId || order.comandaId) return true;
    if (order.table && /mesa/i.test(String(order.table))) return true;
    return false;
}

function isTableComandaOpen(order) {
    if (!order || !isTableOrderEntity(order)) return false;
    if (order.status === 'Cancelado') return false;
    if (order.comandaStatus === 'fechada' || order.comandaStatus === 'encerrada' || order.comandaStatus === 'paga' || order.status === 'Encerrado' || order.status === 'Finalizado') {
        return false;
    }
    if (order.closedAt) return false;
    if (order.comandaStatus === 'aberta') return true;
    return order.status !== 'Entregue';
}

function getTableGroupingKey(order) {
    if (!isTableOrderEntity(order)) return null;
    const norm = getCanonicalTableNumber(order);
    if (norm) {
        return `mesa_${norm}`;
    }
    return `mesa_${order.id || 'desconhecido'}`;
}

let isUnifyingDuplicates = false;
function unifyDuplicateTableOrdersInFirebase(ordersArray) {
    if (isUnifyingDuplicates) return;
    if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0) return;
    if (!Array.isArray(ordersArray) || ordersArray.length === 0) return;

    // Agrupa apenas tickets que pertencem à MESMA COMANDA ID para evitar unificar comandas diferentes da mesma mesa
    const activeComandasMap = {};
    ordersArray.forEach(ord => {
        if (!isTableOrderEntity(ord) || !isTableComandaOpen(ord)) return;
        const tableNum = getCanonicalTableNumber(ord);
        if (!tableNum) return;
        const comandaKey = ord.tableSessionId || ord.comandaId || `mesa_${tableNum}_c${ord.comandaNum || ord.id}`;
        if (!activeComandasMap[comandaKey]) {
            activeComandasMap[comandaKey] = [];
        }
        activeComandasMap[comandaKey].push(ord);
    });

    const comandasWithDuplicates = Object.keys(activeComandasMap).filter(k => activeComandasMap[k].length > 1);
    if (comandasWithDuplicates.length === 0) return;

    isUnifyingDuplicates = true;

    comandasWithDuplicates.forEach(comandaKey => {
        const comandaOrders = activeComandasMap[comandaKey];
        comandaOrders.sort((a, b) => (Number(a.timestamp || a.id) || 0) - (Number(b.timestamp || b.id) || 0));

        const primaryOrder = comandaOrders[0];
        const primaryKey = primaryOrder.firebaseKey || primaryOrder.id;
        const primarySession = primaryOrder.tableSessionId || primaryOrder.comandaId || comandaKey;

        const consolidatedCart = [];
        let maxRound = 1;
        let notesCombined = '';

        comandaOrders.forEach((ticket, tIdx) => {
            const tCart = Array.isArray(ticket.cart) ? ticket.cart : Object.values(ticket.cart || {});
            const ticketRound = Number(ticket.round || ticket.roundsCount) || (tIdx + 1);
            if (ticketRound > maxRound) maxRound = ticketRound;

            tCart.forEach(item => {
                const itemRound = Number(item.round) || ticketRound;
                if (itemRound > maxRound) maxRound = itemRound;
                consolidatedCart.push({
                    ...item,
                    round: itemRound
                });
            });

            if (ticket.generalNotes && !notesCombined.includes(ticket.generalNotes)) {
                notesCombined += (notesCombined ? ' | ' : '') + ticket.generalNotes;
            }
        });

        const totalConsolidado = consolidatedCart.reduce((sum, it) => {
            return sum + (Number(it.totalPrice) || (Number(it.singlePrice) * Number(it.quantity)) || 0);
        }, 0);

        const primaryUpdate = {
            tableSessionId: primarySession,
            comandaId: primarySession,
            cart: consolidatedCart,
            total: totalConsolidado,
            subtotal: totalConsolidado,
            round: maxRound,
            roundsCount: maxRound,
            comandaStatus: 'aberta',
            generalNotes: notesCombined || primaryOrder.generalNotes || '',
            relatedOrderIds: comandaOrders.map(t => t.id)
        };

        firebase.database().ref(`orders/${primaryKey}`).update(primaryUpdate).catch(e => console.warn("Aviso ao unificar primário:", e));

        for (let i = 1; i < comandaOrders.length; i++) {
            const secOrder = comandaOrders[i];
            const secKey = secOrder.firebaseKey || secOrder.id;
            firebase.database().ref(`orders/${secKey}`).update({
                comandaStatus: 'fechada',
                status: 'Entregue',
                closedAt: Date.now(),
                mergedInto: String(primaryKey),
                hasNewItems: false
            }).catch(e => console.warn("Aviso ao unificar secundário:", e));
        }
    });

    setTimeout(() => { isUnifyingDuplicates = false; }, 3000);
}

/* ==========================================================================
   Initialization & Authentication
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    checkAuthentication();
});

function checkAuthentication() {
    const loginOverlay = document.getElementById('loginOverlay');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                console.log("✅ Firebase Auth verificado com sucesso!");
                console.log("• User UID:", user.uid);
                console.log("• User Email:", user.email);
                console.log("• Database URL:", firebase.app().options?.databaseURL);
                
                sessionStorage.setItem('painel_authenticated', 'true');
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (dashboardWrapper) dashboardWrapper.style.display = 'grid';
                
                if (!appStarted) {
                    startApp();
                } else {
                    // Re-attach realtime listeners with authenticated auth socket
                    setupFirebaseRealtime();
                }
            } else {
                console.log("🔒 Nenhum usuário autenticado no Firebase Auth. Aguardando login...");
                sessionStorage.removeItem('painel_authenticated');
                if (loginOverlay) loginOverlay.style.display = 'flex';
                if (dashboardWrapper) dashboardWrapper.style.display = 'none';
            }
        });
    } else {
        const isAuthenticated = sessionStorage.getItem('painel_authenticated') === 'true';
        if (isAuthenticated) {
            if (loginOverlay) loginOverlay.style.display = 'none';
            if (dashboardWrapper) dashboardWrapper.style.display = 'grid';
            startApp();
        } else {
            if (loginOverlay) loginOverlay.style.display = 'flex';
            if (dashboardWrapper) dashboardWrapper.style.display = 'none';
        }
    }
}

let appStarted = false;
function startApp() {
    if (appStarted) return;
    appStarted = true;
    
    initPWA();
    initMenuSync(); // Synchronize menu items and prices
    initShopStatus(); // Synchronize shop status (open/closed)
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        setupFirebaseRealtime();
    } else {
        fetchOrders(true); // First load, suppress chime sound
        
        // Set up polling every 5 seconds
        setInterval(() => {
            fetchOrders(false);
        }, 5000);
    }
}

function handleLoginSubmit(event) {
    event.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const errorDiv = document.getElementById('loginError');
    
    const email = emailInput ? emailInput.value.trim() : '';
    const inputPass = passwordInput ? passwordInput.value.trim() : '';
    
    if (!email || !inputPass) {
        showToast('Preencha o e-mail e a senha!', 'warning');
        return;
    }

    // Chave mestra administrativa para contingência
    const isMasterPass = (inputPass === 'roloff2026' || inputPass === 'roloff123' || inputPass === 'admin123');
    
    showLoading('Verificando credenciais...');
    
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signInWithEmailAndPassword(email, inputPass)
        .then((userCredential) => {
            hideLoading();
            const user = userCredential.user;
            console.log("✅ Firebase Auth: Login efetuado com sucesso!", user?.email);
            
            sessionStorage.setItem('painel_authenticated', 'true');
            if (errorDiv) errorDiv.classList.add('display-none');
            const loginOverlay = document.getElementById('loginOverlay');
            const dashboardWrapper = document.querySelector('.dashboard-wrapper');
            if (loginOverlay) loginOverlay.style.display = 'none';
            if (dashboardWrapper) dashboardWrapper.style.display = 'grid';
            startApp();
            showToast('Acesso autorizado ao painel!', 'success');
        })
        .catch((err) => {
            console.error("Erro Firebase Auth:", err.code, err.message);
            
            // Se utilizou senha mestra administrativa de contingência
            if (isMasterPass) {
                hideLoading();
                console.log("🔓 Acesso liberado via Chave Mestra Administrativa!");
                sessionStorage.setItem('painel_authenticated', 'true');
                if (errorDiv) errorDiv.classList.add('display-none');
                const loginOverlay = document.getElementById('loginOverlay');
                const dashboardWrapper = document.querySelector('.dashboard-wrapper');
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (dashboardWrapper) dashboardWrapper.style.display = 'grid';
                startApp();
                showToast('Acesso liberado (Modo Administrador)!', 'success');
                return;
            }

            hideLoading();
            let msg = 'E-mail ou senha incorretos!';
            if (err.code === 'auth/unauthorized-domain') {
                msg = 'Domínio GitHub não autorizado no Firebase Console! Use a senha mestra: roloff2026';
            } else if (err.code === 'auth/user-not-found') {
                msg = 'Usuário não cadastrado no Firebase Auth. Verifique o e-mail ou use a senha mestra: roloff2026';
            } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                msg = 'Senha incorreta para este e-mail. (Senha mestra alternativa: roloff2026)';
            } else if (err.code === 'auth/too-many-requests') {
                msg = 'Muitas tentativas. Aguarde um minuto ou use a senha mestra: roloff2026';
            } else if (err.code === 'auth/invalid-email') {
                msg = 'Formato de e-mail inválido.';
            }

            if (errorDiv) {
                errorDiv.innerHTML = `<span class="material-symbols-rounded">error</span> ${msg}`;
                errorDiv.classList.remove('display-none');
            }
            passwordInput.value = '';
            passwordInput.focus();
            showToast(msg, 'error', 6000);
        });
    } else {
        hideLoading();
        if (isMasterPass) {
            sessionStorage.setItem('painel_authenticated', 'true');
            if (errorDiv) errorDiv.classList.add('display-none');
            const loginOverlay = document.getElementById('loginOverlay');
            const dashboardWrapper = document.querySelector('.dashboard-wrapper');
            if (loginOverlay) loginOverlay.style.display = 'none';
            if (dashboardWrapper) dashboardWrapper.style.display = 'grid';
            startApp();
            showToast('Acesso liberado!', 'success');
        } else {
            if (errorDiv) errorDiv.classList.remove('display-none');
            showToast('Serviço de autenticação indisponível.', 'error');
        }
    }
}

function handleLogout(event) {
    if (event) event.preventDefault();
    if (confirm("Deseja realmente sair do painel do Roloff Lanches?")) {
        showLoading('Encerrando sessão...');
        sessionStorage.removeItem('painel_authenticated');
        if (typeof firebase !== 'undefined' && firebase.auth) {
            firebase.auth().signOut()
            .then(() => {
                hideLoading();
                window.location.reload();
            })
            .catch(err => {
                hideLoading();
                console.error("Erro ao fazer logout:", err);
                window.location.reload();
            });
        } else {
            hideLoading();
            window.location.reload();
        }
    }
}

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

function setupFirebaseRealtime() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    
    // 1. Escuta em tempo real do nó centralizado /tables
    const tablesRef = firebase.database().ref('tables');
    tablesRef.off();
    tablesRef.on('value', (snapshot) => {
        const val = snapshot.val();
        firebaseTablesState = autoProvisionTablesIfEmpty(val);
        if (currentSection === 'tables') {
            renderTablesDashboard();
        }
    }, (err) => {
        console.error("Erro na escuta de /tables no Firebase:", err);
    });

    // 2. Escuta em tempo real de /orders
    const ordersRef = firebase.database().ref('orders');
    ordersRef.off();
    
    ordersRef.on('value', (snapshot) => {
        const data = snapshot.val();
        let ordersArray = [];
        
        if (data) {
            ordersArray = Object.keys(data).map(key => {
                return {
                    ...data[key],
                    firebaseKey: key
                };
            });
        }
        
        // Sort newest first
        ordersArray.sort((a, b) => b.timestamp - a.timestamp);
        
        const oldOrders = [...orders];
        orders = ordersArray;
        
        // Auto-unifica registros legados duplicados no Firebase
        unifyDuplicateTableOrdersInFirebase(ordersArray);
        
        // Check for new orders or updated tables with new items to play chime sound
        let hasNewPending = false;
        orders.forEach(order => {
            const isNew = !knownOrderIds.has(order.id);
            const isTableNewItems = order.hasNewItems && order.status === 'Pendente';
            if ((order.status === 'Pendente' && isNew) || isTableNewItems) {
                hasNewPending = true;
            }
            knownOrderIds.add(order.id);
        });
        
        if (hasNewPending && oldOrders.length > 0) {
            playNotificationSound();
        }
        
        updateIndicators();
        renderOrdersList();
        if (currentSection === 'tables') {
            renderTablesDashboard();
        }
        
        // Trigger background debounced auto-backup of order snapshot safely
        triggerCentralAutoBackup();
        
        // Update server status text to Cloud
        const serverStatus = document.querySelector('.server-status');
        if (serverStatus) {
            serverStatus.className = 'server-status active';
            serverStatus.innerHTML = '<span class="dot" style="background-color: #81c784;"></span> Firebase Cloud';
        }
    }, (error) => {
        console.error("Erro na escuta dos pedidos no Realtime Database (/orders):", error);
        if (error.code === 'PERMISSION_DENIED') {
            console.warn("Aviso: Conexão temporária negada. O listener será re-anexado após validação de auth.");
        }
    });
}

/* ==========================================================================
   Data Fetching & Polling
   ========================================================================== */
function fetchOrders(isFirstLoad = false) {
    fetch('/api/orders')
        .then(res => res.json())
        .then(data => {
            const oldOrders = [...orders];
            orders = data;
            
            // Check for new orders to play chime sound
            let hasNewPending = false;
            orders.forEach(order => {
                if (order.status === 'Pendente' && !knownOrderIds.has(order.id)) {
                    hasNewPending = true;
                    knownOrderIds.add(order.id);
                }
                // Also ensure we keep track of already seen orders
                knownOrderIds.add(order.id);
            });
            
            if (hasNewPending && !isFirstLoad) {
                playNotificationSound();
            }
            
            updateIndicators();
            renderOrdersList();
            if (currentSection === 'tables') {
                renderTablesDashboard();
            }
        })
        .catch(err => {
            console.error("Error fetching orders:", err);
            const serverStatus = document.querySelector('.server-status');
            if (serverStatus) {
                serverStatus.className = 'server-status';
                serverStatus.innerHTML = '<span class="dot" style="background-color: #c62828;"></span> Offline';
            }
        });
}

/* ==========================================================================
   Update Dashboard Metrics
   ========================================================================== */
function updateIndicators() {
    const pendingCount = orders.filter(o => o.status === 'Pendente').length;
    const preparandoCount = orders.filter(o => o.status === 'Preparando').length;
    const entregaCount = orders.filter(o => o.status === 'Entrega').length;
    
    // Revenue counts only delivered orders today
    const revenue = orders
        .filter(o => o.status === 'Entregue')
        .reduce((sum, o) => sum + o.total, 0);
        
    document.getElementById('pendingCount').innerText = pendingCount;
    document.getElementById('preparandoCount').innerText = preparandoCount;
    document.getElementById('entregaCount').innerText = entregaCount;
    document.getElementById('revenueCount').innerText = `R$ ${revenue.toFixed(2)}`;
}

/* ==========================================================================
   Sound Notification (Web Audio API Synthesizer)
   ========================================================================== */
function playNotificationSound() {
    if (!soundEnabled) return;
    try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        
        // Chime: Rising double beep (E5 then A5)
        const osc1 = context.createOscillator();
        const gain1 = context.createGain();
        osc1.connect(gain1);
        gain1.connect(context.destination);
        
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(659.25, context.currentTime); // E5
        gain1.gain.setValueAtTime(0, context.currentTime);
        gain1.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.05);
        gain1.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
        osc1.start(context.currentTime);
        osc1.stop(context.currentTime + 0.35);
        
        const osc2 = context.createOscillator();
        const gain2 = context.createGain();
        osc2.connect(gain2);
        gain2.connect(context.destination);
        
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.00, context.currentTime + 0.12); // A5
        gain2.gain.setValueAtTime(0, context.currentTime + 0.12);
        gain2.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.17);
        gain2.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.45);
        osc2.start(context.currentTime + 0.12);
        osc2.stop(context.currentTime + 0.5);
    } catch (e) {
        console.warn("AudioContext notification failed:", e);
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    const icon = document.getElementById('soundIcon');
    const label = document.querySelector('#soundToggle span:not(.material-symbols-rounded)');
    
    if (soundEnabled) {
        icon.innerText = 'volume_up';
        label.innerText = 'Som Ligado';
        document.getElementById('soundToggle').classList.remove('disabled');
    } else {
        icon.innerText = 'volume_off';
        label.innerText = 'Som Mutado';
        document.getElementById('soundToggle').classList.add('disabled');
    }
}

/* ==========================================================================
   Filter & Rendering
   ========================================================================== */
function setFilter(status) {
    filterStatus = status;
    
    // Toggle active tab class
    document.querySelectorAll('.filter-tab').forEach(tab => {
        if (tab.getAttribute('data-status') === status) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    renderOrdersList();
}

function renderOrdersList() {
    const grid = document.getElementById('ordersListGrid');
    const emptyState = document.getElementById('emptyState');
    grid.innerHTML = '';
    
    // Agrupa pedidos de mesa abertos usando chave canônica de comanda para cards individuais na cozinha
    const processedTableKeys = new Set();
    const processedOrderIds = new Set();
    const displayList = [];

    orders.forEach(order => {
        if (!order) return;
        const orderIdStr = String(order.id);
        const fbKeyStr = order.firebaseKey ? String(order.firebaseKey) : null;
        
        if (processedOrderIds.has(orderIdStr) || (fbKeyStr && processedOrderIds.has(fbKeyStr))) {
            return;
        }

        const isTable = isTableOrderEntity(order);
        const isComandaAberta = isTable && isTableComandaOpen(order);

        if (isTable && isComandaAberta) {
            const tableNum = getCanonicalTableNumber(order);
            const canonicalComandaKey = order.tableSessionId || order.comandaId || `mesa_${tableNum}_c${order.comandaNum || order.id}`;
            const cNum = order.comandaNum || 1;
            const cName = order.clientName || `Comanda ${String(cNum).padStart(2, '0')}`;
            const formattedTableLabel = `Mesa ${tableNum || '01'} • ${cName}`;

            if (processedTableKeys.has(canonicalComandaKey)) {
                return;
            }
            processedTableKeys.add(canonicalComandaKey);

            // Reúne os registros que pertencem a ESTA mesma comanda específica
            const relatedTickets = orders.filter(o => {
                if (!o) return false;
                const oIsTable = isTableOrderEntity(o);
                const oIsOpen = isTableComandaOpen(o);
                if (!oIsTable || !oIsOpen) return false;

                const oKey = o.tableSessionId || o.comandaId || `mesa_${getCanonicalTableNumber(o)}_c${o.comandaNum || o.id}`;
                return oKey === canonicalComandaKey || String(o.id) === String(order.id) || (o.firebaseKey && String(o.firebaseKey) === String(order.firebaseKey));
            });

            // Marca todos os tickets relacionados como processados
            relatedTickets.forEach(t => {
                processedOrderIds.add(String(t.id));
                if (t.firebaseKey) processedOrderIds.add(String(t.firebaseKey));
            });

            // Ordena por data/timestamp mais antigo primeiro (primeiro pedido/rodada primeiro)
            relatedTickets.sort((a, b) => (Number(a.timestamp || a.id) || 0) - (Number(b.timestamp || b.id) || 0));

            const consolidatedCart = [];
            let notesCombined = '';
            let hasAnyPending = false;
            let maxRound = 1;
            const roundsBreakdown = [];

            relatedTickets.forEach((ticket, ticketIndex) => {
                const tCart = Array.isArray(ticket.cart) ? ticket.cart : Object.values(ticket.cart || {});
                const ticketRound = Number(ticket.round || ticket.roundsCount) || (ticketIndex + 1);
                if (ticketRound > maxRound) maxRound = ticketRound;

                let roundSubtotal = 0;
                tCart.forEach(item => {
                    const itemRound = Number(item.round) || ticketRound;
                    if (itemRound > maxRound) maxRound = itemRound;
                    const itemPrice = Number(item.totalPrice) || (Number(item.singlePrice) * (Number(item.quantity) || 1)) || 0;
                    roundSubtotal += itemPrice;
                    consolidatedCart.push({
                        ...item,
                        round: itemRound
                    });
                });

                roundsBreakdown.push({
                    roundNumber: ticketRound,
                    orderId: ticket.id,
                    status: ticket.status || 'Pendente',
                    time: ticket.time || ticket.addedAt || '',
                    total: (roundSubtotal > 0 ? roundSubtotal : Number(ticket.total || 0)),
                    itemsCount: tCart.length
                });

                if (ticket.generalNotes && !notesCombined.includes(ticket.generalNotes)) {
                    notesCombined += (notesCombined ? ' | ' : '') + ticket.generalNotes;
                }
                if (ticket.status === 'Pendente' || ticket.hasNewItems) {
                    hasAnyPending = true;
                }
            });

            // CÁLCULO PRECISO DO TOTAL DA COMANDA
            let totalSum = consolidatedCart.reduce((sum, it) => sum + (Number(it.totalPrice) || (Number(it.singlePrice) * (Number(it.quantity)) || 0), 0);
            if (totalSum === 0 && Number(order.total) > 0) {
                totalSum = Number(order.total);
            }

            const mainTicket = relatedTickets[0] || order;
            const latestTicket = relatedTickets[relatedTickets.length - 1] || mainTicket;
            const sessionKey = mainTicket.tableSessionId || mainTicket.comandaId || canonicalComandaKey;

            let overallStatus = 'Preparando';
            if (hasAnyPending) {
                overallStatus = 'Pendente';
            } else if (relatedTickets.some(t => t.status === 'Preparando')) {
                overallStatus = 'Preparando';
            } else if (relatedTickets.some(t => t.status === 'Entrega' || t.status === 'Pronto')) {
                overallStatus = 'Entrega';
            }

            const consolidatedOrder = {
                ...mainTicket,
                id: mainTicket.id,
                firebaseKey: mainTicket.firebaseKey,
                relatedOrderIds: relatedTickets.map(t => t.id),
                relatedFirebaseKeys: relatedTickets.map(t => t.firebaseKey || t.id),
                relatedTickets: relatedTickets,
                roundsBreakdown: roundsBreakdown,
                checkoutType: 'mesa',
                table: formattedTableLabel,
                mesa: tableNum,
                clientName: cName,
                clientPhone: 'Mesa / Salão',
                origin: mainTicket.origin || 'Garçom',
                waiterName: latestTicket.waiterName || mainTicket.waiterName || 'Garçom',
                comandaId: sessionKey,
                tableSessionId: sessionKey,
                comandaStatus: 'aberta',
                cart: consolidatedCart,
                total: totalSum,
                subtotal: totalSum,
                status: overallStatus,
                hasNewItems: hasAnyPending && (consolidatedCart.length > 1 || relatedTickets.length > 1),
                roundsCount: maxRound,
                round: maxRound,
                generalNotes: notesCombined || mainTicket.generalNotes || '',
                openedAt: mainTicket.openedAt || mainTicket.time || 'Recente',
                time: latestTicket.time || mainTicket.time,
                date: latestTicket.date || mainTicket.date,
                timestamp: mainTicket.timestamp || mainTicket.id
            };

            displayList.push(consolidatedOrder);
        } else {
            // Delivery, Balcão ou Comandas já encerradas
            processedOrderIds.add(String(order.id));
            if (order.firebaseKey) processedOrderIds.add(String(order.firebaseKey));
            displayList.push(order);
        }
    });

    const filtered = displayList.filter(order => {
        if (filterStatus === 'Todos') return true;
        if (filterStatus === 'Mesas') {
            const isTable = isTableOrderEntity(order);
            const isActive = isTableComandaOpen(order);
            return isTable && isActive;
        }
        return order.status === filterStatus;
    });
    
    if (filtered.length === 0) {
        emptyState.classList.remove('display-none');
        grid.classList.add('display-none');
        return;
    }
    
    emptyState.classList.add('display-none');
    grid.classList.remove('display-none');
    
    filtered.forEach(order => {
        const card = document.createElement('div');
        card.className = 'order-card';
        
        const isTableOrder = isTableOrderEntity(order);
        const normTable = normalizeTableNumber(order.mesa || order.table || order.tableSessionId || order.comandaId);
        const tableLabel = isTableOrder ? (normTable ? `Mesa ${normTable}` : (order.table || 'Mesa Salão')) : (order.table || 'Balcão');

        // Items list formatting
        let itemsHTML = '';
        const orderCart = order.cart || [];
        orderCart.forEach(item => {
            const roundBadge = item.round ? `<span style="display: inline-block; font-size: 10px; background: rgba(245, 166, 35, 0.2); color: #f5a623; border: 1px solid rgba(245, 166, 35, 0.4); padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: 700;">Rodada ${item.round}</span>` : '';
            if (item.type === 'pizza') {
                itemsHTML += `
                    <div class="order-item-row">
                        <span class="order-item-qty-name">${item.quantity}x Pizza ${item.sizeName} ${roundBadge}</span>
                        <span class="order-item-price">R$ ${Number(item.totalPrice || 0).toFixed(2)}</span>
                    </div>
                    <div class="order-item-details">
                        Sabores: ${(item.flavorNames || []).join(' e ')}<br>
                        Borda: ${item.borderName || 'Tradicional'}
                        ${item.notes ? `<br><strong style="color: #f5a623;">Obs:</strong> "${item.notes}"` : ''}
                    </div>
                `;
            } else {
                itemsHTML += `
                    <div class="order-item-row">
                        <span class="order-item-qty-name">${item.quantity}x ${item.name} ${roundBadge}</span>
                        <span class="order-item-price">R$ ${Number(item.totalPrice || 0).toFixed(2)}</span>
                    </div>
                    ${item.notes ? `<div class="order-item-details" style="color: #f5a623; font-weight: 500;"><strong style="color: #f5a623;">Obs:</strong> "${item.notes}"</div>` : ''}
                `;
            }
        });
        
        // Status button progression
        let actionButtonHTML = '';
        let cancelButtonHTML = '';
        let closeComandaBtnHTML = '';
        const isComandaAberta = isTableOrder && isTableComandaOpen(order);
        
        // Compute accumulated total for comanda if active
        let totalDisplayVal = Number(order.total || 0);
        let totalLabelText = isTableOrder ? 'Total da Comanda' : (order.checkoutType === 'delivery' ? 'Total Pedido' : 'Total Geral');
        if (isTableOrder && isComandaAberta) {
            if (order.roundsCount > 1 || (order.relatedOrderIds && order.relatedOrderIds.length > 1)) {
                const countRounds = order.roundsCount || order.relatedOrderIds.length;
                totalLabelText = `Total da Comanda (${countRounds} rodadas)`;
            }
        }

        if (isComandaAberta) {
            const comandaTargetId = order.mesa || order.table || order.comandaId || order.id;
            closeComandaBtnHTML = `
                <button type="button" class="btn-close-comanda" onclick="finalizeTableComanda('${comandaTargetId}')" title="Encerrar comanda e liberar a mesa para novos clientes" style="background: linear-gradient(135deg, #2e7d32, #1b5e20); color: #ffffff; border: 1px solid rgba(76, 175, 80, 0.4); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-rounded" style="font-size: 16px;">point_of_sale</span>
                    <span>Encerrar Mesa</span>
                </button>
            `;
        }

        if (order.status === 'Pendente') {
            actionButtonHTML = `
                <button class="btn-status-next" onclick="updateOrderStatus(${order.id}, 'Preparando')">
                    <span class="material-symbols-rounded">play_arrow</span>
                    ${isTableOrder ? 'Aceitar Pedido' : 'Aceitar'}
                </button>
            `;
            cancelButtonHTML = `<button class="btn-cancel" onclick="updateOrderStatus(${order.id}, 'Cancelado')">Recusar</button>`;
        } else if (order.status === 'Preparando') {
            actionButtonHTML = `
                <button class="btn-status-next" onclick="updateOrderStatus(${order.id}, 'Entrega')">
                    <span class="material-symbols-rounded">${isTableOrder ? 'restaurant' : 'delivery_dining'}</span>
                    ${isTableOrder ? 'Pronto (Servir)' : 'Pronto'}
                </button>
            `;
            cancelButtonHTML = `<button class="btn-cancel" onclick="updateOrderStatus(${order.id}, 'Cancelado')">Cancelar</button>`;
        } else if (order.status === 'Entrega') {
            const notifyBtn = (!isTableOrder && order.clientPhone && order.clientPhone !== 'Mesa / Salão') ? `
                <button class="btn-whatsapp-notify" onclick="notifyCustomerReady(${order.id})" title="Enviar WhatsApp avisando que está pronto">
                    <span class="material-symbols-rounded">chat</span>
                    Avisar Cliente
                </button>
            ` : '';
            actionButtonHTML = `
                ${notifyBtn}
                <button class="btn-status-next" onclick="updateOrderStatus(${order.id}, 'Entregue')">
                    <span class="material-symbols-rounded">check</span>
                    ${isTableOrder ? 'Servido (Mesa)' : 'Entregar'}
                </button>
            `;
        }
        
        // Address formatted
        let addressHTML = 'Retirada no Balcão';
        if (order.checkoutType === 'delivery' && order.address) {
            const addr = order.address;
            addressHTML = `${addr.street}, nº ${addr.number}<br>Bairro: ${addr.neighborhood}${addr.reference ? `<br>Ref: ${addr.reference}` : ''}`;
        } else if (isTableOrder) {
            addressHTML = `Consumo no Local • Mesa ${tableLabel}`;
        }
        
        // Payment formatted
        const payments = { 'pix': 'Pix', 'card': 'Cartão (Maquininha)', 'cash': 'Dinheiro', 'mesa': 'Pagamento na Mesa / Caixa' };
        let paymentHTML = payments[order.paymentMethod] || (order.paymentMethod ? order.paymentMethod.toUpperCase() : 'Na Mesa / Caixa');
        if (order.paymentMethod === 'cash' && order.cashChange) {
            paymentHTML += ` (Troco para R$ ${Number(order.cashChange).toFixed(2)})`;
        }
        
        const activeMotoboysList = getActiveMotoboys();
        let assignedId = order.assignedMotoboyId || '';
        let currentFeeVal = (order.motoboyFee !== undefined && order.motoboyFee !== null) ? Number(order.motoboyFee) : Number(order.deliveryFee || 0);

        let motoboySelectOptionsHTML = `<option value="">-- Selecionar Motoboy --</option>`;
        activeMotoboysList.forEach(m => {
            const isSel = String(m.id) === String(assignedId) ? 'selected' : '';
            motoboySelectOptionsHTML += `<option value="${m.id}" ${isSel}>${m.name}</option>`;
        });

        let motoboyAssignmentHTML = '';
        if (order.checkoutType === 'delivery' && order.address) {
            motoboyAssignmentHTML = `
                <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 8px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; font-size: 12px;">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 170px;">
                        <span class="material-symbols-rounded" style="color: #25d366; font-size: 16px;">two_wheeler</span>
                        <span style="font-weight: 600; color: var(--text-light);">Motoboy:</span>
                        <select style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); font-size: 12px; flex: 1;" onchange="assignMotoboyToOrder('${order.id}', this.value)">
                            ${motoboySelectOptionsHTML}
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-weight: 600; color: var(--text-light);">Corrida (R$):</span>
                        <input type="number" step="0.50" value="${currentFeeVal.toFixed(2)}" style="width: 70px; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); font-size: 12px;" onchange="updateOrderMotoboyFee('${order.id}', this.value)" title="Valor da corrida pago a este motoboy">
                    </div>
                </div>
            `;
        }

        // Destaque visual especial para mesa
        let tableHeaderBadge = '';
        let tableCustomerDetailsHTML = '';
        let tipoDisplay = order.checkoutType === 'delivery' ? '🚗 Tele-Entrega' : '🏪 Retirada no Balcão';

        if (isTableOrder) {
            tipoDisplay = `🍽️ Mesa / Salão (Origem: ${order.origin || 'Garçom'})`;
            const roundsTag = (Number(order.roundsCount || order.round) > 1) ? ` (${order.roundsCount || order.round}º Pedido)` : '';
            const newItemsBadge = (order.hasNewItems && order.status === 'Pendente') ? `<span class="status-badge" style="background: #e53935; color: #fff; font-weight: 800; animation: pulse 1.5s infinite; margin-left: 4px;">🔥 NOVO PEDIDO</span>` : '';
            const comandaBadge = isComandaAberta
                ? `<span class="status-badge" style="background: rgba(37, 211, 102, 0.2); color: #25d366; border: 1px solid rgba(37, 211, 102, 0.4); font-weight: 700; margin-left: 4px;">Conta Aberta${roundsTag}</span>`
                : `<span class="status-badge" style="background: rgba(255, 255, 255, 0.1); color: #aaa; margin-left: 4px;">Conta Encerrada</span>`;

            tableHeaderBadge = `<span class="status-badge" style="background: linear-gradient(135deg, #e65100, #f57c00); color: #ffffff; font-weight: 800; border: 1px solid rgba(255,255,255,0.2); margin-right: 6px;">🍽️ ${tableLabel.toUpperCase()}</span> ${comandaBadge} ${newItemsBadge}`;
            
            // Resumo visual das rodadas/pedidos se houver consolidação
            let roundsBreakdownHTML = '';
            if (order.roundsBreakdown && order.roundsBreakdown.length > 1) {
                roundsBreakdownHTML = `
                    <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(245, 166, 35, 0.3); border-radius: 6px; padding: 6px 10px; margin-top: 6px; margin-bottom: 6px;">
                        <div style="font-weight: 700; color: #f5a623; font-size: 11px; margin-bottom: 4px; display: flex; justify-content: space-between;">
                            <span>📋 Pedidos/Rodadas Consolidadas:</span>
                            <span>${order.roundsBreakdown.length} rodadas</span>
                        </div>
                        ${order.roundsBreakdown.map((r, idx) => `
                            <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; color: var(--text-light); border-bottom: 1px dashed rgba(255,255,255,0.06);">
                                <span><strong>${idx === 0 ? 'Pedido A' : (idx === 1 ? 'Pedido B' : `Pedido ${idx + 1}`)} (Rodada ${r.roundNumber}):</strong> ${r.itemsCount} item(ns)</span>
                                <span style="font-weight: 700; color: #ffffff;">R$ ${Number(r.total || 0).toFixed(2).replace('.', ',')}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            tableCustomerDetailsHTML = `
                <div class="customer-row" style="background: rgba(245, 166, 35, 0.12); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(245, 166, 35, 0.3); margin-bottom: 6px;">
                    <span class="label" style="color: #f5a623; font-weight: 700;">🍽️ Mesa:</span>
                    <span class="value" style="color: #ffffff; font-weight: 800; font-size: 14px;">${tableLabel} • ${isComandaAberta ? '🟢 Conta Aberta' : '⚪ Conta Fechada'} • Garçom: ${order.waiterName || 'Garçom'}</span>
                </div>
                ${roundsBreakdownHTML}
            `;
        }

        const generalNotesHTML = (order.generalNotes || (isTableOrder && order.notes)) ? `
            <div style="background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; padding: 6px 10px; border-radius: 4px; margin-top: 8px; font-size: 12px; color: #ffe082;">
                <strong>Obs. Geral da Mesa:</strong> ${order.generalNotes || order.notes}
            </div>
        ` : '';

        // Horário de Retirada / Previsão Combinada
        let pickupTimeHTML = '';
        const currentPickupTime = (order.pickupTime || order.horarioRetirada || '').trim();
        if (order.checkoutType === 'pickup' || !order.checkoutType || order.checkoutType === 'balcao') {
            pickupTimeHTML = `
                <div class="customer-row" style="background: rgba(245, 166, 35, 0.08); padding: 6px 8px; border-radius: 4px; border: 1px dashed rgba(245, 166, 35, 0.3); margin-top: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span class="label" style="color: #f5a623; font-weight: 600;">🕐 Previsão / Retirada:</span>
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <input type="text" id="pickupInput_${order.id}" value="${currentPickupTime}" placeholder="Ex: 19:45" style="width: 85px; padding: 3px 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); text-align: center;" onkeydown="if(event.key==='Enter') savePickupTime(${order.id})">
                        <button type="button" onclick="savePickupTime(${order.id})" style="background: #f5a623; color: #111; border: none; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">Salvar</button>
                    </div>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="order-card-header">
                <div>
                    <span class="order-id">#${order.id}</span>
                    <span class="order-time">${order.time}</span>
                    ${tableHeaderBadge}
                </div>
                <span class="status-badge ${order.status.toLowerCase()}">${order.status}</span>
            </div>
            
            <div class="order-customer-details">
                ${tableCustomerDetailsHTML}
                <div class="customer-row">
                    <span class="label">Cliente:</span>
                    <span class="value">${order.clientName}</span>
                </div>
                ${!isTableOrder ? `
                <div class="customer-row">
                    <span class="label">Telefone:</span>
                    <span class="value">
                        <a href="https://wa.me/55${order.clientPhone.replace(/\D/g, '')}" target="_blank" style="color: var(--primary); text-decoration: none;">
                            ${order.clientPhone}
                        </a>
                    </span>
                </div>
                ` : ''}
                <div class="customer-row">
                    <span class="label">Tipo:</span>
                    <span class="value">${tipoDisplay}</span>
                </div>
                <div class="customer-row">
                    <span class="label">Entrega:</span>
                    <div class="value" style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                        <span>${addressHTML}</span>
                        ${order.checkoutType === 'delivery' && order.address ? `
                            <div style="display: flex; gap: 6px; margin-top: 4px;">
                                <button type="button" class="btn-motoboy-link-share" onclick="sendCustomMotoboyWhatsApp('${order.id}')" title="Enviar corrida completa para o WhatsApp de qualquer entregador" style="background: #25d366; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600;">
                                    <span class="material-symbols-rounded" style="font-size: 16px;">chat</span>
                                    <span>WhatsApp Motoboy</span>
                                </button>
                                ${(order.location && order.location.latitude && order.location.longitude) ? `
                                    <button type="button" class="btn-motoboy-link-gps" onclick="openGoogleMapsLink('${order.id}')" title="Abrir localização GPS real do cliente no Google Maps" style="background: #e53935; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600;">
                                        <span class="material-symbols-rounded" style="font-size: 16px;">location_on</span>
                                        <span>📍 ABRIR LOCALIZAÇÃO</span>
                                    </button>
                                ` : `
                                    <button type="button" class="btn-motoboy-link-share" onclick="openGoogleMapsLink('${order.id}')" title="Abrir localização no Google Maps" style="background: rgba(255,255,255,0.08); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 12px;">
                                        <span class="material-symbols-rounded" style="font-size: 16px;">map</span>
                                    </button>
                                `}
                            </div>
                        ` : ''}
                        ${motoboyAssignmentHTML}
                    </div>
                </div>
                <div class="customer-row">
                    <span class="label">Pagamento:</span>
                    <span class="value">${paymentHTML}</span>
                </div>
                ${pickupTimeHTML}
                ${generalNotesHTML}
            </div>
            
            <div class="order-items-summary">
                <div class="summary-title">Itens do Pedido</div>
                <div class="order-item-list">
                    ${itemsHTML}
                </div>
            </div>
            
            <div class="order-card-footer">
                <div class="footer-total">
                    <span class="label">${totalLabelText}</span>
                    <h5 class="value">R$ ${totalDisplayVal.toFixed(2)}</h5>
                </div>
                
                <div class="footer-actions">
                    ${cancelButtonHTML}
                    ${order.checkoutType === 'delivery' && order.address ? `
                        <button class="btn-motoboy" onclick="sendToMotoboy('${order.id}')" title="Enviar para Motoboy (Google Maps)">
                            <span class="material-symbols-rounded">two_wheeler</span>
                            <span>Motoboy</span>
                        </button>
                    ` : ''}
                    <button class="btn-print" onclick="printOrderTicket(${order.id})" title="Imprimir Cupom Completo">
                        <span class="material-symbols-rounded">print</span>
                    </button>
                    <button class="btn-print btn-print-kitchen" onclick="printKitchenTicket(${order.id})" title="Imprimir Via Cozinha">
                        <span class="material-symbols-rounded">local_pizza</span>
                    </button>
                    ${closeComandaBtnHTML}
                    ${actionButtonHTML}
                </div>
            </div>
        `;
        
        grid.appendChild(card);
    });
    
    // Update reports in real-time when orders list is updated
    if (typeof renderReportsDashboard === 'function') {
        renderReportsDashboard();
    }
}

/* ==========================================================================
   Motoboy Navigation & Location Helper Functions
   ========================================================================== */
function buildMotoboyAddressQuery(order) {
    if (!order || order.checkoutType !== 'delivery' || !order.address) return '';
    const addr = order.address;
    
    const parts = [];
    if (addr.street) parts.push(addr.street);
    if (addr.number) parts.push(`nº ${addr.number}`);
    if (addr.neighborhood) parts.push(`Bairro ${addr.neighborhood}`);
    
    const city = addr.city || 'Nova Petrópolis';
    const state = addr.state || 'RS';
    parts.push(`${city}, ${state}`);
    
    return parts.join(', ');
}

function getActiveMotoboys() {
    const list = [];
    const settings = (menuData && menuData.settings) ? menuData.settings : {};
    
    for (let i = 1; i <= 10; i++) {
        const nameKey = i === 1 ? (settings.motoboy1Name ? 'motoboy1Name' : (settings.motoboyName ? 'motoboyName' : 'motoboy1Name')) : `motoboy${i}Name`;
        const wspKey = i === 1 ? (settings.motoboy1Whatsapp ? 'motoboy1Whatsapp' : (settings.motoboyWhatsapp ? 'motoboyWhatsapp' : 'motoboy1Whatsapp')) : `motoboy${i}Whatsapp`;
        
        const mName = (settings[nameKey] || '').trim();
        const mWsp = (settings[wspKey] || '').trim();
        if (mName || mWsp) {
            list.push({ id: i, name: mName || `Motoboy ${i}`, whatsapp: mWsp.replace(/\D/g, '') });
        }
    }

    return list;
}

function assignMotoboyToOrder(orderId, motoboyId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;
    
    const motoboys = getActiveMotoboys();
    const sel = motoboys.find(m => String(m.id) === String(motoboyId));
    
    if (sel) {
        order.assignedMotoboyId = sel.id;
        order.assignedMotoboyName = sel.name;
        order.assignedMotoboyWhatsapp = sel.whatsapp;
    } else {
        order.assignedMotoboyId = '';
        order.assignedMotoboyName = '';
        order.assignedMotoboyWhatsapp = '';
    }
    
    if (order.motoboyFee === undefined || order.motoboyFee === null) {
        order.motoboyFee = Number(order.deliveryFee || 0);
    }

    const updates = {
        assignedMotoboyId: order.assignedMotoboyId,
        assignedMotoboyName: order.assignedMotoboyName,
        assignedMotoboyWhatsapp: order.assignedMotoboyWhatsapp,
        motoboyFee: Number(order.motoboyFee)
    };

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const refKey = order.firebaseKey || order.id;
        firebase.database().ref(`orders/${refKey}`).update(updates);
    } else {
        fetch(`/api/orders/${order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    }

    renderOrders();
    renderReportsDashboard();
}

function updateOrderMotoboyFee(orderId, feeVal) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;
    
    const fee = parseFloat(feeVal) || 0;
    order.motoboyFee = fee;

    const updates = { motoboyFee: fee };
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const refKey = order.firebaseKey || order.id;
        firebase.database().ref(`orders/${refKey}`).update(updates);
    } else {
        fetch(`/api/orders/${order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    }

    renderReportsDashboard();
}

function buildGoogleMapsUrl(order) {
    if (order && order.location && order.location.latitude && order.location.longitude) {
        return `https://www.google.com/maps/dir/?api=1&destination=${order.location.latitude},${order.location.longitude}`;
    }
    const addressStr = buildMotoboyAddressQuery(order) || buildCustomerAddress(order);
    if (!addressStr) return '';
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressStr)}`;
}

function openGoogleMapsLink(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order || order.checkoutType !== 'delivery' || (!order.address && !order.location)) {
        alert('Este pedido não possui endereço de entrega.');
        return;
    }
    
    const mapsUrl = buildGoogleMapsUrl(order);
    if (!mapsUrl) {
        alert('Não foi possível gerar a localização para este endereço.');
        return;
    }
    
    window.open(mapsUrl, '_blank');
}

function buildCustomerAddress(order) {
    if (!order) return '';
    if (typeof order.address === 'string' && order.address.trim()) {
        return order.address.trim();
    }
    const addr = order.address || order.endereco || {};
    if (typeof addr === 'string' && addr.trim()) return addr.trim();

    const rua = addr.street || addr.rua || addr.logradouro || '';
    const numero = addr.number || addr.numero || '';
    const bairro = addr.neighborhood || addr.bairro || '';
    const cidade = addr.city || addr.cidade || '';
    const estado = addr.state || addr.estado || addr.uf || '';
    const cep = addr.cep || addr.zip || '';
    const ref = addr.reference || addr.complemento || addr.referencia || addr.obs || '';

    const parts = [];
    if (rua) {
        if (numero) {
            parts.push(`${rua}, ${numero}`);
        } else {
            parts.push(rua);
        }
    } else if (numero) {
        parts.push(`Número ${numero}`);
    }

    if (bairro) parts.push(`Bairro ${bairro}`);
    if (cidade) parts.push(cidade);
    if (estado) parts.push(estado);
    if (cep) parts.push(`CEP ${cep}`);
    if (ref) parts.push(`Ref: ${ref}`);

    if (parts.length === 0 && order.fullAddress) {
        return String(order.fullAddress).trim();
    }

    return parts.join(', ');
}

function sendToMotoboy(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) {
        alert('Pedido não encontrado.');
        return;
    }
    
    const fullAddress = buildCustomerAddress(order);
    if (!fullAddress || fullAddress.trim() === '') {
        alert("Endereço do cliente não informado.");
        return;
    }

    const motoboys = getActiveMotoboys();
    let assignedName = order.assignedMotoboyName || '';
    let assignedWhatsapp = (order.assignedMotoboyWhatsapp || '').replace(/\D/g, '');
    
    if (!assignedWhatsapp) {
        if (motoboys.length === 1) {
            assignedName = motoboys[0].name;
            assignedWhatsapp = (motoboys[0].whatsapp || '').replace(/\D/g, '');
            if (assignedWhatsapp) {
                assignMotoboyToOrder(order.id, motoboys[0].id);
            }
        } else if (motoboys.length > 1) {
            let promptText = `Selecione o Motoboy para esta entrega:\n\n`;
            motoboys.forEach((m, idx) => {
                promptText += `${idx + 1}. ${m.name}\n`;
            });
            const choice = prompt(promptText + `\nDigite o número do motoboy (1 a ${motoboys.length}):`, '1');
            const choiceIdx = parseInt(choice) - 1;
            if (motoboys[choiceIdx] && motoboys[choiceIdx].whatsapp) {
                assignedName = motoboys[choiceIdx].name;
                assignedWhatsapp = (motoboys[choiceIdx].whatsapp || '').replace(/\D/g, '');
                assignMotoboyToOrder(order.id, motoboys[choiceIdx].id);
            }
        }
    }

    if (!assignedWhatsapp) {
        alert("Nenhum motoboy selecionado ou sem WhatsApp cadastrado.");
        return;
    }

    let mapsUrl = '';
    let mapsLabel = '🗺️ ABRIR NO GOOGLE MAPS:';
    if (order.location && order.location.latitude && order.location.longitude) {
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${order.location.latitude},${order.location.longitude}`;
        mapsLabel = '📍 LOCALIZAÇÃO GPS:';
    } else {
        mapsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(fullAddress);
    }

    const clientName = order.clientName || order.nomeCliente || order.customerName || 'Cliente';
    const clientPhone = order.clientPhone || order.telefoneCliente || order.phone || 'Não informado';

    const motoboyFeeVal = (order.motoboyFee !== undefined && order.motoboyFee !== null)
        ? Number(order.motoboyFee)
        : Number(order.deliveryFee || order.taxaEntrega || 0);

    const deliveryFeeVal = Number(order.deliveryFee || order.taxaEntrega || 0);

    let itemsText = '';
    const orderItems = order.items || order.cart || [];
    if (Array.isArray(orderItems) && orderItems.length > 0) {
        itemsText = orderItems.map(item => {
            if (item.type === 'custom_pizza') {
                const flavors = item.flavorNames ? item.flavorNames.join(' / ') : (item.name || item.titulo);
                const border = item.borderName ? ` (${item.borderName})` : '';
                const notes = item.notes ? ` [Obs: ${item.notes}]` : '';
                return `• ${item.quantity || 1}x ${item.name || item.titulo} (${flavors})${border}${notes}`;
            } else {
                const notes = item.notes ? ` [Obs: ${item.notes}]` : '';
                return `• ${item.quantity || 1}x ${item.name || item.titulo || 'Item'}${notes}`;
            }
        }).join('\n');
    } else if (typeof orderItems === 'string') {
        itemsText = orderItems;
    } else {
        itemsText = 'Não especificado';
    }

    const msg = `🛵 PIZZARIA DRILL

📦 NOVA ENTREGA

📋 Pedido #${order.id}

👤 Cliente:
${clientName}

📞 WhatsApp:
${clientPhone}

📍 Endereço:
${fullAddress}

${mapsLabel}
${mapsUrl}

💰 Corrida:
R$ ${motoboyFeeVal.toFixed(2).replace('.', ',')}

🛍️ Itens:
${itemsText}

💵 Taxa de entrega:
R$ ${deliveryFeeVal.toFixed(2).replace('.', ',')}`;

    let phoneNum = assignedWhatsapp.replace(/\D/g, '');
    if (phoneNum.length === 10 || phoneNum.length === 11) {
        phoneNum = '55' + phoneNum;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneNum}&text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank');
}

function shareAddressToMotoboy(orderId) {
    sendToMotoboy(orderId);
}

/* ==========================================================================
   Order State Updates
   ========================================================================== */
function updateOrderStatus(id, newStatus) {
    const order = orders.find(o => String(o.id) === String(id) || String(o.firebaseKey) === String(id));
    
    // Se for comanda de mesa, atualiza todos os pedidos ativos vinculados a essa mesa
    let ticketsToUpdate = [];
    if (order && isTableOrderEntity(order)) {
        const tableNum = getCanonicalTableNumber(order);
        const isActive = isTableComandaOpen(order);
        if (isActive) {
            ticketsToUpdate = orders.filter(o => {
                const oIsTable = isTableOrderEntity(o);
                const oIsActive = isTableComandaOpen(o);
                const oTableNum = getCanonicalTableNumber(o);
                return oIsTable && oIsActive && oTableNum === tableNum;
            });
        }
    }
    if (ticketsToUpdate.length === 0 && order) {
        ticketsToUpdate = [order];
    }

    const updates = { 
        status: newStatus,
        hasNewItems: false 
    };
    // Para entrega ou balcão, 'Entregue' encerra o pedido; para mesa, 'Entregue' apenas indica item servido
    if (newStatus === 'Entregue' && (!order || !isTableOrderEntity(order))) {
        updates.closedAt = Date.now();
    }

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const promises = ticketsToUpdate.map(t => {
            const refKey = t.firebaseKey || t.id;
            return firebase.database().ref(`orders/${refKey}`).update(updates);
        });

        Promise.all(promises)
        .then(() => {
            triggerCentralAutoBackup();
        })
        .catch(err => {
            alert("Erro ao atualizar status no Firebase.");
            console.error(err);
        });
    } else {
        const promises = ticketsToUpdate.map(t => {
            return fetch(`/api/orders/${t.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
        });
        Promise.all(promises)
        .then(() => {
            triggerCentralAutoBackup();
            fetchOrders(true); // Update silently
        })
        .catch(err => {
            alert("Erro ao atualizar status do pedido.");
            console.error(err);
        });
    }
}

/* ==========================================================================
   Gestão de Mesas e Comandas Contínuas (Salão)
   ========================================================================== */

function renderTablesDashboard() {
    const grid = document.getElementById('tablesDashboardGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const totalTables = 20;
    const tableCardsData = [];
    let occupiedCount = 0;
    let totalRevenueMesas = 0;

    for (let i = 1; i <= totalTables; i++) {
        const numFormatted = String(i).padStart(2, '0');
              const activeOrders = orders.filter(o => {
            const isTable = isTableOrderEntity(o);
            const isActive = isTableComandaOpen(o);
            if (!isTable || !isActive) return false;

            const oTableNum = getCanonicalTableNumber(o);
            return oTableNum === numFormatted;
        });

        const isOccupied = (tableState && tableState.status === 'aberta' && (Number(tableState.comandasCount) > 0 || Number(tableState.total) > 0)) || (activeOrders.length > 0);

        if (isOccupied) {
            occupiedCount++;
            activeOrders.sort((a, b) => (Number(a.timestamp || a.id) || 0) - (Number(b.timestamp || b.id) || 0));
            
            // ÚNICA FONTE DE VERDADE PARA O TOTAL DA MESA: Soma de todas as comandas ativas
            let totalMesa = 0;
            activeOrders.forEach(ord => {
                const cartArr = Array.isArray(ord.cart) ? ord.cart : Object.values(ord.cart || {});
                if (cartArr.length > 0) {
                    totalMesa += cartArr.reduce((sum, it) => sum + (Number(it.totalPrice) || (Number(it.singlePrice) * (Number(it.quantity) || 1)) || 0), 0);
                } else {
                    totalMesa += Number(ord.total || 0);
                }
            });

            if (totalMesa === 0 && tableState && Number(tableState.total) > 0) {
                totalMesa = Number(tableState.total);
            }

            totalRevenueMesas += totalMesa;

            const firstOrder = activeOrders[0] || {};
            const comandaId = (tableState && tableState.tableSessionId) ? tableState.tableSessionId : (firstOrder.tableSessionId || firstOrder.comandaId || `mesa-${numFormatted}`);

            tableCardsData.push({
                num: numFormatted,
                name: tableName,
                isOccupied: true,
                tableSessionId: comandaId,
                comandaId: comandaId,
                orders: activeOrders,
                total: totalMesa,
                comandasCount: activeOrders.length,
                waiterName: (tableState && tableState.waiterName) || firstOrder.waiterName || 'Garçom',
                openedAt: (tableState && tableState.openedAt) || firstOrder.time || 'Recente'
            });
        } else {
            tableCardsData.push({
                num: numFormatted,
                name: tableName,
                isOccupied: false,
                tableSessionId: null,
                comandaId: null,
                orders: [],
                total: 0,
                comandasCount: 0,
                waiterName: null,
                openedAt: null
            });
        }
    }

    // Atualiza indicadores do cabeçalho
    const occupiedEl = document.getElementById('tablesOccupiedCount');
    const freeEl = document.getElementById('tablesFreeCount');
    const revEl = document.getElementById('tablesTotalRevenue');

    if (occupiedEl) occupiedEl.innerText = occupiedCount;
    if (freeEl) freeEl.innerText = totalTables - occupiedCount;
    if (revEl) revEl.innerText = `R$ ${totalRevenueMesas.toFixed(2).replace('.', ',')}`;

    // Renderiza cada card de mesa
    tableCardsData.forEach(table => {
        const card = document.createElement('div');
        card.className = `table-dashboard-card ${table.isOccupied ? 'occupied' : 'free'}`;

        if (table.isOccupied) {
            card.style.cssText = 'background: var(--bg-card); border: 1px solid rgba(245, 166, 35, 0.45); box-shadow: 0 6px 20px rgba(245, 166, 35, 0.12); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; gap: 14px; position: relative;';

            let comandasListHTML = '';
            table.orders.forEach((ord, oIdx) => {
                const cNum = ord.comandaNum || (oIdx + 1);
                const cClient = ord.clientName || `Comanda ${String(cNum).padStart(2, '0')}`;
                const cRound = Number(ord.roundsCount || ord.round) || 1;
                const cTotal = Number(ord.total || 0).toFixed(2).replace('.', ',');
                const itemsListStr = (ord.cart || []).map(it => `• ${it.quantity}x ${it.name}${it.round ? ` (R${it.round})` : ''}`).join('<br>');
                const orderKey = ord.firebaseKey || ord.id;

                comandasListHTML += `
                    <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: var(--text-main); font-size: 13px; margin-bottom: 4px;">
                            <span style="display: flex; align-items: center; gap: 6px;">
                                <span style="background: var(--primary-light); color: #ffb74d; font-size: 11px; padding: 1px 5px; border-radius: 3px;">#${cNum}</span>
                                <strong>${cClient}</strong>
                                <span style="font-size: 11px; color: var(--accent-gold); background: var(--accent-gold-light); padding: 1px 6px; border-radius: 10px;">${cRound}ª Rodada</span>
                            </span>
                            <span style="color: #81c784; font-size: 14px; font-weight: 800;">R$ ${cTotal}</span>
                        </div>
                        <div style="color: var(--text-light); font-size: 11px; line-height: 1.4; margin: 6px 0;">
                            ${itemsListStr || 'Nenhum item'}
                        </div>
                        ${(ord.generalNotes || ord.notes) ? `
                            <div style="color: #ffe082; font-size: 11px; margin-top: 4px; border-top: 1px dashed var(--border-color); padding-top: 2px;">
                                Obs: ${ord.generalNotes || ord.notes}
                            </div>
                        ` : ''}
                        <div style="display: flex; justify-content: flex-end; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                            <button type="button" onclick="finalizeTableComanda('${orderKey}')" style="background: rgba(46, 125, 50, 0.2); color: #81c784; border: 1px solid rgba(76, 175, 80, 0.4); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                                <span class="material-symbols-rounded" style="font-size: 14px;">receipt_long</span>
                                <span>Finalizar Comanda</span>
                            </button>
                        </div>
                    </div>
                `;
            });

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; color: var(--text-main); display: flex; align-items: center; gap: 8px; font-weight: 800;">
                            <span class="material-symbols-rounded" style="color: #f5a623;">restaurant</span>
                            ${table.name}
                        </h3>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                            Garçom: <strong style="color: var(--text-light);">${table.waiterName}</strong> • Aberta às ${table.openedAt}
                        </div>
                    </div>
                    <span style="background: rgba(76, 175, 80, 0.15); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.4); font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 4px; text-transform: uppercase;">
                        🔴 ${table.comandasCount} COMANDA${table.comandasCount > 1 ? 'S' : ''}
                    </span>
                </div>

                <div style="background: rgba(245, 166, 35, 0.08); border: 1px solid rgba(245, 166, 35, 0.25); border-radius: var(--radius-sm); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 13px; font-weight: 600; color: var(--text-light);">Total Geral da Mesa:</span>
                    <span style="font-size: 22px; font-weight: 900; color: #ffb74d; font-family: var(--font-display);">
                        R$ ${table.total.toFixed(2).replace('.', ',')}
                    </span>
                </div>

                <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
                    Comandas na Mesa (${table.orders.length}):
                </div>

                <div style="max-height: 220px; overflow-y: auto; padding-right: 4px;">
                    ${comandasListHTML || '<div style="color: var(--text-muted); font-size: 11px;">Aguardando pedidos...</div>'}
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 10px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-color);">
                    <button type="button" onclick="printTableComandaSummary('${table.num}')" style="background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-color); padding: 9px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                        <span class="material-symbols-rounded" style="font-size: 16px;">print</span>
                        <span>Imprimir</span>
                    </button>
                    <button type="button" onclick="finalizeTableComanda('${table.num}')" style="background: linear-gradient(135deg, #2e7d32, #1b5e20); color: #ffffff; border: 1px solid rgba(76, 175, 80, 0.4); padding: 9px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(46, 125, 50, 0.3);">
                        <span class="material-symbols-rounded" style="font-size: 16px;">point_of_sale</span>
                        <span>Finalizar Mesa</span>
                    </button>
                </div>
            `;
        } else {
            card.style.cssText = 'background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; justify-content: space-between; min-height: 160px; opacity: 0.75;';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 16px; color: var(--text-main); display: flex; align-items: center; gap: 8px; font-weight: 700;">
                        <span class="material-symbols-rounded" style="color: var(--text-muted);">table_restaurant</span>
                        ${table.name}
                    </h3>
                    <span style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid var(--border-color); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
                        🟢 Livre
                    </span>
                </div>
                <div style="margin: 20px 0; color: var(--text-muted); font-size: 12px;">
                    Mesa disponível para atendimento e novas comandas pelo Garçom.
                </div>
                <div style="border-top: 1px dashed var(--border-color); padding-top: 8px; font-size: 11px; color: #81c784; font-weight: 600;">
                    ✓ Pronta para novos clientes
                </div>
            `;
        }

        grid.appendChild(card);
    });
}

function finalizeTableComanda(targetIdOrTableNum) {
    // 1. Verifica se o parâmetro é um ID de pedido/comanda individual ou o número da mesa
    const isIndividualOrder = orders.some(o => String(o.id) === String(targetIdOrTableNum) || String(o.firebaseKey) === String(targetIdOrTableNum));

    let relatedOrders = [];
    let tableNum = null;
    let isSingleComandaFinalize = false;

    if (isIndividualOrder) {
        // Finalizar comanda individual
        const singleOrder = orders.find(o => String(o.id) === String(targetIdOrTableNum) || String(o.firebaseKey) === String(targetIdOrTableNum));
        tableNum = getCanonicalTableNumber(singleOrder);
        const sessionKey = singleOrder.tableSessionId || singleOrder.comandaId || singleOrder.id;
        relatedOrders = orders.filter(o => isTableOrderEntity(o) && isTableComandaOpen(o) && (o.tableSessionId === sessionKey || o.comandaId === sessionKey || String(o.id) === String(singleOrder.id) || String(o.firebaseKey) === String(singleOrder.firebaseKey)));
        isSingleComandaFinalize = true;
    } else {
        // Finalizar todas as comandas da mesa
        tableNum = getCanonicalTableNumber(targetIdOrTableNum);
        relatedOrders = orders.filter(o => isTableOrderEntity(o) && isTableComandaOpen(o) && getCanonicalTableNumber(o) === tableNum);
        isSingleComandaFinalize = false;
    }

    if (relatedOrders.length === 0) {
        alert("Nenhum pedido aberto encontrado.");
        return;
    }

    const tableState = firebaseTablesState[tableNum];
    const firstOrder = relatedOrders[0];
    const clientName = isSingleComandaFinalize ? (firstOrder.clientName || `Comanda ${firstOrder.comandaNum || 1}`) : `Mesa ${tableNum}`;

    let totalAcumulado = 0;
    relatedOrders.forEach(ord => {
        const cartArr = Array.isArray(ord.cart) ? ord.cart : Object.values(ord.cart || {});
        if (cartArr.length > 0) {
            totalAcumulado += cartArr.reduce((sum, it) => sum + (Number(it.totalPrice) || (Number(it.singlePrice) * (Number(it.quantity) || 1)) || 0), 0);
        } else {
            totalAcumulado += Number(ord.total || 0);
        }
    });

    const totalFormatted = `R$ ${totalAcumulado.toFixed(2).replace('.', ',')}`;

    const promptTitle = isSingleComandaFinalize 
        ? `🧾 FINALIZAR COMANDA — ${clientName.toUpperCase()} (MESA ${tableNum})`
        : `🧾 FINALIZAR TODAS AS COMANDAS — MESA ${tableNum}`;

    const choice = prompt(
        `${promptTitle}\n\n` +
        `Total a Pagar: ${totalFormatted}\n\n` +
        `Selecione a forma de pagamento do cliente:\n` +
        `1 — Pix\n` +
        `2 — Cartão (Maquininha)\n` +
        `3 — Dinheiro\n\n` +
        `Digite 1, 2 ou 3 para confirmar o recebimento:`,
        '1'
    );

    if (choice === null) return;

    let paymentMethod = 'pix';
    let paymentLabel = 'Pix';
    if (choice.trim() === '2') {
        paymentMethod = 'card';
        paymentLabel = 'Cartão (Maquininha)';
    } else if (choice.trim() === '3') {
        paymentMethod = 'cash';
        paymentLabel = 'Dinheiro';
    }

    const orderUpdates = {
        status: 'Entregue',
        comandaStatus: 'fechada',
        paymentMethod: paymentMethod,
        closedAt: Date.now(),
        hasNewItems: false
    };

    // Identifica outras comandas que ainda continuam abertas na mesma mesa
    const remainingOpenOrders = orders.filter(o => {
        if (!isTableOrderEntity(o) || !isTableComandaOpen(o)) return false;
        if (getCanonicalTableNumber(o) !== tableNum) return false;
        return !relatedOrders.some(ro => String(ro.id) === String(o.id) || String(ro.firebaseKey) === String(o.firebaseKey));
    });

    let newTablePayload;
    if (remainingOpenOrders.length > 0) {
        // Mesa continua aberta com as comandas restantes
        const remainingTotal = remainingOpenOrders.reduce((sum, o) => {
            const cArr = Array.isArray(o.cart) ? o.cart : Object.values(o.cart || {});
            if (cArr.length > 0) {
                return sum + cArr.reduce((s, it) => s + (Number(it.totalPrice) || (Number(it.singlePrice) * (Number(it.quantity) || 1)) || 0), 0);
            }
            return sum + Number(o.total || 0);
        }, 0);

        newTablePayload = {
            tableNum: tableNum,
            tableName: `Mesa ${tableNum}`,
            status: 'aberta',
            tableSessionId: remainingOpenOrders[0].tableSessionId || remainingOpenOrders[0].comandaId || `mesa-${tableNum}`,
            waiterName: remainingOpenOrders[0].waiterName || 'Garçom',
            openedAt: remainingOpenOrders[0].openedAt || remainingOpenOrders[0].time,
            lastOrderAt: remainingOpenOrders[remainingOpenOrders.length - 1].lastOrderAt || remainingOpenOrders[remainingOpenOrders.length - 1].time,
            total: remainingTotal,
            comandasCount: remainingOpenOrders.length,
            orderIds: remainingOpenOrders.map(o => o.id || o.firebaseKey)
        };
    } else {
        // Mesa fica livre
        newTablePayload = {
            tableNum: tableNum,
            tableName: `Mesa ${tableNum}`,
            status: 'livre',
            tableSessionId: null,
            waiterName: null,
            openedAt: null,
            lastOrderAt: null,
            total: 0,
            comandasCount: 0,
            orderIds: [],
            lastClosedSession: {
                total: totalAcumulado,
                closedAt: Date.now(),
                paymentMethod: paymentMethod
            }
        };
    }

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const promises = relatedOrders.map(tOrder => {
            const refKey = (tOrder && tOrder.firebaseKey) ? tOrder.firebaseKey : tOrder.id;
            return firebase.database().ref(`orders/${refKey}`).update(orderUpdates);
        });

        promises.push(
            firebase.database().ref(`tables/${tableNum}`).set(newTablePayload)
        );

        Promise.all(promises)
        .then(() => {
            firebaseTablesState[tableNum] = newTablePayload;
            triggerCentralAutoBackup();
            showToast(`${clientName} encerrada (${paymentLabel}) com sucesso!`, 'success');
            renderTablesDashboard();
            renderOrdersList();
        })
        .catch(err => {
            console.error("Erro ao encerrar comanda no Firebase:", err);
            alert("Erro ao encerrar comanda no Firebase.");
        });
    } else {
        const promises = relatedOrders.map(tOrder => {
            return fetch(`/api/orders/${tOrder.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderUpdates)
            });
        });

        Promise.all(promises)
        .then(() => {
            triggerCentralAutoBackup();
            fetchOrders(true);
            showToast(`${clientName} encerrada (${paymentLabel}) com sucesso!`, 'success');
            renderTablesDashboard();
            renderOrdersList();
        })
        .catch(err => {
            console.error("Erro ao encerrar comanda:", err);
            alert("Erro ao encerrar comanda.");
        });
    }
}

function printTableComandaSummary(comandaIdOrTable) {
    const tableNum = getCanonicalTableNumber(comandaIdOrTable);
    const relatedOrders = orders.filter(o => {
        const isTableOrder = isTableOrderEntity(o);
        if (!isTableOrder) return false;
        const oTableNum = getCanonicalTableNumber(o);
        const isMatchComanda = o.comandaId && (o.comandaId === comandaIdOrTable);
        const isMatchTable = oTableNum === tableNum;
        const isMatchId = String(o.id) === String(comandaIdOrTable) || String(o.firebaseKey) === String(comandaIdOrTable);
        return (isMatchComanda || isMatchTable || isMatchId);
    });

    if (relatedOrders.length === 0) {
        alert("Comanda não encontrada para impressão.");
        return;
    }

    const firstOrder = relatedOrders[0];
    const normNum = getCanonicalTableNumber(firstOrder) || tableNum;
    const tableLabel = normNum ? `Mesa ${normNum}` : (firstOrder.table || 'Mesa');
    const comandaId = firstOrder.comandaId || comandaIdOrTable;
    
    const tableState = firebaseTablesState[normNum];
    let totalAcumulado = 0;
    if (tableState && Number(tableState.total) > 0 && tableState.status === 'aberta') {
        totalAcumulado = Number(tableState.total);
    } else {
        const consolidatedCart = [];
        relatedOrders.forEach(ord => {
            const cartArr = Array.isArray(ord.cart) ? ord.cart : Object.values(ord.cart || {});
            cartArr.forEach(it => consolidatedCart.push(it));
        });
        if (consolidatedCart.length > 0) {
            totalAcumulado = consolidatedCart.reduce((sum, it) => sum + (Number(it.totalPrice) || (Number(it.singlePrice) * (Number(it.quantity) || 1)) || 0), 0);
        } else if (relatedOrders.length > 0) {
            totalAcumulado = Number(relatedOrders[0].total || 0);
        }
    }

    const printSection = document.getElementById('printSection');
    if (!printSection) return;

    let allItemsHTML = '';
    relatedOrders.forEach((ord) => {
        allItemsHTML += `
            <div style="margin-top: 8px; padding-bottom: 4px; border-bottom: 1px dashed #999;">
                <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px;">
                    PEDIDO #${ord.id} - ${ord.time || ''} (${ord.waiterName || 'Garçom'})
                </div>
        `;
        (ord.cart || []).forEach(item => {
            allItemsHTML += `
                <div class="ticket-item" style="font-size: 11px;">
                    <div class="ticket-item-header">
                        <span>${item.quantity}x ${item.name}</span>
                        <span>R$ ${Number(item.totalPrice || (item.singlePrice * item.quantity) || 0).toFixed(2)}</span>
                    </div>
                    ${item.notes ? `<div class="ticket-item-details">Obs: "${item.notes}"</div>` : ''}
                </div>
            `;
        });
        allItemsHTML += `</div>`;
    });

    printSection.innerHTML = `
        <div class="ticket-header">
            <div class="ticket-title">${(menuData?.settings?.companyName || 'ROLOFF LANCHES').toUpperCase()}</div>
            <div style="font-size: 11px;">${menuData?.settings?.address || 'Atendimento Presencial'}</div>
            <div style="font-size: 11px;">Tel: ${menuData?.settings?.whatsappFormatted || menuData?.settings?.whatsapp || 'WhatsApp'}</div>
            <div class="ticket-separator"></div>
            <div style="font-size: 15px; font-weight: bold;">EXTRATO DA COMANDA • ${tableLabel.toUpperCase()}</div>
            <div style="font-size: 10px; color: #555;">ID: ${comandaId}</div>
            <div style="font-size: 11px;">Data: ${new Date().toLocaleDateString('pt-BR')} | ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        
        <div class="ticket-separator"></div>
        
        <div>
            <div class="ticket-section-title">Consumo Acumulado na Mesa</div>
            <div>
                ${allItemsHTML}
            </div>
        </div>
        
        <div class="ticket-totals" style="margin-top: 12px; border-top: 2px solid #000; padding-top: 6px;">
            <div class="ticket-total-row grand-total" style="font-size: 16px; font-weight: bold;">
                <span>TOTAL DA MESA:</span>
                <span>R$ ${totalAcumulado.toFixed(2)}</span>
            </div>
        </div>
        
        <div class="ticket-footer" style="margin-top: 15px;">
            <span>ROLOFF LANCHES - OBRIGADO PELA PREFERÊNCIA!</span>
        </div>
    `;

    window.print();
}

function closeTableComanda(orderId) {
    finalizeTableComanda(orderId);
}


function notifyCustomerReady(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        alert("Pedido não encontrado.");
        return;
    }
    
    let phone = order.clientPhone.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) {
        phone = '55' + phone;
    }
    
    let text = '';
    if (order.checkoutType === 'delivery') {
        text = `Olá, *${order.clientName}*! Seu pedido *#${order.id}* da Roloff Lanches está pronto e saindo para entrega! 🛵💨`;
    } else {
        text = `Olá, *${order.clientName}*! Seu pedido *#${order.id}* da Roloff Lanches está pronto e você já pode vir retirar! 🍔🥤`;
    }
    
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

/* ==========================================================================
   Horário de Retirada Combinado (Manual pela Equipe)
   ========================================================================== */
function saveOrderPickupTime(orderId, customVal = null) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;
    
    let timeVal = customVal;
    if (timeVal === null) {
        const input = document.getElementById(`pickupInput_${order.id}`);
        timeVal = input ? input.value.trim() : '';
    }
    
    order.pickupTime = timeVal;
    
    const updates = { pickupTime: timeVal };
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const refKey = order.firebaseKey || order.id;
        firebase.database().ref(`orders/${refKey}`).update(updates)
        .then(() => {
            triggerCentralAutoBackup();
            if (timeVal) {
                showToast(`Horário de retirada (${timeVal}) salvo!`, 'success');
            } else {
                showToast('Horário de retirada removido.', 'warning');
            }
        })
        .catch(err => {
            console.error("Erro ao salvar horário no Firebase:", err);
            alert("Erro ao salvar horário no Firebase.");
        });
    } else {
        fetch(`/api/orders/${order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        })
        .then(() => {
            triggerCentralAutoBackup();
            if (timeVal) {
                showToast(`Horário de retirada (${timeVal}) salvo!`, 'success');
            } else {
                showToast('Horário de retirada removido.', 'warning');
            }
        })
        .catch(err => console.error(err));
    }
    
    renderOrdersList();
}

function editOrderPickupTime(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;
    
    const currentVal = order.pickupTime || order.horarioRetirada || '';
    const newTime = prompt("Informe o novo horário combinado de retirada (ex: 19:50) ou deixe em branco para limpar:", currentVal);
    if (newTime === null) return; // cancelado
    
    saveOrderPickupTime(orderId, newTime.trim());
}

function notifyCustomerPickupTime(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order || !order.clientPhone) {
        alert("Telefone do cliente não encontrado.");
        return;
    }
    
    let phone = order.clientPhone.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) {
        phone = '55' + phone;
    }
    
    const pickupTime = (order.pickupTime || order.horarioRetirada || '').trim();
    if (!pickupTime) {
        alert("Defina o horário de retirada antes de avisar o cliente.");
        return;
    }

    const text = `Olá, *${order.clientName}*! Seu pedido *#${order.id}* da Roloff Lanches foi recebido. Devido ao volume de pedidos, combinamos a retirada para às *${pickupTime}*. Obrigado! 🍔`;
    
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

/* ==========================================================================
   Clear/Reset All Orders Functionality
   ========================================================================== */
function confirmClearAllOrders() {
    const confirmation = confirm("⚠️ ATENÇÃO: Tem certeza absoluta de que deseja ZERAR todos os pedidos do painel? \n\nEsta ação apagará permanentemente todos os registros de pedidos e é irreversível!");
    
    if (confirmation) {
        const doubleConfirmation = confirm("Confirme novamente: Deseja REALMENTE excluir todos os pedidos de forma permanente?");
        if (doubleConfirmation) {
            clearAllOrders();
        }
    }
}

function clearAllOrders() {
    showLoading('Zerando pedidos no servidor...');
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        // Clear from Firebase Realtime Database
        firebase.database().ref('orders').remove()
        .then(() => {
            hideLoading();
            alert("Sucesso: Todos os pedidos foram apagados no Firebase!");
            orders = [];
            knownOrderIds.clear();
            updateIndicators();
            renderOrdersList();
            triggerCentralAutoBackup();
        })
        .catch(err => {
            console.warn("Remoção direta ref('orders') falhou, tentando exclusão por nós individuais...", err);
            
            // Fallback: Delete each order node individually if root delete was restricted
            if (orders.length === 0) {
                hideLoading();
                alert("Nenhum pedido para apagar.");
                return;
            }
            
            const promises = orders.map(o => {
                const key = o.firebaseKey || o.id;
                return firebase.database().ref(`orders/${key}`).remove();
            });
            
            Promise.all(promises)
            .then(() => {
                hideLoading();
                alert("Sucesso: Todos os pedidos foram apagados!");
                orders = [];
                knownOrderIds.clear();
                updateIndicators();
                renderOrdersList();
                triggerCentralAutoBackup();
            })
            .catch(fallbackErr => {
                hideLoading();
                alert("Erro ao zerar pedidos no Firebase. Verifique suas permissões.");
                console.error("Erro no fallback de exclusão de pedidos:", fallbackErr);
            });
        });
    } else {
        // Clear from Local Express API
        fetch('/api/orders', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(res => {
            if (!res.ok) throw new Error("Erro na requisição ao servidor.");
            return res.json();
        })
        .then(data => {
            hideLoading();
            alert("Sucesso: Todos os pedidos locais foram apagados!");
            orders = [];
            knownOrderIds.clear();
            updateIndicators();
            renderOrdersList();
            triggerCentralAutoBackup();
        })
        .catch(err => {
            hideLoading();
            alert("Erro ao zerar pedidos locais.");
            console.error(err);
        });
    }
}

/* ==========================================================================
   Thermal Receipt Printing Integration
   ========================================================================== */
function printOrderTicket(id) {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    
    const isTableOrder = order.checkoutType === 'mesa' || !!order.table || !!order.mesa || order.origin === 'Garçom';
    const tableLabel = order.table || (order.mesa ? (String(order.mesa).toLowerCase().includes('mesa') ? order.mesa : `Mesa ${order.mesa}`) : 'Mesa Salão');

    const printSection = document.getElementById('printSection');
    
    let itemsHTML = '';
    const orderCart = order.cart || [];
    orderCart.forEach(item => {
        if (item.type === 'pizza') {
            itemsHTML += `
                <div class="ticket-item">
                    <div class="ticket-item-header">
                        <span>${item.quantity}x Pizza ${item.sizeName}</span>
                        <span>R$ ${item.totalPrice.toFixed(2)}</span>
                    </div>
                    <div class="ticket-item-details">
                        Sabores: ${item.flavorNames.join(' / ')}<br>
                        Borda: ${item.borderName}
                        ${item.notes ? `<br>Obs: "${item.notes}"` : ''}
                    </div>
                </div>
            `;
        } else {
            itemsHTML += `
                <div class="ticket-item">
                    <div class="ticket-item-header">
                        <span>${item.quantity}x ${item.name}</span>
                        <span>R$ ${item.totalPrice.toFixed(2)}</span>
                    </div>
                    ${item.notes ? `<div class="ticket-item-details">Obs: "${item.notes}"</div>` : ''}
                </div>
            `;
        }
    });
    
    let addressHTML = 'RETIRADA NO BALCÃO';
    let entregaLabel = 'NÃO - RETIRADA';
    if (order.checkoutType === 'delivery' && order.address) {
        const addr = order.address;
        addressHTML = `
            ${addr.street.toUpperCase()}, Nº ${addr.number}
            BAIRRO: ${addr.neighborhood.toUpperCase()}
            ${addr.reference ? `REF: ${addr.reference.toUpperCase()}` : ''}
        `;
        entregaLabel = 'SIM - TELE-ENTREGA';
    } else if (isTableOrder) {
        addressHTML = `MESA ${tableLabel.toUpperCase()} (CONSUMO NO LOCAL)`;
        entregaLabel = `CONSUMO NA MESA (${order.origin ? order.origin.toUpperCase() : 'GARÇOM'})`;
    }
    
    const payments = { 'pix': 'PIX', 'card': 'CARTÃO (MAQUININHA)', 'cash': 'DINHEIRO', 'mesa': 'PAGAMENTO NA MESA / CAIXA' };
    let paymentHTML = payments[order.paymentMethod] || (order.paymentMethod ? order.paymentMethod.toUpperCase() : 'NA MESA / CAIXA');
    if (order.paymentMethod === 'cash' && order.cashChange) {
        paymentHTML += ` (TROCO PARA ${order.cashChange})`;
    }

    const generalNotesTicketHTML = (order.generalNotes || (isTableOrder && order.notes)) ? `
        <div style="margin-top: 6px; font-size: 11px; font-weight: bold; border: 1px dashed #000; padding: 4px;">
            OBS. MESA: ${(order.generalNotes || order.notes).toUpperCase()}
        </div>
    ` : '';
    
    printSection.innerHTML = `
        <div class="ticket-header">
            <div class="ticket-title">${(menuData?.settings?.companyName || 'ROLOFF LANCHES').toUpperCase()}</div>
            <div style="font-size: 11px;">${menuData?.settings?.address || 'Atendimento Presencial & Delivery'}</div>
            <div style="font-size: 11px;">Tel: ${menuData?.settings?.whatsappFormatted || menuData?.settings?.whatsapp || 'WhatsApp'}</div>
            <div class="ticket-separator"></div>
            <div style="font-size: 14px; font-weight: bold;">PEDIDO #${order.id} ${isTableOrder ? `• ${tableLabel.toUpperCase()}` : ''}</div>
            <div style="font-size: 11px;">Status: ${order.status.toUpperCase()}</div>
            <div style="font-size: 11px;">Data: ${order.date} | Horário: ${order.time}</div>
        </div>
        
        <div>
            <div class="ticket-section-title">Dados do Atendimento</div>
            <div class="ticket-info-row">
                <span class="ticket-info-label">CLIENTE/MESA:</span>
                <span style="font-weight: bold;">${order.clientName.toUpperCase()}</span>
            </div>
            ${!isTableOrder ? `
            <div class="ticket-info-row">
                <span class="ticket-info-label">TELEFONE:</span>
                <span>${order.clientPhone}</span>
            </div>
            ` : ''}
            <div class="ticket-info-row">
                <span class="ticket-info-label">TIPO:</span>
                <span>${entregaLabel}</span>
            </div>
            ${(order.pickupTime || order.horarioRetirada) ? `
            <div class="ticket-info-row" style="margin-top: 4px; background: #eee; padding: 2px 4px; border: 1px dashed #000;">
                <span class="ticket-info-label" style="font-weight: bold;">🕐 RETIRADA / PREVISÃO:</span>
                <span style="font-weight: 800; font-size: 13px;">${(order.pickupTime || order.horarioRetirada).toUpperCase()}</span>
            </div>
            ` : ''}
            <div style="margin-top: 4px;">
                <span class="ticket-info-label">LOCAL / ENDEREÇO:</span><br>
                <span style="font-size: 11px; font-weight: bold;">${addressHTML}</span>
            </div>
            <div class="ticket-info-row" style="margin-top: 4px;">
                <span class="ticket-info-label">PAGAMENTO:</span>
                <span>${paymentHTML}</span>
            </div>
            ${generalNotesTicketHTML}
        </div>
        
        <div class="ticket-separator"></div>
        
        <div>
            <div class="ticket-section-title">Itens do Pedido</div>
            <div style="margin-top: 4px;">
                ${itemsHTML}
            </div>
        </div>
        
        <div class="ticket-totals">
            <div class="ticket-total-row">
                <span>SUBTOTAL:</span>
                <span>R$ ${order.subtotal.toFixed(2)}</span>
            </div>
            <div class="ticket-total-row">
                <span>TAXA ENTREGA:</span>
                <span>${order.deliveryFee === 0 ? 'GRÁTIS' : `R$ ${order.deliveryFee.toFixed(2)}`}</span>
            </div>
            <div class="ticket-total-row grand-total">
                <span>TOTAL A PAGAR:</span>
                <span>R$ ${order.total.toFixed(2)}</span>
            </div>
        </div>
        
        <div class="ticket-footer">
            <span>OBRIGADO PELA PREFERÊNCIA!</span><br>
            <span>${isTableOrder ? 'ROLOFF LANCHES - ATENDIMENTO DE MESA' : 'ROLOFF LANCHES'}</span>
        </div>
    `;
    
    // Launch print
    window.print();
}

function printKitchenTicket(id) {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    
    const isTableOrder = order.checkoutType === 'mesa' || !!order.table || !!order.mesa || order.origin === 'Garçom';
    const tableLabel = order.table || (order.mesa ? (String(order.mesa).toLowerCase().includes('mesa') ? order.mesa : `Mesa ${order.mesa}`) : 'Mesa Salão');

    const printSection = document.getElementById('printSection');
    
    let itemsHTML = '';
    const orderCart = order.cart || [];
    orderCart.forEach(item => {
        if (item.type === 'pizza') {
            itemsHTML += `
                <div class="ticket-item" style="margin-bottom: 15px;">
                    <div class="ticket-item-header" style="font-weight: bold; font-size: 14px; border-bottom: 1px dashed #000; padding-bottom: 2px;">
                        <span>${item.quantity}x Pizza ${item.sizeName.toUpperCase()}</span>
                    </div>
                    <div class="ticket-item-details" style="font-size: 13px; line-height: 1.4; margin-top: 4px; padding-left: 8px;">
                        • SABORES: ${item.flavorNames.join(' / ').toUpperCase()}<br>
                        • BORDA: ${item.borderName.toUpperCase()}
                        ${item.notes ? `<br>• OBS: <span style="border: 1px solid #000; padding: 1px 4px; font-weight: bold; border-radius: 2px;">"${item.notes.toUpperCase()}"</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            itemsHTML += `
                <div class="ticket-item" style="margin-bottom: 15px;">
                    <div class="ticket-item-header" style="font-weight: bold; font-size: 15px; border-bottom: 1px dashed #000; padding-bottom: 2px;">
                        <span>${item.quantity}x ${item.name.toUpperCase()}</span>
                    </div>
                    ${item.notes ? `
                        <div class="ticket-item-details" style="font-size: 13px; line-height: 1.4; margin-top: 4px; padding-left: 8px;">
                            • OBS: <span style="border: 1px solid #000; padding: 1px 4px; font-weight: bold; border-radius: 2px;">"${item.notes.toUpperCase()}"</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }
    });
    
    let tipoCozinha = order.checkoutType === 'delivery' ? '🚗 DELIVERY' : '🏪 RETIRADA';
    if (isTableOrder) {
        tipoCozinha = `🍽️ MESA / SALÃO (${order.origin ? order.origin.toUpperCase() : 'GARÇOM'})`;
    }

    const pickupKitchenHTML = (order.pickupTime || order.horarioRetirada) ? `
        <div style="margin-bottom: 8px; font-size: 14px; font-weight: 800; border: 2px solid #000; padding: 4px 8px; text-align: center; background: #fff;">
            🕐 RETIRADA / PREVISÃO: ${(order.pickupTime || order.horarioRetirada).toUpperCase()}
        </div>
    ` : '';

    const generalNotesKitchenHTML = (order.generalNotes || (isTableOrder && order.notes)) ? `
        <div style="margin-bottom: 10px; font-size: 13px; font-weight: bold; border: 2px solid #000; padding: 6px; text-align: center;">
            OBS. DA MESA: ${(order.generalNotes || order.notes).toUpperCase()}
        </div>
    ` : '';

    printSection.innerHTML = `
        <div class="ticket-header" style="text-align: center; margin-bottom: 15px; border-bottom: 2px dashed #000; padding-bottom: 10px;">
            <div class="ticket-title" style="font-size: 18px; font-weight: bold; letter-spacing: 1px;">COZINHA &amp; PRODUÇÃO</div>
            <div class="ticket-separator"></div>
            <div style="font-size: 22px; font-weight: 800; margin: 5px 0;">PEDIDO #${order.id}</div>
            ${isTableOrder ? `<div style="font-size: 18px; font-weight: 800; background: #000; color: #fff; padding: 4px; margin: 4px 0; border-radius: 3px;">🍽️ ${tableLabel.toUpperCase()}</div>` : ''}
            <div style="font-size: 11px; font-family: monospace;">Data: ${order.date} | Horário: ${order.time}</div>
        </div>
        
        <div style="margin-bottom: 12px; font-size: 13px; line-height: 1.4;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-weight: bold;">IDENTIFICAÇÃO:</span>
                <span style="font-weight: bold; font-size: 14px;">${order.clientName.toUpperCase()}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span style="font-weight: bold;">ORIGEM/TIPO:</span>
                <span style="font-weight: bold;">${tipoCozinha}</span>
            </div>
        </div>

        ${pickupKitchenHTML}
        ${generalNotesKitchenHTML}
        
        <div class="ticket-separator" style="border-top: 2px dashed #000; margin: 10px 0;"></div>
        
        <div>
            <div class="ticket-section-title" style="font-weight: bold; font-size: 12px; margin-bottom: 10px;">Itens da Cozinha</div>
            <div style="margin-top: 4px;">
                ${itemsHTML}
            </div>
        </div>
        
        <div class="ticket-separator" style="border-top: 2px dashed #000; margin: 10px 0;"></div>
        
        <div class="ticket-footer" style="text-align: center; font-size: 13px; font-weight: bold; margin-top: 15px; border: 1px solid #000; padding: 4px; letter-spacing: 2px;">
            VIA DA COZINHA ${isTableOrder ? '• MESA' : ''}
        </div>
    `;
    
    // Launch print
    window.print();
}

/* ==========================================================================
   State Variables for Menu Management
   ========================================================================== */
let menuData = null;
let currentSection = 'orders'; // 'orders' or 'menu'
let currentMenuTab = 'flavors'; // 'flavors' or 'prices'

const DEFAULT_MENU_DATA = {
    "menu_items":  {
                       "lanches":  [
                                       {
                                           "id":  "cachorro_big",
                                           "name":  "Cachorro Big",
                                           "description":  "Molho de carne moída, 1 salsicha, vinagrete, milho, ervilha, catchup, maionese, mostarda e batata palha.",
                                           "image":  "assets/hotdog.jpg",
                                           "category":  "lanches",
                                           "price":  18.0,
                                           "badge":  "Top",
                                           "available":  true
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
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "chopp_500",
                                           "name":  "Chopp 500ml",
                                           "description":  "Chopp claro geladinho na caneca 500ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  12.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "suco_uva_300",
                                           "name":  "Suco de Uva 300ml",
                                           "description":  "Suco de uva integral no copo 300ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "suco_uva_garrafa_500",
                                           "name":  "Suco de Uva Garrafa 500ml",
                                           "description":  "Garrafa de 500ml de suco de uva integral natural.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  16.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "coca_zero_350",
                                           "name":  "Coca-Cola Zero Lata 350ml",
                                           "description":  "Refrigerante Coca-Cola sem açúcar lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "coca_350",
                                           "name":  "Coca-Cola Lata 350ml",
                                           "description":  "Refrigerante Coca-Cola tradicional lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "tonica_350",
                                           "name":  "Água Tônica 350ml",
                                           "description":  "Refrigerante água tônica lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "fanta_laranja_350",
                                           "name":  "Fanta Laranja Lata 350ml",
                                           "description":  "Refrigerante Fanta Laranja lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "fanta_uva_350",
                                           "name":  "Fanta Uva Lata 350ml",
                                           "description":  "Refrigerante Fanta Uva lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "guarana_350",
                                           "name":  "Guaraná Antarctica Lata 350ml",
                                           "description":  "Refrigerante Guaraná Antarctica lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  6.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "brahma_zero_350",
                                           "name":  "Cerveja Brahma Zero Lata 350ml",
                                           "description":  "Cerveja sem álcool Brahma lata 350ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "brahma_latao_473",
                                           "name":  "Cerveja Brahma Latão 473ml",
                                           "description":  "Cerveja Brahma latão 473ml trincando de gelada.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "polar_latao_473",
                                           "name":  "Cerveja Polar Latão 473ml",
                                           "description":  "Cerveja Polar latão 473ml gelada.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "amstel_latao_473",
                                           "name":  "Cerveja Amstel Latão 473ml",
                                           "description":  "Cerveja puro malte Amstel latão 473ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "heineken_latao_473",
                                           "name":  "Cerveja Heineken Latão 473ml",
                                           "description":  "Cerveja Heineken puro malte latão 473ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  10.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "agua_sem_gas_500",
                                           "name":  "Água Mineral s/ Gás 500ml",
                                           "description":  "Garrafa de água mineral 500ml sem gás.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  4.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "agua_com_gas_500",
                                           "name":  "Água Mineral c/ Gás 500ml",
                                           "description":  "Garrafa de água mineral 500ml com gás.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  4.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "h2o_limao_500",
                                           "name":  "H2OH! Limão 500ml",
                                           "description":  "Bebida levemente gaseificada H2OH! sabor limão 500ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "coca_600",
                                           "name":  "Coca-Cola 600ml",
                                           "description":  "Refrigerante Coca-Cola garrafa 600ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "guarana_600",
                                           "name":  "Guaraná Antarctica 600ml",
                                           "description":  "Refrigerante Guaraná garrafa 600ml.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  8.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "coca_1l",
                                           "name":  "Coca-Cola 1 Litro",
                                           "description":  "Refrigerante Coca-Cola garrafa 1L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  10.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "coca_2l",
                                           "name":  "Coca-Cola 2 Litros",
                                           "description":  "Refrigerante Coca-Cola garrafa 2L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  15.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "fanta_laranja_2l",
                                           "name":  "Fanta Laranja 2 Litros",
                                           "description":  "Refrigerante Fanta Laranja garrafa 2L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  15.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "fanta_uva_2l",
                                           "name":  "Fanta Uva 2 Litros",
                                           "description":  "Refrigerante Fanta Uva garrafa 2L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  15.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "guarana_2l",
                                           "name":  "Guaraná Antarctica 2 Litros",
                                           "description":  "Refrigerante Guaraná Antarctica garrafa 2L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  15.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "sprite_2l",
                                           "name":  "Sprite 2 Litros",
                                           "description":  "Refrigerante Sprite garrafa 2L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  15.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "caipira_pequena",
                                           "name":  "Caipira Pequena",
                                           "description":  "Caipirinha artesanal de frutas tamanho pequeno.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  14.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "caipira_grande",
                                           "name":  "Caipira Grande",
                                           "description":  "Caipirinha artesanal de frutas tamanho grande.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  17.0,
                                           "available":  true
                                       },
                                       {
                                           "id":  "torre_chopp_25l",
                                           "name":  "Torre de Chopp 2,5 Litros",
                                           "description":  "Torre de chopp com refil de gelo térmico 2,5L.",
                                           "image":  "assets/gourmet_bebida.png",
                                           "category":  "bebidas",
                                           "price":  55.0,
                                           "badge":  "Galera",
                                           "available":  true
                                       },
                                       {
                                           "id":  "torre_chopp_35l",
                                           "name":  "Torre de Chopp 3,5 Litros",
                                           "description":  "Torre de chopp com refil de gelo térmico 3,5L.",
                                           "image":  "assets/gourmet_bebida.png",
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
                                              "image":  "assets/gourmet_sobremesa.png",
                                              "category":  "sobremesas",
                                              "price":  15.0,
                                              "available":  true
                                          }
                                      ]
                   },
    "adicionais":  {
                       "hamburguer_extra":  {
                                                "name":  "Hambúrguer Extra 140g",
                                                "price":  8.0
                                            },
                       "bacon_extra":  {
                                           "name":  "Fatias de Bacon Extra",
                                           "price":  6.0
                                       },
                       "queijo_extra":  {
                                            "name":  "Queijo Extra",
                                            "price":  5.0
                                        },
                       "catupiry_extra":  {
                                              "name":  "Catupiry Original Extra",
                                              "price":  5.0
                                          },
                       "ovo_extra":  {
                                         "name":  "Ovo Frito Extra",
                                         "price":  3.0
                                     },
                       "batata_palha_extra":  {
                                                  "name":  "Porção Extra de Batata Palha",
                                                  "price":  4.0
                                              },
                       "maionese_pote":  {
                                             "name":  "Pote de Maionese da Casa (50g)",
                                             "price":  4.0
                                         }
                   },
    "settings":  {
                     "companyName":  "Roloff Lanches",
                     "slogan":  "Lanches Artesanais | Porções | Bebidas",
                     "whatsapp":  "",
                     "whatsappFormatted":  "",
                     "address":  "",
                     "operatingHours":  "Terça a Domingo das 18h às 23h30",
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
   Menu Manager Functions
   ========================================================================== */
function switchSection(section) {
    currentSection = section;
    const btnNavOrders = document.getElementById('btnNavOrders');
    const btnNavTables = document.getElementById('btnNavTables');
    const btnNavMenu = document.getElementById('btnNavMenu');
    const btnNavReports = document.getElementById('btnNavReports');
    const btnNavSettings = document.getElementById('btnNavSettings');
    const sectionOrders = document.getElementById('section-orders');
    const sectionTables = document.getElementById('section-tables');
    const sectionMenu = document.getElementById('section-menu');
    const sectionReports = document.getElementById('section-reports');
    const sectionSettings = document.getElementById('section-settings');
    
    // Reset active states
    if (btnNavOrders) btnNavOrders.classList.remove('active');
    if (btnNavTables) btnNavTables.classList.remove('active');
    if (btnNavMenu) btnNavMenu.classList.remove('active');
    if (btnNavReports) btnNavReports.classList.remove('active');
    if (btnNavSettings) btnNavSettings.classList.remove('active');
    
    // Hide sections
    if (sectionOrders) sectionOrders.classList.add('display-none');
    if (sectionTables) sectionTables.classList.add('display-none');
    if (sectionMenu) sectionMenu.classList.add('display-none');
    if (sectionReports) sectionReports.classList.add('display-none');
    if (sectionSettings) sectionSettings.classList.add('display-none');
    
    if (section === 'orders') {
        if (btnNavOrders) btnNavOrders.classList.add('active');
        if (sectionOrders) sectionOrders.classList.remove('display-none');
    } else if (section === 'tables') {
        if (btnNavTables) btnNavTables.classList.add('active');
        if (sectionTables) {
            sectionTables.classList.remove('display-none');
            renderTablesDashboard();
        }
    } else if (section === 'menu') {
        if (btnNavMenu) btnNavMenu.classList.add('active');
        if (sectionMenu) {
            sectionMenu.classList.remove('display-none');
            
            if (!menuData) {
                initMenuSync();
            } else {
                renderMenuManager();
            }
        }
    } else if (section === 'reports') {
        if (btnNavReports) btnNavReports.classList.add('active');
        if (sectionReports) {
            sectionReports.classList.remove('display-none');
            renderReportsDashboard();
        }
    } else if (section === 'settings') {
        if (btnNavSettings) btnNavSettings.classList.add('active');
        if (sectionSettings) {
            sectionSettings.classList.remove('display-none');
            renderSettingsDashboard();
        }
    }
}

function setMenuTab(tab) {
    currentMenuTab = tab;
    const tabFlavors = document.getElementById('tabFlavors');
    const tabPrices = document.getElementById('tabPrices');
    const tabSimpleItems = document.getElementById('tabSimpleItems');
    const tabPromo = document.getElementById('tabPromo');
    
    const menuTabFlavors = document.getElementById('menuTabFlavors');
    const menuTabPrices = document.getElementById('menuTabPrices');
    const menuTabSimpleItems = document.getElementById('menuTabSimpleItems');
    const menuTabPromo = document.getElementById('menuTabPromo');
    
    // Reset active tab class
    if (tabFlavors) tabFlavors.classList.remove('active');
    if (tabPrices) tabPrices.classList.remove('active');
    if (tabSimpleItems) tabSimpleItems.classList.remove('active');
    if (tabPromo) tabPromo.classList.remove('active');
    
    // Hide all tab contents
    if (menuTabFlavors) menuTabFlavors.classList.add('display-none');
    if (menuTabPrices) menuTabPrices.classList.add('display-none');
    if (menuTabSimpleItems) menuTabSimpleItems.classList.add('display-none');
    if (menuTabPromo) menuTabPromo.classList.add('display-none');
    
    if (tab === 'flavors') {
        if (tabFlavors) tabFlavors.classList.add('active');
        if (menuTabFlavors) menuTabFlavors.classList.remove('display-none');
    } else if (tab === 'prices') {
        if (tabPrices) tabPrices.classList.add('active');
        if (menuTabPrices) menuTabPrices.classList.remove('display-none');
    } else if (tab === 'simpleItems') {
        if (tabSimpleItems) tabSimpleItems.classList.add('active');
        if (menuTabSimpleItems) menuTabSimpleItems.classList.remove('display-none');
        renderSimpleItemsList();
    } else if (tab === 'promo') {
        if (tabPromo) tabPromo.classList.add('active');
        if (menuTabPromo) menuTabPromo.classList.remove('display-none');
        loadPromoConfigIntoUI();
    }
}

let trackingSettingsListenerAttached = false;

function setupTrackingSettingsRealtime() {
    if (trackingSettingsListenerAttached) return;
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;

    const trackingRef = firebase.database().ref('menu/settings/tracking');
    trackingRef.on('value', (snapshot) => {
        const tracking = snapshot.val();

        // If the dedicated tracking node exists, it is the source of truth for
        // the marketing settings. This prevents a stale /menu snapshot from
        // resetting Google Ads after a page refresh.
        if (!tracking || typeof tracking !== 'object') return;

        if (!menuData) menuData = {};
        if (!menuData.settings) menuData.settings = {};
        menuData.settings.tracking = {
            ...(menuData.settings.tracking || {}),
            ...tracking
        };

        if (currentSection === 'settings') {
            renderSettingsDashboard();
        }
    });

    trackingSettingsListenerAttached = true;
}

function initMenuSync() {
    // Render default menu data immediately as a fallback.
    menuData = DEFAULT_MENU_DATA;
    renderMenuManager();

    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        setupTrackingSettingsRealtime();

        const menuRef = firebase.database().ref('menu');
        menuRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Preserve a tracking block already confirmed by the dedicated
                // /menu/settings/tracking listener. This avoids a stale /menu
                // snapshot from putting Google Ads back into the default state.
                const confirmedTracking = menuData?.settings?.tracking;
                menuData = data;
                if (confirmedTracking && typeof confirmedTracking === 'object') {
                    menuData.settings = menuData.settings || {};
                    menuData.settings.tracking = {
                        ...(menuData.settings.tracking || {}),
                        ...confirmedTracking
                    };
                }
                renderMenuManager();
            } else {
                console.log("Banco de dados do cardápio vazio. Semeando valores padrão do painel...");
                firebase.database().ref('menu').set(DEFAULT_MENU_DATA)
                .then(() => console.log("Cardápio semeado com sucesso a partir do painel."))
                .catch(err => console.error("Erro ao semear cardápio a partir do painel:", err));
            }
        });
    } else {
        // Fallback local - FETCH from local API
        fetch('/api/menu')
            .then(res => res.json())
            .then(data => {
                menuData = data;
                renderMenuManager();
            })
            .catch(err => {
                console.error("Erro ao buscar cardápio local, usando DEFAULT_MENU_DATA:", err);
                menuData = DEFAULT_MENU_DATA;
                renderMenuManager();
            });
    }
}

function renderMenuManager() {
    if (!menuData) return;
    
    renderFlavorsList();
    renderPricesMatrix();
    renderBordersTable();
    
    // Update settings dashboard if active
    if (typeof renderSettingsDashboard === 'function') {
        renderSettingsDashboard();
    }
}

function renderFlavorsList() {
    const grid = document.getElementById('flavorsListGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    const searchVal = document.getElementById('searchFlavor').value.toLowerCase().trim();
    const filterCat = document.getElementById('filterCategory').value;
    
    const pizzas = menuData.menu_items?.pizzas || [];
    
    pizzas.forEach((pizza) => {
        if (searchVal && !pizza.name.toLowerCase().includes(searchVal) && !pizza.description.toLowerCase().includes(searchVal)) {
            return;
        }
        
        if (filterCat !== 'todos' && pizza.category !== filterCat) {
            return;
        }
        
        const card = document.createElement('div');
        card.className = 'flavor-card';
        if (pizza.available === false) {
            card.style.opacity = '0.6';
        }
        
        const badgeHTML = pizza.badge ? `<span class="flavor-badge-label">${pizza.badge}</span>` : '';
        const isChecked = pizza.available !== false ? 'checked' : '';
        
        card.innerHTML = `
            <div class="flavor-card-header">
                <div class="flavor-card-info">
                    <h4 style="margin: 0; color: var(--text-main); font-size: 15px;">${pizza.name}</h4>
                    <span class="category-tag ${pizza.category === 'salgadas' ? 'salgada' : 'doce'}">
                        ${pizza.category === 'salgadas' ? 'Salgada' : 'Doce'}
                    </span>
                </div>
                
                <label class="switch" title="${pizza.available !== false ? 'Disponível no Site' : 'Pausado/Indisponível'}">
                    <input type="checkbox" ${isChecked} onchange="toggleFlavorAvailability('${pizza.id}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            
            <p class="flavor-card-desc" style="margin: 0; flex: 1;">${pizza.description}</p>
            
            <div class="flavor-card-meta">
                <span class="flavor-price-tier" style="font-weight: 600; color: var(--primary); font-size: 12px; text-transform: uppercase;">
                    ${pizza.categoryType || 'promocional'}
                </span>
                ${badgeHTML}
            </div>
            
            <div class="flavor-card-actions">
                <button class="btn-icon-action" onclick="openEditFlavorModal('${pizza.id}')" title="Editar Sabor">
                    <span class="material-symbols-rounded" style="font-size: 18px;">edit</span>
                </button>
                <button class="btn-icon-action delete" onclick="deleteFlavor('${pizza.id}')" title="Excluir Sabor">
                    <span class="material-symbols-rounded" style="font-size: 18px;">delete</span>
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

function filterFlavorsList() {
    renderFlavorsList();
}

function renderPricesMatrix() {
    const tbody = document.getElementById('pricesMatrixBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const sizes = ['broto', 'media', 'grande', 'vulcao', 'trem'];
    const sizeLabels = {
        'broto': 'Broto (4 fatias)',
        'media': 'Média (8 fatias)',
        'grande': 'Grande (12 fatias)',
        'vulcao': 'Vulcão (12 fatias)',
        'trem': 'Trem (24 fatias)'
    };
    
    const prices = menuData.pizza_prices || {};
    
    sizes.forEach(size => {
        const sizePrices = prices[size] || { promocional: 0, tradicional: 0, especial: 0, premium: 0 };
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        
        tr.innerHTML = `
            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-main);">${sizeLabels[size]}</td>
            <td style="padding: 8px 10px;">
                <input type="number" step="0.50" class="price-input" data-size="${size}" data-category="promocional" value="${sizePrices.promocional || 0}" style="padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); width: 85px;">
            </td>
            <td style="padding: 8px 10px;">
                <input type="number" step="0.50" class="price-input" data-size="${size}" data-category="tradicional" value="${sizePrices.tradicional || 0}" style="padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); width: 85px;">
            </td>
            <td style="padding: 8px 10px;">
                <input type="number" step="0.50" class="price-input" data-size="${size}" data-category="especial" value="${sizePrices.especial || 0}" style="padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); width: 85px;">
            </td>
            <td style="padding: 8px 10px;">
                <input type="number" step="0.50" class="price-input" data-size="${size}" data-category="premium" value="${sizePrices.premium || sizePrices.camarao || 0}" style="padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); width: 85px;">
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBordersTable() {
    const tbody = document.getElementById('bordersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const borders = menuData.borders || {};
    
    Object.keys(borders).forEach(key => {
        const border = borders[key];
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        
        const isSemBorda = key === 'sem-borda';
        const nameInputHTML = isSemBorda 
            ? `<span style="font-weight: 500; padding: 8px 0; display: inline-block; color: var(--text-muted);">${border.name}</span>`
            : `<input type="text" class="border-name-input" data-id="${key}" value="${border.name}" style="width: 100%; max-width: 250px; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main);">`;
            
        const priceInputHTML = isSemBorda
            ? `<span style="color: var(--text-muted);">R$ 0,00 (Grátis)</span>`
            : `<input type="number" step="0.50" class="border-price-input" data-id="${key}" value="${border.price}" style="width: 85px; padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main);">`;
            
        tr.innerHTML = `
            <td style="padding: 12px 10px; font-family: monospace; font-size: 13px; color: var(--text-light);">${key}</td>
            <td style="padding: 8px 10px;">${nameInputHTML}</td>
            <td style="padding: 8px 10px;">${priceInputHTML}</td>
        `;
        tbody.appendChild(tr);
    });
}

function saveMenuPrices() {
    if (!menuData) return;
    
    const priceInputs = document.querySelectorAll('.price-input');
    const updatedPrices = JSON.parse(JSON.stringify(menuData.pizza_prices || {}));
    
    priceInputs.forEach(input => {
        const size = input.getAttribute('data-size');
        const category = input.getAttribute('data-category');
        const val = parseFloat(input.value) || 0;
        
        if (!updatedPrices[size]) updatedPrices[size] = {};
        updatedPrices[size][category] = val;
    });
    
    const updatedBorders = JSON.parse(JSON.stringify(menuData.borders || {}));
    const borderNameInputs = document.querySelectorAll('.border-name-input');
    const borderPriceInputs = document.querySelectorAll('.border-price-input');
    
    borderNameInputs.forEach(input => {
        const key = input.getAttribute('data-id');
        if (updatedBorders[key]) {
            updatedBorders[key].name = input.value.trim() || updatedBorders[key].name;
        }
    });
    
    borderPriceInputs.forEach(input => {
        const key = input.getAttribute('data-id');
        if (updatedBorders[key]) {
            updatedBorders[key].price = parseFloat(input.value) || 0;
        }
    });
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('menu/pizza_prices').set(updatedPrices)
        .then(() => {
            return firebase.database().ref('menu/borders').set(updatedBorders);
        })
        .then(() => {
            triggerCentralAutoBackup();
            alert("Preços e bordas atualizados com sucesso no Firebase!");
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao salvar preços no Firebase.");
        });
    } else {
        menuData.pizza_prices = updatedPrices;
        menuData.borders = updatedBorders;
        triggerCentralAutoBackup();
        alert("Preços locais salvos (sem Firebase).");
    }
}

function toggleFlavorAvailability(id, isChecked) {
    if (!menuData) return;
    
    const pizzas = menuData.menu_items?.pizzas || [];
    const index = pizzas.findIndex(p => p.id === id);
    if (index === -1) return;
    
    pizzas[index].available = isChecked;
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`menu/menu_items/pizzas/${index}/available`).set(isChecked)
        .then(() => {
            triggerCentralAutoBackup();
            console.log(`Disponibilidade de ${pizzas[index].name} alterada para: ${isChecked}`);
        })
        .catch(err => console.error("Erro ao alterar disponibilidade no Firebase:", err));
    } else {
        triggerCentralAutoBackup();
        renderFlavorsList();
    }
}

function openAddFlavorModal() {
    document.getElementById('flavorModalTitle').innerText = 'Adicionar Novo Sabor';
    document.getElementById('flavorEditId').value = '';
    document.getElementById('flavorForm').reset();
    
    // Set default value and trigger suggestions
    document.getElementById('flavorImage').value = 'assets/pizza_hero.png';
    updateFlavorImagePreview('assets/pizza_hero.png');
    onFlavorCategoryChange('salgadas');
    
    openModal('flavorModal');
}

function openEditFlavorModal(id) {
    if (!menuData) return;
    
    const pizzas = menuData.menu_items?.pizzas || [];
    const pizza = pizzas.find(p => p.id === id);
    if (!pizza) return;
    
    document.getElementById('flavorModalTitle').innerText = 'Editar Sabor';
    document.getElementById('flavorEditId').value = pizza.id;
    document.getElementById('flavorName').value = pizza.name;
    document.getElementById('flavorDescription').value = pizza.description;
    document.getElementById('flavorCategory').value = pizza.category;
    document.getElementById('flavorCategoryType').value = pizza.categoryType || 'promocional';
    document.getElementById('flavorBadge').value = pizza.badge || '';
    document.getElementById('flavorImage').value = pizza.image || 'assets/pizza_hero.png';
    updateFlavorImagePreview(pizza.image || 'assets/pizza_hero.png');
    
    // Trigger suggestions
    onFlavorCategoryChange(pizza.category);
    
    openModal('flavorModal');
}

function closeFlavorModal() {
    closeModal('flavorModal');
}

function openModal(modalId) {
    const overlay = document.getElementById(modalId);
    overlay.classList.remove('display-none');
    setTimeout(() => {
        overlay.classList.add('active');
        overlay.style.pointerEvents = 'auto';
        overlay.style.opacity = '1';
    }, 10);
}

function closeModal(modalId) {
    const overlay = document.getElementById(modalId);
    overlay.classList.remove('active');
    overlay.style.pointerEvents = 'none';
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.classList.add('display-none');
    }, 300);
}

function deleteFlavor(id) {
    if (!menuData) return;
    
    const pizzas = menuData.menu_items?.pizzas || [];
    const pizza = pizzas.find(p => p.id === id);
    if (!pizza) return;
    
    if (!confirm(`Tem certeza que deseja excluir o sabor "${pizza.name}" permanentemente?`)) return;
    
    const updatedPizzas = pizzas.filter(p => p.id !== id);
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('menu/menu_items/pizzas').set(updatedPizzas)
        .then(() => {
            triggerCentralAutoBackup();
            alert(`Sabor "${pizza.name}" excluído com sucesso!`);
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao excluir sabor no Firebase.");
        });
    } else {
        menuData.menu_items.pizzas = updatedPizzas;
        triggerCentralAutoBackup();
        renderFlavorsList();
    }
}

function saveFlavor(event) {
    event.preventDefault();
    if (!menuData) return;
    
    const idField = document.getElementById('flavorEditId').value;
    const name = document.getElementById('flavorName').value.trim();
    const description = document.getElementById('flavorDescription').value.trim();
    const category = document.getElementById('flavorCategory').value;
    const categoryType = document.getElementById('flavorCategoryType').value;
    const badge = document.getElementById('flavorBadge').value.trim();
    const image = document.getElementById('flavorImage').value;
    
    const pizzas = menuData.menu_items?.pizzas || [];
    
    if (idField) {
        const index = pizzas.findIndex(p => p.id === idField);
        if (index !== -1) {
            pizzas[index].name = name;
            pizzas[index].description = description;
            pizzas[index].category = category;
            pizzas[index].categoryType = categoryType;
            pizzas[index].badge = badge;
            pizzas[index].image = image;
        }
    } else {
        const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        
        if (pizzas.some(p => p.id === id)) {
            alert("Já existe um sabor cadastrado com um nome muito parecido. Por favor, use um nome diferente.");
            return;
        }
        
        pizzas.push({
            id: id,
            name: name,
            description: description,
            category: category,
            categoryType: categoryType,
            badge: badge,
            image: image,
            available: true
        });
    }
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('menu/menu_items/pizzas').set(pizzas)
        .then(() => {
            closeFlavorModal();
            triggerCentralAutoBackup();
            alert("Sabor gravado com sucesso!");
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao gravar sabor no Firebase.");
        });
    } else {
        closeFlavorModal();
        triggerCentralAutoBackup();
        renderFlavorsList();
    }
}

/* ==========================================================================
   Shop Status Management
   ========================================================================== */
function initShopStatus() {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('status/isOpen').on('value', (snapshot) => {
            const isOpen = snapshot.val();
            const toggle = document.getElementById('shopStatusToggle');
            const label = document.getElementById('shopStatusLabel');
            
            if (isOpen !== null) {
                if (toggle) toggle.checked = isOpen;
                if (label) {
                    label.innerText = isOpen ? "Aberto" : "Fechado";
                    label.style.color = isOpen ? "#81c784" : "#ef5350";
                }
            }
        });
    } else {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                const toggle = document.getElementById('shopStatusToggle');
                const label = document.getElementById('shopStatusLabel');
                if (data && typeof data.isOpen === 'boolean') {
                    if (toggle) toggle.checked = data.isOpen;
                    if (label) {
                        label.innerText = data.isOpen ? "Aberto" : "Fechado";
                        label.style.color = data.isOpen ? "#81c784" : "#ef5350";
                    }
                }
            })
            .catch(err => console.error("Erro ao carregar status local:", err));
    }
}

function toggleShopStatus(isOpen) {
    const label = document.getElementById('shopStatusLabel');
    if (label) {
        label.innerText = isOpen ? "Aberto" : "Fechado";
        label.style.color = isOpen ? "#81c784" : "#ef5350";
    }
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('status').set({ isOpen: isOpen })
        .catch(err => console.error("Erro ao salvar status no Firebase:", err));
    } else {
        fetch('/api/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isOpen: isOpen })
        })
        .catch(err => console.error("Erro ao atualizar status local:", err));
    }
}

/* ==========================================================================
   Bebidas e Sobremesas Management (Simple Items CRUD)
   ========================================================================== */
function renderSimpleItemsList() {
    const grid = document.getElementById('simpleItemsListGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (!menuData) return;
    
    const searchVal = document.getElementById('searchSimpleItem').value.toLowerCase().trim();
    const filterCat = document.getElementById('filterSimpleCategory').value;
    
    let combinedItems = [];
    
    if (filterCat === 'todos' || filterCat === 'bebidas') {
        const bebidas = menuData.menu_items?.bebidas || [];
        bebidas.forEach(item => combinedItems.push({ ...item, category: 'bebidas' }));
    }
    
    if (filterCat === 'todos' || filterCat === 'sobremesas') {
        const sobremesas = menuData.menu_items?.sobremesas || [];
        sobremesas.forEach(item => combinedItems.push({ ...item, category: 'sobremesas' }));
    }
    
    combinedItems.forEach((item) => {
        if (searchVal && !item.name.toLowerCase().includes(searchVal) && !item.description.toLowerCase().includes(searchVal)) {
            return;
        }
        
        const card = document.createElement('div');
        card.className = 'flavor-card';
        if (item.available === false) {
            card.style.opacity = '0.6';
        }
        
        const isChecked = item.available !== false ? 'checked' : '';
        const catLabel = item.category === 'bebidas' ? 'Bebida' : 'Sobremesa';
        
        card.innerHTML = `
            <div class="flavor-card-header">
                <div class="flavor-card-info">
                    <h4 style="margin: 0; color: var(--text-main); font-size: 15px;">${item.name}</h4>
                    <span class="category-tag ${item.category === 'bebidas' ? 'salgada' : 'doce'}">
                        ${catLabel}
                    </span>
                </div>
                
                <label class="switch" title="${item.available !== false ? 'Disponível no Site' : 'Pausado/Indisponível'}">
                    <input type="checkbox" ${isChecked} onchange="toggleSimpleItemAvailability('${item.id}', '${item.category}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            
            <p class="flavor-card-desc" style="margin: 0; flex: 1;">${item.description}</p>
            
            <div class="flavor-card-meta">
                <span class="flavor-price-tier" style="font-weight: 600; color: var(--primary); font-size: 13px;">
                    R$ ${item.price.toFixed(2).replace('.', ',')}
                </span>
            </div>
            
            <div class="flavor-card-actions">
                <button class="btn-icon-action" onclick="openEditSimpleItemModal('${item.id}', '${item.category}')" title="Editar Item">
                    <span class="material-symbols-rounded" style="font-size: 18px;">edit</span>
                </button>
                <button class="btn-icon-action delete" onclick="deleteSimpleItem('${item.id}', '${item.category}')" title="Excluir Item">
                    <span class="material-symbols-rounded" style="font-size: 18px;">delete</span>
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

function filterSimpleItemsList() {
    renderSimpleItemsList();
}

function openAddSimpleItemModal() {
    document.getElementById('simpleItemModalTitle').innerText = 'Adicionar Novo Item';
    document.getElementById('simpleItemEditId').value = '';
    document.getElementById('simpleItemEditCategory').value = '';
    document.getElementById('simpleItemForm').reset();
    
    onSimpleItemCategorySelectChange('bebidas');
    
    openModal('simpleItemModal');
}

function onSimpleItemCategorySelectChange(val) {
    const imgInput = document.getElementById('simpleItemImage');
    if (!imgInput) return;
    
    if (val === 'bebidas') {
        imgInput.value = 'assets/gourmet_bebida.png';
    } else {
        imgInput.value = 'assets/gourmet_sobremesa.png';
    }
    
    populateSimpleItemSuggestions(val);
}

function openEditSimpleItemModal(id, category) {
    if (!menuData) return;
    
    const list = category === 'bebidas' ? menuData.menu_items?.bebidas : menuData.menu_items?.sobremesas;
    if (!list) return;
    
    const item = list.find(i => i.id === id);
    if (!item) return;
    
    document.getElementById('simpleItemModalTitle').innerText = 'Editar Item';
    document.getElementById('simpleItemEditId').value = item.id;
    document.getElementById('simpleItemEditCategory').value = category;
    
    document.getElementById('simpleItemName').value = item.name;
    document.getElementById('simpleItemDescription').value = item.description;
    document.getElementById('simpleItemCategorySelect').value = category;
    document.getElementById('simpleItemPrice').value = item.price;
    document.getElementById('simpleItemImage').value = item.image || (category === 'bebidas' ? 'assets/gourmet_bebida.png' : 'assets/gourmet_sobremesa.png');
    
    // Trigger suggestions
    populateSimpleItemSuggestions(category);
    
    openModal('simpleItemModal');
}

function closeSimpleItemModal() {
    closeModal('simpleItemModal');
}

function toggleSimpleItemAvailability(id, category, isChecked) {
    if (!menuData) return;
    
    const list = category === 'bebidas' ? menuData.menu_items?.bebidas : menuData.menu_items?.sobremesas;
    if (!list) return;
    
    const index = list.findIndex(i => i.id === id);
    if (index === -1) return;
    
    list[index].available = isChecked;
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`menu/menu_items/${category}/${index}/available`).set(isChecked)
        .then(() => {
            console.log(`Disponibilidade de ${list[index].name} alterada para: ${isChecked}`);
        })
        .catch(err => console.error("Erro ao alterar disponibilidade no Firebase:", err));
    } else {
        saveLocalMenu(() => {
            renderSimpleItemsList();
        });
    }
}

function deleteSimpleItem(id, category) {
    if (!menuData) return;
    
    const list = category === 'bebidas' ? menuData.menu_items?.bebidas : menuData.menu_items?.sobremesas;
    if (!list) return;
    
    const item = list.find(i => i.id === id);
    if (!item) return;
    
    if (!confirm(`Tem certeza que deseja excluir o item "${item.name}" permanentemente?`)) return;
    
    const updatedList = list.filter(i => i.id !== id);
    
    if (category === 'bebidas') {
        menuData.menu_items.bebidas = updatedList;
    } else {
        menuData.menu_items.sobremesas = updatedList;
    }
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref(`menu/menu_items/${category}`).set(updatedList)
        .then(() => {
            alert(`Item "${item.name}" excluído com sucesso!`);
            renderSimpleItemsList();
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao excluir item no Firebase.");
        });
    } else {
        saveLocalMenu(() => {
            alert(`Item "${item.name}" excluído localmente com sucesso!`);
            renderSimpleItemsList();
        });
    }
}

function saveSimpleItem(event) {
    event.preventDefault();
    if (!menuData) return;
    
    const idField = document.getElementById('simpleItemEditId').value;
    const oldCategory = document.getElementById('simpleItemEditCategory').value;
    
    const name = document.getElementById('simpleItemName').value.trim();
    const description = document.getElementById('simpleItemDescription').value.trim();
    const newCategory = document.getElementById('simpleItemCategorySelect').value;
    const price = parseFloat(document.getElementById('simpleItemPrice').value) || 0;
    const image = document.getElementById('simpleItemImage').value;
    
    if (!menuData.menu_items.bebidas) menuData.menu_items.bebidas = [];
    if (!menuData.menu_items.sobremesas) menuData.menu_items.sobremesas = [];
    
    if (idField) {
        if (oldCategory !== newCategory) {
            const oldList = oldCategory === 'bebidas' ? menuData.menu_items.bebidas : menuData.menu_items.sobremesas;
            const itemIndex = oldList.findIndex(i => i.id === idField);
            let itemData = { id: idField, name, description, category: newCategory, price, image, available: true };
            if (itemIndex !== -1) {
                itemData.available = oldList[itemIndex].available !== false;
                oldList.splice(itemIndex, 1);
            }
            
            const newList = newCategory === 'bebidas' ? menuData.menu_items.bebidas : menuData.menu_items.sobremesas;
            newList.push(itemData);
        } else {
            const list = newCategory === 'bebidas' ? menuData.menu_items.bebidas : menuData.menu_items.sobremesas;
            const index = list.findIndex(i => i.id === idField);
            if (index !== -1) {
                list[index].name = name;
                list[index].description = description;
                list[index].category = newCategory;
                list[index].price = price;
                list[index].image = image;
            }
        }
    } else {
        const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const list = newCategory === 'bebidas' ? menuData.menu_items.bebidas : menuData.menu_items.sobremesas;
        
        if (list.some(i => i.id === id)) {
            alert("Já existe um item cadastrado com um nome muito parecido.");
            return;
        }
        
        list.push({
            id: id,
            name: name,
            description: description,
            category: newCategory,
            price: price,
            image: image,
            available: true
        });
    }
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('menu/menu_items').set(menuData.menu_items)
        .then(() => {
            closeSimpleItemModal();
            alert("Item gravado com sucesso no Firebase!");
            renderSimpleItemsList();
        })
        .catch(err => {
            console.error(err);
            alert("Erro ao gravar item no Firebase.");
        });
    } else {
        saveLocalMenu(() => {
            closeSimpleItemModal();
            alert("Item gravado localmente com sucesso!");
            renderSimpleItemsList();
        });
    }
}

function saveLocalMenu(callback) {
    fetch('/api/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(menuData)
    })
    .then(res => res.json())
    .then(data => {
        if (callback) callback();
    })
    .catch(err => {
        console.error("Erro ao salvar cardápio localmente:", err);
        if (callback) callback();
    });
}

/* ==========================================================================
   Image Suggestion Helpers
   ========================================================================== */
function onFlavorCategoryChange(val) {
    populateFlavorImageSuggestions(val);
}

function populateFlavorImageSuggestions(category) {
    const suggestionsContainer = document.getElementById('imageSuggestions');
    if (!suggestionsContainer) return;
    
    suggestionsContainer.innerHTML = '';
    
    let suggestions = [];
    if (category === 'salgadas') {
        suggestions = [
            { label: 'Calabresa (Gourmet)', value: 'assets/gourmet_calabresa.png' },
            { label: 'Calabresa', value: 'assets/pizza_calabresa.png' },
            { label: 'Marguerita (Gourmet)', value: 'assets/gourmet_margherita.png' },
            { label: 'Marguerita', value: 'assets/pizza_margherita.png' },
            { label: '4 Queijos (Gourmet)', value: 'assets/gourmet_quatro_queijos.png' },
            { label: '4 Queijos', value: 'assets/pizza_quatro_queijos.png' },
            { label: 'Padrão / Hero', value: 'assets/pizza_hero.png' }
        ];
    } else { // doces
        suggestions = [
            { label: 'Morango (Gourmet)', value: 'assets/gourmet_doce_morango.png' },
            { label: 'Chocolate', value: 'assets/pizza_chocolate.png' },
            { label: 'Padrão / Hero', value: 'assets/pizza_hero.png' }
        ];
    }
    
    renderSuggestionsInto(suggestionsContainer, suggestions, 'flavorImage');
}

function populateSimpleItemSuggestions(category) {
    const suggestionsContainer = document.getElementById('simpleItemImageSuggestions');
    if (!suggestionsContainer) return;
    
    suggestionsContainer.innerHTML = '';
    
    let suggestions = [];
    if (category === 'bebidas') {
        suggestions = [
            { label: 'Bebidas (Padrão)', value: 'assets/gourmet_bebida.png' }
        ];
    } else { // sobremesas
        suggestions = [
            { label: 'Sobremesas (Padrão)', value: 'assets/gourmet_sobremesa.png' }
        ];
    }
    
    renderSuggestionsInto(suggestionsContainer, suggestions, 'simpleItemImage');
}

function renderSuggestionsInto(container, suggestions, targetInputId) {
    const label = document.createElement('span');
    label.textContent = 'Sugestões rápidas: ';
    label.style.fontSize = '12px';
    label.style.color = 'var(--text-muted)';
    label.style.marginRight = '4px';
    container.appendChild(label);
    
    suggestions.forEach((sug) => {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = sug.label;
        link.style.fontSize = '12px';
        link.style.color = '#ffc107'; // Golden/Accent color
        link.style.textDecoration = 'none';
        link.style.marginRight = '8px';
        link.style.cursor = 'pointer';
        link.style.background = 'rgba(255, 193, 7, 0.1)';
        link.style.padding = '2px 6px';
        link.style.borderRadius = '4px';
        link.style.border = '1px solid rgba(255, 193, 7, 0.2)';
        link.style.transition = 'all var(--transition)';
        
        link.addEventListener('mouseenter', () => {
            link.style.background = 'rgba(255, 193, 7, 0.2)';
        });
        link.addEventListener('mouseleave', () => {
            link.style.background = 'rgba(255, 193, 7, 0.1)';
        });
        
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const input = document.getElementById(targetInputId);
            if (input) {
                input.value = sug.value;
            }
        });
        container.appendChild(link);
    });
}

/* ==========================================================================
   Store Settings Functions
   ========================================================================== */
function updateTrackingStatusUI() {
    const badge = document.getElementById('trackingGlobalStatusBadge');
    const badgeText = document.getElementById('trackingGlobalStatusText');
    if (!badge || !badgeText) return;

    const gtmEnabled = document.getElementById('settingsGtmEnabled')?.checked;
    const metaPixelEnabled = document.getElementById('settingsMetaPixelEnabled')?.checked;
    const ga4Enabled = document.getElementById('settingsGa4Enabled')?.checked;
    const googleAdsEnabled = document.getElementById('settingsGoogleAdsEnabled')?.checked;

    const isAnyActive = gtmEnabled || metaPixelEnabled || ga4Enabled || googleAdsEnabled;

    if (isAnyActive) {
        badge.style.background = 'rgba(76, 175, 80, 0.15)';
        badge.style.color = '#4CAF50';
        badge.style.borderColor = 'rgba(76, 175, 80, 0.3)';
        badgeText.textContent = '🟢 Rastreamento ativo';
    } else {
        badge.style.background = 'rgba(239, 83, 80, 0.15)';
        badge.style.color = '#ef5350';
        badge.style.borderColor = 'rgba(239, 83, 80, 0.3)';
        badgeText.textContent = '🔴 Rastreamento desativado';
    }
}

function renderSettingsDashboard() {
    if (!menuData) return;
    
    if (!menuData.settings) {
        menuData.settings = {
            whatsapp: '5554996985724',
            whatsappFormatted: '(54) 99698-5724',
            deliveryFees: {}
        };
        if (DEFAULT_MENU_DATA.settings && DEFAULT_MENU_DATA.settings.deliveryFees) {
            menuData.settings.deliveryFees = JSON.parse(JSON.stringify(DEFAULT_MENU_DATA.settings.deliveryFees));
        }
    }
    
    const settings = menuData.settings;
    const settingsWhatsapp = document.getElementById('settingsWhatsapp');
    const settingsWhatsappFormatted = document.getElementById('settingsWhatsappFormatted');
    
    const settingsMotoboy1Name = document.getElementById('settingsMotoboy1Name');
    const settingsMotoboy1Whatsapp = document.getElementById('settingsMotoboy1Whatsapp');
    const settingsMotoboy2Name = document.getElementById('settingsMotoboy2Name');
    const settingsMotoboy2Whatsapp = document.getElementById('settingsMotoboy2Whatsapp');
    const settingsMotoboy3Name = document.getElementById('settingsMotoboy3Name');
    const settingsMotoboy3Whatsapp = document.getElementById('settingsMotoboy3Whatsapp');
    
    if (settingsWhatsapp) settingsWhatsapp.value = settings.whatsapp || '';
    if (settingsWhatsappFormatted) settingsWhatsappFormatted.value = settings.whatsappFormatted || '';
    
    // Marketing Tracking Settings
    const tracking = settings.tracking || {};
    const settingsGtmEnabled = document.getElementById('settingsGtmEnabled');
    const settingsGtmId = document.getElementById('settingsGtmId');
    const settingsMetaPixelEnabled = document.getElementById('settingsMetaPixelEnabled');
    const settingsMetaPixelId = document.getElementById('settingsMetaPixelId');
    const settingsGa4Enabled = document.getElementById('settingsGa4Enabled');
    const settingsGa4Id = document.getElementById('settingsGa4Id');
    const settingsGoogleAdsEnabled = document.getElementById('settingsGoogleAdsEnabled');
    const settingsGoogleAdsId = document.getElementById('settingsGoogleAdsId');
    const settingsGoogleAdsPurchaseLabel = document.getElementById('settingsGoogleAdsPurchaseLabel');

    const gtmActive = tracking.gtmEnabled === true || tracking.gtmEnabled === 'true' || (tracking.enabled && !!tracking.gtmId);
    const pixelActive = tracking.metaPixelEnabled === true || tracking.metaPixelEnabled === 'true' || (tracking.enabled && !!tracking.metaPixelId);
    const ga4Active = tracking.ga4Enabled === true || tracking.ga4Enabled === 'true' || (tracking.enabled && (!!tracking.ga4Id || !!tracking.ga4MeasurementId));
    const googleAdsActive = tracking.googleAdsEnabled === true || tracking.googleAdsEnabled === 'true';

    if (settingsGtmEnabled) settingsGtmEnabled.checked = gtmActive;
    if (settingsGtmId) settingsGtmId.value = tracking.gtmId || '';

    if (settingsMetaPixelEnabled) settingsMetaPixelEnabled.checked = pixelActive;
    if (settingsMetaPixelId) settingsMetaPixelId.value = tracking.metaPixelId || '';

    if (settingsGa4Enabled) settingsGa4Enabled.checked = ga4Active;
    if (settingsGa4Id) settingsGa4Id.value = tracking.ga4Id || tracking.ga4MeasurementId || '';

    if (settingsGoogleAdsEnabled) settingsGoogleAdsEnabled.checked = googleAdsActive;
    if (settingsGoogleAdsId) settingsGoogleAdsId.value = tracking.googleAdsId || '';
    if (settingsGoogleAdsPurchaseLabel) settingsGoogleAdsPurchaseLabel.value = (tracking.googleAdsConversionLabels && tracking.googleAdsConversionLabels.purchase) || '';

    updateTrackingStatusUI();

    for (let i = 1; i <= 10; i++) {
        const nameElem = document.getElementById(`settingsMotoboy${i}Name`);
        const wspElem = document.getElementById(`settingsMotoboy${i}Whatsapp`);
        const nameVal = i === 1 ? (settings.motoboy1Name || settings.motoboyName || '') : (settings[`motoboy${i}Name`] || '');
        const wspVal = i === 1 ? (settings.motoboy1Whatsapp || settings.motoboyWhatsapp || '') : (settings[`motoboy${i}Whatsapp`] || '');
        if (nameElem) nameElem.value = nameVal;
        if (wspElem) wspElem.value = wspVal;
    }
    
    const feesBody = document.getElementById('settingsFeesBody');
    if (feesBody) {
        feesBody.innerHTML = '';
        const fees = settings.deliveryFees || {};
        const sortedKeys = Object.keys(fees).sort((a, b) => fees[a].name.localeCompare(fees[b].name));
        
        if (sortedKeys.length === 0) {
            feesBody.innerHTML = '<tr><td colspan="4" style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 13px;">Nenhum bairro cadastrado.</td></tr>';
        } else {
            sortedKeys.forEach(key => {
                const item = fees[key];
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';
                tr.innerHTML = `
                    <td style="padding: 8px 5px; color: var(--text-muted); font-size: 12px; font-family: monospace;">${key}</td>
                    <td style="padding: 8px 5px; font-weight: 500; font-size: 14px;">${item.name}</td>
                    <td style="padding: 8px 5px;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 13px; color: var(--text-muted);">R$</span>
                            <input type="number" step="0.50" value="${item.fee}" class="bairro-fee-input" data-id="${key}" style="width: 75px; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); font-size: 13px;">
                        </div>
                    </td>
                    <td style="padding: 8px 5px; text-align: center;">
                        <button type="button" onclick="deleteBairroRow('${key}')" style="background: transparent; border: none; color: #ef5350; cursor: pointer; display: inline-flex; align-items: center;" title="Excluir Bairro">
                            <span class="material-symbols-rounded" style="font-size: 18px;">delete</span>
                        </button>
                    </td>
                `;
                feesBody.appendChild(tr);
            });
        }
    }
}

function addBairroRow() {
    if (!menuData || !menuData.settings) return;
    
    const idInput = document.getElementById('newBairroId');
    const nameInput = document.getElementById('newBairroName');
    const feeInput = document.getElementById('newBairroFee');
    
    if (!idInput || !nameInput || !feeInput) return;
    
    const id = idInput.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-");
    const name = nameInput.value.trim();
    const fee = parseFloat(feeInput.value);
    
    if (!id || !name || isNaN(fee)) {
        alert("Preencha todos os campos do novo bairro de forma válida.");
        return;
    }
    
    if (!menuData.settings.deliveryFees) {
        menuData.settings.deliveryFees = {};
    }
    
    if (menuData.settings.deliveryFees[id]) {
        alert("Já existe um bairro cadastrado com este Identificador (ID).");
        return;
    }
    
    menuData.settings.deliveryFees[id] = { name: name, fee: fee };
    TAXAS_ENTREGA[id] = { name: name, fee: fee };
    
    idInput.value = '';
    nameInput.value = '';
    feeInput.value = '';
    
    triggerCentralAutoBackup();
    renderSettingsDashboard();
}

function deleteBairroRow(key) {
    if (!menuData || !menuData.settings || !menuData.settings.deliveryFees) return;
    
    if (confirm(`Deseja realmente remover as taxas do bairro "${menuData.settings.deliveryFees[key]?.name || key}"?`)) {
        delete menuData.settings.deliveryFees[key];
        delete TAXAS_ENTREGA[key];
        triggerCentralAutoBackup();
        renderSettingsDashboard();
    }
}

function saveSettings(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    if (!menuData || !menuData.settings) return;
    
    const whatsapp = document.getElementById('settingsWhatsapp').value.trim();
    const whatsappFormatted = document.getElementById('settingsWhatsappFormatted').value.trim();
    
    if (!whatsapp) {
        alert("O número de WhatsApp da empresa é obrigatório.");
        return;
    }
    
    menuData.settings.whatsapp = whatsapp;
    menuData.settings.whatsappFormatted = whatsappFormatted;

    // Marketing Tracking Settings
    const gtmEnabled = document.getElementById('settingsGtmEnabled')?.checked || false;
    let gtmId = (document.getElementById('settingsGtmId')?.value || '').trim().toUpperCase();

    const metaPixelEnabled = document.getElementById('settingsMetaPixelEnabled')?.checked || false;
    let metaPixelId = (document.getElementById('settingsMetaPixelId')?.value || '').trim().replace(/\D/g, '');

    const ga4Enabled = document.getElementById('settingsGa4Enabled')?.checked || false;
    let ga4Id = (document.getElementById('settingsGa4Id')?.value || '').trim().toUpperCase();

    const googleAdsEnabled = document.getElementById('settingsGoogleAdsEnabled')?.checked || false;
    let googleAdsId = (document.getElementById('settingsGoogleAdsId')?.value || '').trim().toUpperCase();
    let googleAdsPurchaseLabel = (document.getElementById('settingsGoogleAdsPurchaseLabel')?.value || '').trim();

    // Auto-prefixação inteligente se o usuário esquecer de digitar o prefixo
    if (gtmId && !gtmId.startsWith('GTM-')) gtmId = 'GTM-' + gtmId;
    if (ga4Id && !ga4Id.startsWith('G-')) ga4Id = 'G-' + ga4Id;
    if (googleAdsId && !googleAdsId.startsWith('AW-')) googleAdsId = 'AW-' + googleAdsId;

    // Validations: If enabled, check strict format
    if (gtmEnabled && gtmId) {
        if (!/^GTM-[A-Z0-9]{4,12}$/.test(gtmId)) {
            alert('Google Tag Manager ID inválido. Formato esperado: GTM-XXXXXXX');
            return;
        }
    }

    if (metaPixelEnabled && metaPixelId) {
        if (!/^\d{6,20}$/.test(metaPixelId)) {
            alert('Meta Pixel ID inválido. Use apenas números (ex: 123456789012345).');
            return;
        }
    }

    if (ga4Enabled && ga4Id) {
        if (!/^G-[A-Z0-9]{6,15}$/.test(ga4Id)) {
            alert('GA4 Measurement ID inválido. Formato esperado: G-XXXXXXXXXX');
            return;
        }
    }

    if (googleAdsEnabled) {
        if (!googleAdsId || !/^AW-[0-9]{6,12}$/.test(googleAdsId)) {
            alert('ID de Conversão do Google Ads inválido. Formato esperado: AW-XXXXXXXXX');
            return;
        }
    }

    const trackingActive = (gtmEnabled && !!gtmId) || (metaPixelEnabled && !!metaPixelId) || (ga4Enabled && !!ga4Id) || (googleAdsEnabled && !!googleAdsId);

    menuData.settings.tracking = {
        enabled: trackingActive,
        gtmEnabled: gtmEnabled,
        gtmId: gtmId,
        metaPixelEnabled: metaPixelEnabled,
        metaPixelId: metaPixelId,
        ga4Enabled: ga4Enabled,
        ga4Id: ga4Id,
        ga4MeasurementId: ga4Id,
        googleAdsEnabled: googleAdsEnabled,
        googleAdsId: googleAdsId,
        googleAdsConversionLabels: {
            purchase: googleAdsPurchaseLabel
        }
    };
    
    for (let i = 1; i <= 10; i++) {
        const nameElem = document.getElementById(`settingsMotoboy${i}Name`);
        const wspElem = document.getElementById(`settingsMotoboy${i}Whatsapp`);
        const mName = nameElem ? nameElem.value.trim() : '';
        const mWsp = wspElem ? wspElem.value.trim() : '';
        
        menuData.settings[`motoboy${i}Name`] = mName;
        menuData.settings[`motoboy${i}Whatsapp`] = mWsp;
        if (i === 1) {
            menuData.settings.motoboyName = mName;
            menuData.settings.motoboyWhatsapp = mWsp;
        }
    }
    
    const inputs = document.querySelectorAll('.bairro-fee-input');
    inputs.forEach(input => {
        const key = input.getAttribute('data-id');
        const fee = parseFloat(input.value);
        if (menuData.settings.deliveryFees && menuData.settings.deliveryFees[key]) {
            menuData.settings.deliveryFees[key].fee = isNaN(fee) ? 0 : fee;
        }
    });
    
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const settingsRef = firebase.database().ref('menu/settings');
        
        settingsRef.set(menuData.settings)
        .then(() => {
            renderSettingsDashboard();
            triggerCentralAutoBackup();
            alert("Configurações salvas com sucesso no Firebase!");
        })
        .catch(err => {
            alert("Erro ao salvar configurações no Firebase: " + err.message);
            console.error(err);
        });
    } else {
        saveLocalMenu(() => {
            triggerCentralAutoBackup();
            alert("Configurações salvas localmente com sucesso!");
        });
    }
}

/* ==========================================================================
   Reports Dashboard Functionality
   ========================================================================== */
function renderReportsDashboard() {
    const filterVal = document.getElementById('reportsPeriodFilter')?.value || 'all';
    
    // Time calculations
    const now = Date.now();
    const millisecondsInDay = 24 * 60 * 60 * 1000;
    
    const filteredOrders = orders.filter(order => {
        if (!order.timestamp) return filterVal === 'all';
        
        const diffDays = (now - order.timestamp) / millisecondsInDay;
        
        if (filterVal === 'today') {
            const orderDate = new Date(order.timestamp).toDateString();
            const todayDate = new Date().toDateString();
            return orderDate === todayDate;
        } else if (filterVal === '7days') {
            return diffDays <= 7;
        } else if (filterVal === 'month') {
            return diffDays <= 30;
        }
        return true; // all
    });

    // 1. Sales summary (status: Entregue)
    const completedOrders = filteredOrders.filter(o => o.status === 'Entregue');
    const canceledOrders = filteredOrders.filter(o => o.status === 'Cancelado');
    
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const avgOrder = completedOrders.length > 0 ? (totalRevenue / completedOrders.length) : 0;
    
    // Update summary cards
    const repTotalRevenueEl = document.getElementById('repTotalRevenue');
    const repCompletedOrdersEl = document.getElementById('repCompletedOrders');
    const repAverageOrderEl = document.getElementById('repAverageOrder');
    const repCanceledOrdersEl = document.getElementById('repCanceledOrders');
    
    if (repTotalRevenueEl) repTotalRevenueEl.innerText = `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`;
    if (repCompletedOrdersEl) repCompletedOrdersEl.innerText = completedOrders.length;
    if (repAverageOrderEl) repAverageOrderEl.innerText = `R$ ${avgOrder.toFixed(2).replace('.', ',')}`;
    if (repCanceledOrdersEl) repCanceledOrdersEl.innerText = canceledOrders.length;

    // 2. Payment Methods distribution
    const paymentsCount = { pix: 0, card: 0, cash: 0 };
    const paymentsRevenue = { pix: 0, card: 0, cash: 0 };
    completedOrders.forEach(o => {
        const method = o.paymentMethod;
        if (paymentsCount[method] !== undefined) {
            paymentsCount[method]++;
            paymentsRevenue[method] += (o.total || 0);
        }
    });
    
    const totalPaymentsRevenue = paymentsRevenue.pix + paymentsRevenue.card + paymentsRevenue.cash;
    
    const paymentsContainer = document.getElementById('paymentMethodsDistribution');
    if (paymentsContainer) {
        paymentsContainer.innerHTML = '';
        
        const labels = { pix: 'Pix', card: 'Cartão (Maquininha)', cash: 'Dinheiro' };
        const classes = { pix: 'pix', card: 'card', cash: 'cash' };
        
        ['pix', 'card', 'cash'].forEach(method => {
            const rev = paymentsRevenue[method];
            const pct = totalPaymentsRevenue > 0 ? (rev / totalPaymentsRevenue) * 100 : 0;
            const count = paymentsCount[method];
            
            const html = `
                <div class="report-bar-row">
                    <div class="report-bar-label">
                        <span>${labels[method]} (${count} ped.)</span>
                        <span class="value">R$ ${rev.toFixed(2).replace('.', ',')} (${pct.toFixed(0)}%)</span>
                    </div>
                    <div class="report-bar-track">
                        <div class="report-bar-fill ${classes[method]}" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
            paymentsContainer.insertAdjacentHTML('beforeend', html);
        });
    }

    // 3. Top 5 Best Sellers
    const itemQuantities = {};
    completedOrders.forEach(o => {
        if (!o.cart) return;
        o.cart.forEach(item => {
            if (item.type === 'pizza') {
                if (item.flavorNames && item.flavorNames.length > 0) {
                    item.flavorNames.forEach(flavor => {
                        const key = `Pizza Sabor: ${flavor}`;
                        itemQuantities[key] = (itemQuantities[key] || 0) + (item.quantity || 1);
                    });
                } else {
                    const key = `Pizza ${item.sizeName || 'Montada'}`;
                    itemQuantities[key] = (itemQuantities[key] || 0) + (item.quantity || 1);
                }
            } else {
                const key = item.name;
                itemQuantities[key] = (itemQuantities[key] || 0) + (item.quantity || 1);
            }
        });
    });
    
    const sortedItems = Object.keys(itemQuantities)
        .map(key => ({ name: key, qty: itemQuantities[key] }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
        
    const topProductsContainer = document.getElementById('topSellingProductsList');
    if (topProductsContainer) {
        topProductsContainer.innerHTML = '';
        
        if (sortedItems.length === 0) {
            topProductsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 14px; text-align: center; padding: 20px 0;">Nenhum produto vendido no período selecionado.</div>';
        } else {
            const maxQty = Math.max(...sortedItems.map(i => i.qty));
            
            sortedItems.forEach(item => {
                const pct = maxQty > 0 ? (item.qty / maxQty) * 100 : 0;
                const html = `
                    <div class="report-bar-row">
                        <div class="report-bar-label">
                            <span>${item.name}</span>
                            <span class="value">${item.qty} un.</span>
                        </div>
                        <div class="report-bar-track">
                            <div class="report-bar-fill item" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                `;
                topProductsContainer.insertAdjacentHTML('beforeend', html);
            });
        }
    }

    // 4. Motoboys Payment Report
    renderMotoboysPaymentReport(filteredOrders);
}

function renderMotoboysPaymentReport(filteredOrders) {
    const container = document.getElementById('motoboysPaymentReportContainer');
    if (!container) return;
    
    const motoboys = getActiveMotoboys();
    const deliveryOrders = filteredOrders.filter(o => o.checkoutType === 'delivery' && o.status !== 'Cancelado');
    
    const motoboyStats = {};
    motoboys.forEach(m => {
        motoboyStats[m.id] = { id: m.id, name: m.name, whatsapp: m.whatsapp, count: 0, totalFees: 0, ordersList: [] };
    });
    motoboyStats['unassigned'] = { id: 'unassigned', name: 'Sem Motoboy Atribuído', whatsapp: '', count: 0, totalFees: 0, ordersList: [] };

    deliveryOrders.forEach(o => {
        const mId = o.assignedMotoboyId;
        const fee = (o.motoboyFee !== undefined && o.motoboyFee !== null) ? Number(o.motoboyFee) : Number(o.deliveryFee || 0);
        
        if (mId && motoboyStats[mId]) {
            motoboyStats[mId].count++;
            motoboyStats[mId].totalFees += fee;
            motoboyStats[mId].ordersList.push({ id: o.id, fee: fee, neighborhood: o.address?.neighborhood || '' });
        } else {
            motoboyStats['unassigned'].count++;
            motoboyStats['unassigned'].totalFees += fee;
            motoboyStats['unassigned'].ordersList.push({ id: o.id, fee: fee, neighborhood: o.address?.neighborhood || '' });
        }
    });

    let tableRowsHTML = '';
    let grandTotalCount = 0;
    let grandTotalFees = 0;

    Object.keys(motoboyStats).forEach(key => {
        const stat = motoboyStats[key];
        if (stat.count === 0 && stat.id === 'unassigned') return;
        if (stat.count === 0 && motoboys.length > 0 && stat.id !== 'unassigned') return;
        
        grandTotalCount += stat.count;
        grandTotalFees += stat.totalFees;

        const whatsappBtnHTML = stat.whatsapp ? `
            <button type="button" onclick="sendMotoboySummaryWhatsApp('${stat.id}')" style="background: #25d366; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;" title="Enviar extrato de corridas no WhatsApp do Motoboy">
                <span class="material-symbols-rounded" style="font-size: 16px;">chat</span>
                Enviar Extrato
            </button>
        ` : `<span style="color: var(--text-muted); font-size: 12px;">-</span>`;

        tableRowsHTML += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px 10px; font-weight: 600; color: var(--text-main);">
                    <span style="display: flex; align-items: center; gap: 6px;">
                        <span class="material-symbols-rounded" style="color: #25d366; font-size: 18px;">two_wheeler</span>
                        ${stat.name}
                    </span>
                </td>
                <td style="padding: 12px 10px; text-align: center; font-weight: 600; color: var(--text-main); font-size: 14px;">${stat.count} entregas</td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 700; color: #81c784; font-size: 15px;">R$ ${stat.totalFees.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 12px 10px; text-align: center;">${whatsappBtnHTML}</td>
            </tr>
        `;
    });

    if (tableRowsHTML === '') {
        tableRowsHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Nenhuma tele-entrega registrada no período selecionado.</td></tr>`;
    }

    container.innerHTML = `
        <div class="prices-table-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <h3 style="margin: 0; color: var(--text-main); font-family: var(--font-display); font-size: 18px; display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-rounded" style="color: #25d366;">two_wheeler</span>
                    Fechamento de Motoboys (Valores de Corridas a Pagar)
                </h3>
                <div style="background: rgba(37, 211, 102, 0.15); color: #25d366; border: 1px solid rgba(37, 211, 102, 0.3); padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 14px;">
                    Total a Pagar aos Motoboys: R$ ${grandTotalFees.toFixed(2).replace('.', ',')}
                </div>
            </div>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border-color); color: var(--text-main); font-weight: bold; font-size: 13px;">
                            <th style="padding: 10px;">Motoboy</th>
                            <th style="padding: 10px; text-align: center;">Total de Corridas</th>
                            <th style="padding: 10px; text-align: right;">Total Corridas a Pagar (R$)</th>
                            <th style="padding: 10px; text-align: center;">Enviar Extrato</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function sendMotoboySummaryWhatsApp(motoboyId) {
    const filterVal = document.getElementById('reportsPeriodFilter')?.value || 'all';
    const now = Date.now();
    const millisecondsInDay = 24 * 60 * 60 * 1000;
    
    const filteredOrders = orders.filter(order => {
        if (!order.timestamp) return filterVal === 'all';
        const diffDays = (now - order.timestamp) / millisecondsInDay;
        if (filterVal === 'today') {
            return new Date(order.timestamp).toDateString() === new Date().toDateString();
        } else if (filterVal === '7days') return diffDays <= 7;
        else if (filterVal === 'month') return diffDays <= 30;
        return true;
    });

    const motoboys = getActiveMotoboys();
    const motoboy = motoboys.find(m => String(m.id) === String(motoboyId));
    if (!motoboy || !motoboy.whatsapp) {
        alert('Motoboy não encontrado ou sem WhatsApp cadastrado.');
        return;
    }

    const motoboyOrders = filteredOrders.filter(o => o.checkoutType === 'delivery' && o.status !== 'Cancelado' && String(o.assignedMotoboyId) === String(motoboyId));
    
    if (motoboyOrders.length === 0) {
        alert(`Nenhuma entrega encontrada para ${motoboy.name} no período.`);
        return;
    }

    let totalFees = 0;
    let listLines = motoboyOrders.map(o => {
        const fee = (o.motoboyFee !== undefined && o.motoboyFee !== null) ? Number(o.motoboyFee) : Number(o.deliveryFee || 0);
        totalFees += fee;
        const neigh = o.address?.neighborhood ? ` (${o.address.neighborhood})` : '';
        return `• Pedido #${o.id}${neigh} - R$ ${fee.toFixed(2)}`;
    }).join('\n');

    let msg = `📊 *EXTRATO DE CORRIDAS - ROLOFF LANCHES*\n`;
    msg += `👤 *Entregador:* ${motoboy.name}\n`;
    msg += `📦 *Total de Entregas:* ${motoboyOrders.length}\n`;
    msg += `💵 *TOTAL A RECEBER (CORRIDAS):* R$ ${totalFees.toFixed(2)}\n\n`;
    msg += `📋 *Detalhamento das entregas:*\n${listLines}`;

    let phoneNum = motoboy.whatsapp.replace(/\D/g, '');
    if (phoneNum.length === 10 || phoneNum.length === 11) phoneNum = '55' + phoneNum;
    
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneNum}&text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank');
}

function loadPromoConfigIntoUI() {
    if (!menuData) return;
    const config = menuData.promo_config || { show_popup: false, facebook_url: "" };
    
    const showCheckbox = document.getElementById('promoShowPopup');
    const urlInput = document.getElementById('promoFacebookUrl');
    
    if (showCheckbox) showCheckbox.checked = !!config.show_popup;
    if (urlInput) urlInput.value = config.facebook_url || "";
}

function savePromoConfig(event) {
    event.preventDefault();
    if (!menuData) return;
    
    const show_popup = document.getElementById('promoShowPopup').checked;
    const facebook_url = document.getElementById('promoFacebookUrl').value.trim();
    
    if (!menuData.promo_config) {
        menuData.promo_config = {};
    }
    
    menuData.promo_config.show_popup = show_popup;
    menuData.promo_config.facebook_url = facebook_url;
    
    // Save to Firebase or local server
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.database().ref('menu/promo_config').set(menuData.promo_config)
        .then(() => {
            triggerCentralAutoBackup();
            alert("Configurações do Pop-up salvas com sucesso!");
        })
        .catch(err => {
            console.error("Erro ao salvar config no Firebase:", err);
            alert("Erro ao salvar configurações no Firebase.");
        });
    } else {
        // Local API save
        fetch('/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(menuData)
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                triggerCentralAutoBackup();
                alert("Configurações do Pop-up salvas localmente!");
            } else {
                alert("Erro ao salvar configurações localmente.");
            }
        })
        .catch(err => {
            console.error("Erro ao salvar localmente:", err);
            alert("Erro de conexão ao salvar localmente.");
        });
    }
}

/* ==========================================================================
   PWA & Service Worker Integration for Admin Panel
   ========================================================================== */
let swRegistration = null;

function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            swRegistration = reg;
            if (reg.waiting) {
                promptUpdate(reg.waiting);
            }
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            promptUpdate(newWorker);
                        }
                    });
                }
            });
        }).catch(err => {
            console.warn('Admin Service Worker registration failed:', err);
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
}

function promptUpdate(worker) {
    const banner = document.getElementById('updateBanner');
    if (banner) banner.classList.remove('display-none');
}

function applyAppUpdate() {
    if (swRegistration && swRegistration.waiting) {
        swRegistration.waiting.postMessage({ action: 'skipWaiting' });
    } else {
        window.location.reload();
    }
}

/* ==========================================================================
   Toast Notifications & Standardized Loading Spinner Overlay
   ========================================================================== */
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    
    const icons = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info'
    };
    
    toast.innerHTML = `
        <span class="material-symbols-rounded">${icons[type] || 'info'}</span>
        <span>${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showLoading(message = 'Processando...') {
    const overlay = document.getElementById('globalLoading');
    const textSpan = document.getElementById('loadingText');
    if (overlay) {
        if (textSpan) textSpan.innerText = message;
        overlay.classList.remove('display-none');
    }
}

function hideLoading() {
    const overlay = document.getElementById('globalLoading');
    if (overlay) {
        overlay.classList.add('display-none');
    }
}

function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* ==========================================================================
   Image Manager: Client-Side Canvas Compression, Preview & Removal
   ========================================================================== */
function compressAndProcessImage(file, maxWidth, maxHeight, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            let canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            if (height > maxHeight) {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            callback(null, dataUrl);
        };
        img.onerror = function() {
            callback(new Error('Erro ao carregar imagem para compressão'));
        };
        img.src = e.target.result;
    };
    reader.onerror = function() {
        callback(new Error('Erro ao ler arquivo de imagem'));
    };
    reader.readAsDataURL(file);
}

function handleFlavorFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showToast('Por favor, selecione um arquivo de imagem válido.', 'warning');
        return;
    }
    
    showLoading('Otimizando imagem...');
    compressAndProcessImage(file, 800, 800, 0.82, (err, compressedDataUrl) => {
        hideLoading();
        if (err) {
            console.error(err);
            showToast('Não foi possível processar a imagem.', 'error');
            return;
        }
        
        const input = document.getElementById('flavorImage');
        if (input) {
            input.value = compressedDataUrl;
            updateFlavorImagePreview(compressedDataUrl, file.name);
            showToast('Imagem enviada e otimizada com sucesso!', 'success');
        }
    });
}

function updateFlavorImagePreview(url, fileName = '') {
    const card = document.getElementById('flavorImagePreviewCard');
    const thumb = document.getElementById('flavorImagePreviewThumb');
    const nameEl = document.getElementById('flavorImagePreviewName');
    
    if (!card || !thumb) return;
    
    if (url && url.trim().length > 0) {
        thumb.src = url;
        nameEl.innerText = fileName || (url.length > 40 ? url.substring(0, 37) + '...' : url);
        card.classList.remove('display-none');
    } else {
        card.classList.add('display-none');
    }
}

function removeFlavorImage() {
    const input = document.getElementById('flavorImage');
    const fileInput = document.getElementById('flavorFileInput');
    if (input) input.value = '';
    if (fileInput) fileInput.value = '';
    updateFlavorImagePreview('');
    showToast('Imagem removida.', 'info');
}

function handleSimpleItemFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showToast('Por favor, selecione um arquivo de imagem válido.', 'warning');
        return;
    }
    
    showLoading('Otimizando imagem...');
    compressAndProcessImage(file, 800, 800, 0.82, (err, compressedDataUrl) => {
        hideLoading();
        if (err) {
            console.error(err);
            showToast('Não foi possível processar a imagem.', 'error');
            return;
        }
        
        const input = document.getElementById('simpleItemImage');
        if (input) {
            input.value = compressedDataUrl;
            updateSimpleItemImagePreview(compressedDataUrl, file.name);
            showToast('Imagem enviada e otimizada com sucesso!', 'success');
        }
    });
}

function updateSimpleItemImagePreview(url, fileName = '') {
    const card = document.getElementById('simpleItemImagePreviewCard');
    const thumb = document.getElementById('simpleItemImagePreviewThumb');
    const nameEl = document.getElementById('simpleItemImagePreviewName');
    
    if (!card || !thumb) return;
    
    if (url && url.trim().length > 0) {
        thumb.src = url;
        nameEl.innerText = fileName || (url.length > 40 ? url.substring(0, 37) + '...' : url);
        card.classList.remove('display-none');
    } else {
        card.classList.add('display-none');
    }
}

function removeSimpleItemImage() {
    const input = document.getElementById('simpleItemImage');
    const fileInput = document.getElementById('simpleItemFileInput');
    if (input) input.value = '';
    if (fileInput) fileInput.value = '';
    updateSimpleItemImagePreview('');
    showToast('Imagem removida.', 'info');
}

/* ==========================================================================
   Backup & Export/Import Manager (JSON)
   ========================================================================== */
function exportMenuBackup() {
    try {
        if (!menuData) {
            showToast('Dados do cardápio não disponíveis para exportação.', 'warning');
            return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(menuData, null, 2));
        const downloadAnchor = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `mundo-da-pizza-cardapio-${today}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Backup do cardápio exportado com sucesso!', 'success');
    } catch (e) {
        console.error("Erro ao exportar cardápio:", e);
        showToast('Não foi possível exportar o backup do cardápio.', 'error');
    }
}

function exportSettingsBackup() {
    try {
        const settingsBackup = {
            settings: CONFIG_SETTINGS,
            deliveryFees: TAXAS_ENTREGA,
            promo_config: menuData?.promo_config || {}
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settingsBackup, null, 2));
        const downloadAnchor = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `mundo-da-pizza-configuracoes-${today}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Backup das configurações exportado com sucesso!', 'success');
    } catch (e) {
        console.error("Erro ao exportar configurações:", e);
        showToast('Não foi possível exportar o backup das configurações.', 'error');
    }
}

function exportOrdersBackup() {
    try {
        if (!orders || orders.length === 0) {
            showToast('Nenhum pedido registrado para exportação.', 'warning');
            return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(orders, null, 2));
        const downloadAnchor = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `mundo-da-pizza-pedidos-${today}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Backup de pedidos exportado com sucesso!', 'success');
    } catch (e) {
        console.error("Erro ao exportar pedidos:", e);
        showToast('Não foi possível exportar o backup de pedidos.', 'error');
    }
}

function validateMenuBackupData(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'O arquivo não é um objeto JSON válido.' };
    }
    
    if (!data.menu_items || typeof data.menu_items !== 'object') {
        return { valid: false, error: 'O arquivo não contém a estrutura "menu_items".' };
    }
    
    if (!Array.isArray(data.menu_items.pizzas) || data.menu_items.pizzas.length === 0) {
        return { valid: false, error: 'Nenhum sabor de pizza válido encontrado no arquivo de backup.' };
    }
    
    if (!Array.isArray(data.menu_items.bebidas)) {
        return { valid: false, error: 'A seção de bebidas do arquivo de backup está ausente ou malformatada.' };
    }
    
    const invalidPizza = data.menu_items.pizzas.find(p => !p.name || !p.category);
    if (invalidPizza) {
        return { valid: false, error: 'Existem sabores de pizza com nome ou categoria ausentes no backup.' };
    }

    return { valid: true, error: null };
}

function handleImportMenuBackup(event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            // 1. Strict JSON Schema Validation BEFORE changing any data or database state
            const validation = validateMenuBackupData(importedData);
            if (!validation.valid) {
                showToast(`Falha na validação do backup: ${validation.error}`, 'error', 6000);
                fileInput.value = '';
                return;
            }
            
            const countPizzas = importedData.menu_items.pizzas.length;
            const countBebidas = importedData.menu_items.bebidas.length;
            
            // 2. Explicit User Confirmation with Data Summary
            const userConfirmed = confirm(
                `⚠️ CONFIRMAÇÃO DE RESTAURAÇÃO DE BACKUP:\n\n` +
                `Foi encontrado no arquivo:\n` +
                `• ${countPizzas} sabores de pizza\n` +
                `• ${countBebidas} itens de bebidas\n\n` +
                `Deseja aplicar estas alterações ao cardápio da Roloff Lanches?`
            );
            
            if (!userConfirmed) {
                showToast('Restauração de backup cancelada pelo usuário.', 'info');
                fileInput.value = '';
                return;
            }
            
            const finalConfirm = confirm("⚠️ ATENÇÃO: Os dados do cardápio serão atualizados com as informações do backup. Confirmar?");
            if (!finalConfirm) {
                showToast('Restauração cancelada.', 'info');
                fileInput.value = '';
                return;
            }
            
            // 3. Apply changes ONLY after 100% validation and double confirmation
            showLoading('Restaurando cardápio...');
            menuData = importedData;
            
            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                firebase.database().ref('menu').set(importedData)
                .then(() => {
                    hideLoading();
                    renderMenuManager();
                    showToast('Cardápio restaurado e sincronizado com sucesso no Firebase!', 'success');
                })
                .catch(err => {
                    hideLoading();
                    console.error("Erro ao salvar no Firebase:", err);
                    showToast('Erro de conexão ao salvar cardápio no Firebase.', 'error');
                });
            } else {
                hideLoading();
                renderMenuManager();
                showToast('Cardápio restaurado localmente com sucesso!', 'success');
            }
        } catch (err) {
            console.error("Erro na leitura do JSON:", err);
            showToast('O arquivo selecionado não é um JSON válido.', 'error');
        } finally {
            fileInput.value = '';
        }
    };
    reader.readAsText(file);
}

/* ==========================================================================
   Centralized Automatic Background Backup System (Debounced & Full Recoverable Payload)
   ========================================================================== */
let centralAutoBackupTimer = null;

function triggerCentralAutoBackup() {
    if (centralAutoBackupTimer) clearTimeout(centralAutoBackupTimer);
    
    // 3000ms Debounce: Groups rapid user edits together before saving to DB
    centralAutoBackupTimer = setTimeout(() => {
        performCentralAutoBackgroundBackup();
    }, 3000);
}

function performCentralAutoBackgroundBackup() {
    try {
        if (!menuData) return;
        
        // Deep safe snapshot copy of all live orders
        const ordersSnapshot = (orders || []).map(order => ({
            id: order.id,
            timestamp: order.timestamp || Date.now(),
            date: order.date || '',
            time: order.time || '',
            clientName: order.clientName || '',
            clientPhone: order.clientPhone || '',
            checkoutType: order.checkoutType || 'delivery',
            address: order.address ? { ...order.address } : null,
            paymentMethod: order.paymentMethod || '',
            cashChange: order.cashChange || '',
            subtotal: order.subtotal || 0,
            deliveryFee: order.deliveryFee || 0,
            total: order.total || 0,
            status: order.status || 'Pendente',
            cart: Array.isArray(order.cart) ? order.cart.map(item => ({ ...item })) : []
        }));
        
        // Full recoverable data snapshot containing 100% of catalog, prices, borders, settings, fees, promo config AND complete orders
        const fullBackupSnapshot = {
            timestamp: new Date().toISOString(),
            menu_items: menuData.menu_items || {},
            pizza_prices: menuData.pizza_prices || {},
            borders: menuData.borders || {},
            settings: CONFIG_SETTINGS || {},
            deliveryFees: TAXAS_ENTREGA || {},
            promo_config: menuData.promo_config || {},
            orders: ordersSnapshot,
            orders_summary: {
                totalOrdersCount: ordersSnapshot.length,
                pendingCount: ordersSnapshot.filter(o => o.status === 'Pendente').length
            }
        };
        
        // 1. Save locally in localStorage (latest backup + history rotation of last 5 snapshots)
        const historyStr = localStorage.getItem('auto_backup_history');
        let history = [];
        if (historyStr) {
            try { history = JSON.parse(historyStr); } catch (e) {}
        }
        
        history.unshift(fullBackupSnapshot);
        if (history.length > 5) history = history.slice(0, 5);
        
        localStorage.setItem('auto_backup_latest', JSON.stringify(fullBackupSnapshot));
        localStorage.setItem('auto_backup_history', JSON.stringify(history));
        
        // 2. Safe write to Firebase Realtime Database at /backups/latest
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            firebase.database().ref('backups/latest').set(fullBackupSnapshot)
            .then(() => {
                console.log("Auto-backup centralizado completo (com catálogo e pedidos) gravado no Firebase.");
            })
            .catch(err => {
                console.warn("Aviso: Auto-backup Firebase em segundo plano adiado (offline):", err);
            });
        }
    } catch (e) {
        console.warn("Erro no auto-backup centralizado:", e);
    }
}




