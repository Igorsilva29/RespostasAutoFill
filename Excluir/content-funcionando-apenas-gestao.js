// content.js — injeção e inserção robusta (retry + iframe load + mutation observer)

// Ajuste do atalho: Ctrl + / (pode mudar se quiser)
const TRIGGER_CTRL = true;
const TRIGGER_KEY = "/";

// quantas tentativas para inserir (com pequenos delays)
const INSERT_RETRIES = 6;
const INSERT_RETRY_DELAY = 80; // ms

console.log("[QuickReplies] content.js carregado");

function safeLog(...args) {
  // descomente a linha abaixo se quiser logs menores
  console.log("[QuickReplies]", ...args);
}

// --------------- injetar no documento (principal ou iframe doc)
function injectScript(doc) {
  if (!doc || doc._quickRepliesInjected) return;
  doc._quickRepliesInjected = true;
  safeLog("Injetando script em documento:", doc.location?.href || doc.title || "document");

  // Listener global de keydown no documento para pegar o atalho mesmo que campo seja dinâmico
  doc.addEventListener("keydown", async (event) => {
    const matchKey = event.key === TRIGGER_KEY && (!TRIGGER_CTRL || event.ctrlKey);
    if (!matchKey) return;

    // previne inserir "/" no campo automaticamente
    try { event.preventDefault(); } catch (e) {}

    const active = doc.activeElement;
    if (!active) {
      safeLog("Atalho: sem elemento ativo");
      return;
    }

    // pega replies via background/storage
    const replies = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getQuickReplies" }, (res) => {
        resolve(res || []);
      });
    });

    if (!replies || replies.length === 0) {
      safeLog("Nenhuma resposta salva");
      return;
    }

    // remove popup antigo
    const old = doc.getElementById("quick-replies-popup");
    if (old) old.remove();

    // cria popup
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

    replies.forEach((r, idx) => {
      const opt = doc.createElement("div");
      opt.textContent = r;
      Object.assign(opt.style, { padding: "6px 8px", cursor: "pointer" });
      opt.addEventListener("mouseenter", () => opt.style.background = "#f0f0f0");
      opt.addEventListener("mouseleave", () => opt.style.background = "transparent");
      opt.addEventListener("click", async () => {
        popup.remove();
        await removeTriggerCharacter(active, doc);
        const ok = await tryInsertWithRetries(active, r, INSERT_RETRIES, INSERT_RETRY_DELAY);
        safeLog("Inserção tentativa:", ok ? "sucesso" : "falha", "no elemento", active);
      });
      popup.appendChild(opt);
    });

    // posiciona embaixo do elemento ativo (tenta usar bounding rect)
    try {
      const rect = active.getBoundingClientRect();
      const popupHeight = 200; // altura máxima do popup
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

    doc.body.appendChild(popup);
    doc.addEventListener("click", (ev) => { if (!popup.contains(ev.target)) popup.remove(); }, { once: true });
  }, true);
}

// --------------- observa iframes dinamicamente e injeta quando prontos
function watchIframes(root = document) {
  Array.from(root.querySelectorAll("iframe")).forEach((iframe) => tryInjectIntoIframe(iframe));

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.tagName === "IFRAME") tryInjectIntoIframe(node);
      });
    }
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
}

// tenta injetar no iframe com load + polling do documento interno
function tryInjectIntoIframe(iframe) {
  if (!iframe || iframe._quickRepliesIframeBound) return;
  iframe._quickRepliesIframeBound = true;

  const doInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc) {
        injectScript(doc);
        const mo = new MutationObserver(() => { try { injectScript(doc); } catch(e){} });
        try { mo.observe(doc.body || doc, { childList: true, subtree: true }); } catch(e){}
      }
    } catch (e) {
      safeLog("iframe cross-origin, fallback:", iframe.src);
    }
  };

  iframe.addEventListener("load", doInject);
  setTimeout(doInject, 300);
  setTimeout(doInject, 1200);
  setTimeout(doInject, 3000);
}

// --------------- remover trigger char (tentativa segura)
async function removeTriggerCharacter(element, docContext) {
  try {
    if (!element) return;

    if (element.isContentEditable) {
      const sel = element.ownerDocument.getSelection();
      if (!sel || !sel.rangeCount) {
        const txt = element.innerText || "";
        if (txt.endsWith("/")) element.innerText = txt.slice(0, -1);
        return;
      }
      const range = sel.getRangeAt(0).cloneRange();
      try { range.setStart(range.startContainer, Math.max(0, range.startOffset - 1)); } catch(e){}
      const prefix = range.toString();
      if (prefix && prefix.endsWith("/")) range.deleteContents();
      else { const txt = element.innerText || ""; if (txt.endsWith("/")) element.innerText = txt.slice(0, -1); }
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (["TEXTAREA", "INPUT"].includes(element.tagName)) {
      const pos = element.selectionStart || 0;
      if (pos > 0 && element.value[pos - 1] === "/") {
        element.value = element.value.slice(0, pos - 1) + element.value.slice(pos);
        element.setSelectionRange(pos - 1, pos - 1);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  } catch (err) { safeLog("removeTriggerCharacter erro:", err); }
}

// --------------- função que tenta inserir texto diversas vezes (retry)
async function tryInsertWithRetries(element, text, retries = 5, delay = 80) {
  for (let i = 0; i < retries; i++) {
    const ok = await insertTextOnce(element, text);
    if (ok) return true;
    await sleep(delay);
  }
  return false;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// --------------- inserção que retorna true/false (mantém quebras de linha)
async function insertTextOnce(element, text) {
  if (!element) return false;

  if (typeof text === "string") text = text.replace(/\r?\n/g, "\n");

  try {
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      const start = element.selectionStart || element.value.length;
      const end = element.selectionEnd || start;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      const pos = start + text.length;
      element.setSelectionRange(pos, pos);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (element.isContentEditable) {
      const sel = element.ownerDocument.getSelection();
      if (!sel) throw new Error("Sem seleção");

      const range = sel.rangeCount ? sel.getRangeAt(0) : element.ownerDocument.createRange();
      range.deleteContents();

      const frag = element.ownerDocument.createDocumentFragment();
      text.split("\n").forEach((line, idx, arr) => {
        frag.appendChild(document.createTextNode(line));
        if (idx < arr.length - 1) frag.appendChild(element.ownerDocument.createElement("br"));
      });

      range.insertNode(frag);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }

  } catch (err) {
    try { element.innerText = text; element.dispatchEvent(new InputEvent("input", { bubbles: true })); } catch(e){}
    safeLog("insertTextOnce erro:", err);
  }

  return false;
}

// --------------- inicialização
(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  setInterval(() => { try { Array.from(document.querySelectorAll("iframe")).forEach(tryInjectIntoIframe); } catch(e){} }, 2500);
})();
