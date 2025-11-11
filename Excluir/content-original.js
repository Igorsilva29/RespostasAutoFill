// content.js — Inserção robusta multi-campo + WhatsApp + correção Gestão/Email
const TRIGGER_CTRL = true;
const TRIGGER_KEY = "/";
const INSERT_RETRIES = 6;
const INSERT_RETRY_DELAY = 80;

console.log("[QuickReplies] content.js carregado");

function safeLog(...args) {
  console.log("[QuickReplies]", ...args);
}

// ---------------------- Injeção no documento
function injectScript(doc) {
  if (!doc || doc._quickRepliesInjected) return;
  doc._quickRepliesInjected = true;

  doc.addEventListener("keydown", async (event) => {
    const matchKey = event.key === TRIGGER_KEY && (!TRIGGER_CTRL || event.ctrlKey);
    if (!matchKey) return;
    try { event.preventDefault(); } catch (e) {}

    const active = doc.activeElement;
    if (!active) return;

    const replies = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "getQuickReplies" }, res => resolve(res || []));
    });
    if (!replies.length) return;

    const old = doc.getElementById("quick-replies-popup");
    if (old) old.remove();

    const popup = createPopup(doc, active, replies);
    doc.body.appendChild(popup);
    doc.addEventListener("click", ev => { if (!popup.contains(ev.target)) popup.remove(); }, { once: true });

  }, true);
}

// ---------------------- Criação do popup
function createPopup(doc, active, replies) {
  const popup = doc.createElement("div");
  popup.id = "quick-replies-popup";
  Object.assign(popup.style, {
    position: "absolute",
    zIndex: "2147483647",
    background: "#fff",
    border: "1px solid #ccc",
    padding: "6px",
    borderRadius: "6px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    fontFamily: "sans-serif",
    fontSize: "13px",
    maxWidth: "780px",
    maxHeight: "320px",
    overflowY: "auto"
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
    const popupHeight = 200;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + window.scrollY + 8;
    if (rect.bottom + popupHeight + 16 > viewportHeight) {
      top = rect.top + window.scrollY - popupHeight - 8;
      if (top < 0) top = 10;
    }

    let left = rect.left + window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - 260;
    if (left > maxLeft) left = maxLeft;
    if (left < 10) left = 10;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  } catch (e) {
    popup.style.left = "10px";
    popup.style.top = "10px";
  }
}

// ---------------------- Remove "/" antes da inserção
async function removeTriggerCharacter(element) {
  if (!element) return;
  try {
    if (element.isContentEditable) {
      const sel = element.ownerDocument.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0).cloneRange();
        range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
        if (range.toString().endsWith("/")) range.deleteContents();
      } else {
        if ((element.innerText || "").endsWith("/")) element.innerText = element.innerText.slice(0, -1);
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
    const ok = await insertTextOnce(element, text);
    if (ok) return true;
    await sleep(delay);
  }
  return false;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ---------------------- Inserção de texto por tipo de campo
async function insertTextOnce(element, text) {
  if (!element) return false;
  if (typeof text === "string") text = text.replace(/\r?\n/g, "\n");

  try {
    const tag = element.tagName ? element.tagName.toUpperCase() : "";

    // 1) Textarea / Input
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const start = element.selectionStart || element.value.length;
      const end = element.selectionEnd || start;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      const pos = start + text.length;
      element.setSelectionRange(pos, pos);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2) WhatsApp / Gmail / Email (contenteditable)
    if (element.isContentEditable) {
      element.focus();

      const isWhatsApp = element.closest('[contenteditable="true"][data-tab]') || false;
      if (isWhatsApp) {
        const clipboardEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        clipboardEvent.clipboardData.setData("text/plain", text);
        element.dispatchEvent(clipboardEvent);
        return true;
      }

      // Gestão / Email — correção da inversão e da primeira linha vazia
      // Limpa seleção atual para evitar inserção invertida
      const sel = element.ownerDocument.getSelection();
      if (sel) sel.removeAllRanges();

      // Remove conteúdo se estava totalmente apagado antes (para não gerar linha extra)
      if (element.innerHTML === "<br>" || element.innerHTML.trim() === "") {
        element.innerHTML = "";
      }

      // Inserção correta de múltiplas linhas
      const lines = text.split("\n");
      lines.forEach((line, idx) => {
        element.appendChild(document.createTextNode(line));
        if (idx < lines.length - 1) element.appendChild(document.createElement("br"));
      });

      // Coloca cursor no final
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.addRange(range);

      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }

  } catch (err) {
    safeLog("insertTextOnce erro:", err);
  }
  return false;
}

// ---------------------- Observa iframes
function watchIframes(root = document) {
  Array.from(root.querySelectorAll("iframe")).forEach(tryInjectIntoIframe);
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.tagName === "IFRAME") tryInjectIntoIframe(node);
      });
    });
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
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
        const mo = new MutationObserver(() => { try { injectScript(doc); } catch(e){} });
        mo.observe(doc.body || doc, { childList: true, subtree: true });
      }
    } catch (e) { safeLog("iframe cross-origin:", iframe.src); }
  };

  iframe.addEventListener("load", doInject);
  setTimeout(doInject, 300);
  setTimeout(doInject, 1200);
  setTimeout(doInject, 3000);
}

// ---------------------- Inicialização
(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  setInterval(() => {
    try { Array.from(document.querySelectorAll("iframe")).forEach(tryInjectIntoIframe); } catch(e){}
  }, 2500);
})();
