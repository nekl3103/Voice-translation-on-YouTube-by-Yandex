(() => {
  const input = document.querySelector('#site-input');
  const form = document.querySelector('#add-site');
  const list = document.querySelector('#site-list');
  const message = document.querySelector('#site-message');
  const incognito = document.querySelector('#incognito-status');
  const idFor = (host) => 'vvt_' + host.replace(/\./g, '_');
  const patternFor = (host) => '*://' + host + '/*';

  function parseHost(value) {
    const url = new URL(value.includes('://') ? value : 'https://' + value);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Нужен адрес HTTP или HTTPS');
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('-')) throw Error('Введите обычный домен сайта');
    return host;
  }

  async function sites() {
    const saved = await chrome.storage.sync.get({ videoVoiceTranslateSites: [] });
    return saved.videoVoiceTranslateSites || [];
  }

  async function render() {
    list.replaceChildren();
    const hosts = await sites();
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
          await chrome.scripting.unregisterContentScripts({ ids: [idFor(host)] });
          await chrome.permissions.remove({ origins: [patternFor(host)] });
          await chrome.storage.sync.set({ videoVoiceTranslateSites: (await sites()).filter((value) => value !== host) });
          message.textContent = 'Сайт удалён. Обновите его вкладку.';
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
      const pattern = patternFor(host);
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) { message.textContent = 'Доступ к сайту не предоставлен'; return; }
      const current = await sites();
      if (current.includes(host)) { message.textContent = 'Этот сайт уже добавлен'; return; }
      await chrome.scripting.registerContentScripts([{
        id: idFor(host), matches: [pattern], js: ['content.js'], css: ['content.css'],
        allFrames: true, runAt: 'document_idle', persistAcrossSessions: true
      }]);
      await chrome.storage.sync.set({ videoVoiceTranslateSites: [...current, host] });
      input.value = '';
      message.textContent = 'Сайт добавлен. Обновите его вкладку.';
      await render();
    } catch (error) { message.textContent = error.message || String(error); }
  });

  document.querySelector('#open-extension').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });
  chrome.extension.isAllowedIncognitoAccess().then((allowed) => {
    incognito.textContent = allowed ? 'Доступ в инкогнито включён' : 'Доступ в инкогнито пока выключен';
  }).catch(() => {});
  render().catch((error) => { message.textContent = error.message || String(error); });
})();
