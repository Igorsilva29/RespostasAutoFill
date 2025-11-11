// Funcionandos as 3 opções, porém, no email e no gestão o texto com quebra de linha está ficando invertido

// content.js — Unificado e otimizado: WhatsApp, Email e Gestão
const TRIGGER_CTRL = true;
const TRIGGER_KEY = "/";
const INSERT_RETRIES = 6;
const INSERT_RETRY_DELAY = 80;

console.log("[QuickReplies] content.js carregado");

function safeLog(...args) { console.log("[QuickReplies]", ...args); }

// ---------------------- Inicialização
(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  setInterval(() => {
    try { document.querySelectorAll("iframe").forEach(tryInjectIntoIframe); } catch(e){}
  }, 2500);
})();

// ---------------------- Injeção no documento
function injectScript(doc) {
  if (!doc || doc._quickRepliesInjected) return;
  doc._quickRepliesInjected = true;

  doc.addEventListener("keydown", async event => {
    if (!(event.key === TRIGGER_KEY && (!TRIGGER_CTRL || event.ctrlKey))) return;
    try { event.preventDefault(); } catch (e) {}

    const active = doc.activeElement;
    if (!active) return;

    const replies = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: "getQuickReplies" }, res => resolve(res || []))
    );
    if (!replies.length) return;

    const oldPopup = doc.getElementById("quick-replies-popup");
    if (oldPopup) oldPopup.remove();

    const popup = createPopup(doc, active, replies);
    doc.body.appendChild(popup);
    doc.addEventListener("click", e => { if (!popup.contains(e.target)) popup.remove(); }, { once: true });
  }, true);
}

// ---------------------- Criação do popup
function createPopup(doc, active, replies) {
  const popup = doc.createElement("div");
  popup.id = "quick-replies-popup";
  Object.assign(popup.style, {
    position: "absolute", zIndex: "2147483647",
    background: "#fff", border: "1px solid #ccc",
    padding: "6px", borderRadius: "6px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    fontFamily: "sans-serif", fontSize: "13px",
    maxWidth: "780px", maxHeight: "320px", overflowY: "auto"
  });

  replies.forEach(r => {
    const opt = doc.createElement("div");
    opt.textContent = r;
    Object.assign(opt.style, { padding: "6px 8px", cursor: "pointer" });
    opt.addEventListener("mouseenter", () => opt.style.background = "#f0f0f0");
    opt.addEventListener("mouseleave", () => opt.style.background = "transparent");
    opt.addEventListener("click", async () => {
      popup.remove();
      await removeTriggerCharacter(active);
      await tryInsertWithRetries(active, r, INSERT_RETRIES, INSERT_RETRY_DELAY);
    });
    popup.appendChild(opt);
  });

  positionPopup(active, popup);
  return popup;
}

// ---------------------- Posicionamento do popup
function positionPopup(active, popup) {
  try {
    const rect = active.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 8;
    if (rect.bottom + 200 + 16 > window.innerHeight) {
      top = rect.top + window.scrollY - 200 - 8;
      if (top < 0) top = 10;
    }
    let left = Math.min(Math.max(rect.left + window.scrollX, 10), window.scrollX + window.innerWidth - 260);
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  } catch { popup.style.top = popup.style.left = "10px"; }
}

// ---------------------- Remove trigger "/"
async function removeTriggerCharacter(element) {
  if (!element) return;
  try {
    if (element.isContentEditable) {
      const sel = element.ownerDocument.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0).cloneRange();
        range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
        if (range.toString().endsWith("/")) range.deleteContents();
      } else if ((element.innerText || "").endsWith("/")) {
        element.innerText = element.innerText.slice(0, -1);
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (["INPUT", "TEXTAREA"].includes(element.tagName)) {
      const pos = element.selectionStart || 0;
      if (pos > 0 && element.value[pos - 1] === "/") {
        element.value = element.value.slice(0, pos - 1) + element.value.slice(pos);
        element.setSelectionRange(pos - 1, pos - 1);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  } catch (err) { safeLog("removeTriggerCharacter erro:", err); }
}

// ---------------------- Inserção com retries
async function tryInsertWithRetries(element, text, retries = 5, delay = 80) {
  for (let i = 0; i < retries; i++) {
    if (await insertTextOnce(element, text)) return true;
    await new Promise(res => setTimeout(res, delay));
  }
  return false;
}

// ---------------------- Inserção de texto por tipo de campo
async function insertTextOnce(element, text) {
  if (!element) return false;
  if (typeof text === "string") text = text.replace(/\r?\n/g, "\n");

  try {
    const tag = element.tagName?.toUpperCase();

    // Textarea / Input (Gestão / Email)
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const start = element.selectionStart || element.value.length;
      const end = element.selectionEnd || start;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      element.setSelectionRange(start + text.length, start + text.length);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // ContentEditable (WhatsApp / Gmail / Email)
    if (element.isContentEditable) {
      element.focus();
      const isWhatsApp = element.closest('[contenteditable="true"][data-tab]');

      if (isWhatsApp) { // WhatsApp Web
        const clipboardEvent = new ClipboardEvent("paste", {
          bubbles: true, cancelable: true,
          clipboardData: new DataTransfer()
        });
        clipboardEvent.clipboardData.setData("text/plain", text);
        element.dispatchEvent(clipboardEvent);
        return true;
      }

      // Outros contenteditables
      const sel = element.ownerDocument.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        text.split("\n").forEach((line, idx) => {
          range.insertNode(document.createTextNode(line));
          if (idx < text.split("\n").length - 1) range.insertNode(document.createElement("br"));
        });
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        element.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return true;
      }
    }

  } catch (err) { safeLog("insertTextOnce erro:", err); }
  return false;
}

// ---------------------- Observa iframes
function watchIframes(root = document) {
  root.querySelectorAll("iframe").forEach(tryInjectIntoIframe);
  new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes?.forEach(n => { if (n.tagName === "IFRAME") tryInjectIntoIframe(n); }));
  }).observe(root.body || root, { childList: true, subtree: true });
}

// ---------------------- Injeção em iframe
function tryInjectIntoIframe(iframe) {
  if (!iframe || iframe._quickRepliesIframeBound) return;
  iframe._quickRepliesIframeBound = true;

  const doInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc) {
        injectScript(doc);
        new MutationObserver(() => { try { injectScript(doc); } catch{} })
          .observe(doc.body || doc, { childList: true, subtree: true });
      }
    } catch { safeLog("iframe cross-origin:", iframe.src); }
  };

  iframe.addEventListener("load", doInject);
  [300,1200,3000].forEach(t => setTimeout(doInject, t));
}
