// topup-earn-main/router.js
(function () {
  'use strict';

  const tg = window.Telegram?.WebApp;

  // Intercept click on navigation links
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');

    // Ignore anchors, external links, or telegram deep links
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('https://t.me')) {
      return;
    }

    e.preventDefault();
    window.navigateSpa(href);
  });

  // Handle Telegram/Browser back & forward buttons
  window.addEventListener('popstate', function () {
    loadPageContent(window.location.pathname, false);
  });

  // Global SPA Navigator
  window.navigateSpa = function (url) {
    if (window.location.pathname === url) return;
    loadPageContent(url, true);
  };

  async function loadPageContent(url, pushState = true) {
    const body = document.body;
    body.style.opacity = '0.4';
    body.style.transition = 'opacity 0.12s ease';

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP error " + res.status);
      const htmlText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // 1. UPDATE PAGE TITLE
      if (doc.title) document.title = doc.title;

      // 2. MERGE & UPDATE CSS STYLES (Fixes CSS breaking/disappearing)
      const oldStyles = document.querySelectorAll('style[data-spa-style]');
      oldStyles.forEach(s => s.remove());

      const newStyles = doc.querySelectorAll('style');
      newStyles.forEach(style => {
        const clonedStyle = document.createElement('style');
        clonedStyle.setAttribute('data-spa-style', 'true');
        clonedStyle.textContent = style.textContent;
        document.head.appendChild(clonedStyle);
      });

      // 3. SWAP CONTAINER CONTENT
      const newContainer = doc.querySelector('.container');
      const curContainer = document.querySelector('.container');

      if (newContainer && curContainer) {
        curContainer.innerHTML = newContainer.innerHTML;
      } else {
        document.body.innerHTML = doc.body.innerHTML;
      }

      // 4. UPDATE BROWSER HISTORY
      if (pushState) {
        window.history.pushState({}, '', url);
      }

      // 5. UPDATE TELEGRAM BACK BUTTON
      if (tg) {
        if (url === '/' || url.includes('index.html')) {
          tg.BackButton.hide();
        } else {
          tg.BackButton.show();
          tg.BackButton.onClick(() => window.navigateSpa('/index.html'));
        }
      }

      // 6. UPDATE ACTIVE DOCK TAB
      updateActiveDockTab(url);

      // 7. RUN NEW PAGE SCRIPTS
      const scripts = (newContainer || doc.body).querySelectorAll('script');
      scripts.forEach(oldScript => {
        const src = oldScript.getAttribute('src');
        // Do not reload telegram SDK or router
        if (src && (src.includes('telegram-web-app.js') || src.includes('router.js'))) {
          return;
        }

        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.textContent = oldScript.textContent;
        document.body.appendChild(newScript);
        newScript.remove(); // Clean DOM node after execution
      });

    } catch (err) {
      console.warn("SPA Navigation failed, falling back to clean reload:", err);
      window.location.href = url;
    } finally {
      body.style.opacity = '1';
    }
  }

  function updateActiveDockTab(currentPath) {
    document.querySelectorAll('.dock-tab').forEach(tab => {
      tab.classList.remove('active');
      const href = tab.getAttribute('href');
      if (href && currentPath.includes(href.replace('.html', '').replace('/', ''))) {
        tab.classList.add('active');
      }
    });

    if (currentPath === '/' || currentPath.includes('index')) {
      document.getElementById('tab-earn')?.classList.add('active');
    }
  }
})();
