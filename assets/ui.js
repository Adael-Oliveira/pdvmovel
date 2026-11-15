/* Utilidades de interface compartilhadas pelos painéis */
const ICONES = new URL("icones.svg", import.meta.url).href;

export const ic = (nome, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="${ICONES}#i-${nome}"/></svg>`;
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* troca <i data-ic="nome"></i> por ícones */
export function icones(root = document) {
  root.querySelectorAll("i[data-ic]").forEach(el => { el.outerHTML = ic(el.dataset.ic, el.className); });
}

let toastAtual;
export function toast(msg, icone = "check") {
  toastAtual?.remove();
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status");
  t.innerHTML = `${ic(icone)}<span>${esc(msg)}</span>`;
  document.body.appendChild(t); toastAtual = t;
  setTimeout(() => t.remove(), 2800);
}

/* diálogo de confirmação / pergunta, sem confirm() e prompt() do navegador */
function caixa({ titulo, texto, ok = "Confirmar", cancelar = "Cancelar", perigo = false, campo = null }) {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "pequeno";
    d.innerHTML = `<div class="dlg-topo"><h3>${esc(titulo)}</h3></div>
      <div class="dlg-corpo"><p style="color:var(--cinza)">${esc(texto || "")}</p>
      ${campo ? `<label class="campo"><span>${esc(campo.rotulo || "")}</span><input class="inp" maxlength="${campo.max || 60}"></label>` : ""}
      <div class="erro"></div></div>
      <div class="dlg-pe"><span class="esp"></span><button class="btn claro" value="nao">${esc(cancelar)}</button>
      <button class="btn ${perigo ? "perigo" : "marca"}" value="sim">${esc(ok)}</button></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector("input");
    if (inp) inp.value = campo.valor || "";
    const fim = v => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[value="nao"]').onclick = () => fim(campo ? null : false);
    d.querySelector('[value="sim"]').onclick = () => {
      if (!campo) return fim(true);
      const v = inp.value.trim();
      if (campo.exato != null && v !== campo.exato) { d.querySelector(".erro").textContent = campo.msgExato || "O texto não confere."; return; }
      if (!v) { d.querySelector(".erro").textContent = "Preencha o campo."; return; }
      fim(v);
    };
    d.addEventListener("cancel", e => { e.preventDefault(); fim(campo ? null : false); });
    inp?.addEventListener("keydown", e => { if (e.key === "Enter") d.querySelector('[value="sim"]').click(); });
    d.showModal(); (inp || d.querySelector('[value="sim"]')).focus();
  });
}
export const confirmar = o => caixa(o);
export const perguntar = o => caixa({ ...o, campo: o.campo || { valor: o.valor, rotulo: o.rotulo, max: o.max } });

/* fecha diálogos com [data-fechar] e ao clicar fora */
export function prepararDialogos() {
  document.querySelectorAll("dialog").forEach(d => {
    d.querySelectorAll("[data-fechar]").forEach(b => b.onclick = () => d.close());
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
  });
}

export const GOOGLE_SVG = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
