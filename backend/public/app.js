/* aluguemais — storefront script v2.2.0
 * Compatível com TODOS os temas Nuvemshop: legados, atuais, componentizados e futuros.
 * Referências:
 *   Anchor Points : https://docs.nuvemshop.com.br/help/pontos-de-anchoragem
 *   Scripts API   : https://tiendanube.github.io/api-documentation/resources/script
 *   Migration Guide: https://dev.nuvemshop.com.br/docs/applications/nube-sdk/migration-guide
 *
 * NubeSDK NÃO é necessário — este é um script de vitrine (não é checkout).
 * Script tag CDN: script[src*="<app-handle>/<script-handle>"] → script[src*="aluguemais"]
 * ES5 puro + fetch + MutationObserver (disponíveis em todos os temas NS).
 */
!function () {
  'use strict';

  // ─── API base ─────────────────────────────────────────────────────────────────
  // Novo formato CDN Nuvemshop: cdn.tiendanube.net/apps/<app-handle>/<script-handle>/...
  // Migration Guide: usar script[src*="<app-handle>/<script-handle>"] como seletor.
  var API_FALLBACK = 'https://appaluguemaisnuvempro-production.up.railway.app';

  function detectApiBase() {
    var tags = document.querySelectorAll(
      'script[src*="aluguemais"],' + // CDN: handle do app (cobre novo e antigo formato)
      'script[src*="app.min.js"],' + // URL direta legada
      'script[src*="app.js"]'        // ambiente de desenvolvimento
    );
    for (var i = 0; i < tags.length; i++) {
      try {
        var api = new URL(tags[i].src, location.href).searchParams.get('api');
        if (api) return api.replace(/\/$/, '');
      } catch (e) { /* src sem query string — ignora */ }
    }
    return API_FALLBACK;
  }

  // ─── window.LS ────────────────────────────────────────────────────────────────
  function ls() { return window.LS || {}; }
  function storeNsId() { var s = ls().store || {}; return String(s.id || s.store_id || ''); }
  function productNsId() { return String(((ls().product) || {}).id || ''); }
  function storeCountry() { return String(((ls().store) || {}).country || 'BR').toUpperCase(); }

  // ─── País / textos ────────────────────────────────────────────────────────────
  var _country;
  function country() { return _country || (_country = storeCountry()); }
  function isBR() { return country() === 'BR'; }
  function isMX() { return country() === 'MX'; }

  var TXT = {
    rent:        function () { return isBR() ? 'Alugar'                          : isMX() ? 'Rentar'                      : 'Alquilar'; },
    defineDate:  function () { return isBR() ? 'Defina a data do evento'         : isMX() ? 'Define la fecha del evento'   : 'Definí la fecha del evento'; },
    unavailable: function () { return isBR() ? 'Indisponível'                    : 'No disponible'; },
    checking:    function () { return 'Verificando...'; },
    earlyDate:   function () { return isBR() ? 'Antecedência insuficiente'       : 'Anticipación insuficiente'; },
    dateLabel:   function () { return isBR() ? 'Informe a data do evento:'       : isMX() ? 'Ingresa la fecha del evento:' : 'Ingresá la fecha del evento:'; },
    errCheck:    function () { return isBR() ? 'Erro ao verificar. Tente novamente.' : 'Error al verificar. Intentá de nuevo.'; },
    okHint:      function () { return isBR() ? 'Data disponível!'                : '¡Fecha disponible!'; },
    earlyHint:   function (n) { return isBR() ? 'Escolha com pelo menos ' + n + ' dia(s) de antecedência.' : 'Elegí con al menos ' + n + ' día(s) de anticipación.'; },
    unavailHint: function () { return isBR() ? 'Data indisponível. Escolha outra.' : 'Fecha no disponible. Elegí otra.'; },
    partialHint: function (n) { return isBR() ? 'Apenas ' + n + ' unidade(s) disponível(is) nesta data.' : 'Solo ' + n + ' unidad(es) disponible(s) en esta fecha.'; },
  };

  // Nome da propriedade submetida no form → Nuvemshop exibe como rótulo no carrinho
  function propDateName()  { return isBR() ? 'properties[Data do Evento]' : 'properties[Fecha del Evento]'; }

  // ─── Utilitários de data ──────────────────────────────────────────────────────
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function toISO(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }
  function fromISO(s) {
    var p = String(s || '').split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  // ─── Fetch JSON ───────────────────────────────────────────────────────────────
  function jsonFetch(url, cb) {
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) { cb(null, d); })
      .catch(function (e) { cb(e, null); });
  }

  // ─── WeakSet polyfill ─────────────────────────────────────────────────────────
  function makeWeakSet() {
    try { var ws = new WeakSet(); return { has: function (x) { return ws.has(x); }, add: function (x) { ws.add(x); } }; }
    catch (e) { var arr = []; return { has: function (x) { return arr.indexOf(x) >= 0; }, add: function (x) { arr.push(x); } }; }
  }

  // ─── ANCHOR POINTS — seletores multi-tema ────────────────────────────────────
  // Referência: https://docs.nuvemshop.com.br/help/pontos-de-anchoragem
  //
  // GRADE DE PRODUTOS
  //   Temas novos  : data-store="product-item-{product.id}"
  //   Temas antigos: data-product-id="{product.id}"
  var GRID_SEL = '[data-store^="product-item-"],[data-product-id]';

  function getGridPid(item) {
    var ds = item.getAttribute('data-store') || '';
    if (ds.indexOf('product-item-') === 0) return parseInt(ds.slice(13), 10); // 'product-item-'.length === 13
    return parseInt(item.getAttribute('data-product-id') || '0', 10);
  }

  // FORM DO PRODUTO (contém botão de compra e quantity)
  //   Temas novos  : data-store="product-form-{product.id}"
  //   Temas antigos: <form>
  function closestProductForm(el) {
    var p = el;
    while (p && p !== document.body) {
      var ds = p.getAttribute ? (p.getAttribute('data-store') || '') : '';
      if (p.tagName === 'FORM' || ds.indexOf('product-form-') === 0) return p;
      p = p.parentElement;
    }
    return null;
  }

  // BOTÃO DE COMPRA (página de produto e grade)
  //   Temas novos  : submit dentro de [data-store^="product-form-"]
  //                  OU [data-store="product-buy-button"]
  //   Temas antigos: .js-addtocart
  var BUY_SEL = [
    '[data-store="product-buy-button"]',
    '[data-store^="product-form-"] [type="submit"]',
    '.js-addtocart',
    '[data-action="add-to-cart"]',
    'form[action*="cart"] [type="submit"]',
    'form[action*="carrinho"] [type="submit"]',
    'form[action*="checkout"] [type="submit"]',
  ];

  function findBuyBtn(root) {
    for (var i = 0; i < BUY_SEL.length; i++) {
      var el = (root || document).querySelector(BUY_SEL[i]);
      if (el) return el;
    }
    return null;
  }

  // QUANTIDADE (página de produto)
  //   Temas novos  : input numérico dentro de [data-store^="product-form-"]
  //   Temas antigos: .js-quantity-input, input[name="quantity"]
  var PROD_QTY_INPUT_SEL = [
    '[data-store^="product-form-"] input[type="number"]',
    '[data-store="product-quantity"] input',
    '.js-quantity-input',
    'input[name="quantity"]',
  ];

  function findProdQtyInput() {
    for (var i = 0; i < PROD_QTY_INPUT_SEL.length; i++) {
      var el = document.querySelector(PROD_QTY_INPUT_SEL[i]);
      if (el) return el;
    }
    return null;
  }

  // Botões +/- de quantidade (página de produto)
  var PROD_QTY_DOWN = '.js-quantity-down,[data-action="decrease-quantity"],[data-quantity-action="down"]';
  var PROD_QTY_UP   = '.js-quantity-up,[data-action="increase-quantity"],[data-quantity-action="up"]';

  // CARRINHO — ITEM
  //   Temas novos  : data-store="cart-item-{product.id}"  → ID embutido no atributo
  //   Temas antigos: detectado via rótulo da propriedade no DOM
  //
  // CARRINHO — CONTROLES DE QUANTIDADE (dentro do item)
  //   Temas novos  : buttons próximos ao input numérico
  //   Temas antigos: .js-quantity-down / .js-quantity-up / .js-quantity-input
  var CART_QTY_INPUT = [
    '.js-quantity-input',
    'input[name*="quantity"]',
    'input[name*="updates"]',
    'input[type="number"]',
  ].join(',');

  var CART_QTY_BTNS = [
    '.js-quantity-down',
    '.js-quantity-up',
    '[data-quantity-action]',
    '[data-action="decrease-quantity"]',
    '[data-action="increase-quantity"]',
    '[data-action="minus"]',
    '[data-action="plus"]',
  ].join(',');

  // Rótulos da propriedade exibidos no carrinho (todos os idiomas suportados)
  var CART_PROP_LABELS = ['Data do Evento', 'Fecha del Evento'];

  // ─── GRADE DE PRODUTOS ────────────────────────────────────────────────────────
  var _processed = makeWeakSet();

  function replaceGridItem(item, ids, skipPid) {
    if (_processed.has(item)) return;
    var pid = getGridPid(item);
    if (!pid || ids.indexOf(pid) === -1) return;
    if (skipPid && pid === parseInt(skipPid, 10)) return;
    _processed.add(item);

    var buyBtn = findBuyBtn(item);
    if (!buyBtn) return;

    // Produto-alvo URL: primeira âncora do card
    var link = item.querySelector('a[href]');
    var href = link ? link.href : location.href;

    // Cria <a> com as mesmas classes do botão (herda visual do tema intacto)
    var a = document.createElement('a');
    a.href = href;
    a.className = buyBtn.className;
    a.setAttribute('aria-label', TXT.rent());
    a.setAttribute('data-alm', '1');

    // Preserva ícone SVG do botão original, se houver
    var svg = buyBtn.querySelector('svg')
           || (buyBtn.parentElement && buyBtn.parentElement.querySelector('svg'));
    if (svg) {
      var sp = document.createElement('span');
      sp.appendChild(document.createTextNode(TXT.rent()));
      a.appendChild(sp);
      a.appendChild(svg.cloneNode(true));
    } else {
      a.appendChild(document.createTextNode(TXT.rent()));
    }

    // Remove o form/botão de compra rápida; insere link de aluguel
    var form = closestProductForm(buyBtn);
    if (form && item.contains(form)) {
      form.insertAdjacentElement('afterend', a);
      form.remove();
    } else {
      buyBtn.parentNode.replaceChild(a, buyBtn);
    }
  }

  function processGrid(ids, skipPid) {
    if (!ids || !ids.length) return;
    var items = document.querySelectorAll(GRID_SEL);
    for (var i = 0; i < items.length; i++) replaceGridItem(items[i], ids, skipPid);
  }

  // ─── CARRINHO ─────────────────────────────────────────────────────────────────
  var _cartDone = makeWeakSet();

  function applyCartItem(container) {
    if (_cartDone.has(container)) return;
    _cartDone.add(container);

    // Desabilita input de quantidade
    var inputs = container.querySelectorAll(CART_QTY_INPUT);
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].setAttribute('disabled', '');
      inputs[i].style.cssText += ';pointer-events:none;opacity:0.55;cursor:not-allowed;';
    }

    // Oculta botões + e -
    var btns = container.querySelectorAll(CART_QTY_BTNS);
    for (var j = 0; j < btns.length; j++) btns[j].style.display = 'none';
  }

  // IDs alugáveis em cache para uso no processCart (sem nova requisição)
  var _rentableIds = [];

  function processCart() {
    // ── Estratégia 1: Temas novos ──────────────────────────────────────────────
    // Anchor point: data-store="cart-item-{product.id}" (NS Anchor Points Doc)
    // O ID do produto está embutido no atributo → comparação direta com rentableIds.
    var newItems = document.querySelectorAll('[data-store^="cart-item-"]');
    for (var i = 0; i < newItems.length; i++) {
      var item = newItems[i];
      var ds = item.getAttribute('data-store') || '';
      var pid = parseInt(ds.slice(10), 10); // 'cart-item-'.length === 10
      if (pid && _rentableIds.indexOf(pid) >= 0) applyCartItem(item);
    }

    // ── Estratégia 2: Todos os temas (texto da propriedade) ───────────────────
    // Detecta pelo rótulo "Data do Evento" / "Fecha del Evento" exibido pelo NS.
    // Cobre temas antigos e serve de fallback para temas componentizados onde
    // o anchor point do item ainda não foi identificado.
    var candidates = document.querySelectorAll('strong,dt,span,b,th,td,p');
    for (var j = 0; j < candidates.length; j++) {
      var txt = (candidates[j].textContent || candidates[j].innerText || '').trim();
      if (!txt || txt.length > 80) continue;

      var isLabel = false;
      for (var k = 0; k < CART_PROP_LABELS.length; k++) {
        var lbl = CART_PROP_LABELS[k];
        if (txt === lbl || txt.indexOf(lbl + ':') === 0 || txt.indexOf(lbl + ' :') === 0) {
          isLabel = true; break;
        }
      }
      if (!isLabel) continue;

      // Sobe no DOM até achar um ancestral com controles de quantidade
      var p = candidates[j].parentElement;
      for (var depth = 0; depth < 14 && p && p !== document.body; depth++) {
        if (_cartDone.has(p)) break;
        if (p.querySelector(CART_QTY_INPUT)) { applyCartItem(p); break; }
        p = p.parentElement;
      }
    }
  }

  // ─── PÁGINA DE PRODUTO ────────────────────────────────────────────────────────
  function setBtn(btn, state, text) {
    if (btn.tagName === 'INPUT') btn.value = text; else btn.textContent = text;
    if (state === 'enabled') btn.removeAttribute('disabled'); else btn.setAttribute('disabled', '');
    btn.setAttribute('aria-busy', state === 'checking' ? 'true' : 'false');
  }

  function getQty() {
    var qi = findProdQtyInput();
    var v = qi ? parseInt(qi.value, 10) : 1;
    return (v && v > 0) ? v : 1;
  }

  var _debounce;
  function debounce(fn, ms) { clearTimeout(_debounce); _debounce = setTimeout(fn, ms || 350); }

  function setupProductPage(apiBase, sid, pid, cfg) {
    var buyBtn = findBuyBtn();
    if (!buyBtn) return;

    var form = closestProductForm(buyBtn);

    // ── Desabilita botão imediatamente ────────────────────────────────────────
    setBtn(buyBtn, 'disabled', TXT.defineDate());

    // ── Date picker visual ────────────────────────────────────────────────────
    var wrap = document.createElement('div');
    wrap.className = 'alm-date-wrap';
    wrap.style.cssText = 'margin:16px 0 10px;';

    var lbl = document.createElement('label');
    lbl.setAttribute('for', 'alm-date');
    lbl.style.cssText = 'display:block;margin-bottom:6px;font-size:14px;font-weight:600;color:inherit;';
    lbl.appendChild(document.createTextNode(TXT.dateLabel()));

    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'alm-date';
    dateInput.className = 'form-control';
    dateInput.style.cssText = 'max-width:280px;padding:8px 12px;font-size:14px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;cursor:pointer;';
    // Validação 3: data mínima = hoje + diasAntes
    dateInput.min = toISO(addDays(today0(), cfg.diasAntes));

    var msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:6px 0 0;font-size:13px;min-height:18px;line-height:1.4;';

    wrap.appendChild(lbl);
    wrap.appendChild(dateInput);
    wrap.appendChild(msgEl);

    // ── Hidden input submetido no form → properties[Data do Evento] ───────────
    // A Nuvemshop exibe automaticamente esse campo como propriedade no carrinho.
    var hiddenDate = document.createElement('input');
    hiddenDate.type = 'hidden';
    hiddenDate.name = propDateName();
    hiddenDate.id = 'alm-hidden-date';

    // Insere picker antes do container do botão (compatível com todos os temas)
    var anchor = (buyBtn.parentElement && buyBtn.parentElement.parentElement)
      ? buyBtn.parentElement.parentElement
      : (buyBtn.parentElement || buyBtn);
    anchor.insertAdjacentElement('beforebegin', wrap);

    // Adiciona hidden input dentro do form para ser submetido
    if (form) form.appendChild(hiddenDate);

    // ── Validação + verificação de disponibilidade ─────────────────────────────
    function check() {
      var val = dateInput.value;
      var selected = fromISO(val);
      hiddenDate.value = val || '';

      // Validação 1: campo obrigatório
      if (!selected) {
        setBtn(buyBtn, 'disabled', TXT.defineDate());
        msgEl.textContent = ''; msgEl.style.color = '';
        return;
      }

      // Validação 2 + 3: data futura com antecedência mínima
      var minDate = addDays(today0(), cfg.diasAntes);
      if (selected.getTime() < minDate.getTime()) {
        setBtn(buyBtn, 'disabled', TXT.earlyDate());
        msgEl.style.color = '#c0392b';
        msgEl.textContent = TXT.earlyHint(cfg.diasAntes);
        return;
      }

      // Validação 4 + 5: disponibilidade no intervalo [data−diasAntes, data+diasDepois]
      var qty = getQty();
      setBtn(buyBtn, 'checking', TXT.checking());
      msgEl.textContent = '';

      var from = toISO(addDays(selected, -cfg.diasAntes));
      var to   = toISO(addDays(selected,  cfg.diasDepois));
      var url  = apiBase + '/storefront/' + sid + '/products/' + pid +
                 '/availability?from=' + from + '&to=' + to + '&qty=' + qty;

      jsonFetch(url, function (err, data) {
        if (err || !data) {
          setBtn(buyBtn, 'disabled', TXT.defineDate());
          msgEl.style.color = '#c0392b';
          msgEl.textContent = TXT.errCheck();
          return;
        }
        var remaining = data.remaining || 0;
        if (data.available && remaining >= qty) {
          setBtn(buyBtn, 'enabled', TXT.rent());
          msgEl.style.color = '#27ae60';
          msgEl.textContent = TXT.okHint() + (remaining > 1 ? ' (' + remaining + ')' : '');
        } else if (remaining > 0 && remaining < qty) {
          setBtn(buyBtn, 'disabled', TXT.unavailable());
          msgEl.style.color = '#c0392b';
          msgEl.textContent = TXT.partialHint(remaining);
        } else {
          setBtn(buyBtn, 'disabled', TXT.unavailable());
          msgEl.style.color = '#c0392b';
          msgEl.textContent = TXT.unavailHint();
        }
      });
    }

    dateInput.addEventListener('change', function () { debounce(check, 350); });

    // Reagir a mudanças de quantidade (todos os temas)
    var qInput = findProdQtyInput();
    if (qInput) {
      qInput.addEventListener('change', function () { if (dateInput.value) debounce(check, 350); });
      qInput.addEventListener('keyup',  function () { if (dateInput.value) debounce(check, 350); });
    }
    var qDown = document.querySelector(PROD_QTY_DOWN);
    var qUp   = document.querySelector(PROD_QTY_UP);
    if (qDown) qDown.addEventListener('click', function () { if (dateInput.value) setTimeout(check, 60); });
    if (qUp)   qUp.addEventListener('click',   function () { if (dateInput.value) setTimeout(check, 60); });
  }

  // ─── Observer unificado (grade + modal do carrinho) ───────────────────────────
  function observeAll(ids, skipPid) {
    if (!window.MutationObserver) return;
    var cartTimer;
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n.querySelectorAll) continue;
          if (!ids.length) continue;

          // Temas novos: data-store="product-item-{id}"
          // Temas antigos: data-product-id="{id}"
          var ds = (n.getAttribute && n.getAttribute('data-store')) || '';
          if (ds.indexOf('product-item-') === 0 || n.hasAttribute('data-product-id')) {
            replaceGridItem(n, ids, skipPid);
          }
          var inner = n.querySelectorAll(GRID_SEL);
          for (var k = 0; k < inner.length; k++) replaceGridItem(inner[k], ids, skipPid);
        }
      }
      // Debounce: o modal do carrinho injeta vários nós em sequência
      clearTimeout(cartTimer);
      cartTimer = setTimeout(processCart, 200);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Inicialização ────────────────────────────────────────────────────────────
  function init() {
    var apiBase = detectApiBase();
    var sid = storeNsId();
    if (!sid) return;

    var pid = productNsId();

    // 1. Busca IDs alugáveis → processa grade e carrinho em TODAS as páginas
    jsonFetch(apiBase + '/storefront/' + sid + '/rentable-ids', function (err, data) {
      _rentableIds = (data && Array.isArray(data.ids)) ? data.ids : [];
      processGrid(_rentableIds, pid);  // substitui botões na grade
      processCart();                   // desabilita qty no carrinho já renderizado
      observeAll(_rentableIds, pid);   // grade + modal do carrinho (dinâmico)
    });

    // 2. Comportamento específico da página de produto
    if (!pid) return;

    jsonFetch(apiBase + '/storefront/' + sid + '/products/' + pid + '/config', function (err, data) {
      if (err || !data || !data.enabled) return;
      setupProductPage(apiBase, sid, pid, {
        diasAntes:  data.diasAntes  || 0,
        diasDepois: data.diasDepois || 0,
        estoque:    data.estoque    || 1,
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}();
