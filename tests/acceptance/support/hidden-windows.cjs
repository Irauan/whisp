'use strict'
// Keeps the windows of an acceptance test hidden, so a test run does not flash or take the focus.
// `windows.ts` loads this file with `-r` before the app starts. The product has no test hook.
// The window stays hidden but paints, so Playwright still renders and acts on the page.
const { app, BrowserWindow } = require('electron')

// The app shows its window on `ready-to-show`. Here a show or a focus does nothing.
for (const name of ['show', 'showInactive', 'focus', 'moveTop']) {
  BrowserWindow.prototype[name] = function hiddenWindow() {}
}
app.focus = function hiddenApp() {}

app.on('browser-window-created', (_event, window) => {
  window.setSkipTaskbar(true)
  // A hidden window must still run its timers and animation frames for the checks of Playwright.
  window.webContents.setBackgroundThrottling(false)
})

globalThis.aetherTestHiddenWindows = true
