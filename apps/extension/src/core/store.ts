import localforage from 'localforage';

// The extension origin's IndexedDB. The offscreen document has no chrome.storage.
export const store = localforage.createInstance({ name: 'pangolin', storeName: 'kv' });
