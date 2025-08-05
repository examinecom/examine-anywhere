document.addEventListener("DOMContentLoaded", async function () {
  // Load current domain
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentDomain = new URL(tab.url).hostname;

  // Load saved settings
  const {
    extensionEnabled = true,
    disabledDomains = [],
    contentTypes = {
      interventions: true,
      topics: true,
      glossary: true,
      outcomes: false,
    },
    linkOption = "first",
  } = await chrome.storage.sync.get([
    "extensionEnabled",
    "contentTypes",
    "linkOption",
    "disabledDomains",
  ]);
  console.log(contentTypes);

  // Set initial states
  document.getElementById("toggle-extension").checked = extensionEnabled;
  document.getElementById("toggle-disable-domain").checked =
    disabledDomains.includes(currentDomain);

  document.getElementById("option-interventions").checked =
    contentTypes.interventions;
  document.getElementById("option-topics").checked = contentTypes.topics;
  document.getElementById("option-glossary").checked = contentTypes.glossary;
  document.getElementById("option-outcomes").checked = contentTypes.outcomes;

  if (linkOption === "all") {
    document.getElementById("option-all-mentions").checked = true;
  } else {
    document.getElementById("option-first-mention").checked = true;
  }

  document
    .getElementById("toggle-extension")
    .addEventListener("change", async function () {
      const enabled = this.checked;
      updatedSettings({ extensionEnabled: enabled });
    });

  // Domain toggle handler
  document
    .getElementById("toggle-disable-domain")
    .addEventListener("change", async function () {
      const disabledDomains = await chrome.storage.sync
        .get("disabledDomains")
        .then((r) => r.disabledDomains || []);
      const updatedDomains = this.checked
        ? [...disabledDomains, currentDomain]
        : disabledDomains.filter((d) => d !== currentDomain);

      await chrome.storage.sync.set({ disabledDomains: updatedDomains });

      // Send message to all tabs to update state
      const tabs = await chrome.tabs.query({});
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            action: "updateDisabledDomains",
            disabledDomains: updatedDomains,
          })
          .catch(() => {});
      });

      reloadCurrentTab();
    });

  // Content type options
  const contentOptionIds = ["interventions", "topics", "outcomes", "glossary"];
  contentOptionIds.forEach((id) => {
    document
      .getElementById(`option-${id}`)
      .addEventListener("change", async function () {
        const contentTypes = {
          interventions: document.getElementById("option-interventions")
            .checked,
          topics: document.getElementById("option-topics").checked,
          outcomes: document.getElementById("option-outcomes").checked,
          glossary: document.getElementById("option-glossary").checked,
        };

        updatedSettings({ contentTypes });
      });
  });

  // Link options
  document
    .getElementById("option-first-mention")
    .addEventListener("change", async function () {
      if (this.checked) {
        updatedSettings({ linkOption: "first" });
      }
    });

  document
    .getElementById("option-all-mentions")
    .addEventListener("change", async function () {
      if (this.checked) {
        updatedSettings({ linkOption: "all" });
      }
    });

  async function updatedSettings(newSettings) {
    await chrome.storage.sync.set(newSettings);

    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      chrome.tabs
        .sendMessage(tab.id, {
          action: "updateSettings",
          settings: newSettings,
        })
        .catch(() => {});
    });

    reloadCurrentTab();
  }

  // Reload current tab to apply changes immediately
  async function reloadCurrentTab() {
    const [currentTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (currentTab) {
      chrome.tabs.reload(currentTab.id);
    }
  }
});
