const GLOSSARY_PREFIX = "glossary_chunk_";
const GLOSSARY_KEYS_KEY = "glossary_meta_keys";

// List of domains to exclude
const EXCLUDED_DOMAINS = ["examine.com"];

// Extension settings with defaults
let settings = {
  extensionEnabled: true,
  contentTypes: {
    interventions: true,
    topics: true,
    outcomes: false,
    glossary: true,
  },
  linkOption: "first", // 'first' or 'all'
};

// Track first mentions when in 'first mention' mode
const firstMentions = new Set();
let observer;
let isProcessing = false;

// Initialize the extension
initExtension();

async function initExtension() {
  // Load disabled domains
  const { disabledDomains = [] } = await chrome.storage.sync.get([
    "disabledDomains",
  ]);
  const currentDomain = window.location.hostname;

  // Check if current domain is disabled
  if (disabledDomains.includes(currentDomain)) {
    return; // Stop execution for disabled domains
  }

  // Check if current URL is excluded
  const currentUrl = new URL(window.location.href);
  const isExcluded = EXCLUDED_DOMAINS.some((domain) =>
    currentUrl.hostname.includes(domain)
  );

  if (isExcluded) return;

  // Load settings first
  const savedSettings = await chrome.storage.sync.get([
    "extensionEnabled",
    "contentTypes",
    "linkOption",
  ]);

  settings = validateSettings(savedSettings);
  // Object.assign(settings, savedSettings);

  // Initialize mutation observer
  // initObserver();

  // Add event listeners for tooltips
  document.addEventListener("mouseover", handleMouseOver);
  document.addEventListener("mouseout", handleMouseOut);

  // Check if extension is enabled
  if (settings.extensionEnabled) {
    await processPage();
  }
}

function validateSettings(settings) {
  return {
    extensionEnabled:
      typeof settings.extensionEnabled === "boolean"
        ? settings.extensionEnabled
        : true,
    contentTypes: {
      interventions:
        typeof settings.contentTypes?.interventions === "boolean"
          ? settings.contentTypes.interventions
          : true,
      topics:
        typeof settings.contentTypes?.topics === "boolean"
          ? settings.contentTypes.topics
          : true,
      outcomes:
        typeof settings.contentTypes?.outcomes === "boolean"
          ? settings.contentTypes.outcomes
          : false,
      glossary:
        typeof settings.contentTypes?.glossary === "boolean"
          ? settings.contentTypes.glossary
          : true,
    },
    linkOption: ["first", "all"].includes(settings.linkOption)
      ? settings.linkOption
      : "first",
  };
}

function initObserver() {
  observer = new MutationObserver((mutations) => {
    if (!settings.extensionEnabled || isProcessing) return;

    const hasRelevantChanges = mutations.some((mutation) => {
      return Array.from(mutation.addedNodes).some(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          !node.classList?.contains("glossary-highlight")
      );
    });

    if (hasRelevantChanges) {
      clearTimeout(window.glossaryDebounce);
      window.glossaryDebounce = setTimeout(() => {
        isProcessing = true;
        processPage().finally(() => {
          isProcessing = false;
        });
      }, 2000); // Run after 2sec
    }
  });

  observer.observe(document.querySelector("main") || document.body, {
    childList: true,
    subtree: true,
  });
}

async function processPage() {
  // Clear existing state
  clearExistingHighlights();

  // Load glossary from storage
  const glossary = await getGlossary();
  if (!glossary || !glossary.length) return;

  // Only getting content from main, if main tag not found then do search on body
  const contentRoot = document.querySelector("main") || document.body;

  // Extract all terms from glossary
  const terms = extractTermsFromGlossary(glossary);
  if (terms.length === 0) return;

  // Split terms into smaller groups
  const termGroups = splitTermsIntoGroups(terms, 100);

  // Process each group of terms
  for (const group of termGroups) {
    processTermGroup(group, contentRoot, glossary);
  }
}

// clear existing highlights
function clearExistingHighlights() {
  firstMentions.clear();
  document.querySelectorAll(".glossary-highlight").forEach((highlight) => {
    highlight.replaceWith(document.createTextNode(highlight.textContent));
  });
}

// extract all terms from glossary
function extractTermsFromGlossary(glossary) {
  const terms = [];
  glossary.forEach((item) => {
    if (isContentTypeEnabled(item.content_type)) {
      terms.push(item.name);
      if (item.synonyms && item.synonyms.length) {
        terms.push(...item.synonyms);
      }
    }
  });
  return terms;
}

// split terms into groups
function splitTermsIntoGroups(terms, groupSize = 100) {
  const termGroups = [];
  for (let i = 0; i < terms.length; i += groupSize) {
    termGroups.push(terms.slice(i, i + groupSize));
  }
  return termGroups;
}

// collect matching text nodes
function collectMatchingTextNodes(contentRoot, pattern) {
  const walker = document.createTreeWalker(
    contentRoot,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  const textNodes = [];

  while ((node = walker.nextNode())) {
    // Skip text nodes inside script, style, or link (a) tags
    if (
      node.parentNode.tagName === "SCRIPT" ||
      node.parentNode.tagName === "STYLE" ||
      node.parentNode.tagName === "A"
    ) {
      continue;
    }

    if (isInsideInteractiveElement(node)) {
      continue;
    }

    if (node.nodeValue.match(pattern)) {
      textNodes.push(node);
    }
  }

  return textNodes;
}

// create glossary link element
function createGlossaryLink(matchedText, glossaryItem) {
  const link = document.createElement("a");
  link.className = "glossary-highlight";
  link.dataset.description = glossaryItem.overview;
  link.dataset.url = glossaryItem.url;
  link.dataset.type = glossaryItem.content_type;
  link.href = `https://examine.com${glossaryItem.url}?utm_source=browser-extension-chrome&utm_medium=external&utm_campaign=browser-extension`;
  link.target = "_blank";
  link.appendChild(document.createTextNode(matchedText));
  return link;
}

// check if term should be linked based on first mention setting
function shouldLinkTerm(glossaryItem) {
  if (settings.linkOption === "first" && firstMentions.has(glossaryItem.url)) {
    return false;
  }
  return true;
}

// process a single text node with matches
function processTextNodeWithMatches(textNode, pattern, glossary) {
  const parent = textNode.parentNode;
  const text = textNode.nodeValue;
  const matches = [...text.matchAll(pattern)];

  // If no matches, skip
  if (matches.length === 0) return;

  // Create document fragment to hold new content
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  matches.forEach((match) => {
    const matchedText = match[0];
    const matchIndex = match.index;

    // Add text before the match
    if (matchIndex > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.substring(lastIndex, matchIndex))
      );
    }

    // Find the glossary item
    const glossaryItem = findGlossaryItem(matchedText, glossary);
    if (glossaryItem && shouldLinkTerm(glossaryItem)) {
      if (settings.linkOption === "first") {
        firstMentions.add(glossaryItem.url);
      }

      // Create the link element
      const link = createGlossaryLink(matchedText, glossaryItem);
      fragment.appendChild(link);
    } else {
      fragment.appendChild(document.createTextNode(matchedText));
    }

    lastIndex = matchIndex + matchedText.length;
  });

  // Add remaining text after last match
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }

  // Replace the original text node with the fragment
  parent.replaceChild(fragment, textNode);
}

// process a group of terms
function processTermGroup(group, contentRoot, glossary) {
  const pattern = new RegExp(
    `\\b(${group.map((term) => escapeRegExp(term)).join("|")})\\b`,
    "gi"
  );

  // Collect all matching text nodes
  const textNodes = collectMatchingTextNodes(contentRoot, pattern);

  // Process each matching text node
  textNodes.forEach((textNode) => {
    processTextNodeWithMatches(textNode, pattern, glossary);
  });
}

function isInsideInteractiveElement(node) {
  const interactiveTags = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"];
  let parent = node.parentNode;

  while (parent) {
    if (interactiveTags.includes(parent.tagName)) {
      return true;
    }
    if (
      parent.classList?.contains("r") ||
      (parent instanceof Element && parent.getAttribute("role") === "link")
    ) {
      return true;
    }
    parent = parent.parentNode;
  }

  return false;
}

// escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// find glossary item by name or synonym
function findGlossaryItem(matchedText, glossary) {
  const lowerMatched = matchedText.toLowerCase();

  for (const item of glossary) {
    // Check if this content type is enabled
    if (!isContentTypeEnabled(item.content_type)) {
      continue;
    }

    // Check if this outcome option setting is enabled
    if (isOutcomesEnabled(item.url)) {
      continue;
    }

    // Check name
    if (item.name.toLowerCase() === lowerMatched) {
      return item;
    }

    // Check synonyms - handle null/undefined cases
    if (item.synonyms && Array.isArray(item.synonyms)) {
      if (
        item.synonyms.some(
          (synonym) => String(synonym).toLowerCase() === lowerMatched
        )
      ) {
        return item;
      }
    }
  }

  return null;
}

// check if content type is enabled
function isContentTypeEnabled(contentType) {
  switch (contentType) {
    case "interventions":
      return settings.contentTypes.interventions;
    case "categories":
    case "topics":
      return settings.contentTypes.topics;
    case "glossary":
      return settings.contentTypes.glossary;
    default:
      return false;
  }
}

// check if outocomes option is enabled
function isOutcomesEnabled(url) {
  if (!settings.contentTypes.outcomes) {
    return url.includes("/outcomes");
  }

  return false;
}

// Get glossary from storage
async function getGlossary() {
  try {
    // First get the list of chunk keys
    const { [GLOSSARY_KEYS_KEY]: chunkKeys } = await chrome.storage.local.get([
      GLOSSARY_KEYS_KEY,
    ]);

    if (!chunkKeys || !Array.isArray(chunkKeys)) {
      console.warn("No glossary data found");
      return [];
    }

    // Get all chunks in parallel
    const chunks = await chrome.storage.local.get(chunkKeys);

    // Combine and validate
    const glossary = [];
    for (const key of chunkKeys) {
      if (chunks[key] && Array.isArray(chunks[key])) {
        glossary.push(...chunks[key]);
      }
    }

    return glossary;
  } catch (error) {
    console.error("Failed to load glossary:", error);
    return [];
  }
}

let tooltip = null;

function handleMouseOver(e) {
  const highlight = e.target.closest(".glossary-highlight");
  if (highlight) {
    showTooltip(
      highlight,
      highlight.dataset.description,
      highlight.dataset.type,
      highlight.dataset.url
    );
  }
}

function handleMouseOut(e) {
  const highlight = e.target.closest(".glossary-highlight");
  if (highlight) {
    hideTooltip();
  }
}

// include brand logo and description
function contentType(type, url) {
  let text = "";

  if (type === "interventions") {
    text = url.includes("/supplements") ? "Supplements" : "Interventions";
  } else if (type === "topics") {
    text = url.includes("/outcomes") ? "Outcomes" : "Conditions/Goals";
  } else {
    text = "Glossary";
  }

  return text;
}

function showTooltip(element, text, type, url) {
  hideTooltip();

  tooltip = document.createElement("div");
  tooltip.className = "glossary-tooltip";

  // Create text node for main text
  const mainTextNode = document.createTextNode(text);

  // Create container for brand text
  const brandSpan = document.createElement("div");
  brandSpan.className = "glossary-tooltip-brand";

  // Add "From: " text
  brandSpan.appendChild(document.createTextNode("From: "));

  // Add icon
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/icon128.png");
  icon.className = "glossary-icon";
  brandSpan.appendChild(icon);

  // Add type text
  brandSpan.appendChild(document.createTextNode(` ${contentType(type, url)}`));

  // Combine everything
  tooltip.appendChild(mainTextNode);
  tooltip.appendChild(brandSpan);
  document.body.appendChild(tooltip);

  // Calculate position after tooltip is in DOM
  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // Default position below
  let top = rect.bottom + window.scrollY + 5;
  let left = rect.left + window.scrollX;
  let positionClass = "tooltip-below";

  // Check if tooltip would go offscreen vertically
  if (rect.bottom + tooltipRect.height + 5 > viewportHeight) {
    // Position above if not enough space below
    top = rect.top + window.scrollY - tooltipRect.height - 5;
    positionClass = "tooltip-above";
  }

  // Handle horizontal overflow
  if (left + tooltipRect.width > viewportWidth) {
    left = viewportWidth - tooltipRect.width - 5;
  }
  left = Math.max(5, left);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.add(positionClass);

  // Trigger reflow before adding visible class
  void tooltip.offsetWidth;
  tooltip.classList.add("visible");
}

function hideTooltip() {
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!chrome.runtime?.id) {
    console.log("Extension context invalidated - removing listeners");
    document.removeEventListener("mouseover", handleMouseOver);
    document.removeEventListener("mouseout", handleMouseOut);
    if (observer) observer.disconnect();
    return;
  }

  if (request.action === "updateDisabledDomains") {
    const currentDomain = window.location.hostname;
    if (request.disabledDomains.includes(currentDomain)) {
      // Clean up if this domain was just disabled
      document.querySelectorAll(".glossary-highlight").forEach((el) => {
        el.replaceWith(document.createTextNode(el.textContent));
      });
      hideTooltip();
    }
    // No need to enable here - will happen on next page load
    sendResponse({ success: true });
    return true;
  } else if (request.action === "toggleExtension") {
    if (request.enabled) {
      settings.extensionEnabled = true;
      processPage();
    } else {
      settings.extensionEnabled = false;
      // Remove all highlights
      document.querySelectorAll(".glossary-highlight").forEach((highlight) => {
        const textNode = document.createTextNode(highlight.textContent);
        highlight.parentNode.replaceChild(textNode, highlight);
      });
      hideTooltip();
    }
  } else if (request.action === "updateSettings") {
    // Update settings and reprocess page
    Object.assign(settings, request.settings);
    firstMentions.clear();

    if (settings.extensionEnabled) {
      processPage();
    } else {
      // Remove highlights if extension was disabled
      document.querySelectorAll(".glossary-highlight").forEach((highlight) => {
        const textNode = document.createTextNode(highlight.textContent);
        highlight.parentNode.replaceChild(textNode, highlight);
      });
      hideTooltip();
    }
  }
});

// cleanup function
function cleanupExtension() {
  document.removeEventListener("mouseover", handleMouseOver);
  document.removeEventListener("mouseout", handleMouseOut);
  if (observer) observer.disconnect();
  hideTooltip();
}

// Check for valid context periodically
setInterval(() => {
  if (!chrome.runtime?.id) {
    cleanupExtension();
  }
}, 5000);
