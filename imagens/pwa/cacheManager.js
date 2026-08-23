/* ==========================================================================
   Cache Manager - Roloff Lanches PWA
   ========================================================================== */

window.PWACacheManager = {
  // Retorna informações sobre o status do cache estático
  getCacheInfo: async function () {
    if (!('caches' in window)) return null;
    try {
      const keys = await caches.keys();
      return {
        hasCache: keys.length > 0,
        cacheKeys: keys
      };
    } catch (e) {
      console.warn('[CacheManager] Erro ao consultar cache:', e);
      return null;
    }
  },

  // Limpa caches antigos manualmente se necessário
  clearOldCaches: async function (currentCacheName) {
    if (!('caches' in window)) return;
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== currentCacheName) {
            return caches.delete(key);
          }
        })
      );
    } catch (e) {
      console.warn('[CacheManager] Erro ao limpar caches:', e);
    }
  }
};
