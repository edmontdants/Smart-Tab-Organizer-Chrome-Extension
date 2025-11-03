// background.js - service worker to keep badge live
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    await chrome.action.setBadgeText({ text: String(tabs.length) });
    await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } catch (err) {
    console.warn('background updateBadge error', err);
  }
}

chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onAttached.addListener(updateBadge);
chrome.tabs.onDetached.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

// initial call (service worker may start later)
updateBadge();
