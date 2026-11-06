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

// Clicking the toolbar icon opens the side panel. Dapp requests open the small
// toolbar popup instead: the popup is attached to the icon just long enough to
// open it, then detached so the next icon click opens the panel again. When a
// Pangolin UI is already open the core shows the request there and never asks
// for this. A separate window is the last resort if Chrome refuses the popup.
const openPrompt = async (windowId?: number): Promise<void> => {
  await chrome.action.setBadgeBackgroundColor({ color: '#0d7150' });
  await chrome.action.setBadgeText({ text: '1' });
  try {
    await chrome.action.setPopup({ popup: 'popup.html' });
    await chrome.action.openPopup(windowId != null ? { windowId } : undefined);
  } catch {
    await chrome.windows.create({ url: 'popup.html?window=1', type: 'popup', width: 380, height: 660 });
  } finally {
    await chrome.action.setPopup({ popup: '' });
  }
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
  if (msg?.type === 'prompt') void openPrompt(msg.windowId);
  if (msg?.type === 'prompt-clear') void chrome.action.setBadgeText({ text: '' });
  return false;
});

void usePanel();
void ensureCore();
