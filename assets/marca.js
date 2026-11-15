/* =====================================================================
   MARCA — edite SÓ este arquivo para trocar nome, logo, cor e contatos
   em todas as páginas (site, painel do restaurante e plataforma).
   ===================================================================== */
window.MARCA = {
  nome: "PDVMovel",                 // nome do produto
  frase: "Autoatendimento para trailers, food trucks e lanchonetes",

  // Logo: coloque o arquivo na pasta assets/ e escreva o nome aqui
  // (ex.: "logo.png" ou "logo.svg"). Vazio = usa a inicial do nome.
  logo: "",
  // Logo para fundo escuro (opcional). Vazio = usa a mesma de cima.
  logoClara: "",

  cor: "#F2B705",                   // cor principal da marca

  whatsapp: "5519983332894",        // só números, com 55 + DDD
  telefone: "(19) 98333-2894",      // como aparece escrito no site
  instagram: "dev_adaeloliveira",   // sem o @
  email: "",                        // ex.: "contato@seudominio.com.br" (vazio = não aparece)
  cidade: "Nova Odessa, SP",

  empresa: "Adael Oliveira",        // quem aparece no rodapé (©)
};

/* ---------- daqui para baixo não precisa mexer ---------- */
(function () {
  const M = window.MARCA;
  const base = (document.currentScript && document.currentScript.src || "").replace(/[^/]*$/, "");
  const url = f => !f ? "" : /^(https?:)?\/\//.test(f) || f.startsWith("/") ? f : base + f;
  M.logoUrl = url(M.logo);
  M.logoClaraUrl = url(M.logoClara) || M.logoUrl;
  M.wa = (texto) => `https://wa.me/${M.whatsapp}?text=${encodeURIComponent(texto || `Olá! Quero saber mais sobre o ${M.nome}.`)}`;
  M.inicial = (M.nome || "?").trim().charAt(0).toUpperCase();

  document.documentElement.style.setProperty("--marca", M.cor);
  document.title = document.title.replace(/\{marca\}/g, M.nome);

  function aplicar(root) {
    root.querySelectorAll("[data-marca]").forEach(el => {
      const k = el.dataset.marca;
      if (k === "nome") el.textContent = M.nome;
      else if (k === "frase") el.textContent = M.frase;
      else if (k === "telefone") el.textContent = M.telefone;
      else if (k === "instagram") el.textContent = "@" + M.instagram;
      else if (k === "email") el.textContent = M.email;
      else if (k === "cidade") el.textContent = M.cidade;
      else if (k === "empresa") el.textContent = M.empresa;
      else if (k === "ano") el.textContent = new Date().getFullYear();
    });
    root.querySelectorAll("[data-marca-link]").forEach(el => {
      const k = el.dataset.marcaLink;
      if (k === "whatsapp") { el.href = M.wa(el.dataset.texto ? el.dataset.texto.replace(/\{marca\}/g, M.nome) : ""); el.target = "_blank"; el.rel = "noopener"; }
      else if (k === "instagram") { el.href = `https://instagram.com/${M.instagram}`; el.target = "_blank"; el.rel = "noopener"; }
      else if (k === "email") { if (M.email) el.href = `mailto:${M.email}`; else el.remove(); }
    });
    root.querySelectorAll("[data-marca-logo]").forEach(el => {
      const clara = el.dataset.marcaLogo === "clara";
      const src = clara ? M.logoClaraUrl : M.logoUrl;
      el.innerHTML = src
        ? `<img src="${src}" alt="${M.nome}">`
        : `<span class="mono" aria-hidden="true">${M.inicial}</span>`;
      el.classList.toggle("tem-img", !!src);
    });
    root.querySelectorAll("[data-marca-texto]").forEach(el => {
      el.textContent = el.dataset.marcaTexto.replace(/\{marca\}/g, M.nome);
    });
  }
  M.aplicar = aplicar;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => aplicar(document));
  else aplicar(document);
})();
