export function chromeStorage() {
  return {
    async get(key) {
      return (await chrome.storage.local.get(key))[key];
    },
    async getByPrefix(prefix) {
      const all = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix)));
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
    async remove(keys) {
      await chrome.storage.local.remove(keys);
    },
    // Calls `callback` when a key accepted by `filter` changes (from any tab or from the toolbar popup).
    onChange(filter, callback) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.keys(changes).some(filter)) callback();
      });
    },
  };
}
