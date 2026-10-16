const { browserInputCopy } = require("./browser-input-copy.cjs");

async function requestBrowserInputOverride({ host, window, dialog, language, tabId, allowed }) {
  const revision = host.inputOverrideContext(tabId);
  if (allowed === true) {
    const copy = browserInputCopy(language);
    const { response } = await dialog.showMessageBox(window, {
      type: "warning", title: copy.title, message: copy.message, detail: copy.detail,
      buttons: [copy.cancel, copy.allow], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response !== 1) return host.snapshot();
  }
  // Revalidate after the dialog: selection or ownership may have changed while it was open.
  return host.setInputOverride(tabId, allowed, revision);
}

module.exports = { requestBrowserInputOverride };
