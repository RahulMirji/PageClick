/// <reference types="chrome" />

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: Error) => console.error(error));
