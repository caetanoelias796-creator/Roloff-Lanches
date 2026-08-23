/* ==========================================================================
   Update Manager - Roloff Lanches PWA
   ========================================================================== */

window.PWAUpdateManager = {
  registration: null,
  refreshing: false,

  init: function (registration) {
    if (!registration) return;
    this.registration = registration;
    this.listenForUpdates();
    this.listenForControllerChange();
  },

  listenForUpdates: function () {
    const reg = this.registration;

    // Força checagem de atualização no servidor no carregamento
    if (reg && typeof reg.update === 'function') {
      reg.update().catch(() => {});
    }

    // Se já houver um Service Worker aguardando ativação (waiting)
    if (reg.waiting) {
      this.showUpdateBanner(reg.waiting);
      return;
    }

    // Monitora quando um novo Service Worker for encontrado
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          this.showUpdateBanner(newWorker);
        }
      });
    });
  },

  listenForControllerChange: function () {
    // Quando o controlador mudar (novo SW assumiu o controle), recarrega a página automaticamente
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.refreshing) return;
      this.refreshing = true;
      console.log('[UpdateManager] Novo controlador ativado. Recarregando página...');
      window.location.reload();
    });
  },

  showUpdateBanner: function (worker) {
    if (document.getElementById('pwa-update-banner')) return;

    const bannerHtml = `
      <div id="pwa-update-banner" style="
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #1e1e24;
        border: 1px solid #fb8500;
        color: #ffffff;
        padding: 14px 18px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 14px;
        max-width: 92%;
        width: 400px;
        font-family: 'Outfit', sans-serif;
        animation: pwaSlideUp 0.4s ease-out forwards;
      ">
        <style>
          @keyframes pwaSlideUp {
            from { opacity: 0; transform: translate(-50%, 30px); }
            to { opacity: 1; transform: translate(-50%, 0); }
          }
        </style>
        <div style="font-size: 22px; color: #fb8500; display: flex; align-items: center;">✨</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 13px; color: #ffffff;">Uma nova versão do cardápio está disponível.</div>
        </div>
        <div>
          <button id="pwa-btn-update-now" style="
            background: linear-gradient(135deg, #fb8500 0%, #ffb703 100%);
            color: #000000;
            border: none;
            padding: 8px 14px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: transform 0.15s, opacity 0.15s;
          ">ATUALIZAR AGORA</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', bannerHtml);

    const updateBtn = document.getElementById('pwa-btn-update-now');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        updateBtn.disabled = true;
        updateBtn.innerText = 'ATUALIZANDO...';

        // 1. Envia comando SKIP_WAITING ao Worker
        if (worker) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }

        // 2. Limpa caches locais anteriores
        if ('caches' in window) {
          caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => caches.delete(key)));
          }).then(() => {
            // 3. Recarrega a página automaticamente para trazer todos os arquivos novos
            window.location.reload(true);
          }).catch(() => {
            window.location.reload(true);
          });
        } else {
          window.location.reload(true);
        }
      });
    }
  }
};
