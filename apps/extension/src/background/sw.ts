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

// The toolbar icon opens the side panel. Chrome only opens a side panel in
// response to a user click, so a dapp request that arrives while the panel is
// closed gets a badge and a small prompt window instead. (When the panel is
// open, the core shows the prompt there and never asks for this.)
const openPrompt = async (): Promise<void> => {
  await chrome.action.setBadgeBackgroundColor({ color: '#0d7150' });
  await chrome.action.setBadgeText({ text: '1' });
  await chrome.windows.create({ url: 'popup.html?window=1', type: 'popup', width: 380, height: 660 });
};

const usePanel = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  void usePanel();
  void ensureCore();
});
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

void usePanel();
void ensureCore();
