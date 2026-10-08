// topup-earn-main/router.js
(function () {
  const tg = window.Telegram?.WebApp;

  // Intercept all clicks on internal links
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    
    // Ignore external links, anchors, or telegram deep links
    if (!href || href.startsWith('http') || href.startsWith('https://t.me') || href.startsWith('#')) {
      return;
    }

    e.preventDefault();
    navigateSpa(href);
  });

  // Handle browser/Telegram back and forward buttons
  window.addEventListener('popstate', function () {
    loadPageContent(window.location.pathname, false);
  });

  // Exported global navigation function
  window.navigateSpa = function (url) {
    if (window.location.pathname === url) return;
    loadPageContent(url, true);
  };

  async function loadPageContent(url, pushState = true) {
    const container = document.querySelector('.container') || document.body;
    
    // Smooth fade out
    container.style.opacity = '0.35';
    container.style.transition = 'opacity 0.15s ease';

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load");
      const htmlText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // 1. Update Title
      if (doc.title) document.title = doc.title;

      // 2. Extract & Swap Main Container
      const newContainer = doc.querySelector('.container');
      if (newContainer && container) {
        container.innerHTML = newContainer.innerHTML;
      } else {
        document.body.innerHTML = doc.body.innerHTML;
      }

      // 3. Push to History
      if (pushState) {
        window.history.pushState({}, '', url);
      }

      // 4. Update Navigation Tabs Active State
      updateActiveTab(url);

      // 5. Update Telegram Back Button
      if (tg) {
        if (url === '/' || url.includes('index.html')) {
          tg.BackButton.hide();
        } else {
          tg.BackButton.show();
          tg.BackButton.onClick(() => navigateSpa('/index.html'));
        }
      }

      // 6. Execute newly injected scripts
      const scripts = (newContainer || doc.body).querySelectorAll('script');
      scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.textContent = oldScript.textContent;
        document.body.appendChild(newScript);
        newScript.remove(); // Clean up execution node
      });

    } catch (err) {
      console.error("AJAX navigation failed, falling back to reload:", err);
      window.location.href = url;
    } finally {
      container.style.opacity = '1';
    }
  }

  function updateActiveTab(currentPath) {
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
