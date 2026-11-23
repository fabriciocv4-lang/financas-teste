// Finanças do Casal - versão de teste (login + Lançar + Contas)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, setDoc, updateDoc, deleteField, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ---------- utilidades ----------
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
const dueLabel = (am, k, dia = 10) => { const t = am + 1 + k; return dia + "/" + ABR[t % 12] + "/" + String(Math.floor(t / 12)).slice(2); };
const dateLong = (iso) => { const [y, m, d] = parts(iso); return DOW[new Date(y, m - 1, d).getDay()] + ", " + d + " de " + ABR[m - 1] + ". de " + y; };
const dateShort = (iso) => { const [, m, d] = parts(iso); return pad(d) + " " + ABR[m - 1]; };

// ---------- estado ----------
const newForm = () => ({ tipo: "despesa", data: todayISO(), pay: "cartao", card: "var", conta: "marido", valor: "", n: 1, terc: false, cat: "Mercado", desc: "" });
const S = {
  user: null, ready: false, view: "resumo", menu: false, mes: 0, fixos: [], pagos: {}, cfg: {}, selDay: 0, payAsk: null, editFix: false, editCard: null,
  lanc: [], base: { marido: 0, esposa: 0 }, online: navigator.onLine,
  f: newForm(), cal: { open: false, pend: null, vy: 0, vm: 0 },
  saved: "", confirmId: null, editConta: null, draft: "", loginErr: "", busy: false,
};
let unsubs = [];

// ---------- dados ----------
function errH(e) { S.dataErr = e.message; render(); }
function startData() {
  stopData();
  unsubs.push(onSnapshot(query(collection(db, "lancamentos"), orderBy("data", "desc")), (snap) => {
    S.lanc = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.fromCache = snap.metadata.fromCache;
    render();
  }, (e) => { S.dataErr = e.message; render(); }));
  unsubs.push(onSnapshot(collection(db, "fixos"), (snap) => {
    S.fixos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.dia || 0) - (b.dia || 0));
    render();
  }, errH));
  unsubs.push(onSnapshot(collection(db, "pagos"), (snap) => {
    S.pagos = {}; snap.docs.forEach((d) => { S.pagos[d.id] = d.data(); });
    render();
  }, errH));
  unsubs.push(onSnapshot(doc(db, "config", "geral"), (snap) => {
    S.cfg = snap.exists() ? snap.data() : {};
    render();
  }, errH));
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
  const pg = Object.values(S.pagos).filter((p) => p.conta === c).reduce((s, p) => s + p.valor, 0);
  return S.lanc.filter((l) => l.conta === c).reduce((s, l) => s + (l.tipo === "receita" ? l.total : l.forma === "pix" ? -l.total : 0), 0) + (S.base[c] || 0) - pg;
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
  if (!c.total) return ["Digite o valor para ver em qual fatura essa compra cai.", "Cartões fecham dia 30."];
  const mes = MESES[c.am % 12];
  if (c.n === 1) {
    const a = `Entra na fatura de ${mes}, que vence ${dueLabel(c.am, 0, diaVenc(f.card))}.`;
    if (f.terc) return [a, "De terceiros: usa o limite do cartão, mas não entra nas contas do casal."];
    const gasto = S.lanc.filter((l) => l.forma === "cartao" && l.n === 1 && !l.terceiros && (l.cartao === "var" || l.cartao === "comp") && cycleIdx(l.data) === c.am).reduce((s, l) => s + l.total, 0);
    const resta = cfg().orcVar - gasto - c.total;
    return [a, resta >= 0 ? `Depois deste gasto, ainda dá para gastar ${brl(resta)} do orçamento variável de ${mes}.` : `Passa ${brl(-resta)} do orçamento variável de ${mes}.`];
  }
  return [`${c.n}x de ${brl(c.per)} · 1ª parcela em ${dueLabel(c.am, 0, diaVenc(f.card))} · última em ${dueLabel(c.am, c.n - 1, diaVenc(f.card))}.`,
    f.terc ? "De terceiros: as parcelas usam o limite, mas não entram nos gastos fixos." : `Soma ${brl(c.per)} por mês nos gastos fixos até ${dueLabel(c.am, c.n - 1, diaVenc(f.card)).replace(/^\d+\//, "")}.`];
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
        `<button class="card${f.card === k.id ? " on" : ""}" data-act="card" data-v="${k.id}" aria-pressed="${f.card === k.id}"><i style="background:${cardInfo(k).color}"></i><span><b>${k.name}</b><small>${k.sub}</small></span></button>`).join("");
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

// ---------- novas abas: cálculos ----------
const MIDX = (iso) => { const [y, m] = parts(iso); return y * 12 + m - 1; };
const mLabel = (M) => MESES[M % 12][0].toUpperCase() + MESES[M % 12].slice(1) + " " + Math.floor(M / 12);
const dim = (M) => new Date(Math.floor(M / 12), (M % 12) + 1, 0).getDate();
const isoOf = (M, d) => Math.floor(M / 12) + "-" + pad((M % 12) + 1) + "-" + pad(d);
const rnd = (v) => Math.round(v * 100) / 100;
S.mes = MIDX(todayISO());
S.fixKeep = true; S.cfgEdit = false; S.cfgDraft = {};
const COR_NOMES = [["#14465F", "Azul petróleo"], ["#0B1F3A", "Azul marinho"], ["#3A2E5C", "Roxo"], ["#0B6B50", "Verde"], ["#A3261B", "Vinho"], ["#8A5A00", "Dourado"], ["#1B3A63", "Azul"], ["#2B2B2B", "Grafite"]];
function cardInfo(k, src) {
  const C = src || cfg();
  return { color: C["cor_" + k.id] || k.color, fim: C["fim_" + k.id] || "", dia: Number(C["dia_" + k.id]) || 10, lim: C["lim_" + k.id] };
}
const diaVenc = (cid) => cardInfo(CARDS.find((k) => k.id === cid)).dia;
function fixoEf(f, M) {
  if (f.inicio != null && M < f.inicio) return null;
  if (f.fim != null && M > f.fim) return null;
  let r = { desc: f.desc, valor: f.valor || 0, dia: f.dia || 1 };
  const h = f.hist || {};
  Object.keys(h).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach((k) => { if (Number(k.slice(1)) <= M) r = { ...r, ...h[k] }; });
  const u = (f.uni || {})["m" + M]; if (u) r = { ...r, ...u };
  return { id: f.id, ...r };
}
const fixosDe = (M) => S.fixos.map((f) => fixoEf(f, M)).filter(Boolean).sort((a, b) => a.dia - b.dia);
function cardArt(k, I) {
  return `<div class="ccard" style="background-color:${I.color}"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">${k.name}</b><span class="cchip" aria-hidden="true"></span></div><div style="font-size:20px;letter-spacing:2px;font-variant-numeric:tabular-nums">•••• •••• •••• ${esc(I.fim || "0000")}</div><div style="display:flex;justify-content:space-between;font-size:13px"><span>${k.sub}</span><span>Paga dia ${I.dia}</span></div></div>`;
}
function cfg() {
  return { orcVar: 1000, limiteMes: 6000, lim_parc: 6000, lim_var: 6000, lim_comp: 6000, ...S.cfg };
}
const contaNome = (c) => (c === "marido" ? "do marido" : "da esposa");
function itensCartao(cid, M) {
  const out = [];
  for (const l of S.lanc) {
    if (l.forma !== "cartao" || l.cartao !== cid) continue;
    const a = cycleIdx(l.data), n = l.n || 1, k = M - a;
    if (k >= 0 && k < n) out.push({ l, k, n, valor: n > 1 ? l.parcela : l.total });
  }
  return out;
}
function faturaDe(cid, M) {
  const it = itensCartao(cid, M); let tot = 0, nos = 0;
  it.forEach((x) => { tot += x.valor; if (!x.l.terceiros) nos += x.valor; });
  return { it, tot: rnd(tot), nos: rnd(nos), ter: rnd(tot - nos) };
}
function usoCartao(cid) {
  let nos = 0, ter = 0;
  S.lanc.forEach((l) => {
    if (l.forma !== "cartao" || l.cartao !== cid) return;
    const a = cycleIdx(l.data), n = l.n || 1, v = n > 1 ? l.parcela : l.total;
    for (let k = 0; k < n; k++) if (!S.pagos["fatura_" + cid + "_" + (a + k)]) { if (l.terceiros) ter += v; else nos += v; }
  });
  return { nos: rnd(nos), ter: rnd(ter), tot: rnd(nos + ter) };
}
const fixoPago = (f, M) => S.pagos["fixo_" + f.id + "_" + M];
function parcelasNossas(M) {
  let s = 0;
  ["parc", "comp"].forEach((c) => itensCartao(c, M).forEach((x) => { if (x.n > 1 && !x.l.terceiros) s += x.valor; }));
  return rnd(s);
}
function mesCalc(M) {
  const C = cfg();
  const FX = fixosDe(M), fx = FX.reduce((s, f) => s + (f.valor || 0), 0);
  const fxPago = FX.filter((f) => fixoPago(f, M)).reduce((s, f) => s + (f.valor || 0), 0);
  const parc = parcelasNossas(M);
  let varG = 0;
  ["var", "comp"].forEach((c) => itensCartao(c, M).forEach((x) => { if (x.n === 1 && !x.l.terceiros) varG += x.valor; }));
  const pix = S.lanc.filter((l) => l.tipo === "despesa" && l.forma === "pix" && MIDX(l.data) === M).reduce((s, l) => s + l.total, 0);
  const rec = S.lanc.filter((l) => l.tipo === "receita" && MIDX(l.data) === M).reduce((s, l) => s + l.total, 0);
  varG = rnd(varG);
  const gasto = rnd(varG + fxPago + pix), aPagar = rnd(fx - fxPago + parc), reservado = Math.max(0, rnd(C.orcVar - varG));
  return { fx: rnd(fx), fxPago: rnd(fxPago), parc, varG, pix: rnd(pix), rec: rnd(rec), gasto, aPagar, reservado, orc: C.orcVar, limite: C.limiteMes, sobra: rnd(C.limiteMes - gasto - aPagar - reservado) };
}
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
const bar = (a, b) => { const p = b > 0 ? (a / b) * 100 : 0; return `<div class="bar" role="img" aria-label="${Math.round(p)}%"><i class="${p > 100 ? "r" : p > 85 ? "w" : ""}" style="width:${Math.min(100, p)}%"></i></div>`; };
const pill = (st) => `<span class="pill ${st}">${st === "p" ? "Pago" : st === "a" ? "Pendente" : "Atrasado"}</span>`;

function eventosMes(M) {
  const ev = [], T = todayISO();
  const stOf = (key, iso) => (S.pagos[key] ? "p" : iso < T ? "l" : "a");
  fixosDe(M).forEach((f) => {
    const day = Math.min(f.dia || 1, dim(M)), iso = isoOf(M, day), key = "fixo_" + f.id + "_" + M;
    ev.push({ key, nome: f.desc || "Gasto fixo", sub: "Gasto fixo", valor: f.valor || 0, day, iso, st: stOf(key, iso) });
  });
  CARDS.forEach((k) => {
    const fa = faturaDe(k.id, M - 1);
    if (fa.nos <= 0) return;
    const key = "fatura_" + k.id + "_" + (M - 1), iso = isoOf(M, Math.min(diaVenc(k.id), dim(M)));
    ev.push({ key, nome: "Fatura · " + k.name, sub: "Vence dia " + diaVenc(k.id) + (fa.ter ? " · terceiros " + brl(fa.ter) + " fora" : ""), valor: fa.nos, day: Math.min(diaVenc(k.id), dim(M)), iso, st: stOf(key, iso) });
  });
  return ev.sort((a, b) => a.day - b.day);
}
function payBlock(key, valor) {
  const p = S.pagos[key];
  if (p) return `<div class="step" style="margin-top:6px"><span class="pill p">Pago em ${esc(dateShort(p.em))} · conta ${contaNome(p.conta)}</span><button class="link del" data-act="unpay" data-v="${key}">Desfazer</button></div>`;
  if (valor <= 0) return "";
  if (S.payAsk === key) return `<div class="conf" role="group"><span>De qual conta saiu ${brl(valor)}?</span><div class="grid2"><button class="opt" data-act="payDo" data-v="${key}|marido|${valor}">Conta do marido</button><button class="opt" data-act="payDo" data-v="${key}|esposa|${valor}">Conta da esposa</button></div><button class="link" data-act="payNo">Cancelar</button></div>`;
  return `<button class="opt" style="margin-top:6px" data-act="payAsk" data-v="${key}">Marcar como pago</button>`;
}
const mnav = () => "";
const confDel = (id, what, act) => `<div class="conf" role="group"><span>Excluir <strong>${esc(what)}</strong>?</span><div class="grid2"><button class="opt" data-act="delNo">Cancelar</button><button class="opt on" style="background:#A3261B;border-color:#A3261B" data-act="${act}" data-v="${id}">Excluir</button></div></div>`;

// ---------- Gastos fixos ----------
function fixosView() {
  const M = S.mes, c = mesCalc(M), tot = c.fx + c.parc, FX = fixosDe(M);
  let h = `<section class="dark"><div style="font-size:13px;color:#C9D6E8">Total de gastos fixos por mês</div><div style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums">${brl(tot)}</div>
    <div class="kv" style="margin-top:10px"><span>Fixos</span><b>${brl(c.fx)} · ${pct(c.fx, tot)}%</b></div><div class="kv"><span>Parcelados</span><b>${brl(c.parc)} · ${pct(c.parc, tot)}%</b></div></section>`;
  h += `<section class="sec"><div class="step"><h2 style="font-size:15px">Fixos</h2><b style="font-variant-numeric:tabular-nums">${brl(c.fx)}</b></div>`;
  if (!FX.length) h += `<p class="sub">Nenhum gasto fixo neste mês. Toque em "Editar gastos fixos" para adicionar.</p>`;
  if (S.editFix) h += `<label class="chk"><input type="checkbox" id="fixKeep" ${S.fixKeep ? "checked" : ""}><span>Manter esta edição nos meses seguintes</span></label><p class="sub">${S.fixKeep ? "A mudança vale de " + mLabel(M) + " em diante." : "A mudança vale só em " + mLabel(M) + ". Os outros meses continuam com os valores anteriores."}</p>`;
  FX.forEach((f) => {
    if (S.editFix) {
      if (S.confirmId === f.id) { h += confDel(f.id, f.desc, "fixDel"); return; }
      h += `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:10px"><div style="display:grid;grid-template-columns:minmax(0,1fr) 110px 44px;gap:6px;align-items:center"><input class="in" style="height:48px;font-size:15px" id="fx-${f.id}-d" data-fx="desc" data-id="${f.id}" value="${esc(f.desc)}" aria-label="Descrição"><input class="in" style="height:48px;font-size:15px" id="fx-${f.id}-v" inputmode="decimal" data-fx="valor" data-id="${f.id}" value="${fmtNum(f.valor || 0)}" aria-label="Valor"><button class="link del" style="padding:0" data-act="delAsk" data-v="${f.id}" aria-label="Excluir ${esc(f.desc)}">✕</button></div>
        <div style="display:flex;align-items:center;gap:8px"><label class="lbl" for="fx-${f.id}-n">Vence todo dia</label><input class="in" style="height:44px;width:72px;font-size:15px;text-align:center;padding:0 4px" id="fx-${f.id}-n" inputmode="numeric" data-fx="dia" data-id="${f.id}" value="${f.dia || 1}"></div></div>`;
    } else h += `<div class="item"><div><b>${esc(f.desc || "Gasto fixo")}</b><small>Todo dia ${f.dia || 1}</small></div><div style="text-align:right"><b style="font-variant-numeric:tabular-nums">${brl(f.valor || 0)}</b><div>${pill(fixoPago(f, M) ? "p" : "a")}</div></div></div>`;
  });
  if (S.editFix) h += `<button class="opt" data-act="fixAdd">+ Adicionar gasto fixo</button>`;
  h += `<button class="opt" data-act="fixEdit" style="${S.editFix ? "background:var(--navy);color:#fff" : ""}">${S.editFix ? "Concluir edição" : "Editar gastos fixos"}</button></section>`;
  const ps = [];
  ["parc", "comp"].forEach((cid) => itensCartao(cid, M).forEach((x) => { if (x.n > 1) ps.push({ ...x, cid }); }));
  h += `<section class="sec"><div class="step"><h2 style="font-size:15px">Parcelados no cartão</h2><b style="font-variant-numeric:tabular-nums">${brl(c.parc)}</b></div>`;
  h += ps.length ? ps.map((x) => `<div class="item"><div><b>${esc(x.l.descricao || x.l.categoria)}</b><small>Parcela ${x.k + 1} de ${x.n} · ${CARDS.find((k) => k.id === x.cid).name}${x.l.terceiros ? " · terceiros (fora do total)" : ""}</small></div><b style="font-variant-numeric:tabular-nums">${brl(x.valor)}</b></div>`).join("") : '<p class="sub">Nenhuma parcela neste mês.</p>';
  h += `<button class="opt" data-act="go" data-v="cartoes">Ver nos cartões</button></section>`;
  return h;
}

// ---------- Cartões ----------
function cartaoSection(k) {
  const M = S.mes, C = cfg(), I = cardInfo(k), lim = C["lim_" + k.id], uso = usoCartao(k.id), fa = faturaDe(k.id, M);
  let h = `<section class="sec" style="gap:12px">${cardArt(k, I)}`;
  if (k.id === "var") {
    const g = fa.it.filter((x) => !x.l.terceiros).reduce((s, x) => s + x.valor, 0);
    h += `<div class="kv"><span>Gasto no mês</span><b>${brl(g)} de ${brl(C.orcVar)}</b></div>${bar(g, C.orcVar)}<p class="sub">${g <= C.orcVar ? "Ainda dá para gastar " + brl(C.orcVar - g) : "Passou " + brl(g - C.orcVar) + " do orçamento"}</p>`;
  } else if (k.id === "parc") h += `<div class="kv"><span>Parcelas do mês</span><b>${brl(fa.nos)}</b></div>`;
  else h += `<div class="kv"><span>Nosso nesta fatura</span><b>${brl(fa.nos)}</b></div><p class="sub">Fatura total ${brl(fa.tot)} · de terceiros ${brl(fa.ter)}</p>`;
  h += `<div class="kv"><span>Limite em uso</span><b>${brl(uso.tot)} / ${brl(lim)}</b></div>${bar(uso.tot, lim)}<p class="sub">Disponível ${brl(Math.max(0, lim - uso.tot))} · nossa parte ${brl(uso.nos)} · terceiros ${brl(uso.ter)}</p>`;
  h += `<div class="step"><b style="font-size:14px">Fatura de ${MESES[M % 12]}</b><span class="sub">vence ${dueLabel(M, 0, I.dia)}</span></div>${fa.nos > 0 ? payBlock("fatura_" + k.id + "_" + M, fa.nos) : '<p class="sub">Sem valores nesta fatura.</p>'}`;
  h += `<div class="step" style="margin-top:6px"><h2 style="font-size:14px">Lançamentos desta fatura</h2><b>${brl(fa.tot)}</b></div>`;
  if (!fa.it.length) h += `<p class="sub">Nada lançado neste cartão neste mês.</p>`;
  fa.it.forEach((x) => {
    const l = x.l, nome = l.descricao || l.categoria;
    h += `<div class="item"><div><b>${esc(nome)}</b><small>${esc(dateShort(l.data))}${x.n > 1 ? " · parcela " + (x.k + 1) + "/" + x.n + " (total " + brl(l.total) + ")" : ""}${l.terceiros ? " · de terceiros" : " · nosso"}</small></div><b style="font-variant-numeric:tabular-nums">${brl(x.valor)}</b></div>`;
  });
  return h + `</section>`;
}
function cartoesView() { return CARDS.map(cartaoSection).join(""); }

// ---------- Agenda ----------
function agendaView() {
  const M = S.mes, ev = eventosMes(M), T = todayISO();
  const sel = S.selDay || (MIDX(T) === M ? Number(T.slice(8)) : 1);
  const tot = (st) => brl(ev.filter((e) => e.st === st).reduce((s, e) => s + e.valor, 0));
  const first = new Date(Math.floor(M / 12), M % 12, 1).getDay();
  let h = mnav();
  h += `<section class="sec"><div class="grid2"><div><div class="sub">Pago</div><b style="color:var(--green)">${tot("p")}</b></div><div><div class="sub">Pendente</div><b style="color:#8A5A00">${tot("a")}</b></div></div><div><div class="sub">Atrasado</div><b style="color:var(--red)">${tot("l")}</b></div></section>`;
  let cells = "";
  for (let i = 0; i < first; i++) cells += "<span></span>";
  for (let d = 1; d <= dim(M); d++) {
    const es = ev.filter((e) => e.day === d);
    const dots = es.slice(0, 3).map((e) => `<i class="${e.st === "p" ? "g" : e.st === "l" ? "r" : "y"}"></i>`).join("");
    cells += `<button class="${d === sel ? "on" : ""}" data-act="selDay" data-v="${d}" aria-label="Dia ${d}${es.length ? ", " + es.length + " vencimento(s)" : ""}" aria-pressed="${d === sel}"><span>${d}</span><span class="dots">${dots}</span></button>`;
  }
  h += `<section class="sec"><div class="ag">${["D", "S", "T", "Q", "Q", "S", "S"].map((x) => `<span class="h">${x}</span>`).join("")}${cells}</div>
    <div class="sub">● verde pago · ● amarelo pendente · ● vermelho atrasado</div></section>`;
  const es = ev.filter((e) => e.day === sel);
  h += `<section class="sec"><h2>Dia ${sel} de ${MESES[M % 12]}</h2>${es.length ? es.map((e) => `<div class="item" style="grid-template-columns:1fr"><div style="display:flex;justify-content:space-between;gap:8px"><div><b>${esc(e.nome)}</b><small>${esc(e.sub)}</small></div><b style="font-variant-numeric:tabular-nums">${brl(e.valor)}</b></div>${payBlock(e.key, e.valor)}</div>`).join("") : '<p class="sub">Nenhum vencimento neste dia.</p>'}</section>`;
  h += `<section class="sec"><h2>Todos os vencimentos do mês</h2>${ev.length ? ev.map((e) => `<div class="item"><div><b>${esc(e.nome)}</b><small>Dia ${e.day} · ${esc(e.sub)}</small></div><div style="text-align:right"><b style="font-variant-numeric:tabular-nums">${brl(e.valor)}</b><div>${pill(e.st)}</div></div></div>`).join("") : '<p class="sub">Nada neste mês.</p>'}<p class="sub">Compras variáveis ficam em Cartões. Aqui entram contas fixas e faturas.</p></section>`;
  return h;
}

// ---------- Previsão ----------
let SIM = { items: [], varVal: null, f: { nome: "", valor: "", kind: "parc", n: 3, start: 0 } };
try { const r = JSON.parse(localStorage.getItem("sim1") || "null"); if (r) SIM = { ...SIM, items: r.items || [], varVal: r.varVal }; } catch (e) {}
const saveSim = () => { try { localStorage.setItem("sim1", JSON.stringify({ items: SIM.items, varVal: SIM.varVal })); } catch (e) {} };
function simMeses() {
  const base = MIDX(todayISO()), C = cfg(), vv = SIM.varVal == null ? C.orcVar : SIM.varVal, out = [];
  for (let i = 0; i < 6; i++) {
    const M = base + i, comp = rnd(fixosDe(M).reduce((s, f) => s + (f.valor || 0), 0) + parcelasNossas(M));
    let sim = 0, ent = 0;
    SIM.items.forEach((x) => {
      if (x.kind === "parc") { const k = i - x.start; if (k >= 0 && k < x.n) sim += x.valor / x.n; }
      else if (x.kind === "vista") { if (i === x.start) sim += x.valor; }
      else if (i === x.start) ent += x.valor;
    });
    sim = rnd(sim);
    out.push({ M, comp, vv, sim, ent, limite: C.limiteMes + ent, sobra: rnd(C.limiteMes + ent - comp - vv - sim), sobra0: rnd(C.limiteMes - comp - C.orcVar) });
  }
  return out;
}
function previsaoView() {
  const C = cfg(), ms = simMeses(), f = SIM.f, v = parse(f.valor), vv = SIM.varVal == null ? C.orcVar : SIM.varVal;
  const pior = ms.reduce((a, b) => (b.sobra < a.sobra ? b : a), ms[0]);
  let h = `<section class="sec" style="background:#EEF3F9;border:0"><h2>Simulação · fora das contas do mês</h2><p class="sub">Nada aqui entra nas contas. Serve para testar cenários. Parcelas caem na fatura que vence dia 10.</p></section>`;
  h += `<section class="sec"><h2>Como ficam os próximos meses</h2><p class="prev" style="background:none;padding:0">${pior.sobra < 0 ? `Em ${mLabel(pior.M)} passa ${brl(-pior.sobra)} do limite de ${brl(C.limiteMes + pior.ent)}.` : `Nos próximos 6 meses o menor saldo é ${brl(pior.sobra)}, em ${mLabel(pior.M)}.`}</p>`;
  ms.forEach((m) => {
    const used = m.comp + m.vv + m.sim;
    h += `<div style="display:flex;flex-direction:column;gap:4px"><div class="kv"><b>${mLabel(m.M)}</b><span style="color:${m.sobra < 0 ? "var(--red)" : "var(--green)"};font-weight:600">${m.sobra < 0 ? "Passa " + brl(-m.sobra) : "Sobra " + brl(m.sobra)}</span></div>${bar(used, m.limite)}<small class="sub">Comprometido ${brl(m.comp)} · Variável ${brl(m.vv)} · Simulação ${brl(m.sim)} · Limite ${brl(m.limite)}${m.sobra !== m.sobra0 ? " · sem simulação: " + brl(m.sobra0) : ""}</small></div>`;
  });
  h += `</section><section class="sec"><h2>Gasto variável por mês</h2><p class="sub">Veja o que muda se vocês gastarem menos ou mais no cartão dos variáveis.</p><div class="kv"><span>Valor testado</span><b>${brl(vv)}</b></div><div class="wrap">${[-200, -100, 100, 200].map((q) => `<button class="chip q" data-act="simVar" data-v="${q}">${q > 0 ? "+" : "−"} ${Math.abs(q)}</button>`).join("")}</div><button class="opt" data-act="simVarReset">Voltar ao orçamento atual (${brl(C.orcVar)})</button></section>`;
  const kinds = [["parc", "Compra parcelada"], ["vista", "Compra à vista"], ["ent", "Entrada extra"]];
  h += `<section class="sec"><h2>Nova simulação</h2><div style="display:flex;flex-direction:column;gap:6px"><label class="lbl" for="sim-nome">O que é? (opcional)</label><input class="in" id="sim-nome" style="height:48px;font-size:15px" value="${esc(f.nome)}"></div>
    <div class="grid2" style="grid-template-columns:1fr">${kinds.map(([id, l]) => opt("simKind", `data-v="${id}"`, l, f.kind === id)).join("")}</div>
    <div style="display:flex;flex-direction:column;gap:6px"><label class="lbl" for="sim-valor">${f.kind === "parc" ? "Valor total" : "Valor"}</label><input class="in big" id="sim-valor" inputmode="decimal" placeholder="0,00" value="${esc(f.valor)}"></div>`;
  if (f.kind === "parc") h += `<div class="step"><span class="lbl">Parcelas</span><div class="step"><button data-act="simN" data-v="-1" aria-label="Menos">−</button><b style="min-width:48px;text-align:center;font-size:18px">${f.n}x</b><button data-act="simN" data-v="1" aria-label="Mais">+</button></div></div>`;
  h += `<h2 style="margin-top:4px">${f.kind === "parc" ? "Primeira parcela em" : "Mês"}</h2><div class="wrap">${ms.map((m, i) => `<button class="chip${f.start === i ? " on" : ""}" data-act="simStart" data-v="${i}" aria-pressed="${f.start === i}">${ABR[m.M % 12]}</button>`).join("")}</div>
    <p class="prev" style="background:#EEF3F9">${v > 0 ? (f.kind === "parc" ? `${f.n}x de ${brl(v / f.n)} a partir de ${mLabel(ms[f.start].M)}.` : f.kind === "vista" ? `${brl(v)} em ${mLabel(ms[f.start].M)}.` : `Entrada de ${brl(v)} em ${mLabel(ms[f.start].M)}, soma ao limite.`) : "Digite o valor para ver o impacto."}</p>
    <button class="main" data-act="simAdd" ${v > 0 ? "" : "disabled"}>Adicionar à simulação</button></section>`;
  h += `<section class="sec"><h2>Simulações</h2>${SIM.items.length ? SIM.items.map((x, i) => S.confirmId === "sim" + i ? confDel("sim" + i, x.nome, "simDel") : `<div class="item"><div><b>${esc(x.nome)}</b><small>${x.kind === "parc" ? x.n + "x de " + brl(x.valor / x.n) : x.kind === "vista" ? "À vista " + brl(x.valor) : "Entrada " + brl(x.valor)} · ${mLabel(ms[x.start].M)}</small></div><button class="link del" data-act="delAsk" data-v="sim${i}">Excluir</button></div>`).join("") : '<p class="sub">Nenhuma simulação ainda.</p>'}<button class="opt" data-act="go" data-v="lancar">Decidiu comprar? Lance como despesa real</button></section>`;
  return h;
}

// ---------- Resumo ----------
function resumoView() {
  const M = S.mes, c = mesCalc(M), T = todayISO(), C = cfg(), atual = M === MIDX(T);
  const usado = c.gasto + c.aPagar;
  let h = `<section class="sec"><h2>Atalhos</h2><div class="shorts">${Object.entries(TITLES).filter(([id]) => id !== "resumo").map(([id, t]) => `<button class="sc" data-act="go" data-v="${id}"><span>${svg(id)}</span><small>${t}</small></button>`).join("")}</div></section>`;
  h += `<section class="dark" style="display:flex;flex-direction:column;gap:14px"><div style="font-size:13px;color:#A9B8CF">Gastos do mês · ${mLabel(M)}</div>
    <div><div style="font-size:13px;color:#A9B8CF">Limite do mês</div><div style="font-size:30px;font-weight:700;font-variant-numeric:tabular-nums">${brl(c.limite)}</div></div>
    <div><div class="kv" style="color:#A9B8CF"><span>Já comprometido</span><b style="color:#fff">${pct(usado, c.limite)}%</b></div><div class="bar" style="margin-top:6px;background:#27456B"><i style="width:${Math.min(100, (usado / (c.limite || 1)) * 100)}%;background:${usado > c.limite ? "#E5645A" : "#4ADE9A"}"></i></div></div>
    <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><div style="font-size:12px;color:#A9B8CF">Gasto</div><b style="font-size:15px">${brl(c.gasto)}</b></div><div><div style="font-size:12px;color:#A9B8CF">A pagar</div><b style="font-size:15px">${brl(c.aPagar)}</b></div><div><div style="font-size:12px;color:#A9B8CF">Sobra prevista</div><b style="font-size:15px;color:${c.sobra < 0 ? "#FF9A92" : "#4ADE9A"}">${brl(c.sobra)}</b></div></div></section>`;
  let ritmo = "";
  if (atual) { const dia = Number(T.slice(8)), esp = rnd((c.orc * dia) / dim(M)), d = rnd(c.varG - esp); ritmo = `<p class="sub">Até o dia ${dia} o ritmo seria ${brl(esp)}. ${d > 0 ? "Vocês estão " + brl(d) + " acima." : d < 0 ? "Vocês estão " + brl(-d) + " abaixo." : "Vocês estão no ritmo."}</p>`; }
  h += `<section class="sec"><h2>Gastos variáveis</h2><div class="kv"><span>Utilizado / limite</span><b>${brl(c.varG)} / ${brl(c.orc)}</b></div>${bar(c.varG, c.orc)}<div class="kv"><span>${c.varG <= c.orc ? "Pode gastar" : "Passou"}</span><b style="color:${c.varG <= c.orc ? "var(--green)" : "var(--red)"}">${brl(Math.abs(c.orc - c.varG))}</b></div>${ritmo}</section>`;
  const fat = CARDS.map((k) => faturaDe(k.id, M));
  h += `<section class="sec"><div class="step"><h2>Cartões</h2><button class="link" data-act="go" data-v="cartoes">Ver cartões</button></div>${CARDS.map((k, i) => { const I = cardInfo(k), u = usoCartao(k.id); return `<div style="display:flex;flex-direction:column;gap:6px"><div class="kv"><span style="display:flex;align-items:center;gap:8px"><i style="width:14px;height:14px;border-radius:4px;background:${I.color};display:inline-block"></i>${k.name}</span><b>${brl(u.tot)} / ${brl(I.lim)}</b></div>${bar(u.tot, I.lim)}<small class="sub">Fatura de ${MESES[M % 12]}: ${brl(fat[i].nos)} · vence ${dueLabel(M, 0, I.dia)}</small></div>`; }).join("")}</section>`;
  const dest = S.sobraDest || "guardar", txt = { guardar: "guardar na conta", proximo: "deixar para o mês seguinte", investir: "investir ou poupar" };
  h += `<section class="sec"><h2>O que fazer com a sobra?</h2><div class="wrap">${Object.entries({ guardar: "Guardar", proximo: "Mês seguinte", investir: "Investir" }).map(([id, l]) => `<button class="chip${dest === id ? " on" : ""}" data-act="dest" data-v="${id}" aria-pressed="${dest === id}">${l}</button>`).join("")}</div><p class="prev">${c.sobra > 0 ? `Se tudo for pago como previsto e o variável for usado por inteiro, sobram ${brl(c.sobra)} em ${MESES[M % 12]}. Plano: ${txt[dest]}.` : `Com o previsto, não sobra nada em ${MESES[M % 12]}.`}</p></section>`;
  h += `<section class="sec"><h2>Projeção financeira</h2>${[1, 2, 3, 4].map((i) => { const m = M + i, v = rnd(fixosDe(m).reduce((s, f) => s + (f.valor || 0), 0) + parcelasNossas(m)); return `<div><div class="kv"><span>${mLabel(m)}</span><b>${brl(v)} / ${brl(C.limiteMes)}</b></div>${bar(v, C.limiteMes)}</div>`; }).join("")}</section>`;
  const b = MIDX(T), all = [...eventosMes(b), ...eventosMes(b + 1)], lim7 = new Date(); lim7.setDate(lim7.getDate() + 7);
  const lim7iso = lim7.getFullYear() + "-" + pad(lim7.getMonth() + 1) + "-" + pad(lim7.getDate());
  const hoje = all.filter((e) => e.iso === T), prox = all.filter((e) => e.iso > T && e.iso <= lim7iso && e.st !== "p");
  const row = (e) => `<div class="item"><div><b>${esc(e.nome)}</b><small>${esc(dateShort(e.iso))}</small></div><div style="text-align:right"><b style="font-variant-numeric:tabular-nums">${brl(e.valor)}</b><div>${pill(e.st)}</div></div></div>`;
  h += `<section class="sec"><div class="step"><h2>Agenda</h2><button class="link" data-act="go" data-v="agenda">Ver agenda</button></div><b style="font-size:14px">Hoje</b>${hoje.length ? hoje.map(row).join("") : '<p class="sub">Nenhum vencimento hoje.</p>'}<b style="font-size:14px;margin-top:6px">Próximos 7 dias</b>${prox.length ? prox.map(row).join("") : '<p class="sub">Nenhum vencimento nos próximos 7 dias.</p>'}</section>`;
  return h;
}

// ---------- Gastos variáveis ----------
const catRows = (map) => { const arr = Object.entries(map).sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...arr.map((x) => x[1])); return arr.length ? arr.map(([k, v]) => `<div><div class="kv"><span>${esc(k)}</span><b>${brl(v)}</b></div><div class="bar"><i style="width:${(v / mx) * 100}%"></i></div></div>`).join("") : '<p class="sub">Nada lançado neste mês.</p>'; };
function variaveisView() {
  const M = S.mes, c = mesCalc(M);
  const its = [...itensCartao("var", M), ...itensCartao("comp", M)].filter((x) => x.n === 1).sort((a, b) => (a.l.data < b.l.data ? 1 : -1));
  const pix = S.lanc.filter((l) => l.tipo === "despesa" && l.forma === "pix" && MIDX(l.data) === M);
  let h = `<section class="dark"><div style="font-size:13px;color:#C9D6E8">Gastos variáveis do mês</div><div style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums">${brl(c.varG)}</div><div style="font-size:13px;color:#C9D6E8;margin:4px 0 10px">Utilizado / limite: ${brl(c.varG)} / ${brl(c.orc)}</div><div class="bar" style="background:#27456B"><i style="width:${Math.min(100, (c.varG / (c.orc || 1)) * 100)}%;background:${c.varG > c.orc ? "#E5645A" : "#4ADE9A"}"></i></div><div style="font-size:13px;color:#C9D6E8;margin-top:8px">${c.varG <= c.orc ? "Pode gastar " + brl(c.orc - c.varG) : "Passou " + brl(c.varG - c.orc)}</div></section>`;
  h += `<section class="sec"><div class="step"><h2>Compras à vista no cartão</h2><b>${its.length}</b></div>${its.length ? its.map((x) => `<div class="item"><div><b>${esc(x.l.descricao || x.l.categoria)}</b><small>${esc(dateShort(x.l.data))} · ${CARDS.find((k) => k.id === x.l.cartao).name}${x.l.terceiros ? " · de terceiros (fora do orçamento)" : ""}</small></div><b style="font-variant-numeric:tabular-nums">${brl(x.valor)}</b></div>`).join("") : '<p class="sub">Nenhuma compra à vista neste mês.</p>'}</section>`;
  h += `<section class="sec"><div class="step"><h2>Pix do mês</h2><b>${brl(c.pix)}</b></div>${pix.length ? pix.map((l) => itemHTML(l, false)).join("") : '<p class="sub">Nenhum Pix neste mês.</p>'}</section>`;
  return h;
}

// ---------- Gráficos ----------
function graficosView() {
  const M = S.mes, C = cfg(), rows = [];
  for (let i = -3; i <= 2; i++) { const m = M + i, c = mesCalc(m); rows.push({ m, comp: rnd(c.fx + c.parc), v: rnd(c.varG + c.pix), rec: c.rec }); }
  const mx = Math.max(C.limiteMes, ...rows.map((r) => r.comp + r.v), ...rows.map((r) => r.rec), 1), w = (v) => (v / mx) * 100;
  let h = `<section class="sec"><h2>Gastos por mês</h2><p class="sub">Escuro: fixos e parcelas · verde: variáveis e Pix · traço: limite de ${brl(C.limiteMes)}</p>`;
  rows.forEach((r) => { h += `<div><div class="kv"><span${r.m === M ? ' style="font-weight:700"' : ""}>${mLabel(r.m)}</span><b>${brl(r.comp + r.v)}</b></div><div class="bar" style="height:16px;position:relative;overflow:visible"><div style="display:flex;height:100%;border-radius:5px;overflow:hidden"><i style="width:${w(r.comp)}%;background:#0B1F3A"></i><i style="width:${w(r.v)}%;background:#0B7A5C"></i></div><span style="position:absolute;left:${w(C.limiteMes)}%;top:-3px;bottom:-3px;border-left:2px dashed #A3261B"></span></div><small class="sub">Fixos e parcelas ${brl(r.comp)} · variáveis e Pix ${brl(r.v)}</small></div>`; });
  h += `</section><section class="sec"><h2>Entradas e saídas</h2><p class="sub">Verde: entradas lançadas · escuro: saídas</p>`;
  rows.forEach((r) => { h += `<div><div class="kv"><span${r.m === M ? ' style="font-weight:700"' : ""}>${mLabel(r.m)}</span><b>${brl(r.rec - r.comp - r.v)}</b></div><div class="bar" style="height:8px;margin-bottom:3px"><i style="width:${w(r.rec)}%"></i></div><div class="bar" style="height:8px"><i style="width:${w(r.comp + r.v)}%;background:#0B1F3A"></i></div><small class="sub">Entradas ${brl(r.rec)} · saídas ${brl(r.comp + r.v)} · saldo do mês na coluna da direita</small></div>`; });
  const cats = {};
  S.lanc.forEach((l) => { if (l.tipo !== "despesa") return; if (l.forma === "pix") { if (MIDX(l.data) === M) cats[l.categoria] = (cats[l.categoria] || 0) + l.total; } });
  ["var", "comp", "parc"].forEach((cid) => itensCartao(cid, M).forEach((x) => { if (!x.l.terceiros) cats[x.l.categoria] = (cats[x.l.categoria] || 0) + x.valor; }));
  h += `</section><section class="sec"><h2>Gastos por categoria em ${MESES[M % 12]}</h2>${catRows(cats)}</section>`;
  return h;
}

// ---------- Configurações ----------
const CFG_NUM = ["limiteMes", "orcVar", "lim_parc", "lim_var", "lim_comp"];
function configView() {
  const C = cfg(), ed = S.cfgEdit, D = S.cfgDraft;
  const val = (key) => (ed ? D[key] : fmtNum(C[key]));
  const campo = (key, label) => ed ? `<div style="display:flex;flex-direction:column;gap:4px"><label class="lbl" for="cd-${key}">${label}</label><input class="in" style="height:48px" id="cd-${key}" inputmode="decimal" data-cd="${key}" value="${esc(D[key])}"></div>` : `<div class="kv"><span>${label}</span><b>${brl(C[key])}</b></div>`;
  let h = `<section class="sec"><h2>Valores do app</h2>${ed ? '<p class="sub">Altere o que precisar e toque em Salvar. Vale para os dois celulares.</p>' : ""}${campo("limiteMes", "Limite total de gastos do mês")}${campo("orcVar", "Orçamento dos gastos variáveis (por mês)")}${campo("lim_parc", "Limite do cartão de gastos fixos")}${campo("lim_var", "Limite do cartão de gastos variáveis")}${campo("lim_comp", "Limite do cartão compartilhado")}</section>`;
  CARDS.forEach((k) => {
    const src = ed ? { ...C, ["cor_" + k.id]: D["cor_" + k.id], ["fim_" + k.id]: D["fim_" + k.id], ["dia_" + k.id]: D["dia_" + k.id] } : C;
    h += `<section class="sec" style="gap:12px"><h2>${k.name}</h2>${cardArt(k, cardInfo(k, src))}`;
    if (ed) h += `<div class="lbl">Cor do cartão</div><div class="wrap">${COR_NOMES.map(([c, n]) => `<button data-act="cfgCor" data-v="${k.id}|${c}" aria-label="${n}" aria-pressed="${D["cor_" + k.id] === c}" style="width:44px;height:44px;border-radius:22px;background:${c};border:3px solid ${D["cor_" + k.id] === c ? "#4ADE9A" : "#fff"};box-shadow:0 0 0 1px #7C8EA8;cursor:pointer"></button>`).join("")}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div style="display:flex;flex-direction:column;gap:4px"><label class="lbl" for="cd-fim_${k.id}">Final do número</label><input class="in" style="height:48px" id="cd-fim_${k.id}" inputmode="numeric" maxlength="4" data-cd="fim_${k.id}" value="${esc(D["fim_" + k.id])}" placeholder="0000"></div><div style="display:flex;flex-direction:column;gap:4px"><label class="lbl" for="cd-dia_${k.id}">Dia de pagamento</label><input class="in" style="height:48px" id="cd-dia_${k.id}" inputmode="numeric" maxlength="2" data-cd="dia_${k.id}" value="${esc(D["dia_" + k.id])}"></div></div>`;
    h += `</section>`;
  });
  h += `<div style="margin:16px 20px 0;display:flex;flex-direction:column;gap:8px">${ed ? '<button class="main" data-act="cfgSave">Salvar</button><button class="opt" data-act="cfgCancel">Cancelar</button>' : '<button class="main" data-act="cfgEdit">Editar</button>'}</div>`;
  h += `<section class="sec"><h2>Backup</h2><p class="sub">Baixa um arquivo com todos os lançamentos, gastos fixos, pagamentos e valores. Guarde no Google Drive antes de cada atualização.</p><button class="opt" data-act="backup">Baixar backup</button></section>
  <section class="sec"><h2>Conta</h2><p class="sub">Entrou como ${esc(S.user.email)}</p><button class="opt" data-act="sair">Sair</button><p class="sub">Versão de teste 4</p></section>`;
  return h;
}
const ICONS = {
  resumo: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  lancar: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  fixos: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  variaveis: '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  cartoes: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  contas: '<path d="M3 7a2 2 0 0 1 2-2h14v4"/><path d="M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2z"/><circle cx="17" cy="14.5" r="1"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  previsao: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  graficos: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  configuracoes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const svg = (id) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
const TITLES = { resumo: "Resumo", lancar: "Lançar", fixos: "Gastos fixos", variaveis: "Gastos variáveis", cartoes: "Cartões", contas: "Contas", agenda: "Agenda", previsao: "Simulação", graficos: "Gráficos", configuracoes: "Configurações" };
const COM_MES = ["resumo", "fixos", "variaveis", "cartoes", "agenda", "graficos"];
const VIEWS = { resumo: resumoView, lancar: lancarView, fixos: fixosView, variaveis: variaveisView, cartoes: cartoesView, contas: contasView, agenda: agendaView, previsao: previsaoView, graficos: graficosView, configuracoes: configView };

function shell() {
  const titulo = TITLES[S.view] || "Lançar", hasM = COM_MES.includes(S.view);
  const sync = !S.online ? "Sem internet" : S.fromCache ? "Sincronizando..." : "Sincronizado";
  const atual = S.mes === MIDX(todayISO());
  let h = `<header class="top"><div class="trow"><button class="icon" data-act="menuOpen" aria-label="Abrir menu" aria-expanded="${S.menu}">${ICON_MENU}</button><div class="ttl"><h1>${titulo}</h1><span id="mchip" class="mchip"${hasM && S.compact ? "" : " hidden"}>${mLabel(S.mes)}</span></div><span class="sync" role="status">${sync}</span></div>`;
  if (hasM) h += `<div id="mpanel" class="mpanel"${S.compact ? " hidden" : ""}><div class="mgrid"><button class="icon" data-act="mes" data-v="-1" aria-label="Mês anterior"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><div style="text-align:center"><div aria-live="polite" style="font-size:16px;font-weight:700">${mLabel(S.mes)}</div><button class="hoje" data-act="mesHoje" ${atual ? 'disabled aria-label="Já está no mês atual"' : 'aria-label="Voltar para o mês atual"'}>${atual ? "Mês atual" : "Ir para o mês atual"}</button></div><button class="icon" data-act="mes" data-v="1" aria-label="Próximo mês"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button></div></div>`;
  h += `</header>` + (hasM ? '<div aria-hidden="true" class="spacer"></div>' : "");
  if (S.dataErr) h += `<p class="err" style="margin:12px 20px">Erro: ${esc(S.dataErr)}</p>`;
  h += (VIEWS[S.view] || lancarView)();
  if (S.menu) {
    h += `<div class="drawer"><nav aria-label="Menu de abas"><div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 12px 12px"><span style="font-size:16px;font-weight:700">Finanças do Casal</span><button data-act="menuClose" aria-label="Fechar menu" style="width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      ${Object.entries(TITLES).map(([id, t]) => `<a data-act="go" data-v="${id}" class="${S.view === id ? "on" : ""}">${svg(id)}<span>${t}</span></a>`).join("")}
      <div style="flex:1"></div><div style="padding:8px 12px;font-size:12px;color:#A9B8CF">${esc(S.user.email)}</div><a data-act="sair"><span>Sair</span></a></nav>
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
  go(d) { S.view = d.v; S.menu = false; S.confirmId = null; S.editConta = null; S.payAsk = null; S.editFix = false; S.cfgEdit = false; S.selDay = 0; scrollTo(0, 0); render(); },
  dest(d) { S.sobraDest = d.v; render(); },
  mesHoje() { S.mes = MIDX(todayISO()); S.selDay = 0; S.payAsk = null; S.confirmId = null; render(); },
  backup() {
    const dados = { geradoEm: new Date().toISOString(), lancamentos: S.lanc, fixos: S.fixos, pagos: S.pagos, config: S.cfg, saldos: S.base };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" }));
    a.download = "backup-financas-" + todayISO() + ".json"; document.body.appendChild(a); a.click(); a.remove();
  },
  mes(d) { S.mes += Number(d.v); S.selDay = 0; S.payAsk = null; S.confirmId = null; render(); },
  selDay(d) { S.selDay = Number(d.v); S.payAsk = null; render(); },
  payAsk(d) { S.payAsk = d.v; render(); }, payNo() { S.payAsk = null; render(); },
  payDo(d) { const [key, conta, valor] = d.v.split("|"); setDoc(doc(db, "pagos", key), { tipo: key.split("_")[0], conta, valor: Number(valor), em: todayISO(), por: S.user.email }).catch(errH); S.payAsk = null; render(); },
  unpay(d) { deleteDoc(doc(db, "pagos", d.v)).catch(errH); },
  fixEdit() { S.editFix = !S.editFix; S.confirmId = null; render(); },
  fixAdd() { addDoc(collection(db, "fixos"), { desc: "Novo gasto fixo", valor: 0, dia: 10, inicio: S.mes, criadoEm: serverTimestamp() }).catch(errH); },
  fixDel(d) {
    const f = S.fixos.find((x) => x.id === d.v);
    if (f) { if (f.inicio != null && f.inicio >= S.mes) deleteDoc(doc(db, "fixos", d.v)).catch(errH); else updateDoc(doc(db, "fixos", d.v), { fim: S.mes - 1 }).catch(errH); }
    S.confirmId = null; render();
  },
  cfgEdit() {
    const C = cfg(); S.cfgDraft = {};
    CFG_NUM.forEach((k) => { S.cfgDraft[k] = fmtNum(C[k]); });
    CARDS.forEach((k) => { const I = cardInfo(k); S.cfgDraft["cor_" + k.id] = I.color; S.cfgDraft["fim_" + k.id] = I.fim; S.cfgDraft["dia_" + k.id] = String(I.dia); });
    S.cfgEdit = true; render();
  },
  cfgCancel() { S.cfgEdit = false; render(); },
  cfgCor(d) { const [id, cor] = d.v.split("|"); S.cfgDraft["cor_" + id] = cor; render(); },
  cfgSave() {
    const D = S.cfgDraft, out = {};
    CFG_NUM.forEach((k) => { out[k] = parse(D[k]); });
    CARDS.forEach((k) => { out["cor_" + k.id] = D["cor_" + k.id]; out["fim_" + k.id] = String(D["fim_" + k.id] || "").replace(/\D/g, "").slice(0, 4); out["dia_" + k.id] = Math.min(31, Math.max(1, parseInt(D["dia_" + k.id]) || 10)); });
    setDoc(doc(db, "config", "geral"), out, { merge: true }).catch(errH);
    S.cfgEdit = false; render();
  },
  simVar(d) { const C = cfg(); SIM.varVal = Math.max(0, (SIM.varVal == null ? C.orcVar : SIM.varVal) + Number(d.v)); saveSim(); render(); },
  simVarReset() { SIM.varVal = null; saveSim(); render(); },
  simKind(d) { SIM.f.kind = d.v; render(); },
  simN(d) { SIM.f.n = Math.min(48, Math.max(2, SIM.f.n + Number(d.v))); render(); },
  simStart(d) { SIM.f.start = Number(d.v); render(); },
  simAdd() {
    const f = SIM.f, v = parse(f.valor); if (v <= 0) return;
    const nome = f.nome.trim() || (f.kind === "parc" ? "Compra parcelada" : f.kind === "vista" ? "Compra à vista" : "Entrada extra");
    SIM.items.push({ nome, kind: f.kind, valor: v, n: f.kind === "parc" ? f.n : 1, start: f.start });
    SIM.f = { ...f, nome: "", valor: "" }; saveSim(); render();
  },
  simDel(d) { SIM.items.splice(Number(d.v.slice(3)), 1); saveSim(); S.confirmId = null; render(); },
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

let lastY = 0;
document.addEventListener("scroll", (e) => {
  const y = window.scrollY || document.documentElement.scrollTop || 0, was = !!S.compact;
  if (y <= 10) S.compact = false; else if (y > lastY + 6 && y > 70) S.compact = true; else if (y < lastY - 6) S.compact = false;
  lastY = y;
  if (was !== S.compact) {
    const p = document.getElementById("mpanel"), c = document.getElementById("mchip");
    if (p) p.hidden = S.compact; if (c) c.hidden = !S.compact;
  }
}, true);
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
  else if (e.target.dataset && e.target.dataset.cd) S.cfgDraft[e.target.dataset.cd] = e.target.value;
  else if (e.target.id === "sim-nome") SIM.f.nome = e.target.value;
  else if (e.target.id === "sim-valor") { SIM.f.valor = e.target.value; render(); }
});
document.addEventListener("change", (e) => {
  const t = e.target, d = t.dataset || {};
  if (t.id === "fixKeep") { S.fixKeep = t.checked; render(); return; }
  if (d.fx) {
    const v = d.fx === "desc" ? t.value.trim() : d.fx === "valor" ? parse(t.value) : Math.min(31, Math.max(1, parseInt(t.value) || 1));
    const M = S.mes, up = {};
    if (S.fixKeep) {
      up["hist.m" + M + "." + d.fx] = v;
      const f = S.fixos.find((x) => x.id === d.id);
      Object.keys((f && f.hist) || {}).forEach((k) => { if (Number(k.slice(1)) > M && f.hist[k][d.fx] !== undefined) up["hist." + k + "." + d.fx] = deleteField(); });
    } else up["uni.m" + M + "." + d.fx] = v;
    updateDoc(doc(db, "fixos", d.id), up).catch(errH);
  }
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
