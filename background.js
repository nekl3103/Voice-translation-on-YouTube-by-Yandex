chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

const idFor = (host) => 'vvt_' + host.replace(/\./g, '_');
const patternsFor = (host) => ['https://' + host + '/*', 'http://' + host + '/*'];
function originHost(origin) {
  const match = /^(?:https?|\*):\/\/([^/*]+)\//.exec(origin);
  return match && match[1] !== '*' && !match[1].startsWith('*.') ? match[1].toLowerCase() : null;
}
async function reconcileSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  const hosts = new Set(origins.map(originHost).filter(host => host && host !== 'youtube.com' && host !== 'www.youtube.com'));
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const registered = new Set(scripts.map(script => script.id));
  for (const host of hosts) {
    const id = idFor(host);
    if (registered.has(id)) continue;
    try {
      await chrome.scripting.registerContentScripts([{
        id, matches: patternsFor(host), js: ['content.js'], css: ['content.css'],
        allFrames: true, runAt: 'document_idle', persistAcrossSessions: true
      }]);
    } catch (error) {
      if (!String(error).includes('Duplicate script ID')) throw error;
    }
  }
  for (const script of scripts) {
    if (!script.id.startsWith('vvt_')) continue;
    const host = script.id.slice(4).replace(/_/g, '.');
    if (!hosts.has(host)) await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
  }
}
let syncQueue = Promise.resolve();
function syncSites() {
  syncQueue = syncQueue.catch(() => {}).then(reconcileSites);
  return syncQueue;
}
chrome.permissions.onAdded.addListener(() => { syncSites().catch(console.error); });
chrome.permissions.onRemoved.addListener(() => { syncSites().catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { syncSites().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { syncSites().catch(console.error); });
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'vvt-sync-sites') return;
  syncSites().then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message || String(error) }));
  return true;
});
