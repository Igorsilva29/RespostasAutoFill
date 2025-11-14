const repliesList = document.getElementById("replies-list");
const newReplyInput = document.getElementById("new-reply");
const addReplyButton = document.getElementById("add-reply");
const newReplyCategoryInput = document.getElementById("new-reply-category");
const categoryColorPicker = document.getElementById("category-color-picker");
const replyForm = document.getElementById("reply-form");

// ======================================================================
// 🔵 CONTROLE DO COLOR PICKER — (NOVO)
// ======================================================================
let pickerDirty = false;

categoryColorPicker.addEventListener("input", () => {
    pickerDirty = true; // usuário alterou manualmente a cor
});

// ======================================================================
// -------------------------- Funções Utilitárias ------------------------
// ======================================================================

function formatText(text) {
  let formatted = text.replace(/\*(.*?)\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\n/g, "<br>");
  return formatted;
}

function ajustarSaudacao(texto) {
  const hora = new Date().getHours();
  let saudacaoAtual = hora >= 5 && hora < 12 ? "Bom dia"
    : hora >= 12 && hora < 18 ? "Boa tarde"
    : "Boa noite";
  return texto.replace(/\b(Bom dia|Boa tarde|Boa noite)\b/gi, saudacaoAtual);
}

function rgbToHex(rgb) {
  if (!rgb) return null;
  if (rgb[0] === "#") return rgb;
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function makeCategoryColorEditable(header, category, colors) {
  const overlay = document.createElement("div");
  overlay.className = "category-color-overlay";
  header.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    e.stopPropagation();

    const inputColor = document.createElement("input");
    inputColor.type = "color";
    const computed = colors[category] || "#0078d7";
    inputColor.value = computed;

    inputColor.addEventListener("input", () => {
      const novaCor = inputColor.value;
      header.style.setProperty("--tag-color", novaCor);

      chrome.storage.sync.get(["quickRepliesColors"], (res) => {
        const cores = res.quickRepliesColors || {};
        cores[category] = novaCor;
        chrome.storage.sync.set({ quickRepliesColors: cores });
      });
    });

    inputColor.click();
  });
}

// ======================================================================
// -------------------------- Storage Helpers ---------------------------
// ======================================================================

function getColors() {
  return new Promise(res => chrome.storage.sync.get(["quickRepliesColors"], r => res(r.quickRepliesColors || {})));
}

function saveColors(obj) {
  chrome.storage.sync.set({ quickRepliesColors: obj });
}

function syncReplies(replies) {
  chrome.storage.sync.set({ quickReplies: replies });
  chrome.storage.local.set({ quickReplies: replies });
  localStorage.setItem("quickReplies", JSON.stringify(replies));
}

async function getReplies() {
  return new Promise(res => {
    chrome.storage.sync.get(["quickReplies"], (r) => res(r.quickReplies || []));
  });
}

async function updateCategorySuggestions() {
  const datalist = document.getElementById("category-options");
  if (!datalist) return;

  const replies = await getReplies();
  const categories = [...new Set(replies.map(r => r.category || "Sem categoria"))];

  datalist.innerHTML = "";
  categories.forEach(cat => {
    if (cat && cat !== "Sem categoria") {
      const option = document.createElement("option");
      option.value = cat;
      datalist.appendChild(option);
    }
  });
}

// ======================================================================
// ---------------------------- Renderização ----------------------------
// ======================================================================

async function renderReplies(replies) {
  repliesList.innerHTML = "";
  if (!replies || !replies.length) return;

  const colors = await getColors();
  const groups = {};

  for (const r of replies) {
    const item = typeof r === "object" ? r : { text: r, category: "Sem categoria" };
    const cat = item.category || "Sem categoria";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  Object.keys(groups).forEach(cat => {
    const catDiv = document.createElement("div");
    catDiv.className = "category-container";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = cat;

    const color = colors[cat] || "#0078d7";
    header.style.setProperty("--tag-color", color);

    makeCategoryColorEditable(header, cat, colors);
    catDiv.appendChild(header);

    const repliesContainer = document.createElement("div");
    repliesContainer.className = "replies-group";
    catDiv.appendChild(repliesContainer);

    groups[cat].forEach(r => {
      const div = document.createElement("div");
      div.className = "reply-item";
      div.dataset.category = cat;
      div.dataset.text = r.text;

      const span = document.createElement("span");
      span.className = "reply-text";
      span.innerHTML = formatText(ajustarSaudacao(r.text));
      span.style.flex = "1";

      const btns = document.createElement("div");
      btns.className = "reply-buttons";

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.textContent = "✏️";
      editBtn.title = "Editar esta resposta"

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.textContent = "🗑️";
      delBtn.title = "Apagar esta resposta"

      btns.appendChild(editBtn);
      btns.appendChild(delBtn);

      div.appendChild(span);
      div.appendChild(btns);
      repliesContainer.appendChild(div);
    });

    repliesList.appendChild(catDiv);

    new Sortable(repliesContainer, {
      animation: 150,
      handle: ".reply-item",
      ghostClass: "sortable-ghost",
      onEnd: function () {
        const updatedReplies = [];
        document.querySelectorAll(".category-container").forEach(catEl => {
          const catName = catEl.querySelector(".category-header").textContent;
          catEl.querySelectorAll(".reply-item").forEach(item => {
            updatedReplies.push({
              category: catName,
              text: item.dataset.text
            });
          });
        });
        syncReplies(updatedReplies);
      }
    });
  });
}

// ======================================================================
// --------------------------- Inicialização ----------------------------
// ======================================================================

chrome.storage.sync.get(["quickReplies"], (r) => {
  renderReplies(r.quickReplies || []);
  updateCategorySuggestions();
});

// ======================================================================
// -------------------- Botão "Adicionar / Salvar" ----------------------
// ======================================================================

let formVisible = false;

addReplyButton.addEventListener("click", async () => {

  if (!formVisible) {
    replyForm.style.display = "flex";
    addReplyButton.textContent = "Salvar resposta 💾";
    addReplyButton.title = "Clique para salvar esta resposta";
    formVisible = true;

    pickerDirty = false;

    await updateCategorySuggestions();
    return;
}


  const category = newReplyCategoryInput?.value.trim() || "Sem categoria";
  const text = newReplyInput.value.trim();
  const userColor = categoryColorPicker?.value || null;

  if (!text) {
    replyForm.style.display = "none";
    addReplyButton.textContent = "Adicionar";
    addReplyButton.title = "Clique para adicionar uma nova resposta";
    formVisible = false;
    return;
  }

  const colors = await getColors();
  const existingColor = colors[category];
  const defaultColor = "#0078d7";

  // ============================================================
  // 🔵 COR FINAL — (LÓGICA CORRIGIDA)
  // ============================================================
  let finalColor;

  if (existingColor) {
    if (!pickerDirty) {
      finalColor = existingColor; // manter cor original
    } else {
      finalColor = userColor;
      colors[category] = finalColor;
      saveColors(colors);
    }
  } else {
    finalColor = userColor || defaultColor;
    colors[category] = finalColor;
    saveColors(colors);
  }
  // ============================================================

  chrome.storage.sync.get(["quickReplies"], (r) => {
    const updated = (r.quickReplies || []).concat({ category, text });
    syncReplies(updated);

    newReplyInput.value = "";
    if (newReplyCategoryInput) newReplyCategoryInput.value = "";
    if (categoryColorPicker) categoryColorPicker.value = "#0078d7";

    replyForm.style.display = "none";
    addReplyButton.textContent = "Adicionar";
    formVisible = false;

    renderReplies(updated);
    updateCategorySuggestions();
  });
});

newReplyInput.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key === "Enter") addReplyButton.click();
});

// ======================================================================
// ---------------------- Editar / Excluir Resposta ---------------------
// ======================================================================

repliesList.addEventListener("click", (e) => {
  const item = e.target.closest(".reply-item");
  if (!item) return;

  const cat = item.dataset.category;
  const txt = item.dataset.text;

  chrome.storage.sync.get(["quickReplies"], (r) => {
    let replies = r.quickReplies || [];

    if (e.target.classList.contains("delete-btn")) {
      replies = replies.filter(obj => !(obj.category === cat && obj.text === txt));
      syncReplies(replies);
      renderReplies(replies);
      updateCategorySuggestions();
    }

    if (e.target.classList.contains("edit-btn")) {
      item.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:5px;width:100%;">
          <input type="text" id="edit-category" value="${cat}" placeholder="Categoria" style="width:100%;">
          <textarea id="edit-text" style="flex:1;">${txt}</textarea>
          <div class="reply-buttons">
            <button class="save-btn" title="Salvar esta resposta">💾</button>
            <button class="cancel-btn" title="Cancelar edição">❌</button>
          </div>
        </div>`;

      const saveBtn = item.querySelector(".save-btn");
      const cancelBtn = item.querySelector(".cancel-btn");

      saveBtn.addEventListener("click", () => {
        const newCat = item.querySelector("#edit-category").value.trim() || "Sem categoria";
        const newText = item.querySelector("#edit-text").value.trim();
        if (!newText) return;

        replies = replies.map(obj => {
          if (obj.category === cat && obj.text === txt) return { category: newCat, text: newText };
          return obj;
        });

        syncReplies(replies);
        renderReplies(replies);
        updateCategorySuggestions();
      });

      cancelBtn.addEventListener("click", () => renderReplies(replies));
    }
  });
});
