const GLOSSARY_API_URL =
  "https://examine.nyc3.cdn.digitaloceanspaces.com/exports/content-list.json";
const GLOSSARY_CHUNK_SIZE = 50;
const GLOSSARY_PREFIX = "glossary_chunk_";
const GLOSSARY_KEYS_KEY = "glossary_meta_keys";
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let updateIntervalId = null; // Use module-scoped variable instead of window

// Initialize
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

function initialize() {
  chrome.storage.local.clear(() => {
    startUpdateInterval();
  });
}

async function fetchGlossaryFromAPI() {
  try {
    const response = await fetch(GLOSSARY_API_URL, {
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "same-origin",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!Array.isArray(data)) throw new Error("Invalid data format");

    await storeGlossaryData(data);
    await chrome.storage.local.set({ glossary_last_updated: Date.now() });
    return true;
  } catch (error) {
    console.error("Glossary update failed:", error);
    return false;
  }
}

async function storeGlossaryData(data) {
  // Split into chunks
  const chunks = {};
  const chunkKeys = [];

  for (let i = 0; i < data.length; i += GLOSSARY_CHUNK_SIZE) {
    const chunkKey = `${GLOSSARY_PREFIX}${i}`;
    chunks[chunkKey] = data.slice(i, i + GLOSSARY_CHUNK_SIZE);
    chunkKeys.push(chunkKey);
  }

  // Store metadata first
  await chrome.storage.local.set({
    [GLOSSARY_KEYS_KEY]: chunkKeys,
    glossary_last_updated: Date.now(),
  });

  // Store chunks in parallel
  const storagePromises = [];
  for (const [key, value] of Object.entries(chunks)) {
    storagePromises.push(chrome.storage.local.set({ [key]: value }));
  }

  await Promise.all(storagePromises);
}

function startUpdateInterval() {
  // Clear existing interval
  if (updateIntervalId) {
    clearInterval(updateIntervalId);
  }

  // Initial update
  fetchGlossaryFromAPI();

  // Set up periodic updates
  updateIntervalId = setInterval(() => {
    chrome.storage.local.get(["glossary_last_updated"], (result) => {
      if (
        !result.glossary_last_updated ||
        Date.now() - result.glossary_last_updated > UPDATE_INTERVAL
      ) {
        fetchGlossaryFromAPI();
      }
    });
  }, UPDATE_INTERVAL);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDisabledDomains") {
    chrome.storage.sync.get(["disabledDomains"], (result) => {
      sendResponse({ disabledDomains: result.disabledDomains || [] });
    });
    return true;
  }
});
