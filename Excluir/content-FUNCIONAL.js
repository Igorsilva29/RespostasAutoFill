// content.js — injeção e inserção robusta (retry + iframe load + mutation observer)
// Substitua seu content.js atual por este.

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
        // remove o "/" se existir (com cuidado)
        await removeTriggerCharacter(active, doc);
        // tenta inserir - com retries
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

  // Tenta posicionar abaixo
  let top = rect.bottom + window.scrollY + 8;

  // Se não houver espaço suficiente abaixo, mostra acima
  if (rect.bottom + popupHeight + 16 > viewportHeight) {
    top = rect.top + window.scrollY - popupHeight - 8;
    if (top < 0) top = 10; // caso o topo da tela fique negativo
  }

  // Calcula posição lateral
  let left = rect.left + window.scrollX;
  const maxLeft = window.scrollX + window.innerWidth - 260;
  if (left > maxLeft) left = maxLeft;
  if (left < 10) left = 10;

  // Aplica
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
  // injeta em frames já presentes (tenta)
  Array.from(root.querySelectorAll("iframe")).forEach((iframe) => {
    tryInjectIntoIframe(iframe);
  });

  // observa criação de novos iframes
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
  if (!iframe) return;
  if (iframe._quickRepliesIframeBound) return;
  iframe._quickRepliesIframeBound = true;

  // quando o iframe carregar, injeta
  const doInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc) {
        injectScript(doc);
        // observa mutações dentro do iframe (p.ex. editor que aparece depois)
        const mo = new MutationObserver(() => {
          // reinject safe if needed
          try { injectScript(doc); } catch(e){}
        });
        try { mo.observe(doc.body || doc, { childList: true, subtree: true }); } catch(e){}
      }
    } catch (e) {
      // cross-origin: não consegue acessar doc — nesse caso, não podemos injetar diretamente
      safeLog("iframe cross-origin, tentativa fallback: ", iframe.src);
    }
  };

  // se já carregou
  iframe.addEventListener("load", doInject);
  // tentar agora (pode já estar pronto)
  setTimeout(doInject, 300);
  setTimeout(doInject, 1200);
  setTimeout(doInject, 3000);
}

// --------------- remover trigger char (tentativa segura)
async function removeTriggerCharacter(element, docContext) {
  try {
    if (!element) return;
    // contenteditable
    if (element.isContentEditable) {
      // tenta remover o caractere imediatamente antes do caret
      const sel = element.ownerDocument.getSelection();
      if (!sel || !sel.rangeCount) {
        // fallback: remove last "/" se existir
        const txt = element.innerText || "";
        if (txt.endsWith("/")) element.innerText = txt.slice(0, -1);
        return;
      }
      const range = sel.getRangeAt(0).cloneRange();
      // cria range que começa 1 char antes
      try {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
      } catch(e) {
        // se não puder ajustar, fallback
      }
      const prefix = range.toString();
      if (prefix && prefix.endsWith("/")) {
        // delete contents of that small range
        range.deleteContents();
      } else {
        // fallback: remove trailing slash in element
        const txt = element.innerText || "";
        if (txt.endsWith("/")) element.innerText = txt.slice(0, -1);
      }
      // force input event
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (["TEXTAREA", "INPUT"].includes(element.tagName)) {
      const pos = element.selectionStart || 0;
      if (pos > 0 && element.value[pos - 1] === "/") {
        element.value = element.value.slice(0, pos - 1) + element.value.slice(pos);
        element.setSelectionRange(pos - 1, pos - 1);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  } catch (err) {
    safeLog("removeTriggerCharacter erro:", err);
  }
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

// --------------- inserção que retorna true/false (tenta vários métodos)
async function insertTextOnce(element, text) {
  // 🔧 Normaliza quebras de linha antes de inserir (mantém compatibilidade total)
  if (typeof text === "string") {
    text = text.replace(/\r?\n/g, "\n"); // converte todas as quebras para o padrão \n
  }

  // 🔧 Se o campo for contenteditable, garante que as quebras de linha apareçam visualmente
  if (element.isContentEditable && text.includes("\n")) {
    const parts = text.split("\n");
    // mantém o conteúdo existente e insere respeitando o cursor
const sel = element.ownerDocument.getSelection();
const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
if (range) {
  parts.forEach((part, i) => {
    range.insertNode(document.createTextNode(part));
    if (i < parts.length - 1) range.insertNode(document.createElement("br"));
  });
  // move cursor para o final
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
} else {
  // fallback: apenas adiciona no final
  parts.forEach((part, i) => {
    element.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) element.appendChild(document.createElement("br"));
  });
}
element.dispatchEvent(new InputEvent("input", { bubbles: true }));
return true;

  }

  if (!element) return false;

  try {
    // inputs/textareas simples
    const tag = element.tagName ? element.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const start = element.selectionStart || element.value.length;
      const end = element.selectionEnd || start;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      const pos = start + text.length;
      element.setSelectionRange(pos, pos);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // contenteditable: tentativas em ordem de eficácia
    if (element.isContentEditable) {
      // 1) try document.execCommand insertText (still works on many editors)
      try {
        element.focus();
        const worked = document.execCommand && document.execCommand("insertText", false, text);
        if (worked !== false) {
          element.dispatchEvent(new InputEvent("input", { bubbles: true }));
          return true;
        }
      } catch(e) { /* ignore */ }

      // 2) Try using the selection/range insert + dispatch input
      try {
        const doc = element.ownerDocument;
        const sel = doc.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = doc.createTextNode(text);
          range.insertNode(node);
          // move cursor after node
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          element.dispatchEvent(new InputEvent("input", { bubbles: true }));
          // For React/Lexical, also dispatch keyboard events to trigger re-render
          element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Unidentified" }));
          element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
          return true;
        }
      } catch(e) { /* ignore */ }

      // 3) FCKEditor / editor inside iframe: try to find editable <body> or <p> and set innerText
      try {
        // if there is a paragraph inside, set it
        const p = element.querySelector("p") || element.querySelector("[data-lexical-editor] p");
        if (p) {
          p.innerText = text;
          // selection at end
          const doc = element.ownerDocument;
          const range = doc.createRange();
          range.selectNodeContents(p);
          range.collapse(false);
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          element.dispatchEvent(new InputEvent("input", { bubbles: true }));
          return true;
        }
      } catch(e){}

      // 4) fallback: set innerText (destrutivo, but last resort)
      try {
        element.innerText = text;
        element.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return true;
      } catch(e){}
    }

  } catch (err) {
    safeLog("insertTextOnce erro:", err);
  }
  return false;
}

// --------------- inicialização
(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  // tentativas periódicas de injetar em iframes (fallback)
  setInterval(() => {
    try { Array.from(document.querySelectorAll("iframe")).forEach(tryInjectIntoIframe); } catch(e){}
  }, 2500);
})();
