/* Sortiva – App installieren (PWA). Kein Prompt beim Laden. */
'use strict';

(function () {
  let deferredPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    && !window.MSStream;

  function hideInstallUi() {
    document.querySelectorAll('[data-install-btn],[data-install-tile]').forEach(el => el.classList.add('hidden'));
  }

  function showInstallUi() {
    if (isStandalone()) return hideInstallUi();
    document.querySelectorAll('[data-install-btn]').forEach(el => el.classList.remove('hidden'));
    const tile = document.querySelector('[data-install-tile]');
    if (tile) tile.classList.remove('hidden');
  }

  function toast(msg) {
    if (typeof window.toast === 'function') return window.toast(msg, 4000);
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 4000);
  }

  async function doInstall(ev) {
    if (ev) ev.preventDefault();
    if (isStandalone()) {
      toast('Sortiva ist schon als App geöffnet.');
      return hideInstallUi();
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          // Erfolg erst bei appinstalled melden
        } else {
          toast('Installation abgebrochen.');
        }
      } catch { /* */ }
      deferredPrompt = null;
      return;
    }
    if (isIos()) {
      toast('Auf dem iPhone/iPad: Teilen-Symbol antippen → „Zum Home-Bildschirm“.');
      return;
    }
    toast('Über das Browser-Menü „App installieren“ oder „Zum Bildschirm hinzufügen“ wählen.');
  }

  function mountHeaderButton() {
    const who = document.querySelector('#topbar .who');
    if (!who || document.getElementById('installBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'installBtn';
    btn.type = 'button';
    btn.className = 'btn-link hidden';
    btn.dataset.installBtn = '1';
    btn.textContent = 'App installieren';
    btn.title = 'Einmal installieren – dann direkt vom Startbildschirm oder Desktop öffnen.';
    btn.addEventListener('click', doInstall);
    who.insertBefore(btn, who.firstChild);
  }

  function mountLoginTile() {
    // Wird nach Login-Render erneut versucht; auch auf Boot-Screen
    if (document.querySelector('[data-install-tile]')) return;
    const host = document.querySelector('.login.card') || document.getElementById('app');
    if (!host) return;
    const tile = document.createElement('div');
    tile.dataset.installTile = '1';
    tile.className = 'card hidden';
    tile.style.cssText = 'margin:1rem auto;max-width:28rem;text-align:center';
    tile.innerHTML = `
      <p style="margin:.2rem 0 .5rem"><b>App installieren</b></p>
      <p class="muted" style="margin:0 0 .7rem;font-size:.9rem">Einmal installieren – dann direkt vom Startbildschirm oder Desktop öffnen.</p>
      <button type="button" class="btn secondary" data-install-action>App installieren</button>`;
    tile.querySelector('[data-install-action]').addEventListener('click', doInstall);
    if (host.classList.contains('login')) host.after(tile);
    else host.prepend(tile);
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallUi();
    toast('Sortiva ist installiert. Du kannst die App jetzt vom Startbildschirm öffnen.');
  });

  function refresh() {
    mountHeaderButton();
    mountLoginTile();
    if (isStandalone()) hideInstallUi();
    else if (deferredPrompt || isIos()) showInstallUi();
    else {
      // Button trotzdem anbieten (Browser-Menü-Hinweis)
      document.querySelectorAll('[data-install-btn]').forEach(el => el.classList.remove('hidden'));
      const tile = document.querySelector('[data-install-tile]');
      if (tile) tile.classList.remove('hidden');
    }
  }

  // Nach Login/Routen: DOM beobachten und Tile/Button nachziehen
  const mo = new MutationObserver(() => {
    mountHeaderButton();
    if (document.querySelector('.login.card')) mountLoginTile();
  });

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('sw.js', location.href).href, { scope: './' })
        .catch(err => console.warn('SW register', err));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mo.observe(document.body, { childList: true, subtree: true });
      refresh();
      registerSw();
    });
  } else {
    mo.observe(document.body, { childList: true, subtree: true });
    refresh();
    registerSw();
  }

  window.__sortivaInstall = { refresh, doInstall, isStandalone };
})();
