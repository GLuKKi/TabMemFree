/* eslint no-console: ["error", { allow: ["debug"] }] */

import { Store } from "./store.js";

// constants
const SETTING_ACTIVE = "active";
const SETTING_TIMEOUT = "timeout";
const SETTING_TICK = "tick";
const SETTING_PINNED = "pinned";
const DEFAULT_SETTINGS = {
  [SETTING_ACTIVE]: true,
  [SETTING_TIMEOUT]: 15 * 60, // seconds
  [SETTING_TICK]: 60, // seconds
  [SETTING_PINNED]: true
};
const TABS_QUERY = { discarded: false, autoDiscardable: true };

// globals
let tabs = {}; // list of tabIDs with inactivity time
let ticker = null;
const store = new Store(DEFAULT_SETTINGS);

// park idle tab if it is not parked yet
function parkTab(tabId) {
  delete tabs[tabId];

  chrome.tabs.discard(tabId, tab => {
    if (chrome.runtime.lastError) {
      return console.debug("Tab discard error:", chrome.runtime.lastError);
    }

    if (!tab) {
      return console.debug("Tab was not discarded:", tabId);
    }

    console.debug("Tab discarded:", tabId);
  });
}

// simple timer - update inactivity time, unload timeouted tabs
async function tick() {
  console.debug("tick");
  const {
    [SETTING_PINNED]: skipPinned,
    [SETTING_TICK]: tickTime,
    [SETTING_TIMEOUT]: tabTimeout
  } = await store.get([SETTING_PINNED, SETTING_TICK, SETTING_TIMEOUT]);

  ticker = setTimeout(tick, tickTime * 1000);

  chrome.tabs.query(TABS_QUERY, async fetchedTabs => {
    // find active or pinned tabs to reset their time
    const activeTabs = new Set();
    fetchedTabs.forEach(tab => {
      if (tab.active || (skipPinned && tab.pinned)) {
        activeTabs.add(tab.id);
      }
    });

    // tick and find expired
    Object.keys(tabs).forEach(key => {
      const tab = tabs[key];

      const tabId = tab.id;
      if (activeTabs.has(tabId)) {
        return (tabs[tabId].time = 0);
      }

      tabs[tabId].time += tickTime;
      if (tabs[tabId].time >= tabTimeout) {
        parkTab(tabId);
      }
    });
  });
}

async function setExtensionState(newState) {
  await store.set({ [SETTING_ACTIVE]: newState });

  if (!newState) {
    if (ticker) {
      clearTimeout(ticker);
    }

    ticker = null;
    tabs = {};

    // set icon
    chrome.browserAction.setIcon({ path: "img/icon19_off.png" });
    chrome.browserAction.setTitle({
      title: chrome.i18n.getMessage("browserActionInactive")
    });

    return;
  }

  // get all tabs
  chrome.tabs.query(TABS_QUERY, fetchedTabs => {
    fetchedTabs.forEach(tab => {
      tabs[tab.id] = { id: tab.id, time: 0 };
    });
  });

  // set icon
  chrome.browserAction.setIcon({ path: "img/icon19.png" });
  chrome.browserAction.setTitle({
    title: chrome.i18n.getMessage("browserActionActive")
  });

  const { [SETTING_TICK]: tickTime } = await store.get(SETTING_TICK);
  ticker = setTimeout(tick, tickTime * 1000);
}

// Events
// tabs.onCreated - add to list
chrome.tabs.onCreated.addListener(tab => {
  console.debug("Tab created:", tab.id);
  tabs[tab.id] = { id: tab.id, time: 0 };
});

// tabs.onRemoved - load if unloaded, remove from list
chrome.tabs.onRemoved.addListener(tabId => {
  console.debug("Tab removed:", tabId);
  delete tabs[tabId];
});

// tabs.onSelectionChanged - load if unloaded, reset inactivity
chrome.tabs.onSelectionChanged.addListener(tabId => {
  console.debug("Tab activated:", tabId);
  tabs[tabId] = { id: tabId, time: 0 };
});

// UI
chrome.browserAction.onClicked.addListener(async () => {
  console.debug("Extension icon clicked");

  const { [SETTING_ACTIVE]: isActive } = await store.get(SETTING_ACTIVE);

  await setExtensionState(!isActive);

  return false;
});

// starter
async function start() {
  console.debug("Extension started");

  await store.ready();

  const { [SETTING_ACTIVE]: isActive } = await store.get(SETTING_ACTIVE);
  await setExtensionState(isActive);
}

start();
