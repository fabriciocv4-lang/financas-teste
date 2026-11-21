// Finanças do Casal - versão de teste (login + Lançar + Contas)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ---------- utilidades ----------
const ORCAMENTO_VAR = 1000; // valor de teste; vira configuração depois
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const ABR = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DOW = ["dom.","seg.","ter.","qua.","qui.","sex.","sáb."];
const CATS_D = ["Mercado","Restaurante","Casa","Transporte","Saúde","Lazer","Tecnologia","Outros"];
const CATS_R = ["Salário","Extra","Reembolso","Outros"];
const CARDS = [
  { id: "parc", name: "Cartão de gastos fixos", sub: "Só parcelado", color: "#14465F", short: "cartão de gastos fixos" },
  { id: "var", name: "Cartão de gastos variáveis", sub: "Só à vista", color: "#0B1F3A", short: "cartão de gastos variáveis" },
  { id: "comp", name: "Cartão compartilhado", sub: "À vista ou parcelado", color: "#3A2E5C", short: "cartão compartilhado" },
];
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parse = (v) => {
  const n = parseFloat(String(v || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const fmtNum = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const parts = (iso) => iso.split("-").map(Number);
const cycleIdx = (iso) => { const [y, m, d] = parts(iso); return y * 12 + (m - 1) + (d > 30 ? 1 : 0); };
const dueLabel = (am, k) => { const t = am + 1 + k; return "10/" + ABR[t % 12] + "/" + String(Math.floor(t / 12)).slice(2); };
const dateLong = (iso) => { const [y, m, d] = parts(iso); return DOW[new Date(y, m - 1, d).getDay()] + ", " + d + " de " + ABR[m - 1] + ". de " + y; };
const dateShort = (iso) => { const [, m, d] = parts(iso); return pad(d) + " " + ABR[m - 1]; };

// ---------- estado ----------
const newForm = () => ({ tipo: "despesa", data: todayISO(), pay: "cartao", card: "var", conta: "marido", valor: "", n: 1, terc: false, cat: "Mercado", desc: "" });
const S = {
  user: null, ready: false, view: "lancar", menu: false,
  lanc: [], base: { marido: 0, esposa: 0 }, online: navigator.onLine,
  f: newForm(), cal: { open: false, pend: null, vy: 0, vm: 0 },
  saved: "", confirmId: null, editConta: null, draft: "", loginErr: "", busy: false,
};
let unsubs = [];

// ---------- dados ----------
function startData() {
  stopData();
  unsubs.push(onSnapshot(query(collection(db, "lancamentos"), orderBy("data", "desc")), (snap) => {
    S.lanc = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.fromCache = snap.metadata.fromCache;
    render();
  }, (e) => { S.dataErr = e.message; render(); }));
  unsubs.push(onSnapshot(doc(db, "config", "saldos"), (snap) => {
    if (snap.exists()) S.base = { marido: snap.data().marido || 0, esposa: snap.data().esposa || 0 };
    render();
  }));
}
function stopData() { unsubs.forEach((u) => u()); unsubs = []; }

onAuthStateChanged(auth, (u) => {
  S.user = u; S.ready = true;
  if (u) startData(); else { stopData(); S.lanc = []; }
  render();
});
addEventListener("online", () => { S.online = true; render(); });
addEventListener("offline", () => { S.online = false; render(); });

function saldoDe(c) {
  return S.lanc.filter((l) => l.conta === c).reduce((s, l) => s + (l.tipo === "receita" ? l.total : l.forma === "pix" ? -l.total : 0), 0) + (S.base[c] || 0);
}
function movimentosDe(c) { return S.lanc.filter((l) => l.conta === c); }

// ---------- cálculos do formulário ----------
function calc() {
  const f = S.f;
  const rec = f.tipo === "receita";
  const isCard = !rec && f.pay === "cartao";
  const total = parse(f.valor);
  const minN = f.card === "parc" ? 2 : 1;
  const showN = isCard && f.card !== "var";
  const n = showN ? Math.max(minN, f.n || 1) : 1;
  const per = Math.floor((total * 100) / n) / 100;
  const am = cycleIdx(f.data);
  return { rec, isCard, isPix: !rec && f.pay === "pix", total, minN, showN, n, per, am };
}
function previewText() {
  const f = S.f, c = calc();
  const conta = f.conta === "marido" ? "do marido" : "da esposa";
  const dl = dateLong(f.data);
  if (c.rec) return [c.total ? `Receita em ${dl}: entra na conta ${conta}.` : "Digite o valor para ver em qual conta ele entra.", "Receita aumenta o saldo da conta escolhida."];
  if (c.isPix) return [c.total ? `Pix em ${dl}: sai direto da conta ${conta}.` : "Digite o valor para ver de onde esse Pix sai.", "Não usa limite de cartão nem orçamento variável. Reduz o saldo da conta."];
  if (!c.total) return ["Digite o valor para ver em qual fatura essa compra cai.", "Cartões fecham dia 30 e todas as faturas vencem dia 10."];
  const mes = MESES[c.am % 12];
  if (c.n === 1) {
    const a = `Entra na fatura de ${mes}, que vence ${dueLabel(c.am, 0)}.`;
    if (f.terc) return [a, "De terceiros: usa o limite do cartão, mas não entra nas contas do casal."];
    const gasto = S.lanc.filter((l) => l.forma === "cartao" && l.n === 1 && !l.terceiros && (l.cartao === "var" || l.cartao === "comp") && cycleIdx(l.data) === c.am).reduce((s, l) => s + l.total, 0);
    const resta = ORCAMENTO_VAR - gasto - c.total;
    return [a, resta >= 0 ? `Depois deste gasto, ainda dá para gastar ${brl(resta)} do orçamento variável de ${mes}.` : `Passa ${brl(-resta)} do orçamento variável de ${mes}.`];
  }
  return [`${c.n}x de ${brl(c.per)} · 1ª parcela em ${dueLabel(c.am, 0)} · última em ${dueLabel(c.am, c.n - 1)}.`,
    f.terc ? "De terceiros: as parcelas usam o limite, mas não entram nos gastos fixos." : `Soma ${brl(c.per)} por mês nos gastos fixos até ${dueLabel(c.am, c.n - 1).slice(3)}.`];
}

// ---------- telas ----------
const ICON_MENU = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const opt = (act, data, label, on) => `<button class="opt${on ? " on" : ""}" data-act="${act}" ${data} aria-pressed="${!!on}">${label}</button>`;

function loginView() {
  return `<div class="login"><h1>Finanças do Casal</h1><p class="sub">Versão de teste. Entre com o e-mail e a senha de vocês.</p>
  <form id="loginForm" style="display:flex;flex-direction:column;gap:12px;margin-top:20px">
    <label class="lbl" for="email">E-mail</label><input class="in" id="email" type="email" autocomplete="username" required>
    <label class="lbl" for="senha">Senha</label><input class="in" id="senha" type="password" autocomplete="current-password" required>
    <button class="main" type="submit" ${S.busy ? "disabled" : ""}>${S.busy ? "Entrando..." : "Entrar"}</button>
    ${S.loginErr ? `<p class="err" role="alert">${esc(S.loginErr)}</p>` : ""}
  </form></div>`;
}

function calendarHTML() {
  const c = S.cal, T = todayISO();
  const first = new Date(c.vy, c.vm, 1).getDay(), dim = new Date(c.vy, c.vm + 1, 0).getDate();
  let cells = "";
  for (let i = 0; i < first; i++) cells += "<span></span>";
  for (let d = 1; d <= dim; d++) {
    const iso = c.vy + "-" + pad(c.vm + 1) + "-" + pad(d);
    cells += `<button class="d${iso === c.pend ? " on" : ""}${iso === T ? " t" : ""}" data-act="calPick" data-v="${iso}" aria-pressed="${iso === c.pend}">${d}</button>`;
  }
  return `<div class="cal"><div style="display:grid;grid-template-columns:44px 1fr 44px;align-items:center">
    <button class="icon" style="border:0;background:transparent" data-act="calMonth" data-v="-1" aria-label="Mês anterior">‹</button>
    <div style="text-align:center;font-size:14px;font-weight:600" aria-live="polite">${MESES[c.vm][0].toUpperCase() + MESES[c.vm].slice(1)} de ${c.vy}</div>
    <button class="icon" style="border:0;background:transparent" data-act="calMonth" data-v="1" aria-label="Próximo mês">›</button></div>
    <div class="g">${["D","S","T","Q","Q","S","S"].map((x) => `<span class="h">${x}</span>`).join("")}</div>
    <div class="g">${cells}</div>
    <div class="f"><button data-act="calCancel" style="color:var(--mut)">Cancelar</button><button data-act="calToday" style="color:var(--green)">Hoje</button><button data-act="calSet">Definir</button></div></div>`;
}

function lancarView() {
  const f = S.f, c = calc(), T = todayISO();
  const cats = c.rec ? CATS_R : CATS_D;
  const cat = cats.includes(f.cat) ? f.cat : cats[0];
  const [p1, p2] = previewText();
  let h = "";
  if (S.saved) h += `<div class="ok" role="status">${esc(S.saved)}</div>`;
  h += `<section class="sec"><div class="step"><label class="lbl" style="font-weight:600;color:var(--navy);font-size:14px">Data da compra</label>${f.data === T ? '<span class="sub">Hoje</span>' : '<button class="link" data-act="dataHoje">Voltar para hoje</button>'}</div>
    <button class="in" data-act="calOpen" style="text-align:left;display:flex;align-items:center;justify-content:space-between;cursor:pointer" aria-expanded="${S.cal.open}"><span>${dateLong(f.data)}</span><span aria-hidden="true">📅</span></button>
    ${S.cal.open ? calendarHTML() : ""}</section>`;
  h += `<section class="sec"><h2>Tipo de lançamento</h2><div class="grid2">${opt("tipo", 'data-v="despesa"', "Despesa", !c.rec)}${opt("tipo", 'data-v="receita"', "Receita", c.rec)}</div></section>`;
  if (c.rec) {
    h += `<section class="sec"><h2>Em qual conta entra?</h2><div class="grid2">${opt("conta", 'data-v="marido"', "Conta do marido", f.conta === "marido")}${opt("conta", 'data-v="esposa"', "Conta da esposa", f.conta === "esposa")}</div></section>`;
  } else {
    h += `<section class="sec"><h2>Forma de pagamento</h2><div class="grid2">${opt("pay", 'data-v="pix"', "Pix", f.pay === "pix")}${opt("pay", 'data-v="cartao"', "Cartão", f.pay === "cartao")}</div>`;
    if (c.isCard) {
      h += `<h2 style="margin-top:8px">Em qual cartão?</h2>` + CARDS.map((k) =>
        `<button class="card${f.card === k.id ? " on" : ""}" data-act="card" data-v="${k.id}" aria-pressed="${f.card === k.id}"><i style="background:${k.color}"></i><span><b>${k.name}</b><small>${k.sub}</small></span></button>`).join("");
    } else {
      h += `<h2 style="margin-top:8px">De qual conta sai o Pix?</h2><div class="grid2">${opt("conta", 'data-v="marido"', "Conta do marido", f.conta === "marido")}${opt("conta", 'data-v="esposa"', "Conta da esposa", f.conta === "esposa")}</div>`;
    }
    h += `</section>`;
  }
  h += `<section class="sec"><div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="valor">Valor</label>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 60px;gap:8px"><input class="in big" id="valor" inputmode="decimal" placeholder="0,00" value="${esc(f.valor)}"><button class="opt" data-act="zerar" style="color:var(--mut);font-size:12px;padding:0" aria-label="Zerar o valor">Zerar</button></div>
    <div class="wrap">${[10, 20, 50, 100, 200].map((q) => `<button class="chip q" data-act="quick" data-v="${q}">+ ${q}</button>`).join("")}</div>
    <p class="sub">Toque nos botões para somar direto no valor. Também dá para digitar.</p></div>`;
  if (c.showN) {
    h += `<div class="step"><span class="lbl">${f.card === "parc" ? "Parcelas (mínimo 2x)" : "À vista ou parcelado"}</span><div class="step"><button data-act="nDec" aria-label="Menos uma parcela">−</button><b id="nLabel" style="min-width:64px;text-align:center;font-size:18px">${c.n === 1 ? "À vista" : c.n + "x"}</b><button data-act="nInc" aria-label="Mais uma parcela">+</button></div></div>`;
  }
  h += `</section>`;
  h += `<section class="sec"><h2>Categoria</h2><div class="wrap">${cats.map((x) => `<button class="chip${x === cat ? " on" : ""}" data-act="cat" data-v="${esc(x)}" aria-pressed="${x === cat}">${x}</button>`).join("")}</div>
    <div style="display:flex;flex-direction:column;gap:6px"><label class="lbl" for="desc">Descrição (opcional)</label><input class="in" id="desc" style="height:48px;font-size:15px" placeholder="Se vazio, usamos a categoria" value="${esc(f.desc)}"></div></section>`;
  if (c.isCard) {
    h += `<section class="sec"><div class="step"><div><div style="font-size:14px;font-weight:600">Compra de terceiros</div><p class="sub">Outra pessoa paga. Fica no cartão, mas não entra nas contas do casal.</p></div>
      <button data-act="terc" role="switch" aria-checked="${f.terc}" aria-label="Compra de terceiros" style="width:52px;height:32px;border-radius:16px;border:0;background:${f.terc ? "#0B7A5C" : "#7C8EA8"};position:relative;cursor:pointer;flex:none"><span style="position:absolute;top:3px;left:${f.terc ? 23 : 3}px;width:26px;height:26px;border-radius:13px;background:#fff"></span></button></div></section>`;
  }
  h += `<section class="sec" style="background:#EEF3F9;border:0;gap:8px"><h2>${c.rec ? "Onde essa receita entra" : "Onde essa compra cai"}</h2><p class="prev" style="background:none;padding:0" id="p1">${esc(p1)}</p><p class="prev" style="background:none;padding:0" id="p2">${esc(p2)}</p></section>`;
  h += `<div style="margin:16px 20px 0;display:flex;flex-direction:column"><button class="main" id="saveBtn" data-act="salvar" ${c.total > 0 ? "" : "disabled"}>${c.rec ? "Lançar receita" : "Lançar despesa"}</button></div>`;
  h += recentesHTML();
  return h;
}

function descLanc(l) {
  const quando = dateShort(l.data);
  if (l.tipo === "receita") return `${quando} · Receita · conta ${l.conta === "marido" ? "do marido" : "da esposa"}`;
  if (l.forma === "pix") return `${quando} · Pix · conta ${l.conta === "marido" ? "do marido" : "da esposa"}`;
  const k = CARDS.find((x) => x.id === l.cartao);
  return `${quando} · ${k ? k.name : "Cartão"}${l.n > 1 ? " · " + l.n + "x de " + brl(l.parcela) : ""}${l.terceiros ? " · terceiros" : ""}`;
}
function itemHTML(l, withDelete) {
  const sinal = l.tipo === "receita" ? "+ " : "- ";
  const cls = l.tipo === "receita" ? "pos" : "";
  let right = `<b class="${cls}" style="font-variant-numeric:tabular-nums">${sinal}${brl(l.total)}</b>`;
  if (!withDelete) return `<div class="item"><div><b>${esc(l.descricao || l.categoria)}</b><small>${esc(descLanc(l))}</small></div>${right}</div>`;
  if (S.confirmId === l.id) {
    return `<div class="conf" role="group" aria-label="Confirmar exclusão" style="margin:6px 0"><span>Excluir <strong>${esc(l.descricao || l.categoria)}</strong> (${brl(l.total)})?</span>
      <div class="grid2"><button class="opt" data-act="delNo">Cancelar</button><button class="opt on" style="background:#A3261B;border-color:#A3261B" data-act="delYes" data-v="${l.id}">Excluir</button></div></div>`;
  }
  return `<div class="item"><div><b>${esc(l.descricao || l.categoria)}</b><small>${esc(descLanc(l))}</small></div><div style="display:flex;align-items:center;gap:4px">${right}<button class="link del" data-act="delAsk" data-v="${l.id}" aria-label="Excluir ${esc(l.descricao || l.categoria)}">Excluir</button></div></div>`;
}
function recentesHTML() {
  const list = S.lanc.slice(0, 15);
  return `<section class="sec"><h2>Últimos lançamentos</h2>${list.length ? list.map((l) => itemHTML(l, true)).join("") : '<p class="sub">Nenhum lançamento ainda.</p>'}</section>`;
}

function contasView() {
  const cs = [["marido", "Conta do marido"], ["esposa", "Conta da esposa"]];
  const tot = saldoDe("marido") + saldoDe("esposa");
  let h = `<section class="dark"><div style="font-size:13px;color:#C9D6E8">Saldo total das contas</div><div style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums">${brl(tot)}</div></section>`;
  cs.forEach(([id, nome]) => {
    h += `<section class="sec"><h2 style="font-size:15px">${nome}</h2><div style="font-size:28px;font-weight:700;font-variant-numeric:tabular-nums">${brl(saldoDe(id))}</div>`;
    if (S.editConta === id) {
      h += `<label class="lbl" for="draft">Saldo real da conta agora</label><input class="in" id="draft" inputmode="decimal" value="${esc(S.draft)}" placeholder="0,00">
        <div class="grid2"><button class="opt" data-act="saldoNo">Cancelar</button><button class="opt on" data-act="saldoSave" data-v="${id}">Salvar saldo</button></div>`;
    } else h += `<button class="opt" data-act="saldoEdit" data-v="${id}" style="color:var(--green);border-color:var(--green);background:#E6F3EE">Corrigir saldo</button>`;
    h += `</section>`;
  });
  const movs = S.lanc.filter((l) => l.conta).slice(0, 30);
  h += `<section class="sec"><h2 style="font-size:15px">Movimentações das contas</h2><p class="sub">Receitas e Pix lançados. O saldo já considera cada uma.</p>${movs.length ? movs.map((l) => itemHTML(l, false)).join("") : '<p class="sub">Nenhuma movimentação ainda.</p>'}</section>`;
  return h;
}

function shell() {
  const titulo = S.view === "contas" ? "Contas" : "Lançar";
  const sync = !S.online ? "Sem internet · salvando no aparelho" : S.fromCache ? "Sincronizando..." : "Sincronizado";
  let h = `<header class="top"><button class="icon" data-act="menuOpen" aria-label="Abrir menu" aria-expanded="${S.menu}">${ICON_MENU}</button><h1>${titulo}</h1><span class="sync" role="status">${sync}</span></header>`;
  if (S.dataErr) h += `<p class="err" style="margin:12px 20px">Erro ao ler os dados: ${esc(S.dataErr)}</p>`;
  h += S.view === "contas" ? contasView() : lancarView();
  if (S.menu) {
    h += `<div class="drawer"><nav aria-label="Menu de abas"><div style="padding:0 12px 12px;font-size:16px;font-weight:700">Finanças do Casal</div>
      <a data-act="go" data-v="lancar" class="${S.view === "lancar" ? "on" : ""}">Lançar</a><a data-act="go" data-v="contas" class="${S.view === "contas" ? "on" : ""}">Contas</a>
      <div style="flex:1"></div><div style="padding:8px 12px;font-size:12px;color:#A9B8CF">${esc(S.user.email)}</div><a data-act="sair">Sair</a></nav>
      <button class="sh" data-act="menuClose" aria-label="Fechar menu"></button></div>`;
  }
  return h;
}

function render() {
  const app = document.getElementById("app");
  if (!S.ready) { app.innerHTML = '<p class="sub" style="padding:40px 20px">Carregando...</p>'; return; }
  const keep = document.activeElement && document.activeElement.id;
  const pos = keep && document.activeElement.selectionStart;
  app.innerHTML = S.user ? shell() : loginView();
  if (keep) { const el = document.getElementById(keep); if (el && el.focus) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

// ---------- ações ----------
function refreshLive() {
  const c = calc(), [p1, p2] = previewText();
  const a = document.getElementById("p1"), b = document.getElementById("p2"), s = document.getElementById("saveBtn"), n = document.getElementById("nLabel");
  if (a) a.textContent = p1; if (b) b.textContent = p2;
  if (s) s.disabled = !(c.total > 0);
  if (n) n.textContent = c.n === 1 ? "À vista" : c.n + "x";
}
const act = {
  menuOpen() { S.menu = true; render(); }, menuClose() { S.menu = false; render(); },
  go(d) { S.view = d.v; S.menu = false; S.confirmId = null; S.editConta = null; scrollTo(0, 0); render(); },
  sair() { S.menu = false; signOut(auth); },
  tipo(d) { S.f.tipo = d.v; S.f.cat = d.v === "receita" ? CATS_R[0] : CATS_D[0]; S.saved = ""; render(); },
  pay(d) { S.f.pay = d.v; S.saved = ""; render(); },
  conta(d) { S.f.conta = d.v; render(); },
  card(d) { S.f.card = d.v; S.f.n = d.v === "parc" ? Math.max(2, S.f.n) : S.f.n; if (d.v === "var") S.f.n = 1; S.saved = ""; render(); },
  cat(d) { S.f.cat = d.v; render(); },
  terc() { S.f.terc = !S.f.terc; render(); },
  nDec() { const c = calc(); S.f.n = Math.max(c.minN, c.n - 1); render(); },
  nInc() { const c = calc(); S.f.n = Math.min(24, c.n + 1); render(); },
  quick(d) { S.f.valor = fmtNum(Math.round((parse(S.f.valor) + Number(d.v)) * 100) / 100); S.saved = ""; render(); },
  zerar() { S.f.valor = ""; render(); },
  dataHoje() { S.f.data = todayISO(); render(); },
  calOpen() { const [y, m] = parts(S.f.data); S.cal = { open: !S.cal.open, pend: S.f.data, vy: y, vm: m - 1 }; render(); },
  calMonth(d) { const t = S.cal.vy * 12 + S.cal.vm + Number(d.v); S.cal.vy = Math.floor(t / 12); S.cal.vm = t % 12; render(); },
  calPick(d) { S.cal.pend = d.v; render(); },
  calToday() { const [y, m] = parts(todayISO()); S.cal.pend = todayISO(); S.cal.vy = y; S.cal.vm = m - 1; render(); },
  calCancel() { S.cal.open = false; render(); },
  calSet() { S.f.data = S.cal.pend || S.f.data; S.cal.open = false; S.saved = ""; render(); },
  salvar() {
    const f = S.f, c = calc();
    if (c.total <= 0) return;
    const cats = c.rec ? CATS_R : CATS_D;
    const categoria = cats.includes(f.cat) ? f.cat : cats[0];
    const d = {
      tipo: f.tipo, forma: c.rec ? "conta" : f.pay, cartao: c.isCard ? f.card : null,
      conta: c.rec || c.isPix ? f.conta : null, total: Math.round(c.total * 100) / 100,
      n: c.n, parcela: c.per, categoria, descricao: f.desc.trim(), data: f.data,
      terceiros: !!(c.isCard && f.terc), por: S.user.email, criadoEm: serverTimestamp(),
    };
    addDoc(collection(db, "lancamentos"), d).catch((e) => { S.dataErr = e.message; render(); });
    const quando = f.data === todayISO() ? "" : " em " + dateLong(f.data);
    const o = d.descricao || categoria;
    S.saved = c.rec ? `${o}: receita de ${brl(d.total)} na conta ${f.conta === "marido" ? "do marido" : "da esposa"}${quando}.`
      : c.isPix ? `${o}: ${brl(d.total)} no Pix, da conta ${f.conta === "marido" ? "do marido" : "da esposa"}${quando}.`
      : `${o}: ${brl(d.total)} ${c.n === 1 ? "à vista" : c.n + "x de " + brl(c.per)} no ${CARDS.find((k) => k.id === f.card).short}${quando}${d.terceiros ? ", como de terceiros" : ""}.`;
    S.f = { ...newForm(), tipo: f.tipo, pay: f.pay, card: f.card, conta: f.conta, cat: categoria, n: f.card === "parc" ? 2 : 1 };
    scrollTo(0, 0); render();
  },
  delAsk(d) { S.confirmId = d.v; render(); }, delNo() { S.confirmId = null; render(); },
  delYes(d) { deleteDoc(doc(db, "lancamentos", d.v)).catch((e) => { S.dataErr = e.message; }); S.confirmId = null; render(); },
  saldoEdit(d) { S.editConta = d.v; S.draft = fmtNum(saldoDe(d.v)); render(); },
  saldoNo() { S.editConta = null; render(); },
  saldoSave(d) {
    const c = d.v, alvo = parse(S.draft);
    const semBase = saldoDe(c) - (S.base[c] || 0);
    const base = { ...S.base, [c]: Math.round((alvo - semBase) * 100) / 100 };
    S.base = base; S.editConta = null;
    setDoc(doc(db, "config", "saldos"), base).catch((e) => { S.dataErr = e.message; render(); });
    render();
  },
};

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || !act[t.dataset.act]) return;
  e.preventDefault();
  act[t.dataset.act](t.dataset);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "valor") { S.f.valor = e.target.value; refreshLive(); }
  else if (e.target.id === "desc") S.f.desc = e.target.value;
  else if (e.target.id === "draft") S.draft = e.target.value;
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "loginForm") return;
  e.preventDefault();
  const email = document.getElementById("email").value.trim(), senha = document.getElementById("senha").value;
  S.busy = true; S.loginErr = ""; render();
  signInWithEmailAndPassword(auth, email, senha).then(() => { S.busy = false; }).catch((er) => {
    S.busy = false;
    const m = { "auth/invalid-credential": "E-mail ou senha incorretos.", "auth/invalid-email": "E-mail inválido.", "auth/too-many-requests": "Muitas tentativas. Espere um pouco e tente de novo.", "auth/network-request-failed": "Sem conexão com a internet.", "auth/invalid-api-key": "Chave do projeto incorreta. Confira o arquivo firebase-config.js.", "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Chave do projeto incorreta. Confira o arquivo firebase-config.js." };
    S.loginErr = m[er.code] || "Não foi possível entrar (" + er.code + ").";
    render();
  });
});
render();
