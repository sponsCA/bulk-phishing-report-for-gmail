// Content scripts cannot be ES modules: the rest is loaded through import().
(async () => {
  const { start } = await import(chrome.runtime.getURL('src/main.js'));
  await start();
})();
