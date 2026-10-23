(() => {
  const input = document.querySelector('#site-input');
  const form = document.querySelector('#add-site');
  const list = document.querySelector('#site-list');
  const message = document.querySelector('#site-message');
  const incognito = document.querySelector('#incognito-status');
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const patternsFor = (host) => ['https://' + host + '/*', 'http://' + host + '/*'];

  function selectTab(name) {
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      document.querySelector('#panel-' + tab.dataset.tab).hidden = !selected;
    }
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  function parseHost(value) {
    const url = new URL(value.includes('://') ? value : 'https://' + value);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Нужен адрес HTTP или HTTPS');
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('-')) throw Error('Введите обычный домен сайта');
    return host;
  }

  function originHost(origin) {
    const match = /^(?:https?|\*):\/\/([^/*]+)\//.exec(origin);
    return match && match[1] !== '*' && !match[1].startsWith('*.') ? match[1].toLowerCase() : null;
  }

  async function sites() {
    const { origins = [] } = await chrome.permissions.getAll();
    return [...new Set(origins.map(originHost).filter(host => host && host !== 'youtube.com' && host !== 'www.youtube.com'))].sort();
  }

  async function syncScripts() {
    const result = await chrome.runtime.sendMessage({ type: 'vvt-sync-sites' });
    if (!result?.ok) throw Error(result?.error || 'Не удалось обновить доступ к сайту');
  }

  async function render() {
    list.replaceChildren();
    const hosts = await sites();
    document.querySelector('#site-count').textContent = String(hosts.length);
    if (!hosts.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Другие сайты пока не добавлены';
      list.append(empty);
      return;
    }
    for (const host of hosts) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = host;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => {
        try {
          const { origins = [] } = await chrome.permissions.getAll();
          const granted = origins.filter(origin => originHost(origin) === host);
          if (granted.length) {
            const removed = await chrome.permissions.remove({ origins: granted });
            if (!removed) throw Error('Chrome не удалил разрешение. Удалите сайт в разделе «Разрешённые сайты» на странице расширения.');
            const { origins: remaining = [] } = await chrome.permissions.getAll();
            if (remaining.some(origin => originHost(origin) === host)) throw Error('Сайт остаётся разрешённым в Chrome. Удалите его в разделе «Разрешённые сайты».');
          }
          await syncScripts();
          await chrome.storage.sync.set({ videoVoiceTranslateSites: (await sites()).filter((value) => value !== host) });
          message.textContent = 'Активный доступ отключён. Chrome может показывать ранее разрешённый сайт в своей карточке расширения.';
          await render();
        } catch (error) { message.textContent = error.message || String(error); }
      });
      row.append(label, remove);
      list.append(row);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    let host;
    try { host = parseHost(input.value.trim()); }
    catch (error) { message.textContent = error.message; return; }
    if (host === 'youtube.com' || host === 'www.youtube.com') {
      message.textContent = 'YouTube уже подключён';
      return;
    }
    try {
      const patterns = patternsFor(host);
      const granted = await chrome.permissions.request({ origins: patterns });
      if (!granted) { message.textContent = 'Доступ к сайту не предоставлен'; return; }
      await syncScripts();
      const current = await sites();
      await chrome.storage.sync.set({ videoVoiceTranslateSites: current });
      input.value = '';
      message.textContent = 'Сайт добавлен. Обновите его вкладку.';
      await render();
    } catch (error) { message.textContent = error.message || String(error); }
  });

  document.querySelector('#open-extension').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });
  if (window.self !== window.top) document.querySelector('#open-extension').hidden = true;
  const autoTranslate = document.querySelector('#auto-translate');
  chrome.storage.sync.get({ videoVoiceTranslate: {} }).then(({ videoVoiceTranslate }) => {
    autoTranslate.checked = videoVoiceTranslate.autoTranslate === true;
  });
  autoTranslate.addEventListener('change', async () => {
    const { videoVoiceTranslate = {} } = await chrome.storage.sync.get({ videoVoiceTranslate: {} });
    await chrome.storage.sync.set({ videoVoiceTranslate: { ...videoVoiceTranslate, autoTranslate: autoTranslate.checked } });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.videoVoiceTranslate) autoTranslate.checked = changes.videoVoiceTranslate.newValue?.autoTranslate === true;
  });
  chrome.extension.isAllowedIncognitoAccess().then((allowed) => {
    incognito.textContent = allowed ? 'Доступ в инкогнито включён' : 'Доступ в инкогнито пока выключен';
  }).catch(() => {});
  render().catch((error) => { message.textContent = error.message || String(error); });
})();
