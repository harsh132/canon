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

// The side panel belongs to a tab. Clicking the toolbar icon enables the panel
// for that tab only and opens it; other tabs have none, and switching back
// restores it. The panel learns its tab from ?tab= so it can show that site.
//
// Dapp requests open the small toolbar popup: it is attached to the icon just
// long enough to open, then detached so the next click opens the panel again.
// A separate window is the last resort if Chrome refuses the popup.
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

// No panel anywhere by default, and the icon click is ours to handle.
const perTabPanels = () =>
  Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
    chrome.sidePanel.setOptions({ enabled: false }),
  ]).catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  // Both calls must start inside the click; awaiting the first would lose it.
  void chrome.sidePanel.setOptions({ tabId: tab.id, path: `panel.html?tab=${tab.id}`, enabled: true });
  void chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.warn('[sw] side panel', e));
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void perTabPanels();
  void ensureCore();
  // First install: onboarding in its own tab, where a passkey dialog cannot close it.
  if (reason === 'install') void chrome.tabs.create({ url: 'onboard.html' });
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

void perTabPanels();
void ensureCore();
