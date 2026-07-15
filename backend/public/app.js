/* aluguemais — storefront script v2.1.0
 * Injetado na vitrine via Portal de Parceiros Nuvemshop.
 * Compatível com temas antigos, atuais e componentizados.
 * ES5 puro + fetch + MutationObserver (disponíveis em todos os temas NS).
 */
!function () {
  'use strict';

  // ─── Constantes ───────────────────────────────────────────────────────────────
  var API_FALLBACK = 'https://appaluguemaisnuvempro-production.up.railway.app';
  // Nome da propriedade no carrinho: dinâmico por país (definido após country())
  function propDateName() {
    return isBR() ? 'properties[Data do Evento]' : 'properties[Fecha del Evento]';
  }
  // Rótulo exibido pelo NS no carrinho (sem o "properties[...]")
  function propDateLabel() {
    return isBR() ? 'Data do Evento' : 'Fecha del Evento';
  }

  // ─── API base: lida do parâmetro ?api= da tag <script> ───────────────────────
  function detectApiBase() {
    var tags = document.querySelectorAll(
      'script[src*="app.min.js"],script[src*="app.js"],script[src*="aluguemais"]'
    );
    for (var i = 0; i < tags.length; i++) {
      try {
        var api = new URL(tags[i].src, location.href).searchParams.get('api');
        if (api) return api.replace(/\/$/, '');
      } catch (e) { /* ignore */ }
    }
    return API_FALLBACK;
  }

  // ─── window.LS: store/product info injetada pelo tema Nuvemshop ──────────────
  function ls() { return window.LS || {}; }
  function storeNsId() {
    var s = ls().store || {};
    return String(s.id || s.store_id || '');
  }
  function productNsId() {
    var p = ls().product || {};
    return String(p.id || '');
  }
  function storeCountry() {
    return String((ls().store || {}).country || 'BR').toUpperCase();
  }

  // ─── Textos por país ──────────────────────────────────────────────────────────
  var _country;
  function country() { return _country || (_country = storeCountry()); }
  var isBR = function () { return country() === 'BR'; };
  var isMX = function () { return country() === 'MX'; };

  var TXT = {
    rent: function () { return isBR() ? 'Alugar' : isMX() ? 'Rentar' : 'Alquilar'; },
    defineDate: function () {
      return isBR() ? 'Defina a data do evento'
           : isMX() ? 'Define la fecha del evento'
           : 'Definí la fecha del evento';
    },
    unavailable: function () { return isBR() ? 'Indisponível' : 'No disponible'; },
    checking: function () { return 'Verificando...'; },
    earlyDate: function () {
      return isBR() ? 'Antecedência insuficiente' : 'Anticipación insuficiente';
    },
    dateLabel: function () {
      return isBR() ? 'Informe a data do evento:'
           : isMX() ? 'Ingresa la fecha del evento:'
           : 'Ingresá la fecha del evento:';
    },
    errCheck: function () {
      return isBR() ? 'Erro ao verificar. Tente novamente.'
           : 'Error al verificar. Intentá de nuevo.';
    },
    okHint: function () { return isBR() ? 'Data disponível!' : '¡Fecha disponible!'; },
    earlyHint: function (n) {
      return isBR()
        ? 'Escolha com pelo menos ' + n + ' dia(s) de antecedência.'
        : 'Elegí con al menos ' + n + ' día(s) de anticipación.';
    },
    unavailHint: function () {
      return isBR() ? 'Data indisponível. Escolha outra.' : 'Fecha no disponible. Elegí otra.';
    },
    partialHint: function (n) {
      return isBR()
        ? 'Apenas ' + n + ' unidade(s) disponível(is) nesta data.'
        : 'Solo ' + n + ' unidad(es) disponible(s) en esta fecha.';
    },
  };

  // ─── Utilitários de data ──────────────────────────────────────────────────────
  function today0() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(d, n) {
    return new Date(d.getTime() + n * 86400000);
  }
  function toISO(d) {
    return d.getFullYear() + '-'
      + ('0' + (d.getMonth() + 1)).slice(-2) + '-'
      + ('0' + d.getDate()).slice(-2);
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
      .then(function (data) { cb(null, data); })
      .catch(function (e) { cb(e, null); });
  }

  // ─── Seletores de botão de compra (multi-tema) ────────────────────────────────
  var BUY_SEL = [
    '.js-addtocart',
    '[data-store="product-buy-button"]',
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

  function closestForm(el) {
    var p = el;
    while (p && p !== document.body) {
      if (p.tagName === 'FORM') return p;
      p = p.parentElement;
    }
    return null;
  }

  function findQtyInput() {
    return document.querySelector('.js-quantity-input')
        || document.querySelector('[data-store="product-quantity"] input')
        || document.querySelector('input[name="quantity"]');
  }

  // ─── GRADE DE PRODUTOS ────────────────────────────────────────────────────────
  // Substitui o botão "Comprar" por um link "Alugar" para produtos alugáveis.
  // Preserva todas as classes CSS do botão original para manter o visual do tema.

  var _processed = (function () {
    try {
      var ws = new WeakSet();
      return { has: function (x) { return ws.has(x); }, add: function (x) { ws.add(x); } };
    } catch (e) {
      var arr = [];
      return {
        has: function (x) { return arr.indexOf(x) >= 0; },
        add: function (x) { arr.push(x); },
      };
    }
  })();

  function replaceGridItem(item, ids, skipPid) {
    if (_processed.has(item)) return;
    var pid = parseInt(item.getAttribute('data-product-id'), 10);
    if (!pid) return;
    if (skipPid && pid === parseInt(skipPid, 10)) return; // produto da página atual
    if (ids.indexOf(pid) === -1) return;
    _processed.add(item);

    var buyBtn = findBuyBtn(item);
    if (!buyBtn) return;

    // URL do produto: primeira âncora do card
    var link = item.querySelector('a[href]');
    var href = link ? link.href : location.href;

    // Cria <a> com as mesmas classes do botão (herda visual do tema)
    var a = document.createElement('a');
    a.href = href;
    a.className = buyBtn.className;
    a.setAttribute('aria-label', TXT.rent());
    a.setAttribute('data-alm', '1');

    // Preserva ícone SVG, se houver
    var svg = buyBtn.querySelector('svg')
           || (buyBtn.parentElement && buyBtn.parentElement.querySelector('svg'));
    if (svg) {
      var textSpan = document.createElement('span');
      textSpan.appendChild(document.createTextNode(TXT.rent()));
      a.appendChild(textSpan);
      a.appendChild(svg.cloneNode(true));
    } else {
      a.appendChild(document.createTextNode(TXT.rent()));
    }

    // Remove o form/botão de compra e insere o link de aluguel no mesmo lugar
    var form = closestForm(buyBtn);
    if (form && item.contains(form)) {
      form.insertAdjacentElement('afterend', a);
      form.remove();
    } else {
      buyBtn.parentNode.replaceChild(a, buyBtn);
    }
  }

  function processGrid(ids, skipPid) {
    if (!ids || !ids.length) return;
    var items = document.querySelectorAll('[data-product-id]');
    for (var i = 0; i < items.length; i++) {
      replaceGridItem(items[i], ids, skipPid);
    }
  }

  // ─── CARRINHO: desabilitar quantidade em itens alugáveis ─────────────────────
  // Nuvemshop renderiza properties no carrinho como rótulo visível (ex: "Data do
  // Evento: 2027-05-15"). Detectamos esse rótulo e desabilitamos os controles de
  // quantidade do item pai — tanto na página /comprar quanto no modal lateral.

  // Seletores de controles de quantidade no carrinho (multi-tema)
  var CART_QTY_INPUT = '.js-quantity-input,input[name*="quantity"],input[name*="updates"]';
  var CART_QTY_BTN   = [
    '.js-quantity-down', '.js-quantity-up',
    '[data-quantity-action]',
    '[data-action="decrease-quantity"]', '[data-action="increase-quantity"]',
    '[data-action="minus"]', '[data-action="plus"]',
    'button[aria-label*="quantity"]',
  ].join(',');

  // Rótulos possíveis (português e espanhol) — detectamos ambos por segurança
  var CART_PROP_LABELS = ['Data do Evento', 'Fecha del Evento'];

  // Elementos candidatos a conter o rótulo da propriedade
  var LABEL_CANDIDATES = 'strong,dt,th,td,span,b,p';

  var _cartDone = (function () {
    try {
      var ws = new WeakSet();
      return { has: function (x) { return ws.has(x); }, add: function (x) { ws.add(x); } };
    } catch (e) {
      var arr = [];
      return { has: function (x) { return arr.indexOf(x) >= 0; }, add: function (x) { arr.push(x); } };
    }
  })();

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
    var btns = container.querySelectorAll(CART_QTY_BTN);
    for (var j = 0; j < btns.length; j++) {
      btns[j].style.display = 'none';
    }
  }

  function processCart() {
    var candidates = document.querySelectorAll(LABEL_CANDIDATES);
    for (var i = 0; i < candidates.length; i++) {
      var txt = (candidates[i].textContent || candidates[i].innerText || '').trim();
      if (!txt || txt.length > 60) continue;

      var isLabel = false;
      for (var j = 0; j < CART_PROP_LABELS.length; j++) {
        var lbl = CART_PROP_LABELS[j];
        if (txt === lbl || txt.indexOf(lbl + ':') === 0 || txt.indexOf(lbl + ' :') === 0) {
          isLabel = true;
          break;
        }
      }
      if (!isLabel) continue;

      // Sobe no DOM até achar um ancestral com controles de quantidade
      var p = candidates[i].parentElement;
      for (var depth = 0; depth < 14 && p && p !== document.body; depth++) {
        if (p.querySelector(CART_QTY_INPUT)) {
          applyCartItem(p);
          break;
        }
        p = p.parentElement;
      }
    }
  }

  // Observer unificado: grade de produtos + abertura do carrinho (modal/page)
  function observeAll(ids, skipPid) {
    if (!window.MutationObserver) return;
    var cartTimer;
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n.querySelectorAll) continue;
          if (ids.length) {
            if (n.hasAttribute && n.hasAttribute('data-product-id')) {
              replaceGridItem(n, ids, skipPid);
            }
            var inner = n.querySelectorAll('[data-product-id]');
            for (var k = 0; k < inner.length; k++) {
              replaceGridItem(inner[k], ids, skipPid);
            }
          }
        }
      }
      // Debounce: modal do carrinho injeta vários nós — processa uma vez ao fim
      clearTimeout(cartTimer);
      cartTimer = setTimeout(processCart, 200);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ─── PÁGINA DE PRODUTO ────────────────────────────────────────────────────────
  // Exibe o seletor de data do evento, valida e verifica disponibilidade via API.

  function setBtn(btn, state, text) {
    if (btn.tagName === 'INPUT') btn.value = text;
    else btn.textContent = text;
    if (state === 'enabled') btn.removeAttribute('disabled');
    else btn.setAttribute('disabled', '');
    btn.setAttribute('aria-busy', state === 'checking' ? 'true' : 'false');
  }

  function getQty() {
    var qi = findQtyInput();
    var v = qi ? parseInt(qi.value, 10) : 1;
    return (v && v > 0) ? v : 1;
  }

  var _debounce;
  function debounce(fn, ms) {
    clearTimeout(_debounce);
    _debounce = setTimeout(fn, ms || 350);
  }

  function setupProductPage(apiBase, sid, pid, cfg) {
    var buyBtn = findBuyBtn();
    if (!buyBtn) return;

    var form = closestForm(buyBtn);

    // ── Desabilita o botão imediatamente ─────────────────────────────────────
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
    dateInput.style.cssText = [
      'max-width:280px',
      'padding:8px 12px',
      'font-size:14px',
      'border:1px solid #ccc',
      'border-radius:6px',
      'background:#fff',
      'color:#333',
      'cursor:pointer',
    ].join(';');
    // Validação 3: data mínima = hoje + diasAntes
    dateInput.min = toISO(addDays(today0(), cfg.diasAntes));

    var msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:6px 0 0;font-size:13px;min-height:18px;line-height:1.4;';

    wrap.appendChild(lbl);
    wrap.appendChild(dateInput);
    wrap.appendChild(msgEl);

    // ── Hidden input (submetido dentro do form com properties[...]) ───────────
    var hiddenDate = document.createElement('input');
    hiddenDate.type = 'hidden';
    hiddenDate.name = propDateName();
    hiddenDate.id = 'alm-hidden-date';

    // Insere picker antes do container do botão (multi-tema)
    var insertAnchor = (buyBtn.parentElement && buyBtn.parentElement.parentElement)
      ? buyBtn.parentElement.parentElement
      : (buyBtn.parentElement || buyBtn);
    insertAnchor.insertAdjacentElement('beforebegin', wrap);

    // Hidden input dentro do form para ser submetido junto
    if (form) form.appendChild(hiddenDate);

    // ── Validação + verificação de disponibilidade ─────────────────────────────
    function check() {
      var val = dateInput.value;
      var selected = fromISO(val);

      // Sincroniza o hidden input
      hiddenDate.value = val || '';

      // Validação 1: data deve ser informada
      if (!selected) {
        setBtn(buyBtn, 'disabled', TXT.defineDate());
        msgEl.textContent = '';
        msgEl.style.color = '';
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

      // Validação 5: disponibilidade no intervalo [data - diasAntes, data + diasDepois]
      var qty = getQty();
      setBtn(buyBtn, 'checking', TXT.checking());
      msgEl.textContent = '';

      var from = toISO(addDays(selected, -cfg.diasAntes));
      var to   = toISO(addDays(selected,  cfg.diasDepois));
      var url  = apiBase + '/storefront/' + sid + '/products/' + pid
               + '/availability?from=' + from + '&to=' + to + '&qty=' + qty;

      jsonFetch(url, function (err, data) {
        if (err || !data) {
          setBtn(buyBtn, 'disabled', TXT.defineDate());
          msgEl.style.color = '#c0392b';
          msgEl.textContent = TXT.errCheck();
          return;
        }

        var remaining = data.remaining || 0;

        // Validação 4 + 5: estoque e disponibilidade no período
        if (data.available && remaining >= qty) {
          setBtn(buyBtn, 'enabled', TXT.rent());
          msgEl.style.color = '#27ae60';
          msgEl.textContent = TXT.okHint()
            + (remaining > 1 ? ' (' + remaining + ')' : '');
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

    // Reagir a mudanças de quantidade
    var qInput = findQtyInput();
    if (qInput) {
      qInput.addEventListener('change', function () { if (dateInput.value) debounce(check, 350); });
      qInput.addEventListener('keyup',  function () { if (dateInput.value) debounce(check, 350); });
    }
    var qDown = document.querySelector('.js-quantity-down');
    var qUp   = document.querySelector('.js-quantity-up');
    if (qDown) qDown.addEventListener('click', function () { if (dateInput.value) setTimeout(check, 60); });
    if (qUp)   qUp.addEventListener('click',   function () { if (dateInput.value) setTimeout(check, 60); });
  }

  // ─── Inicialização ────────────────────────────────────────────────────────────
  function init() {
    var apiBase = detectApiBase();
    var sid = storeNsId();
    if (!sid) return;

    var pid = productNsId();

    // Carrega IDs alugáveis e processa a grade em TODAS as páginas
    jsonFetch(apiBase + '/storefront/' + sid + '/rentable-ids', function (err, data) {
      var ids = (data && Array.isArray(data.ids)) ? data.ids : [];
      processGrid(ids, pid);  // pula o produto atual (tratado à parte)
      observeAll(ids, pid);   // grade + carrinho modal/page
    });

    // Processa o carrinho já presente no DOM (página /comprar)
    processCart();

    // Comportamento adicional só na página de produto
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
