// topup-earn-main/router.js
(function () {
  'use strict';

  const tg = window.Telegram?.WebApp;

  window.navigateSpa = async function (url) {
    if (window.location.pathname === url) return;

    const container = document.querySelector('.container');
    if (container) {
      container.style.opacity = '0.3';
      container.style.transition = 'opacity 0.12s ease';
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const htmlText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // 1. UPDATE TITLE
      if (doc.title) document.title = doc.title;

      // 2. INJECT NEW PAGE STYLES
      document.querySelectorAll('style[data-page-style]').forEach(s => s.remove());
      doc.querySelectorAll('style').forEach(s => {
        const cloned = document.createElement('style');
        cloned.setAttribute('data-page-style', 'true');
        cloned.textContent = s.textContent;
        document.head.appendChild(cloned);
      });

      // 3. SWAP CONTAINER CONTENT ONLY (Leaving Dock Alone)
      const newContainer = doc.querySelector('.container');
      const curContainer = document.querySelector('.container');

      if (newContainer && curContainer) {
        curContainer.innerHTML = newContainer.innerHTML;
      } else {
        window.location.href = url;
        return;
      }

      // 4. UPDATE URL HISTORY
      window.history.pushState({}, '', url);

      // 5. UPDATE TELEGRAM BACK BUTTON
      if (tg) {
        if (url === '/' || url.includes('index.html')) {
          tg.BackButton.hide();
        } else {
          tg.BackButton.show();
          tg.BackButton.onClick(() => window.navigateSpa('/index.html'));
        }
      }

      // 6. SYNC BOTTOM DOCK SELECTION
      if (typeof window.syncActiveTab === 'function') {
        window.syncActiveTab(url);
      }

      // 7. EXECUTE SCRIPTS OF THE NEW PAGE
      const scripts = curContainer.querySelectorAll('script');
      scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.textContent = oldScript.textContent;
        document.body.appendChild(newScript);
        newScript.remove();
      });

    } catch (err) {
      console.warn("SPA fallback redirect:", err);
      window.location.href = url;
    } finally {
      if (container) container.style.opacity = '1';
    }
  };

  // Browser/Telegram Back Button Popstate
  window.addEventListener('popstate', function () {
    window.navigateSpa(window.location.pathname);
  });
})();
