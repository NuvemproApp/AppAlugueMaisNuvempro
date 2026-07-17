/* aluguemais — storefront script v2.4.0
 * Compatível com TODOS os temas Nuvemshop: legados, atuais, componentizados e futuros.
 * Referências:
 *   Anchor Points  : https://docs.nuvemshop.com.br/help/pontos-de-anchoragem
 *   Scripts API    : https://tiendanube.github.io/api-documentation/resources/script
 *   Migration Guide: https://dev.nuvemshop.com.br/docs/applications/nube-sdk/migration-guide
 *
 * NubeSDK NÃO é necessário — este é um script de vitrine (não é checkout).
 * Script tag CDN : script[src*="aluguemais"]
 * ES5 puro + fetch + MutationObserver (disponíveis em todos os temas NS).
 */
!function () {
  'use strict';

  // ─── API base ─────────────────────────────────────────────────────────────────
  var API_FALLBACK = 'https://appaluguemaisnuvempro-production.up.railway.app';

  function detectApiBase() {
    var tags = document.querySelectorAll(
      'script[src*="aluguemais"],' +
      'script[src*="app.min.js"],' +
      'script[src*="app.js"]'
    );
    for (var i = 0; i < tags.length; i++) {
      try {
        var api = new URL(tags[i].src, location.href).searchParams.get('api');
        if (api) return api.replace(/\/$/, '');
      } catch (e) {}
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
    rent:        function () { return isBR() ? 'Alugar'                              : isMX() ? 'Rentar'                      : 'Alquilar'; },
    defineDate:  function () { return isBR() ? 'Defina a data do evento'             : isMX() ? 'Define la fecha del evento'   : 'Definí la fecha del evento'; },
    unavailable: function () { return isBR() ? 'Indisponível'                        : 'No disponible'; },
    checking:    function () { return 'Verificando...'; },
    earlyDate:   function () { return isBR() ? 'Antecedência insuficiente'           : 'Anticipación insuficiente'; },
    dateLabel:   function () { return isBR() ? 'Informe a data do evento:'           : isMX() ? 'Ingresa la fecha del evento:' : 'Ingresá la fecha del evento:'; },
    errCheck:    function () { return isBR() ? 'Erro ao verificar. Tente novamente.' : 'Error al verificar. Intentá de nuevo.'; },
    okHint:      function () { return isBR() ? 'Data disponível!'                    : '¡Fecha disponible!'; },
    earlyHint:   function (n) { return isBR() ? 'Escolha com pelo menos ' + n + ' dia(s) de antecedência.' : 'Elegí con al menos ' + n + ' día(s) de anticipación.'; },
    unavailHint: function () { return isBR() ? 'Data indisponível. Escolha outra.'   : 'Fecha no disponible. Elegí otra.'; },
    partialHint: function (n) { return isBR() ? 'Apenas ' + n + ' unidade(s) disponível(is) nesta data.' : 'Solo ' + n + ' unidad(es) disponible(s) en esta fecha.'; },
  };

  function propDateName() { return isBR() ? 'properties[Data do Evento]' : 'properties[Fecha del Evento]'; }

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

  // ─── Injeção de CSS ───────────────────────────────────────────────────────────
  // Classe alm-cart-item desabilita/oculta controles de quantidade via stylesheet.
  // Classe nuvempro-cart-prod-pers exibe propriedades em temas legados (mesma do SuperCampos).
  var _cssInjected = false;
  function injectAlmCSS() {
    if (_cssInjected || document.getElementById('alm-css')) { _cssInjected = true; return; }
    _cssInjected = true;
    var css =
      '.alm-cart-item .js-quantity-down,' +
      '.alm-cart-item .js-quantity-up,' +
      '.alm-cart-item [data-quantity-action],' +
      '.alm-cart-item [data-action="decrease-quantity"],' +
      '.alm-cart-item [data-action="increase-quantity"],' +
      '.alm-cart-item [data-action="minus"],' +
      '.alm-cart-item [data-action="plus"]' +
      '{display:none!important}' +
      '.alm-cart-item .js-quantity-input,' +
      '.alm-cart-item input[name*="quantity"],' +
      '.alm-cart-item input[name*="updates"],' +
      '.alm-cart-item input[type="number"]' +
      '{pointer-events:none!important;opacity:.55!important;cursor:not-allowed!important}' +
      '.nuvempro-cart-prod-pers{font-size:.82em;line-height:1.6;margin-top:5px;padding:3px 0;clear:both}' +
      '.nuvempro-cart-prod-pers>div{display:block}' +
      '.nuvempro-cart-prod-pers strong{font-weight:600}' +
      '.nuvempro-cart-prod-pers span{margin-left:2px}';
    var style = document.createElement('style');
    style.id = 'alm-css';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─── ANCHOR POINTS — seletores multi-tema ────────────────────────────────────
  // GRADE DE PRODUTOS
  var GRID_SEL = '[data-store^="product-item-"],[data-product-id]';

  function getGridPid(item) {
    var ds = item.getAttribute('data-store') || '';
    if (ds.indexOf('product-item-') === 0) return parseInt(ds.slice(13), 10);
    return parseInt(item.getAttribute('data-product-id') || '0', 10);
  }

  // FORM DO PRODUTO
  function closestProductForm(el) {
    var p = el;
    while (p && p !== document.body) {
      var ds = p.getAttribute ? (p.getAttribute('data-store') || '') : '';
      if (p.tagName === 'FORM' || ds.indexOf('product-form-') === 0) return p;
      p = p.parentElement;
    }
    return null;
  }

  // BOTÃO DE COMPRA
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

  var PROD_QTY_DOWN = '.js-quantity-down,[data-action="decrease-quantity"],[data-quantity-action="down"]';
  var PROD_QTY_UP   = '.js-quantity-up,[data-action="increase-quantity"],[data-quantity-action="up"]';

  // CARRINHO — seletores de item expandidos (inspirado em SuperCampos SEL_LINE_ITEM)
  var CART_ITEM_SEL_LIST = [
    '[data-store^="cart-item-"]',        // Anchor point oficial (todos os temas modernos)
    '[data-component="cart.line-item"]', // Componente moderno
    '.js-cart-item',                      // JS-targeted legado
    '.cart-item',                         // classe genérica legada
    'tr[data-id]',                        // layout tabela (muito legado)
  ];

  // CARRINHO — controles de quantidade
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

  // Rótulos da data do evento (todos os idiomas suportados)
  var CART_DATE_LABELS = ['Data do Evento', 'Fecha del Evento'];

  // ─── Extração de productId de um item do carrinho ─────────────────────────────
  // Inspirado em SuperCampos getProductId(). Cobre âncoras modernas e DOM legado.
  function getProductIdFromCart(item) {
    var ds = item.getAttribute('data-store') || '';
    var m = ds.match(/^cart-item-(\d+)$/);
    if (m) return m[1];
    var byAttr = item.getAttribute('data-product-id');
    if (byAttr) return byAttr;
    var inner = item.querySelector('[data-product-id]');
    if (inner) return inner.getAttribute('data-product-id');
    var qInput = item.querySelector('input[name^="quantity["]');
    if (qInput) {
      var m2 = (qInput.name || '').match(/^quantity\[(\d+)\]$/);
      if (m2) return m2[1];
    }
    return null;
  }

  // ─── Extrai a data do evento (ISO) de um item do carrinho ─────────────────────
  // Cobre tanto a exibição nativa da NS (properties[]) quanto o wrapper que
  // injectCartDate() insere em temas legados — em ambos os casos o texto contém
  // o rótulo ("Data do Evento"/"Fecha del Evento") seguido do valor ISO cru
  // (o mesmo formato do <input type="date">, nunca formatado pelo tema).
  function extractCartItemDate(container) {
    var els = container.querySelectorAll('strong,dt,span,b,th,td,p,div');
    for (var i = 0; i < els.length; i++) {
      var txt = (els[i].textContent || '').trim();
      if (!txt || txt.length > 80) continue;
      for (var j = 0; j < CART_DATE_LABELS.length; j++) {
        if (txt.indexOf(CART_DATE_LABELS[j]) === 0) {
          var m = txt.match(/(\d{4}-\d{2}-\d{2})/);
          if (m) return m[1];
        }
      }
    }
    return null;
  }

  // ─── Quantidade de um item do carrinho ────────────────────────────────────────
  function extractCartItemQty(container) {
    var qi = container.querySelector(CART_QTY_INPUT);
    if (qi) {
      var v = parseInt(qi.value, 10);
      if (v > 0) return v;
    }
    return 1;
  }

  // ─── Unidades do produto `pid` já no carrinho cujo período reservado
  //     [data - diasAntes, data + diasDepois] se sobrepõe à janela informada ───
  // Fecha o furo em que o estoque só é debitado de fato no webhook order/created:
  // enquanto o pedido não é finalizado, essas unidades já estão "comprometidas"
  // no carrinho do próprio visitante mas o back-end ainda não tem como saber disso.
  // Não cobre o caso de outro visitante concorrente com o mesmo produto/data —
  // isso exigiria uma reserva de estoque no servidor, que a Nuvemshop não expõe
  // via webhook de carrinho (só existe webhook de pedido já finalizado).
  function cartQtyOverlapping(pid, selFrom, selTo, diasAntes, diasDepois) {
    var total = 0;
    var seen = makeWeakSet();
    for (var si = 0; si < CART_ITEM_SEL_LIST.length; si++) {
      var items = document.querySelectorAll(CART_ITEM_SEL_LIST[si]);
      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        if (seen.has(item)) continue;
        seen.add(item);

        var itemPid = getProductIdFromCart(item);
        if (!itemPid || String(itemPid) !== String(pid)) continue;

        var dateStr = extractCartItemDate(item);
        var eventDate = dateStr ? fromISO(dateStr) : null;
        if (!eventDate) continue;

        var itemFrom = addDays(eventDate, -diasAntes);
        var itemTo   = addDays(eventDate,  diasDepois);
        if (itemFrom.getTime() > selTo.getTime() || itemTo.getTime() < selFrom.getTime()) continue;

        total += extractCartItemQty(item);
      }
    }
    return total;
  }

  // ─── sessionStorage: data do evento por produto ────────────────────────────────
  // Persiste a data selecionada para exibição no carrinho em temas legados.
  // Inspirado em SuperCampos captureProps() + sessionStorage.
  var _datesKey;
  function datesStorageKey() {
    return _datesKey || (_datesKey = 'alm_dates_' + storeNsId());
  }

  function storeDateForProduct(pid, dateVal) {
    try {
      var raw = sessionStorage.getItem(datesStorageKey());
      var s = raw ? JSON.parse(raw) : {};
      s[pid] = dateVal;
      sessionStorage.setItem(datesStorageKey(), JSON.stringify(s));
    } catch (e) {}
  }

  function getStoredDateForProduct(pid) {
    try {
      var raw = sessionStorage.getItem(datesStorageKey());
      if (!raw) return null;
      return JSON.parse(raw)[pid] || null;
    } catch (e) { return null; }
  }

  // Captura a data do hidden input antes do form ser submetido.
  function captureRentalDate() {
    var pid = productNsId();
    if (!pid || _rentableIds.indexOf(parseInt(pid, 10)) === -1) return;
    var inp = document.getElementById('alm-hidden-date') ||
              document.querySelector('input[name="' + propDateName() + '"]');
    if (inp && inp.value) storeDateForProduct(pid, inp.value);
  }

  // ─── Detecção de propriedade nativa NS no carrinho ────────────────────────────
  // Inspirado em SuperCampos hasNativeProperties().
  // Evita injetar duplicata se a Nuvemshop já exibir o campo nativamente.
  function hasNativeCartDate(container) {
    var els = container.querySelectorAll('strong,dt,span,b,th,td,p');
    for (var i = 0; i < els.length; i++) {
      var txt = (els[i].textContent || '').trim();
      for (var j = 0; j < CART_DATE_LABELS.length; j++) {
        if (txt.indexOf(CART_DATE_LABELS[j]) === 0) return true;
      }
    }
    return false;
  }

  // ─── Injeção da data no item do carrinho (temas legados) ─────────────────────
  // Inspirado em SuperCampos injectIntoItem().
  // Exibe "Data do Evento: YYYY-MM-DD" em temas que não renderizam properties[] nativamente.
  var SEL_CART_NAME = [
    '[data-component="line-item.name"]',
    '.cart-item-name',
    '.item-name',
    '.js-item-name',
    'td.name',
  ];

  function injectCartDate(container) {
    if (container.querySelector('.nuvempro-cart-prod-pers')) return; // idempotente
    if (hasNativeCartDate(container)) return; // NS já exibe — não duplicar

    var pid = getProductIdFromCart(container);
    var dateVal = pid ? getStoredDateForProduct(pid) : null;
    if (!dateVal) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'nuvempro-cart-prod-pers';
    var line = document.createElement('div');
    var strong = document.createElement('strong');
    var span = document.createElement('span');
    strong.textContent = (isBR() ? 'Data do Evento' : 'Fecha del Evento') + ': ';
    span.textContent = dateVal;
    line.appendChild(strong);
    line.appendChild(span);
    wrapper.appendChild(line);

    var nameEl = null;
    for (var i = 0; i < SEL_CART_NAME.length; i++) {
      nameEl = container.querySelector(SEL_CART_NAME[i]);
      if (nameEl) break;
    }
    if (nameEl) nameEl.appendChild(wrapper);
    else container.appendChild(wrapper);
  }

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

    var link = item.querySelector('a[href]');
    var href = link ? link.href : location.href;

    var a = document.createElement('a');
    a.href = href;
    a.className = buyBtn.className;
    a.setAttribute('aria-label', TXT.rent());
    a.setAttribute('data-alm', '1');

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

    // Classe CSS: stylesheet desabilita controles de quantidade e oculta botões +/-
    if (container.classList) container.classList.add('alm-cart-item');

    // Fallback inline: cobre temas cuja especificidade supera !important no stylesheet
    var inputs = container.querySelectorAll(CART_QTY_INPUT);
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].setAttribute('disabled', '');
      inputs[i].style.cssText += ';pointer-events:none;opacity:0.55;cursor:not-allowed;';
    }
    var btns = container.querySelectorAll(CART_QTY_BTNS);
    for (var j = 0; j < btns.length; j++) btns[j].style.display = 'none';

    // Exibe data em temas que não renderizam properties[] nativamente
    injectCartDate(container);
  }

  var _rentableIds = [];

  function processCart() {
    // ── Estratégia 1: seletores expandidos + productId ───────────────────────────
    // Cobre anchor points (ID no atributo) e temas legados (extração por DOM).
    for (var si = 0; si < CART_ITEM_SEL_LIST.length; si++) {
      var items = document.querySelectorAll(CART_ITEM_SEL_LIST[si]);
      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        if (_cartDone.has(item)) continue;

        // Anchor point: ID embutido no atributo (mais confiável)
        var attrDs = item.getAttribute('data-store') || '';
        if (attrDs.indexOf('cart-item-') === 0) {
          var anchorPid = parseInt(attrDs.slice(10), 10);
          if (anchorPid && _rentableIds.indexOf(anchorPid) >= 0) {
            applyCartItem(item);
            continue;
          }
          continue; // tem anchor point mas não é produto alugável — skip
        }

        // Outros seletores: tenta extrair productId do contexto
        var ctxPid = getProductIdFromCart(item);
        if (ctxPid && _rentableIds.indexOf(parseInt(ctxPid, 10)) >= 0) {
          applyCartItem(item);
        }
      }
    }

    // ── Estratégia 2: rótulo da propriedade no DOM (fallback universal) ──────────
    // Funciona em qualquer tema onde NS já exibe "Data do Evento" nativamente,
    // quando o anchor point não está disponível.
    var candidates = document.querySelectorAll('strong,dt,span,b,th,td,p');
    for (var j = 0; j < candidates.length; j++) {
      var txt = (candidates[j].textContent || candidates[j].innerText || '').trim();
      if (!txt || txt.length > 80) continue;

      var isLabel = false;
      for (var k = 0; k < CART_DATE_LABELS.length; k++) {
        var lbl = CART_DATE_LABELS[k];
        if (txt === lbl || txt.indexOf(lbl + ':') === 0 || txt.indexOf(lbl + ' :') === 0) {
          isLabel = true; break;
        }
      }
      if (!isLabel) continue;

      var p = candidates[j].parentElement;
      for (var depth = 0; depth < 14 && p && p !== document.body; depth++) {
        if (_cartDone.has(p)) break;
        if (p.querySelector(CART_QTY_INPUT)) { applyCartItem(p); break; }
        p = p.parentElement;
      }
    }
  }

  // ─── Patch de LS.addToCartEnhanced ────────────────────────────────────────────
  // Inspirado em SuperCampos initCartDisplay() → tryPatch().
  // Captura a data ANTES de adicionar ao carrinho e re-processa o cart após a resposta.
  var _patchTries = 0;
  function tryPatchAddToCart() {
    if (window.LS && typeof window.LS.addToCartEnhanced === 'function') {
      var orig = window.LS.addToCartEnhanced;
      window.LS.addToCartEnhanced = function () {
        captureRentalDate();
        var args = Array.prototype.slice.call(arguments);
        var origCb = typeof args[5] === 'function' ? args[5] : function () {};
        args[5] = function () {
          origCb.apply(this, arguments);
          setTimeout(processCart, 600);
          setTimeout(processCart, 2200);
        };
        return orig.apply(this, args);
      };
    } else if (_patchTries++ < 25) {
      setTimeout(tryPatchAddToCart, 400);
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

    setBtn(buyBtn, 'disabled', TXT.defineDate());

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
    dateInput.min = toISO(addDays(today0(), cfg.diasAntes));

    var msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:6px 0 0;font-size:13px;min-height:18px;line-height:1.4;';

    wrap.appendChild(lbl);
    wrap.appendChild(dateInput);
    wrap.appendChild(msgEl);

    var hiddenDate = document.createElement('input');
    hiddenDate.type = 'hidden';
    hiddenDate.name = propDateName();
    hiddenDate.id = 'alm-hidden-date';

    var anchor = (buyBtn.parentElement && buyBtn.parentElement.parentElement)
      ? buyBtn.parentElement.parentElement
      : (buyBtn.parentElement || buyBtn);
    anchor.insertAdjacentElement('beforebegin', wrap);

    if (form) form.appendChild(hiddenDate);

    function check() {
      var val = dateInput.value;
      var selected = fromISO(val);
      hiddenDate.value = val || '';

      if (!selected) {
        setBtn(buyBtn, 'disabled', TXT.defineDate());
        msgEl.textContent = ''; msgEl.style.color = '';
        return;
      }

      var minDate = addDays(today0(), cfg.diasAntes);
      if (selected.getTime() < minDate.getTime()) {
        setBtn(buyBtn, 'disabled', TXT.earlyDate());
        msgEl.style.color = '#c0392b';
        msgEl.textContent = TXT.earlyHint(cfg.diasAntes);
        return;
      }

      var qty = getQty();
      setBtn(buyBtn, 'checking', TXT.checking());
      msgEl.textContent = '';

      var fromDate = addDays(selected, -cfg.diasAntes);
      var toDate   = addDays(selected,  cfg.diasDepois);
      var url = apiBase + '/storefront/' + sid + '/products/' + pid +
                '/availability?from=' + toISO(fromDate) + '&to=' + toISO(toDate) + '&qty=' + qty;

      jsonFetch(url, function (err, data) {
        if (err || !data) {
          setBtn(buyBtn, 'disabled', TXT.defineDate());
          msgEl.style.color = '#c0392b';
          msgEl.textContent = TXT.errCheck();
          return;
        }
        // Desconta unidades do mesmo produto já no carrinho deste visitante cujo
        // período reservado se sobrepõe ao selecionado — o back-end só sabe de
        // pedidos já finalizados (webhook order/created), não do carrinho em aberto.
        var alreadyInCart = cartQtyOverlapping(pid, fromDate, toDate, cfg.diasAntes, cfg.diasDepois);
        var remaining = Math.max(0, (data.remaining || 0) - alreadyInCart);
        if (remaining >= qty) {
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

  // ─── Observer unificado + setInterval safety net ─────────────────────────────
  function observeAll(ids, skipPid) {
    if (window.MutationObserver) {
      var cartTimer;
      var obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n.querySelectorAll) continue;
            if (!ids.length) continue;

            var ds = (n.getAttribute && n.getAttribute('data-store')) || '';
            if (ds.indexOf('product-item-') === 0 || n.hasAttribute('data-product-id')) {
              replaceGridItem(n, ids, skipPid);
            }
            var inner = n.querySelectorAll(GRID_SEL);
            for (var k = 0; k < inner.length; k++) replaceGridItem(inner[k], ids, skipPid);
          }
        }
        clearTimeout(cartTimer);
        cartTimer = setTimeout(processCart, 200);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // Safety net: garante processamento de novos itens do carrinho (AJAX, modal, rerenders).
    // Inspirado em C# BloquearQtdeItensAlugaveisStoreCart → setInterval(..., 2500).
    setInterval(function () {
      if (_rentableIds.length) processCart();
    }, 2500);
  }

  // ─── Inicialização ────────────────────────────────────────────────────────────
  function init() {
    var apiBase = detectApiBase();
    var sid = storeNsId();
    if (!sid) return;

    var pid = productNsId();

    injectAlmCSS();
    tryPatchAddToCart();

    // Captura data no submit do form (cobre temas que não usam LS.addToCartEnhanced)
    if (pid) {
      var captureForm = document.querySelector('[data-store^="product-form-"]') ||
                        document.querySelector('form[action*="cart"]') ||
                        document.querySelector('form[action*="carrinho"]');
      if (captureForm) captureForm.addEventListener('submit', captureRentalDate, true);
    }

    jsonFetch(apiBase + '/storefront/' + sid + '/rentable-ids', function (err, data) {
      _rentableIds = (data && Array.isArray(data.ids)) ? data.ids : [];
      processGrid(_rentableIds, pid);
      processCart();
      observeAll(_rentableIds, pid);
    });

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
