// Day 1 (V0.1) service worker: side-panel wiring only. No analysis logic.
try {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
} catch {
  // Older Chrome without sidePanel API — panel still opens via chrome.sidePanel.open().
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.storage.local.set({ wdaidt_auto_analyze: false });
  } catch {
    // storage unavailable — non-fatal for Day 1
  }
});

// Clicking the toolbar icon on a ChatGPT tab explicitly opens the panel
// (covers Chrome builds where openPanelOnActionClick is not honoured).
chrome.action?.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch {
    // non-fatal
  }
});
