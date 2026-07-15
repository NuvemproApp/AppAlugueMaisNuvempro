/* aluguemais — storefront script v1.0.0
 * Injetado na vitrine via "Script" no Portal de Parceiros Nuvemshop.
 * Detecta se o produto da página atual está habilitado para aluguel e,
 * se estiver, insere o seletor de data do evento antes do botão de compra.
 * ES5 puro — sem dependências externas.
 */
!function () {
  'use strict';

  var DEFAULT_API_BASE = 'https://localhost:3001';

  function apiFromScriptTag() {
    var scripts = document.querySelectorAll('script[src*="app.min.js"], script[src*="app.js"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var api = new URL(scripts[i].src, window.location.href).searchParams.get('api');
        if (api) return api;
      } catch (e) { /* ignore */ }
    }
    return '';
  }

  function getConfig() {
    var ls = window.LS || {};
    var lsStore = (ls.store && (ls.store.id || ls.store.store_id)) || '';
    var lsProduct = (ls.product && ls.product.id) || '';
    return {
      apiBase: (apiFromScriptTag() || DEFAULT_API_BASE).replace(/\/$/, ''),
      nuvemshopId: String(lsStore),
      productId: String(lsProduct),
    };
  }

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function fmtDate(key) {
    if (!key) return '';
    var p = String(key).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(key);
  }

  function apiFetch(base, path) {
    return fetch(base + path).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; }).catch(function () { return { status: r.status, body: null }; });
    });
  }

  function findBuyButton() {
    return document.querySelector("[data-store='product-buy-button']")
      || document.querySelector('.js-addtocart');
  }

  function initWidget(cfg) {
    var buyBtn = findBuyButton();
    if (!buyBtn) return;

    function setBtnText(t) { if ('value' in buyBtn) buyBtn.value = t; else buyBtn.textContent = t; }
    function enableBtn(on) { if (on) buyBtn.removeAttribute('disabled'); else buyBtn.setAttribute('disabled', 'true'); }
    setBtnText('Alugar');
    enableBtn(false);

    var wrap = document.createElement('div');
    wrap.className = 'alm-data-evento my-3';

    var label = document.createElement('label');
    label.setAttribute('for', 'alm_dataEvento');
    label.textContent = 'Informe a data da reserva:';
    label.style.cssText = 'display:block;margin-bottom:4px;font-size:13px;font-weight:600;';

    var input = document.createElement('input');
    input.type = 'date';
    input.id = 'alm_dataEvento';
    input.name = 'properties[Data do Evento]';
    input.min = todayKey();
    input.className = 'form-control';
    input.style.cssText = 'padding:8px;border:1px solid #ccc;border-radius:8px;max-width:260px;';

    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;margin-top:6px;min-height:18px;';

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(msg);

    var anchor = (buyBtn.parentElement && buyBtn.parentElement.parentElement) || buyBtn.parentElement || buyBtn;
    anchor.insertAdjacentElement('beforebegin', wrap);

    function setMsg(text, color) { msg.textContent = text || ''; msg.style.color = color || '#666'; }

    function getQty() {
      var qi = document.querySelector('.js-quantity-input') || document.querySelector('input[name="quantity"]');
      var q = qi ? parseInt(qi.value, 10) : 1;
      return q && q > 0 ? q : 1;
    }

    function check() {
      var v = input.value;
      var selected = new Date(v + 'T00:00:00');
      if (!v || isNaN(selected.getTime())) { enableBtn(false); setMsg('Selecione uma data válida.', '#b91c1c'); return; }

      var now = new Date();
      if (cfg.daysBefore && now.getTime() + cfg.daysBefore * 86400000 >= selected.getTime()) {
        enableBtn(false);
        setMsg('Data insuficiente: escolha com mais antecedência.', '#b91c1c');
        return;
      }

      var qty = getQty();
      enableBtn(false); setMsg('Verificando disponibilidade...', '#666');
      apiFetch(cfg.apiBase, '/storefront/' + cfg.nuvemshopId + '/products/' + cfg.productId + '/availability?from=' + v + '&to=' + v)
        .then(function (res) {
          var day = res.body && res.body.days && res.body.days[0];
          var remaining = day ? (day.remaining || 0) : 0;
          if (res.status !== 200 || !day) { enableBtn(false); setMsg('Erro ao verificar. Tente novamente.', '#b91c1c'); return; }
          if (remaining <= 0) { enableBtn(false); setMsg('Data indisponível. Tente outra.', '#b91c1c'); return; }
          if (qty > remaining) { enableBtn(false); setMsg('Apenas ' + remaining + ' unidade(s) disponível(is) nesta data.', '#b91c1c'); return; }
          enableBtn(true);
          setMsg('Data disponível! Clique em Alugar.', '#15803d');
        })
        .catch(function () { enableBtn(false); setMsg('Erro ao verificar. Tente novamente.', '#b91c1c'); });
    }

    input.addEventListener('change', check);

    var qInput = document.querySelector('.js-quantity-input') || document.querySelector('input[name="quantity"]');
    if (qInput) { qInput.addEventListener('change', check); qInput.addEventListener('keyup', check); }
    var qDown = document.querySelector('.js-quantity-down');
    var qUp = document.querySelector('.js-quantity-up');
    if (qDown) qDown.addEventListener('click', function () { setTimeout(check, 50); });
    if (qUp) qUp.addEventListener('click', function () { setTimeout(check, 50); });
  }

  function init() {
    var ls = window.LS || {};
    if (!ls.product) return; // não é página de produto

    var cfg = getConfig();
    if (!cfg.nuvemshopId || !cfg.productId) return;

    apiFetch(cfg.apiBase, '/storefront/' + cfg.nuvemshopId + '/products/' + cfg.productId + '/config')
      .then(function (res) {
        if (res.status !== 200 || !res.body || !res.body.enabled) return;
        cfg.daysBefore = res.body.daysBefore || 0;
        initWidget(cfg);
      })
      .catch(function () { /* produto não alugável ou API indisponível */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}();
