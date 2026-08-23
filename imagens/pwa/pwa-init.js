/* ==========================================================================
   PWA Master Initializer - Roloff Lanches
   ========================================================================== */

(function () {
  'use strict';

  // 1. Carrega scripts dependentes de forma segura caso ainda não tenham sido injetados
  function loadScript(src, callback) {
    if (document.querySelector(`script[src="${src}"]`)) {
      if (callback) callback();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = callback;
    script.onerror = function (e) {
      console.warn('[PWA Init] Falha ao carregar script auxiliar:', src, e);
    };
    document.head.appendChild(script);
  }

  // Sequência de inicialização modular do PWA
  function initPWA() {
    // 2. Verifica a Feature Flag Global
    if (!window.PWA_CONFIG || !window.PWA_CONFIG.isEnabled()) {
      console.log('[PWA Init] Feature Flag ENABLE_PWA desativada ou navegador sem suporte a Service Worker.');
      return;
    }

    console.log('[PWA Init] Inicializando PWA Roloff Lanches v' + window.PWA_CONFIG.APP_VERSION);

    // 3. Inicializa a Splash Screen se aplicável
    if (window.PWASplashScreen) {
      window.PWASplashScreen.init();
    }

    // 4. Inicializa o Gerenciador de Instalação (Banners, Modais, Standalone)
    if (window.PWAInstallManager) {
      window.PWAInstallManager.init();
    }

    // 5. Registra o Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js', { scope: './' })
          .then((registration) => {
            console.log('[PWA Init] Service Worker registrado com sucesso. Scope:', registration.scope);

            // Inicializa o Gerenciador de Atualizações
            if (window.PWAUpdateManager) {
              window.PWAUpdateManager.init(registration);
            }
          })
          .catch((err) => {
            console.warn('[PWA Init] Falha no registro do Service Worker:', err);
          });
      });
    }
  }

  // Carrega a cadeia de módulos PWA em ordem
  loadScript('pwa/config.js', function () {
    loadScript('pwa/cacheManager.js', function () {
      loadScript('pwa/updateManager.js', function () {
        loadScript('pwa/installManager.js', function () {
          loadScript('pwa/splashScreen.js', function () {
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', initPWA);
            } else {
              initPWA();
            }
          });
        });
      });
    });
  });

})();
