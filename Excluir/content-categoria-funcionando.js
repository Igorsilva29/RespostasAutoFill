// content.js — Inserção robusta multi-campo + WhatsApp + correção Gestão/Email
const TRIGGER_CTRL = true;
const TRIGGER_KEY = "/";
const INSERT_RETRIES = 6;
const INSERT_RETRY_DELAY = 80;

console.log("[QuickReplies] content.js carregado");

// --- Ajuste automático de saudação conforme o horário ---
function ajustarSaudacao(texto) {
  const hora = new Date().getHours();
  let saudacaoAtual = "";

  if (hora >= 5 && hora < 12) {
    saudacaoAtual = "Bom dia";
  } else if (hora >= 12 && hora < 18) {
    saudacaoAtual = "Boa tarde";
  } else {
    saudacaoAtual = "Boa noite";
  }

  if (typeof texto !== "string") return texto;
  return texto.replace(/\b(Bom dia|Boa tarde|Boa noite)\b/gi, saudacaoAtual);
}

function safeLog(...args) {
  console.log("[QuickReplies]", ...args);
}

// ---------------------- Helpers para messaging/storage (promisified)
function getQuickRepliesFromBackground() {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action: "getQuickReplies" }, res => resolve(res || []));
    } catch (e) {
      safeLog("getQuickRepliesFromBackground erro:", e);
      resolve([]);
    }
  });
}

function saveQuickRepliesToBackground(data) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action: "saveQuickReplies", data }, res => resolve(res || {}));
    } catch (e) {
      safeLog("saveQuickRepliesToBackground erro:", e);
      resolve({});
    }
  });
}

// ---------------------- Normalização automática dos dados
function normalizeRepliesArray(raw) {
  const out = Array.isArray(raw) ? raw.slice() : [];
  const normalized = out.map(item => {
    if (item && typeof item === "object" && (item.text || item.category)) {
      return {
        category: (item.category || "Sem categoria").toString().trim(),
        text: (item.text || "").toString()
      };
    }
    if (typeof item === "string") {
      const match = item.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        return { category: match[1].trim() || "Sem categoria", text: match[2] || "" };
      }
      return { category: "Sem categoria", text: item };
    }
    return { category: "Sem categoria", text: "" };
  });

  return normalized.filter(r => r && typeof r.text === "string" && r.text.trim() !== "");
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

    let replies = await getQuickRepliesFromBackground();
    if (!Array.isArray(replies)) replies = [];

    const needsNormalization = replies.some(item =>
      typeof item === "string" ||
      typeof item !== "object" ||
      item === null ||
      item.category === undefined ||
      item.text === undefined
    );

    const normalized = normalizeRepliesArray(replies);

    if (needsNormalization) {
      try {
        await saveQuickRepliesToBackground(normalized);
        safeLog("quickReplies normalizados e salvos (content.js)");
      } catch (e) {
        safeLog("erro ao salvar normalized replies:", e);
      }
      replies = normalized;
    } else {
      replies = replies.map(item => ({
        category: (item.category || "Sem categoria").toString().trim(),
        text: (item.text || "").toString()
      }));
    }

    if (!replies.length) return;

    const old = doc.getElementById("quick-replies-popup");
    if (old) old.remove();

    const popup = createPopup(doc, active, replies);
    doc.body.appendChild(popup);
    doc.addEventListener("click", ev => {
      if (!popup.contains(ev.target)) popup.remove();
    }, { once: true });

  }, true);
}

// ---------------------- Criação do popup com suporte a categorias
function createPopup(doc, active, replies) {
  const popup = doc.createElement("div");
  popup.id = "quick-replies-popup";

  // 🔧 Estilos reforçados para garantir exibição
  Object.assign(popup.style, {
    position: "fixed", // antes era absolute
    top: "20%",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#fff",
    border: "1px solid #ccc",
    padding: "10px",
    borderRadius: "8px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    fontFamily: "sans-serif",
    fontSize: "13px",
    width: "420px",
    maxHeight: "70vh",
    overflowY: "auto",
    zIndex: "9999999",
    color: "#000",
    display: "block",
    visibility: "visible",
    opacity: "1",
  });

  // 🔹 Agrupamento das mensagens por categoria
  const grouped = groupRepliesByCategory(replies);
  const categories = Object.keys(grouped);
  console.log("[QuickReplies][DEBUG] categorias detectadas:", categories);

  categories.forEach(cat => {
    const catEl = createCategoryItem(doc, popup, active, grouped, cat);
    popup.appendChild(catEl);
  });

  // 🔹 Garante que o popup comece do topo e tenha altura visível
  popup.scrollTop = 0;
  console.log("[QuickReplies][DEBUG] total de elementos dentro do popup:", popup.children.length);

  positionPopup(active, popup);
  return popup;
}


// ---------------------- Cria o item de categoria e exibe as mensagens ao clicar
function createCategoryItem(doc, popup, active, grouped, category) {
  const categoryDiv = doc.createElement("div");
  categoryDiv.style.marginBottom = "8px";

  const categoryTitle = doc.createElement("div");
  categoryTitle.textContent = `📂 ${category}`;
  categoryTitle.style.fontWeight = "bold";
  categoryTitle.style.cursor = "pointer";
  categoryTitle.style.marginBottom = "4px";
  categoryTitle.style.background = "#f5f5f5";
  categoryTitle.style.padding = "4px 8px";
  categoryTitle.style.borderRadius = "4px";

  // 🔹 Container das mensagens (inicialmente oculto)
  const messagesContainer = doc.createElement("div");
  messagesContainer.style.display = "none";
  messagesContainer.style.marginLeft = "10px";

  // 🔹 Mensagens dessa categoria
  const items = grouped[category] || [];

  items.forEach((item, i) => {
    if (!item || !item.text) return;

    const msgDiv = doc.createElement("div");
    msgDiv.textContent = item.text;
    msgDiv.style.padding = "5px";
    msgDiv.style.border = "1px solid #ddd";
    msgDiv.style.borderRadius = "4px";
    msgDiv.style.marginBottom = "4px";
    msgDiv.style.cursor = "pointer";
    msgDiv.style.whiteSpace = "pre-wrap";
    msgDiv.style.background = "#fafafa";

    msgDiv.addEventListener("click", async () => {
      try {
        const activeField =
          doc.activeElement && (doc.activeElement.tagName === "TEXTAREA" || doc.activeElement.tagName === "INPUT" || doc.activeElement.isContentEditable)
            ? doc.activeElement
            : active;

        if (activeField) {
          const ok = await tryInsertWithRetries(activeField, item.text, INSERT_RETRIES, INSERT_RETRY_DELAY);
          if (ok) safeLog("[QuickReplies] Texto inserido com sucesso.");
          else safeLog("[QuickReplies][WARN] Falha ao inserir texto após múltiplas tentativas.");
        } else {
          safeLog("[QuickReplies][WARN] Nenhum campo ativo para inserir o texto.");
        }
      } catch (e) {
        safeLog("[QuickReplies][ERRO] Falha ao inserir texto:", e);
      } finally {
        // Fecha o popup após a inserção
        const p = doc.getElementById("quick-replies-popup");
        if (p) p.remove();
      }
    });

    messagesContainer.appendChild(msgDiv);
  });

  // 🔹 Mostra/esconde as mensagens ao clicar na categoria
  categoryTitle.addEventListener("click", () => {
    const visible = messagesContainer.style.display === "block";
    messagesContainer.style.display = visible ? "none" : "block";
  });

  categoryDiv.appendChild(categoryTitle);
  categoryDiv.appendChild(messagesContainer);
  return categoryDiv;
}


// ---------------------- Agrupamento compatível
function groupRepliesByCategory(replies) {
  const groups = {};
  (Array.isArray(replies) ? replies : []).forEach(item => {
    let category = "Sem categoria";
    let text = "";

    if (typeof item === "object" && item !== null) {
      if (item.category && item.text !== undefined) {
        category = item.category;
        text = item.text;
      } else {
        category = item.category || "Sem categoria";
        text = item.text || item.message || "";
      }
    } else if (typeof item === "string") {
      const match = item.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        category = match[1].trim() || "Sem categoria";
        text = match[2] || "";
      } else {
        text = item;
      }
    }

    if (!groups[category]) groups[category] = [];
    groups[category].push({ text, original: item });
  });

  return groups;
}

// ---------------------- Outras funções (inalteradas)
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

async function tryInsertWithRetries(element, text, retries = 5, delay = 80) {
  for (let i = 0; i < retries; i++) {
    const ok = await insertTextOnce(element, text);
    if (ok) return true;
    await sleep(delay);
  }
  return false;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function insertTextOnce(element, text) {
  if (!element) return false;
  if (typeof text === "string") text = text.replace(/\r?\n/g, "\n");
  text = ajustarSaudacao(text);
  try {
    const tag = element.tagName ? element.tagName.toUpperCase() : "";

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

      const sel = element.ownerDocument.getSelection();
      let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) {
        range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(true);
      }

      if (
        element.innerHTML.trim() === "<br>" ||
        element.innerHTML.trim() === "" ||
        element.innerText.trim() === ""
      ) {
        element.innerHTML = "";
      }

      const lines = text.split("\n");
      const frag = element.ownerDocument.createDocumentFragment();
      lines.forEach((line, idx) => {
        frag.appendChild(document.createTextNode(line));
        if (idx < lines.length - 1) frag.appendChild(document.createElement("br"));
      });
      range.insertNode(frag);

      sel.removeAllRanges();
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

(function init() {
  try { injectScript(document); } catch(e){ safeLog("init injectScript fail", e); }
  try { watchIframes(document); } catch(e){ safeLog("watchIframes fail", e); }
  setInterval(() => {
    try { Array.from(document.querySelectorAll("iframe")).forEach(tryInjectIntoIframe); } catch(e){}
  }, 2500);
})();
