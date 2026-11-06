// Keeps the core's offscreen document alive and surfaces dapp prompts.
import type { SwMessage } from '../shared/protocol';

let creating: Promise<void> | null = null;

const ensureCore = async (): Promise<void> => {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.LOCAL_STORAGE],
      justification: 'Hosts the wallet engine and the WalletConnect relay connection.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
};

const openPrompt = async (): Promise<void> => {
  await chrome.action.setBadgeBackgroundColor({ color: '#0d7150' });
  await chrome.action.setBadgeText({ text: '1' });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({ url: 'popup.html?window=1', type: 'popup', width: 380, height: 660 });
  }
};

chrome.runtime.onInstalled.addListener(() => void ensureCore());
chrome.runtime.onStartup.addListener(() => void ensureCore());

chrome.runtime.onMessage.addListener((msg: SwMessage, _sender, reply) => {
  if (msg?.type === 'ensure-core') {
    ensureCore().then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'prompt') void openPrompt();
  if (msg?.type === 'prompt-clear') void chrome.action.setBadgeText({ text: '' });
  return false;
});

void ensureCore();
