import { requireAuth, logout } from './auth.js';
import { db } from './firebase.js';
import {
  BRANDS, DELIVERY_TERMS, DELIVERY_TERM_LAYERS, LOCAL_COST_LAYERS,
  COST_UNITS, CONTACT, PAYMENT_TERMS, LOCAL_TRANSPORT_TYPES,
  MANDATORY_ITEMS, buildMandatoryItems, parseNum
} from './config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ============================================================
// ESTADO
// ============================================================
let currentUser = null;
let products = [];
let costTables = [];
let currentProduct = null;
let currentQuoteId = null;
let currentQuoteNumber = null;
let isDraft = false;
let selectedQuotePhoto = null;
let selectedPaymentTerm = '';
let customPayment = '';

// Capas de costo: paralelo a LOCAL_COST_LAYERS — pre-poblado con obligatorios
function initLayersWithMandatory() {
  const mandatory = buildMandatoryItems('local');
  return LOCAL_COST_LAYERS.map(l => ({
    ...l,
    items: mandatory.filter(mi => mi.layer === l.id).map(mi => ({ ...mi }))
  }));
}
let layers = initLayersWithMandatory();

// Comisión
let commission = { pct: 0, base: 'cost', fixed_per_shipment: 0, fixed_per_quote: 0 };

// Lock mode
let lockMode = 'margin';

// Marca seleccionada
let currentBrand = 'manila';

// ============================================================
// INIT
// ============================================================
async function init() {
  currentUser = await requireAuth();
  document.getElementById('nav-user').textContent = currentUser.email;
  document.getElementById('btn-logout').addEventListener('click', logout);

  await Promise.all([loadProducts(), loadCostTables()]);
  populateDeliveryTerms();
  populateTransportTypes();
  populatePaymentTerms();
  renderLayers();
  bindPanelEvents();
  recalculate();

  const params = new URLSearchParams(window.location.search);
  const draftId = params.get('draft');
  const copyId = params.get('copy');
  const printMode = params.get('print');
  if (draftId) {
    await loadDraft(draftId);
    if (printMode === 'client' || printMode === 'internal') {
      const isReadOnly = params.get('readonly') === '1';
      if (isReadOnly) {
        document.querySelector('.quote-layout').style.display = 'none';
        window.addEventListener('afterprint', () => {
          window.location.href = 'history-local.html';
        }, { once: true });
      }
      setTimeout(() => printQuote(printMode), 400);
    }
  } else if (copyId) {
    await loadCopy(copyId);
  } else {
    await assignQuoteNumber();
  }
}

// ============================================================
// FIREBASE: CARGA DE DATOS
// ============================================================
async function loadProducts() {
  const snap = await getDocs(collection(db, 'products-local'));
  products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  products.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const sel = document.getElementById('product-select');
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

async function loadCostTables() {
  const snap = await getDocs(collection(db, 'cost_tables'));
  costTables = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function assignQuoteNumber() {
  try {
    const counterRef = doc(db, 'metadata', 'counters');
    let nextNum = 1;
    await runTransaction(db, async tx => {
      const snap = await tx.get(counterRef);
      nextNum = snap.exists() ? (snap.data().quote_local_next ?? 1) : 1;
      tx.set(counterRef, { quote_local_next: nextNum + 1 }, { merge: true });
    });
    const year = new Date().getFullYear();
    currentQuoteNumber = `LOC-${year}-${String(nextNum).padStart(3, '0')}`;
    currentQuoteId = currentQuoteNumber;
  } catch (e) {
    currentQuoteNumber = `LOC-TEMP-${Date.now()}`;
    currentQuoteId = currentQuoteNumber;
  }
  document.getElementById('panel-quote-number').textContent = currentQuoteNumber;
}

async function loadDraft(id) {
  const snap = await getDoc(doc(db, 'quotes-local', id));
  if (!snap.exists()) return;
  const data = snap.data();
  currentQuoteId = id;
  currentQuoteNumber = data.quote_number;
  isDraft = true;
  document.getElementById('panel-quote-number').textContent = currentQuoteNumber + ' (borrador)';
  populateFromData(data);
}

async function loadCopy(id) {
  const snap = await getDoc(doc(db, 'quotes-local', id));
  if (!snap.exists()) return;
  const data = snap.data();
  await assignQuoteNumber();
  document.title = `Cotización copiada de ${data.quote_number}`;
  populateFromData(data, true);
}

function populateFromData(data, isCopy = false) {
  if (data.client) {
    document.getElementById('client-name').value = data.client.name ?? '';
    document.getElementById('client-city').value = data.client.city ?? '';
    document.getElementById('client-contact').value = data.client.contact ?? '';
    document.getElementById('client-address').value = data.client.address ?? '';
  }
  if (data.delivery_term) document.getElementById('delivery-term-select').value = data.delivery_term;
  if (data.transport_type) document.getElementById('transport-type').value = data.transport_type;
  if (data.volume_kg) document.getElementById('volume-kg').value = data.volume_kg;
  if (data.num_shipments) document.getElementById('num-shipments').value = data.num_shipments;
  if (data.valid_days) document.getElementById('valid-days').value = data.valid_days;
  if (data.lead_time) document.getElementById('lead-time').value = data.lead_time;
  if (data.usd_ars_rate) document.getElementById('usd-ars-rate').value = data.usd_ars_rate;
  if (data.client_comments) document.getElementById('client-comments').value = data.client_comments;
  if (data.notes) document.getElementById('quote-notes').value = data.notes;
  if (data.alias) document.getElementById('quote-alias').value = data.alias;
  if (data.margin_pct) document.getElementById('margin-pct').value = data.margin_pct;

  // Brand
  if (data.brand && BRANDS[data.brand]) {
    currentBrand = data.brand;
    document.querySelectorAll('#brand-switcher .brand-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.brand === currentBrand);
    });
  }

  // Payment term
  if (data.payment_term) {
    selectedPaymentTerm = data.payment_term;
    document.querySelectorAll('.payment-term-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.term === selectedPaymentTerm);
    });
    if (selectedPaymentTerm === 'custom' && data.custom_payment) {
      customPayment = data.custom_payment;
      document.getElementById('custom-payment').value = customPayment;
      document.getElementById('custom-payment-wrap').style.display = '';
    }
  }

  // Producto snapshot
  if (data.product) {
    currentProduct = data.product;
    selectedQuotePhoto = data.product?.photo ?? null;
    const productSel = document.getElementById('product-select');
    productSel.value = data.product.id ?? '';
    const thumbWrap = document.getElementById('product-thumb-wrap');
    if (currentProduct.photo) {
      thumbWrap.innerHTML = `<img class="product-thumb" src="${currentProduct.photo}" alt="${currentProduct.name}">`;
      thumbWrap.className = '';
    } else {
      thumbWrap.innerHTML = '<span>📦</span>';
      thumbWrap.className = 'product-thumb-placeholder';
    }
    const catalogProduct = products.find(x => x.id === data.product.id);
    if (catalogProduct) renderQuotePhotoGallery(catalogProduct);
  }

  // Comisión
  if (data.commission) commission = { ...data.commission };

  if (data.cost_layers) {
    layers = LOCAL_COST_LAYERS.map(l => {
      const saved = data.cost_layers.find(sl => sl.layer_id === l.id);
      return { ...l, items: saved ? saved.items.map(item => ({ ...item })) : [] };
    });
    ensureMandatoryItems();
    renderLayers();
  }

  recalculate();
}

// ============================================================
// POPULATE SELECTS
// ============================================================
function populateDeliveryTerms() {
  const sel = document.getElementById('delivery-term-select');
  DELIVERY_TERMS.forEach(dt => {
    const opt = document.createElement('option');
    opt.value = dt.id;
    opt.textContent = dt.name;
    sel.appendChild(opt);
  });
}

function populateTransportTypes() {
  const sel = document.getElementById('transport-type');
  LOCAL_TRANSPORT_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });
}

function populatePaymentTerms() {
  const container = document.getElementById('payment-terms-selector');
  PAYMENT_TERMS.forEach(pt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'payment-term-btn';
    btn.dataset.term = pt.id;
    btn.textContent = pt.name;
    btn.addEventListener('click', () => {
      selectedPaymentTerm = pt.id;
      document.querySelectorAll('.payment-term-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('custom-payment-wrap').style.display = pt.id === 'custom' ? '' : 'none';
      renderChecklist();
    });
    container.appendChild(btn);
  });
}

// ============================================================
// EVENTOS DEL PANEL
// ============================================================
function bindPanelEvents() {
  document.getElementById('product-select').addEventListener('change', onProductChange);

  const panelInputs = ['volume-kg', 'num-shipments', 'margin-pct', 'usd-ars-rate'];
  panelInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', recalculate);
  });
  document.getElementById('delivery-term-select').addEventListener('change', recalculate);
  document.getElementById('target-price').addEventListener('input', onTargetPriceChange);

  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', () => setLockMode(btn.dataset.lock));
  });
  setLockMode('margin');

  // Brand switcher
  document.querySelectorAll('#brand-switcher .brand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentBrand = btn.dataset.brand;
      document.querySelectorAll('#brand-switcher .brand-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Checklist: campos que no disparan recalculate
  document.getElementById('client-name').addEventListener('input', () => renderChecklist());

  document.getElementById('btn-confirm').addEventListener('click', confirmQuote);
  document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
  document.getElementById('btn-print-client').addEventListener('click', () => printQuote('client'));
  document.getElementById('btn-print-internal').addEventListener('click', () => printQuote('internal'));
}

function onProductChange() {
  const sel = document.getElementById('product-select');
  const p = products.find(x => x.id === sel.value);
  currentProduct = p ?? null;
  selectedQuotePhoto = null;

  const thumbWrap = document.getElementById('product-thumb-wrap');
  if (p && p.photo) {
    thumbWrap.innerHTML = `<img class="product-thumb" src="${p.photo}" alt="${p.name}">`;
    thumbWrap.className = '';
  } else {
    thumbWrap.innerHTML = '<span>📦</span>';
    thumbWrap.className = 'product-thumb-placeholder';
  }

  renderQuotePhotoGallery(p);
  recalculate();
}

function renderQuotePhotoGallery(product) {
  const gallery = document.getElementById('quote-photo-gallery');
  const photos = product?.available_photos ?? [];
  if (!photos.length) { gallery.style.display = 'none'; return; }

  gallery.style.display = '';
  gallery.innerHTML = photos.length > 1 ? '<span class="qpg-label">Elegir foto:</span>' : '';
  photos.forEach(src => {
    const item = document.createElement('div');
    item.className = 'qpg-item' + (src === (selectedQuotePhoto || product.photo) ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.addEventListener('click', () => {
      selectedQuotePhoto = src;
      const thumbWrap = document.getElementById('product-thumb-wrap');
      thumbWrap.innerHTML = `<img class="product-thumb" src="${src}" alt="${product.name}">`;
      thumbWrap.className = '';
      gallery.querySelectorAll('.qpg-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
    gallery.appendChild(item);
  });
}

// ============================================================
// RENDER CAPAS DE COSTO
// ============================================================
function renderLayers() {
  const container = document.getElementById('layers-container');
  container.innerHTML = '';

  layers.forEach((layer, layerIdx) => {
    const section = document.createElement('div');
    section.className = 'layer-section';
    section.dataset.layer = layerIdx;

    const yieldBadge = layer.applies_yield
      ? `<span class="layer-yield-badge" id="materia-prima-yield-badge">ajustado por rendimiento</span>`
      : '';
    const processingYieldSlot = layer.id === 'processing'
      ? `<span class="layer-yield-effective" id="processing-yield-display">Rdto: —</span><div id="yield-warning" class="yield-warning" style="display:none"></div>`
      : '';

    section.innerHTML = `
      <div class="layer-header" data-layer="${layerIdx}">
        <span class="layer-toggle">▼</span>
        <h3>${layer.name}</h3>
        ${yieldBadge}${processingYieldSlot}
        <span class="layer-total" id="layer-total-${layerIdx}">$0.00/kg</span>
      </div>
      <div class="layer-body" id="layer-body-${layerIdx}">
        <div id="layer-items-${layerIdx}"></div>
        <button class="btn-add" data-layer="${layerIdx}">＋ Agregar ítem</button>
      </div>
    `;

    container.appendChild(section);

    section.querySelector('.layer-header').addEventListener('click', (e) => {
      if (e.target.closest('.btn-add')) return;
      const body = section.querySelector('.layer-body');
      const header = section.querySelector('.layer-header');
      body.style.display = body.style.display === 'none' ? '' : 'none';
      header.classList.toggle('collapsed', body.style.display === 'none');
    });

    section.querySelector('.btn-add').addEventListener('click', (e) => {
      e.stopPropagation();
      addItem(layerIdx);
    });

    renderLayerItems(layerIdx);
  });

  renderCommissionSection(container);
}

function renderLayerItems(layerIdx) {
  const container = document.getElementById(`layer-items-${layerIdx}`);
  container.innerHTML = '';
  layers[layerIdx].items.forEach((item, itemIdx) => {
    container.appendChild(createItemRow(layerIdx, itemIdx));
  });
}

function createItemRow(layerIdx, itemIdx) {
  const item = layers[layerIdx].items[itemIdx];
  const layer = layers[layerIdx];
  const isProcessing = layer.id === 'processing';
  const row = document.createElement('div');
  row.className = 'cost-item';
  if (item.mandatory) row.classList.add('mandatory-item');
  row.dataset.item = itemIdx;

  const unitOptions = COST_UNITS.map(u =>
    `<option value="${u.id}" ${item.variable_unit === u.id ? 'selected' : ''}>${u.label}</option>`
  ).join('');

  const needsUnitKg = COST_UNITS.find(u => u.id === item.variable_unit)?.needs_unit_kg ?? false;
  const isArs = item.currency === 'ARS';
  if (isArs) row.classList.add('ars-item');
  const nameReadonly = item.mandatory ? 'readonly' : '';

  row.innerHTML = `
    <div class="cost-item-row1">
      <div class="item-name">
        <input type="text" placeholder="Concepto..." value="${item.name ?? ''}" data-field="name" ${nameReadonly}>
      </div>
      <div class="source-toggle">
        <button class="${item.source !== 'table' ? 'active' : ''}" data-src="manual">Manual</button>
        <button class="${item.source === 'table' ? 'active' : ''}" data-src="table">Tabla</button>
      </div>
      <div class="currency-toggle" style="display:none">
        <button class="active ars-active" data-currency="ARS">ARS $</button>
      </div>
      ${item.mandatory ? '' : '<button class="btn-icon" title="Eliminar">✕</button>'}
    </div>
    <div class="cost-item-row2">
      <div class="item-field field-value">
        <label>Valor</label>
        <input type="text" inputmode="decimal" placeholder="0.00" value="${item.variable_value ?? ''}" data-field="variable_value">
      </div>
      <div class="item-field field-unit">
        <label>Unidad</label>
        <select data-field="variable_unit">${unitOptions}</select>
      </div>
      <div class="item-field field-unitkg" style="display:${needsUnitKg ? '' : 'none'}">
        <label>kg/unidad</label>
        <input type="text" inputmode="decimal" placeholder="10" value="${item.variable_unit_kg ?? ''}" data-field="variable_unit_kg">
      </div>
      <div class="item-field field-fship">
        <label>Fijo/ent. $</label>
        <input type="text" inputmode="decimal" placeholder="0" value="${item.fixed_per_shipment ?? ''}" data-field="fixed_per_shipment">
      </div>
      <div class="item-field field-fquote">
        <label>Fijo/coti. $</label>
        <input type="text" inputmode="decimal" placeholder="0" value="${item.fixed_per_quote ?? ''}" data-field="fixed_per_quote">
      </div>
      ${isProcessing ? `
      <div class="item-field field-yield">
        <label>Rdto%</label>
        <input type="text" inputmode="decimal" placeholder="—" value="${item.yield_pct ?? ''}" data-field="yield_pct">
      </div>` : '<div class="item-field field-yield-placeholder"></div>'}
      <div class="item-result na" data-result="${layerIdx}-${itemIdx}">$0.000/kg</div>
    </div>
  `;

  // Currency toggle
  row.querySelectorAll('.currency-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      item.currency = btn.dataset.currency;
      row.querySelectorAll('.currency-toggle button').forEach(b => b.classList.remove('active', 'ars-active'));
      btn.classList.add('active');
      if (item.currency === 'ARS') { btn.classList.add('ars-active'); row.classList.add('ars-item'); }
      else { row.classList.remove('ars-item'); }
      recalculate();
    });
  });

  // Source toggle
  row.querySelectorAll('.source-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      item.source = btn.dataset.src;
      row.querySelectorAll('.source-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.src === 'table') showTablePicker(layerIdx, itemIdx, row);
      recalculate();
    });
  });

  // Field changes
  row.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const field = input.dataset.field;
      const numericFields = ['variable_value', 'variable_unit_kg', 'fixed_per_shipment', 'fixed_per_quote', 'yield_pct'];
      item[field] = numericFields.includes(field) ? (parseNum(input.value) || null) : input.value;
      if (field === 'variable_unit') {
        const needsKg = COST_UNITS.find(u => u.id === item.variable_unit)?.needs_unit_kg ?? false;
        row.querySelector('.field-unitkg').style.display = needsKg ? '' : 'none';
      }
      recalculate();
    });
  });

  // Delete (solo para ítems no obligatorios)
  const deleteBtn = row.querySelector('.btn-icon');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      layers[layerIdx].items.splice(itemIdx, 1);
      renderLayerItems(layerIdx);
      recalculate();
    });
  }

  return row;
}

function addItem(layerIdx) {
  const layerId = layers[layerIdx].id;
  const isProcessing = layerId === 'processing';
  const isPackaging = layerId === 'packaging';
  layers[layerIdx].items.push({
    name: '', source: 'manual', table_ref: null, currency: 'ARS',
    variable_value: 0, variable_unit: isPackaging ? 'box' : 'kg', variable_unit_kg: isPackaging ? 10 : null,
    fixed_per_shipment: 0, fixed_per_quote: 0, cost_per_kg_calc: 0, notes: '',
    ...(isProcessing ? { yield_pct: null } : {})
  });
  renderLayerItems(layerIdx);
  const newRow = document.getElementById(`layer-items-${layerIdx}`).lastElementChild;
  if (newRow) newRow.querySelector('input[data-field="name"]')?.focus();
  recalculate();
}

function showTablePicker(layerIdx, itemIdx, row) {
  const layerId = layers[layerIdx].id;
  const tables = costTables.filter(t => t.layer === layerId);
  if (!tables.length) {
    alert('No hay ítems de tabla para esta capa. Agregalos en Admin → Tablas de costos.');
    return;
  }

  const select = document.createElement('select');
  select.style.cssText = 'position:fixed;z-index:999;background:#fff;border:2px solid var(--accent);padding:8px;border-radius:6px;font-size:13px;font-family:var(--font);box-shadow:0 4px 20px rgba(0,0,0,0.15)';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Elegir ítem de tabla —';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);
  tables.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  const rect = row.getBoundingClientRect();
  select.style.top = (rect.bottom + 4) + 'px';
  select.style.left = rect.left + 'px';
  document.body.appendChild(select);
  select.focus();

  select.addEventListener('change', () => {
    const t = tables.find(x => x.id === select.value);
    if (t) {
      const item = layers[layerIdx].items[itemIdx];
      item.name = t.name;
      item.table_ref = t.id;
      item.currency = t.currency ?? 'ARS';
      item.variable_value = t.variable_value ?? 0;
      item.variable_unit = t.variable_unit ?? 'kg';
      item.variable_unit_kg = t.variable_unit_kg ?? null;
      item.fixed_per_shipment = t.fixed_per_shipment ?? 0;
      item.fixed_per_quote = t.fixed_per_quote ?? 0;
      item.notes = t.notes ?? '';
      renderLayerItems(layerIdx);
      recalculate();
    }
    document.body.removeChild(select);
  });

  select.addEventListener('blur', () => {
    setTimeout(() => { if (document.body.contains(select)) document.body.removeChild(select); }, 200);
  });
}

// ============================================================
// COMISIÓN
// ============================================================
function renderCommissionSection(container) {
  const wrap = container ?? document.getElementById('layers-container');
  let section = document.getElementById('commission-section');
  if (section) section.remove();

  section = document.createElement('div');
  section.id = 'commission-section';
  section.className = 'commission-section';
  section.innerHTML = `
    <h3>
      Comisión comercial
      <span class="comm-total" id="comm-total">$0.00/kg</span>
    </h3>
    <div class="commission-grid">
      <div>
        <label>Porcentaje</label>
        <input type="text" inputmode="decimal" id="comm-pct" value="${commission.pct}" placeholder="0">
      </div>
      <div>
        <label>Base de cálculo</label>
        <select id="comm-base">
          <option value="plant_exit" ${commission.base === 'plant_exit' ? 'selected' : ''}>% sobre precio salida planta</option>
          <option value="price" ${commission.base === 'price' ? 'selected' : ''}>% sobre precio final venta</option>
          <option value="cost" ${commission.base === 'cost' ? 'selected' : ''}>% sobre costo total</option>
        </select>
      </div>
      <div>
        <label>Fijo/entrega ($)</label>
        <input type="text" inputmode="decimal" id="comm-fixed-ship" value="${commission.fixed_per_shipment}" placeholder="0">
      </div>
      <div>
        <label>Fijo/cotización ($)</label>
        <input type="text" inputmode="decimal" id="comm-fixed-quote" value="${commission.fixed_per_quote}" placeholder="0">
      </div>
    </div>
  `;

  wrap.appendChild(section);

  ['comm-pct', 'comm-base', 'comm-fixed-ship', 'comm-fixed-quote'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      commission.pct = parseNum(document.getElementById('comm-pct').value) || 0;
      commission.base = document.getElementById('comm-base').value;
      commission.fixed_per_shipment = parseNum(document.getElementById('comm-fixed-ship').value) || 0;
      commission.fixed_per_quote = parseNum(document.getElementById('comm-fixed-quote').value) || 0;
      recalculate();
    });
  });
}

// ============================================================
// YIELD EFECTIVO
// ============================================================
const PLANT_LAYERS = ['raw_material', 'processing', 'packaging'];

function getPlantExitCost() {
  return layers
    .filter(l => PLANT_LAYERS.includes(l.id))
    .reduce((sum, l) => sum + l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0), 0);
}

// Alias para el motor ARS
function getPlantExitCostArs() {
  return getPlantExitCost();  // cost_per_kg_calc ahora es ARS
}

function computeEffectiveYield() {
  const processingLayer = layers.find(l => l.id === 'processing');
  if (!processingLayer) return 1;
  let ey = 1;
  processingLayer.items.forEach(item => {
    if (item.yield_pct && item.yield_pct > 0) ey *= item.yield_pct / 100;
  });
  return ey;
}

// ============================================================
// CÁLCULO PRINCIPAL — todo en ARS
// ============================================================
function recalculate() {
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShipmentsEl = document.getElementById('num-shipments');
  if (volumeKg === 0 && parseInt(numShipmentsEl.value) > 1) numShipmentsEl.value = 1;
  const numShipments = parseInt(numShipmentsEl.value) || 1;
  const effectiveYield = computeEffectiveYield();
  let marginPct = parseNum(document.getElementById('margin-pct').value) / 100 || 0;
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;
  const fmtArs = v => `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Yield display
  const yieldDisplay = document.getElementById('processing-yield-display');
  if (yieldDisplay) {
    const hasYield = layers.find(l => l.id === 'processing')?.items.some(i => i.yield_pct > 0);
    yieldDisplay.textContent = hasYield
      ? `Rdto efectivo: ${(effectiveYield * 100).toFixed(1)}%`
      : 'Rdto: sin definir';
    yieldDisplay.className = 'layer-yield-effective' + (hasYield ? '' : ' undefined');
  }

  // Yield deviation warning
  const yieldWarning = document.getElementById('yield-warning');
  if (yieldWarning) {
    const actual = effectiveYield * 100;
    const expected = currentProduct?.default_yield_pct;
    if (expected && actual !== expected) {
      const deviation = Math.abs(actual - expected) / expected * 100;
      if (deviation > 10) {
        yieldWarning.style.display = '';
        yieldWarning.textContent = `⚠ Rdto ${actual.toFixed(1)}% difiere ${deviation.toFixed(0)}% del standard (${expected}%)`;
      } else {
        yieldWarning.style.display = 'none';
      }
    } else {
      yieldWarning.style.display = 'none';
    }
  }

  const mpBadge = document.getElementById('materia-prima-yield-badge');
  if (mpBadge && effectiveYield < 1) {
    mpBadge.textContent = `÷ ${(effectiveYield * 100).toFixed(1)}% rdto`;
  }

  // Rate warning — solo si NO hay TC y hay ítems en USD legacy
  const rateInput = document.getElementById('usd-ars-rate');
  const rateLabel = rateInput?.closest('.form-row')?.querySelector('label');
  const hasUsdItems = layers.some(l => l.items.some(i => i.currency === 'USD'));
  if (hasUsdItems && !usdArsRate) {
    rateInput?.classList.add('rate-warning');
    if (rateLabel) rateLabel.classList.add('rate-warning-label');
  } else {
    rateInput?.classList.remove('rate-warning');
    if (rateLabel) rateLabel.classList.remove('rate-warning-label');
  }

  let totalCostPerKgArs = 0;  // todo en ARS

  layers.forEach((layer, idx) => {
    let layerTotal = 0;

    layer.items.forEach((item, itemIdx) => {
      const rawPerKg = calcItemCostPerKgRaw(item, volumeKg, numShipments);
      // Convertir a ARS: items ARS se quedan, items USD se multiplican por TC
      const costPerKgArs = item.currency === 'USD'
        ? (usdArsRate > 0 ? rawPerKg * usdArsRate : 0)
        : rawPerKg;
      const adjusted = layer.applies_yield && effectiveYield > 0 ? costPerKgArs / effectiveYield : costPerKgArs;
      item.cost_per_kg_calc = adjusted;  // ahora en ARS
      layerTotal += adjusted;

      const resultEl = document.querySelector(`[data-result="${idx}-${itemIdx}"]`);
      if (resultEl) {
        if (adjusted > 0) {
          resultEl.textContent = `${fmtArs(adjusted)}/kg`;
          resultEl.classList.remove('na');
        } else {
          resultEl.textContent = '$0,00/kg';
          resultEl.classList.add('na');
        }
      }
    });

    totalCostPerKgArs += layerTotal;
    const totalEl = document.getElementById(`layer-total-${idx}`);
    if (totalEl) totalEl.textContent = `${fmtArs(layerTotal)}/kg`;
  });

  // Lock price mode — todo en ARS directo
  if (lockMode === 'price') {
    const tp = parseNum(document.getElementById('target-price').value);
    if (tp > 0) {
      const cfl = volumeKg > 0
        ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
        : 0;
      let nm;
      if (commission.base === 'cost') {
        const base = totalCostPerKgArs * (1 + commission.pct / 100) + cfl;
        nm = base > 0 ? (tp / base - 1) * 100 : 0;
      } else if (commission.base === 'plant_exit') {
        const pe = getPlantExitCostArs();
        const base = totalCostPerKgArs + pe * (commission.pct / 100);
        nm = base > 0 ? ((tp - cfl) / base - 1) * 100 : 0;
      } else {
        const netP = tp * (1 - commission.pct / 100) - cfl;
        nm = totalCostPerKgArs > 0 ? (netP / totalCostPerKgArs - 1) * 100 : 0;
      }
      if (isFinite(nm) && nm >= -99) {
        marginPct = Math.max(0, nm) / 100;
        const marginEl = document.getElementById('margin-pct');
        if (document.activeElement !== marginEl) marginEl.value = Math.max(0, nm).toFixed(1);
      }
    }
  }

  // Comisión — en ARS
  const commFixedPerKg = volumeKg > 0
    ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
    : 0;

  let commPerKgArs = 0;
  let pricePerKgArs = 0;

  if (commission.base === 'cost') {
    commPerKgArs = totalCostPerKgArs * (commission.pct / 100) + commFixedPerKg;
    pricePerKgArs = (totalCostPerKgArs + commPerKgArs) * (1 + marginPct);
  } else if (commission.base === 'plant_exit') {
    const plantExitPrice = getPlantExitCostArs() * (1 + marginPct);
    commPerKgArs = plantExitPrice * (commission.pct / 100) + commFixedPerKg;
    pricePerKgArs = totalCostPerKgArs * (1 + marginPct) + commPerKgArs;
  } else {
    const base = totalCostPerKgArs * (1 + marginPct) + commFixedPerKg;
    pricePerKgArs = base / (1 - commission.pct / 100);
    commPerKgArs = pricePerKgArs * (commission.pct / 100) + commFixedPerKg;
  }

  // USD solo como referencia
  const pricePerKgUsd = usdArsRate > 0 ? pricePerKgArs / usdArsRate : 0;
  const totalCostPerKgUsd = usdArsRate > 0 ? totalCostPerKgArs / usdArsRate : 0;

  // Commission total
  const commTotalEl = document.getElementById('comm-total');
  if (commTotalEl) commTotalEl.textContent = `${fmtArs(commPerKgArs)}/kg`;

  // Summary
  renderSummary(layers, totalCostPerKgArs, commPerKgArs, marginPct, pricePerKgArs, volumeKg, usdArsRate);

  // Price highlight — en ARS
  if (pricePerKgArs > 0) {
    document.getElementById('price-kg').textContent = `$${Math.round(pricePerKgArs).toLocaleString('es-AR')}/kg`;
    document.getElementById('price-usd').textContent = '';
    document.getElementById('btn-confirm').disabled = false;
    document.getElementById('btn-print-client').disabled = false;
    document.getElementById('btn-print-internal').disabled = false;
  } else {
    document.getElementById('price-kg').textContent = '$ —';
    document.getElementById('price-usd').textContent = '';
    document.getElementById('btn-confirm').disabled = true;
    document.getElementById('btn-print-client').disabled = true;
    document.getElementById('btn-print-internal').disabled = true;
  }

  // Sync target-price
  const targetPriceEl = document.getElementById('target-price');
  if (lockMode !== 'price' && targetPriceEl && document.activeElement !== targetPriceEl) {
    targetPriceEl.value = pricePerKgArs > 0 ? Math.round(pricePerKgArs) : '';
  }

  // Delivery coverage
  renderDeliveryCoverage();

  // Warnings
  renderWarnings(effectiveYield, totalCostPerKgArs, marginPct, usdArsRate);

  // Checklist de completitud
  renderChecklist();

  return { totalCostPerKg: totalCostPerKgUsd, totalCostPerKgArs, commPerKg: commPerKgArs, pricePerKgUsd, pricePerKgArs, marginPct };
}

function onTargetPriceChange() {
  // target-price en ARS
  recalculate();
}

function setLockMode(mode) {
  lockMode = mode;
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lock === mode);
  });
  const marginEl = document.getElementById('margin-pct');
  const priceEl = document.getElementById('target-price');
  if (mode === 'price') {
    marginEl.classList.add('field-computed');
    priceEl.classList.remove('field-computed');
  } else {
    marginEl.classList.remove('field-computed');
    priceEl.classList.add('field-computed');
  }
  recalculate();
}

// ============================================================
// WARNINGS
// ============================================================
function renderWarnings(effectiveYield, totalCostPerKg, marginPct, usdArsRate) {
  const container = document.getElementById('quote-warnings');
  if (!container) return;
  const warnings = [];

  const mpLayer = layers.find(l => l.id === 'raw_material');
  if (mpLayer && mpLayer.items.length === 0) {
    warnings.push('Sin materia prima — ¿falta agregar el costo del pescado?');
  }
  const procLayer = layers.find(l => l.id === 'processing');
  if (procLayer && procLayer.items.length === 0) {
    warnings.push('Sin Proceso en Planta — el costo de mano de obra no está incluido.');
  }
  if (mpLayer && mpLayer.items.length > 0 && effectiveYield >= 0.99) {
    warnings.push('Rendimiento 100% — el costo de MP no está ajustado por merma.');
  }
  if (totalCostPerKg > 0 && marginPct <= 0) {
    warnings.push('Margen 0% o negativo.');
  }
  const hasUsdItems = layers.some(l => l.items.some(i => i.currency === 'USD'));
  if (hasUsdItems && !usdArsRate) {
    warnings.push('Hay ítems en USD y no se definió tipo de cambio.');
  }

  if (warnings.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  container.innerHTML = warnings.map(w => `<div class="quote-warning-item">⚠ ${w}</div>`).join('');
}

function calcItemCostPerKgRaw(item, volumeKg, numShipments) {
  const val = parseFloat(item.variable_value) || 0;
  const unitKg = parseFloat(item.variable_unit_kg) || 1;
  const fixedShip = parseFloat(item.fixed_per_shipment) || 0;
  const fixedQuote = parseFloat(item.fixed_per_quote) || 0;

  let varPerKg = 0;
  switch (item.variable_unit) {
    case 'kg': varPerKg = val; break;
    case 'unit':
    case 'box': varPerKg = unitKg > 0 ? val / unitKg : 0; break;
    case 'load': varPerKg = volumeKg > 0 ? val / volumeKg : 0; break;
    case 'pct_cost':
    case 'pct_price': varPerKg = 0; break;
  }

  const fixedPerKg = volumeKg > 0
    ? (fixedShip * numShipments + fixedQuote) / volumeKg
    : 0;

  return varPerKg + fixedPerKg;
}

function hasArsItems() {
  return layers.some(l => l.items.some(i => i.currency === 'ARS'));
}

function renderDeliveryCoverage() {
  const container = document.getElementById('delivery-coverage');
  if (!container) return;
  const deliveryTerm = document.getElementById('delivery-term-select').value;
  if (!deliveryTerm) { container.innerHTML = ''; return; }

  const def = DELIVERY_TERM_LAYERS[deliveryTerm];
  if (!def) { container.innerHTML = ''; return; }

  const checks = def.required.map(layerId => {
    const layer = layers.find(l => l.id === layerId);
    const hasItems = layer?.items?.length > 0;
    const layerName = layer?.name ?? layerId;
    return { layerName, hasItems };
  });

  let html = `<div class="delivery-coverage">`;
  html += `<div class="delivery-hint">${def.hint}</div>`;

  if (def.required.length > 0) {
    html += `<div class="delivery-checklist">`;
    checks.forEach(({ layerName, hasItems }) => {
      html += `<span class="delivery-check ${hasItems ? 'ok' : 'missing'}">
        ${hasItems ? '✓' : '⚠'} ${layerName}
      </span>`;
    });
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function renderSummary(layers, totalCostArs, commPerKgArs, marginPct, pricePerKgArs, volumeKg, usdArsRate) {
  const container = document.getElementById('cost-summary');
  const fmtArs = v => `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let html = '';

  const effectiveYield = computeEffectiveYield();
  const mpTotal = layers.find(l => l.id === 'raw_material')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
  const procTotal = layers.find(l => l.id === 'processing')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
  const productionSubtotal = mpTotal + procTotal;

  layers.forEach(l => {
    const layerTotal = l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0);
    if (layerTotal === 0 && l.items.length === 0) return;

    if (l.id === 'raw_material' && mpTotal > 0 && effectiveYield < 1) {
      const mpRaw = mpTotal * effectiveYield;
      html += `<div class="cost-summary-row">
        <span class="label">Materia Prima
          <em class="yield-annotation">${fmtArs(mpRaw)} ÷ ${(effectiveYield * 100).toFixed(1)}%</em>
        </span>
        <span class="value">${fmtArs(mpTotal)}/kg</span>
      </div>`;
    } else {
      html += `<div class="cost-summary-row">
        <span class="label">${l.name}</span>
        <span class="value">${fmtArs(layerTotal)}/kg</span>
      </div>`;
    }

    if (l.id === 'processing' && (mpTotal > 0 || procTotal > 0)) {
      html += `<div class="cost-summary-row production-subtotal">
        <span class="label">↳ Costo Mercadería+MO</span>
        <span class="value">${fmtArs(productionSubtotal)}/kg</span>
      </div>`;
    }
  });

  html += `<div class="cost-summary-row separator">
    <span class="label">Subtotal costos</span>
    <span class="value">${fmtArs(totalCostArs)}/kg</span>
  </div>`;

  if (commPerKgArs > 0) {
    html += `<div class="cost-summary-row">
      <span class="label">Comisión</span>
      <span class="value">${fmtArs(commPerKgArs)}/kg</span>
    </div>`;
  }

  const marginAmount = pricePerKgArs - totalCostArs - commPerKgArs;
  html += `<div class="cost-summary-row">
    <span class="label">Margen (${(marginPct * 100).toFixed(1)}%)</span>
    <span class="value">${fmtArs(marginAmount)}/kg</span>
  </div>`;

  if (pricePerKgArs > 0) {
    html += `<div class="cost-summary-row separator" style="font-weight:700">
      <span class="label">Precio de venta</span>
      <span class="value">$${Math.round(pricePerKgArs).toLocaleString('es-AR')}/kg</span>
    </div>`;
  }

  container.innerHTML = html;
}

// ============================================================
// GUARDAR / CONFIRMAR
// ============================================================
function getPaymentTermLabel() {
  if (selectedPaymentTerm === 'custom') {
    return document.getElementById('custom-payment').value.trim() || 'Personalizado';
  }
  const pt = PAYMENT_TERMS.find(p => p.id === selectedPaymentTerm);
  return pt?.name ?? '';
}

function buildQuoteObject(status) {
  const calc = recalculate();
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShipments = parseInt(document.getElementById('num-shipments').value) || 1;
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;

  const costLayersSnapshot = layers.map(l => ({
    layer_id: l.id,
    layer_name: l.name,
    applies_yield: l.applies_yield,
    items: l.items.map(item => ({ ...item })),
    total_per_kg: l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0)
  }));

  return {
    quote_number: currentQuoteNumber,
    quote_type: 'local',
    brand: currentBrand,
    status,
    created_by: currentUser.email,
    created_at: new Date().toISOString(),
    ...(status === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}),

    client: {
      name: document.getElementById('client-name').value.trim(),
      city: document.getElementById('client-city').value.trim(),
      contact: document.getElementById('client-contact').value.trim(),
      address: document.getElementById('client-address').value.trim()
    },
    delivery_term: document.getElementById('delivery-term-select').value,
    transport_type: document.getElementById('transport-type').value,
    valid_days: parseInt(document.getElementById('valid-days').value) || 15,
    lead_time: document.getElementById('lead-time').value.trim(),
    usd_ars_rate: usdArsRate || null,
    client_comments: document.getElementById('client-comments').value.trim(),
    notes: document.getElementById('quote-notes').value.trim(),
    alias: document.getElementById('quote-alias')?.value.trim() ?? '',
    payment_term: selectedPaymentTerm,
    payment_term_label: getPaymentTermLabel(),
    custom_payment: selectedPaymentTerm === 'custom' ? document.getElementById('custom-payment').value.trim() : '',

    product: currentProduct ? { ...currentProduct, photo: selectedQuotePhoto || currentProduct?.photo } : null,
    volume_kg: volumeKg,
    num_shipments: numShipments,
    effective_yield_pct: Math.round(computeEffectiveYield() * 10000) / 100,

    cost_layers: costLayersSnapshot,
    commission: { ...commission },

    total_cost_per_kg: calc?.totalCostPerKg ?? 0,  // USD ref
    total_cost_per_kg_ars: calc?.totalCostPerKgArs ?? 0,
    margin_pct: parseNum(document.getElementById('margin-pct').value) || 0,
    price_per_kg_usd: calc?.pricePerKgUsd ?? 0,
    price_per_kg_ars: calc?.pricePerKgArs ?? 0
  };
}

async function saveDraft() {
  const quote = buildQuoteObject('draft');
  try {
    await setDoc(doc(db, 'quotes-local', currentQuoteId), quote);
    isDraft = true;
    document.getElementById('panel-quote-number').textContent = currentQuoteNumber + ' (borrador guardado)';
    showToast('Borrador guardado');
  } catch (e) {
    showToast('Error al guardar: ' + e.message, true);
  }
}

async function confirmQuote() {
  if (!document.getElementById('client-name').value.trim()) {
    showToast('Completá el nombre del cliente antes de confirmar', true);
    return;
  }
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;
  if (!usdArsRate) {
    showToast('Completá la cotización del dólar para confirmar', true);
    document.getElementById('usd-ars-rate').focus();
    return;
  }

  const confirmed = confirm(`¿Confirmar la cotización ${currentQuoteNumber}? Una vez confirmada no se puede editar.`);
  if (!confirmed) return;

  const quote = buildQuoteObject('confirmed');
  try {
    await setDoc(doc(db, 'quotes-local', currentQuoteId), quote);
    document.getElementById('btn-confirm').disabled = true;
    document.getElementById('btn-save-draft').disabled = true;
    document.getElementById('panel-quote-number').textContent = currentQuoteNumber + ' ✓ Confirmada';
    showToast(`Cotización ${currentQuoteNumber} confirmada`);
  } catch (e) {
    showToast('Error al confirmar: ' + e.message, true);
  }
}

// ============================================================
// PDF / PRINT
// ============================================================
async function printQuote(mode) {
  const priceArs = recalculate()?.pricePerKgArs ?? 0;
  const priceUsd = recalculate()?.pricePerKgUsd ?? 0;
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;
  const deliveryTerm = document.getElementById('delivery-term-select').value;
  const deliveryLabel = DELIVERY_TERMS.find(d => d.id === deliveryTerm)?.name ?? deliveryTerm;
  const transportType = document.getElementById('transport-type').value;
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const validDays = parseInt(document.getElementById('valid-days').value) || 15;
  const validUntil = new Date(Date.now() + validDays * 86400000)
    .toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Accent — dinámico por marca
  const brand = BRANDS[currentBrand] ?? BRANDS.manila;
  document.querySelectorAll('.pdf-page').forEach(p => {
    p.style.setProperty('--pdf-accent', brand.accent);
  });

  // ---- Página cliente ----
  document.getElementById('pdf-logo').src = brand.logo;
  document.getElementById('pdf-quote-number').textContent = currentQuoteNumber;
  document.getElementById('pdf-date').textContent = today;
  document.getElementById('pdf-valid').textContent = `Válida ${validDays} días`;

  // Delivery label
  document.getElementById('pdf-delivery-label').textContent = deliveryLabel;
  document.getElementById('pdf-price-main').textContent = `$${Math.round(priceArs).toLocaleString('es-AR')}`;

  // Info grid
  document.getElementById('pdf-client-val').textContent =
    [document.getElementById('client-name').value,
     document.getElementById('client-contact').value].filter(Boolean).join(' · ');
  document.getElementById('pdf-city-val').textContent =
    document.getElementById('client-city').value || '—';
  document.getElementById('pdf-delivery-val').textContent = deliveryLabel || '—';
  document.getElementById('pdf-transport-val').textContent = transportType || '—';
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShip = parseInt(document.getElementById('num-shipments').value) || 1;
  document.getElementById('pdf-volume-val').textContent =
    `${volumeKg.toLocaleString('es-AR')} kg — ${numShip} entrega${numShip > 1 ? 's' : ''}`;
  document.getElementById('pdf-leadtime-val').textContent = document.getElementById('lead-time').value || '—';
  document.getElementById('pdf-validuntil-val').textContent = validUntil;

  // Payment terms
  document.getElementById('pdf-payment-val').textContent = getPaymentTermLabel() || '—';

  // Photo — usar selectedQuotePhoto si existe
  const photoWrap = document.getElementById('pdf-photo-wrap');
  const productImg = document.getElementById('pdf-product-img');
  const pdfPhoto = selectedQuotePhoto || currentProduct?.photo;
  if (pdfPhoto) {
    productImg.src = pdfPhoto;
    productImg.style.display = 'block';
    photoWrap.classList.add('has-photo');
  } else {
    productImg.style.display = 'none';
    photoWrap.classList.remove('has-photo');
  }

  // Product name/specs
  document.getElementById('pdf-product-name').textContent = currentProduct?.name ?? '';
  document.getElementById('pdf-product-spec').textContent =
    [currentProduct?.specs?.trim_cut, currentProduct?.specs?.caliber].filter(Boolean).join(' — ');

  // Product details (presentación, especie, conservación, duración, etiqueta, unidad, notas)
  const detailsEl = document.getElementById('pdf-product-details');
  if (detailsEl && currentProduct) {
    const details = [];
    if (currentProduct.presentation) details.push(currentProduct.presentation);
    if (currentProduct.specs?.species) details.push(currentProduct.specs.species);
    if (currentProduct.conservation) {
      const consLabel = currentProduct.conservation === 'refrigerado' ? 'Refrigerado' : 'Congelado';
      details.push(consLabel);
    }
    if (currentProduct.shelf_life_days) {
      details.push(`Vida útil: ${currentProduct.shelf_life_days} días`);
    }
    if (currentProduct.sale_unit) details.push(`Unidad: ${currentProduct.sale_unit}`);
    if (currentProduct.label_brand) {
      const lb = BRANDS[currentProduct.label_brand];
      if (lb) details.push(`Etiqueta: ${lb.name}`);
    }
    if (currentProduct.notes) details.push(currentProduct.notes);
    if (details.length > 0) {
      detailsEl.textContent = details.join(' · ');
      detailsEl.style.display = '';
    } else {
      detailsEl.style.display = 'none';
    }
  }

  // Footer dinámico por marca
  const footerEl = document.getElementById('pdf-footer');
  if (footerEl) {
    footerEl.innerHTML = `<span>${brand.name} — Bariloche, Río Negro, Patagonia Argentina</span><span>info@manilapatagonia.com · www.manilapatagonia.com</span>`;
  }

  // Comments
  const comments = document.getElementById('client-comments').value.trim();
  const commentsEl = document.getElementById('pdf-comments');
  if (comments) {
    document.getElementById('pdf-comments-text').textContent = comments;
    commentsEl.style.display = '';
  } else {
    commentsEl.style.display = 'none';
  }

  // ---- Página interna ----
  document.getElementById('pdf-int-quote-number').textContent = currentQuoteNumber;
  const calc = recalculate();
  buildInternalTable(calc);
  const costArsTotal = calc?.totalCostPerKgArs ?? 0;
  document.getElementById('pdf-sum-cost').textContent = `$${costArsTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('pdf-sum-margin').textContent = `${document.getElementById('margin-pct').value}%`;
  document.getElementById('pdf-sum-price').textContent = `$${Math.round(priceArs).toLocaleString('es-AR')}`;
  document.getElementById('pdf-sum-price-usd').textContent = '';

  // Rate note
  const rateEl = document.getElementById('pdf-rate-note');
  if (usdArsRate) {
    rateEl.textContent = `Tipo de cambio: USD 1 = ARS $${usdArsRate.toLocaleString('es-AR')} — ${today}`;
    rateEl.classList.add('visible');
  } else {
    rateEl.textContent = '';
    rateEl.classList.remove('visible');
  }

  // Alias
  const alias = document.getElementById('quote-alias')?.value.trim() ?? '';
  const aliasEl = document.getElementById('pdf-int-alias');
  if (aliasEl) aliasEl.textContent = alias ? ` — ${alias}` : '';

  // Logistics
  const clientName = document.getElementById('client-name').value.trim();
  const clientCity = document.getElementById('client-city').value.trim();
  const leadTime = document.getElementById('lead-time').value.trim();
  const logEl = document.getElementById('pdf-int-logistics');
  if (logEl) {
    const cells = [
      ['Entrega', deliveryLabel || '—'],
      ['Ciudad', clientCity || '—'],
      ['Transporte', transportType || '—'],
      ['Volumen', `${volumeKg.toLocaleString('es-AR')} kg`],
      ['Entregas', numShip],
      ['Plazo', leadTime || '—'],
      ['Cliente', clientName || '—'],
      ['Pago', getPaymentTermLabel() || '—'],
      ['TC', usdArsRate ? `$${usdArsRate.toLocaleString('es-AR')}/USD` : '—'],
    ];
    logEl.innerHTML = `<div class="pdf-section-label" style="font-size:6.5pt;margin-bottom:2mm">Datos de la operación</div><div class="pil-grid">${
      cells.map(([l, v]) => `<div class="pil-cell"><span class="pil-label">${l}</span><span class="pil-val">${v}</span></div>`).join('')
    }</div>`;
  }

  document.getElementById('pdf-meta-footer').textContent =
    `Created by: ${currentUser.email} — ${new Date().toLocaleString('es-AR')} — INTERNAL USE ONLY`;

  // Print mode
  document.body.classList.remove('print-client', 'print-internal');
  document.body.classList.add(mode === 'client' ? 'print-client' : 'print-internal');

  // Wait for images
  const pdfImgs = [...document.querySelectorAll('.pdf-page img')].filter(img => img.src && img.src !== window.location.href);
  await Promise.all(pdfImgs.map(img =>
    img.complete ? Promise.resolve() :
    new Promise(r => { img.onload = r; img.onerror = r; })
  ));

  window.print();
  setTimeout(() => document.body.classList.remove('print-client', 'print-internal'), 500);
}

function buildInternalTable(calc = null) {
  const tbody = document.getElementById('pdf-cost-tbody');
  tbody.innerHTML = '';
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;
  const fmtArs = v => `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  layers.forEach(layer => {
    if (layer.items.length === 0) return;

    const layerRow = document.createElement('tr');
    layerRow.className = 'layer-title';
    const ey = computeEffectiveYield();
    const yieldNote = layer.applies_yield && ey < 1
      ? ` (÷ ${(ey * 100).toFixed(1)}% rdto → ×${(1/ey).toFixed(2)})`
      : '';
    layerRow.innerHTML = `<td colspan="5">${layer.name}${yieldNote}</td>`;
    tbody.appendChild(layerRow);

    let layerTotal = 0;
    layer.items.forEach(item => {
      const tr = document.createElement('tr');
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit;
      const costArs = (item.cost_per_kg_calc ?? 0);  // ya en ARS
      tr.innerHTML = `
        <td>${item.name || '—'}</td>
        <td>${item.source === 'table' ? 'Tabla' : 'Manual'}</td>
        <td class="num">${fmtArs(item.variable_value ?? 0)} ${unitLabel}</td>
        <td class="num">${item.fixed_per_shipment ? fmtArs(item.fixed_per_shipment) : '—'}</td>
        <td class="num">${costArs > 0 ? fmtArs(costArs) + '/kg' : '—'}</td>
      `;
      tbody.appendChild(tr);
      layerTotal += costArs;
    });

    if (layer.items.length > 1) {
      const subRow = document.createElement('tr');
      subRow.className = 'subtotal';
      subRow.innerHTML = `<td colspan="4">Subtotal ${layer.name}</td><td class="num">${fmtArs(layerTotal)}/kg</td>`;
      tbody.appendChild(subRow);
    }
  });

  // Breakdown
  const breakdownEl = document.getElementById('pdf-cost-breakdown');
  if (breakdownEl && calc) {
    const { totalCostPerKgArs, commPerKg, pricePerKgArs, marginPct } = calc;

    let html = '<div class="pdf-cost-breakdown-title">Resumen por capa</div>';

    layers.forEach(l => {
      if (l.items.length === 0) return;
      const layerTotal = l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0);
      html += `<div class="pdf-breakdown-row"><span class="bd-label">${l.name}</span><span class="bd-val">${fmtArs(layerTotal)}/kg</span></div>`;
    });

    if (commPerKg > 0) {
      html += `<div class="pdf-breakdown-row"><span class="bd-label">Comisión (${commission.pct}%)</span><span class="bd-val">${fmtArs(commPerKg)}/kg</span></div>`;
    }

    const marginAmount = pricePerKgArs - totalCostPerKgArs - commPerKg;
    html += `<div class="pdf-breakdown-row separator"><span class="bd-label">Subtotal costos</span><span class="bd-val">${fmtArs(totalCostPerKgArs)}/kg</span></div>`;
    html += `<div class="pdf-breakdown-row"><span class="bd-label">Margen (${(marginPct * 100).toFixed(1)}%)</span><span class="bd-val">+${fmtArs(marginAmount)}/kg</span></div>`;
    html += `<div class="pdf-breakdown-row total"><span class="bd-label">Precio final</span><span class="bd-val">$${Math.round(pricePerKgArs).toLocaleString('es-AR')}/kg</span></div>`;

    if (usdArsRate > 0) {
      html += `<div class="pdf-breakdown-row" style="margin-top:2mm;border-top:1px solid #e5e3e0;padding-top:2mm;color:#7c5a00;font-size:7pt"><span class="bd-label">💱 Tipo de cambio</span><span class="bd-val">$${usdArsRate.toLocaleString('es-AR')}/USD</span></div>`;
    }

    breakdownEl.innerHTML = html;
  }
}

// ============================================================
// MIGRACIÓN: ASEGURAR ÍTEMS OBLIGATORIOS
// ============================================================
function ensureMandatoryItems() {
  const mandatoryDefs = buildMandatoryItems('local');
  MANDATORY_ITEMS.forEach(mi => {
    const layer = layers.find(l => l.id === mi.layer);
    if (!layer) return;
    let existing = layer.items.find(item => item.mandatory_id === mi.id);
    if (!existing) {
      existing = layer.items.find(item => item.name && item.name.toLowerCase() === mi.name.toLowerCase());
    }
    if (existing) {
      existing.mandatory = true;
      existing.mandatory_id = mi.id;
    } else {
      const template = mandatoryDefs.find(d => d.mandatory_id === mi.id);
      if (template) layer.items.unshift({ ...template });
    }
  });
}

// ============================================================
// CHECKLIST DE COMPLETITUD
// ============================================================
function renderChecklist() {
  const panel = document.getElementById('checklist-panel');
  if (!panel) return;

  const checks = [];

  // Campos generales local
  checks.push({ label: 'Cliente', ok: !!document.getElementById('client-name').value.trim() });
  checks.push({ label: 'Producto', ok: !!document.getElementById('product-select').value });
  checks.push({ label: 'TC', ok: (parseNum(document.getElementById('usd-ars-rate').value) || 0) > 0 });
  checks.push({ label: 'Entrega', ok: !!document.getElementById('delivery-term-select').value });
  checks.push({ label: 'Pago', ok: !!selectedPaymentTerm });

  // Ítems obligatorios de costo
  MANDATORY_ITEMS.forEach(mi => {
    const layer = layers.find(l => l.id === mi.layer);
    if (!layer) return;
    const item = layer.items.find(i => i.mandatory_id === mi.id);
    let ok = false;
    if (item) {
      ok = (item.variable_value > 0) || (item.fixed_per_shipment > 0) || (item.fixed_per_quote > 0);
      if (mi.has_yield && ok) {
        ok = ok && item.yield_pct > 0;
      }
    }
    checks.push({ label: mi.name, ok });
  });

  const total = checks.length;
  const done = checks.filter(c => c.ok).length;

  let html = `<span class="checklist-counter">${done}/${total}</span>`;
  checks.forEach(c => {
    html += `<span class="checklist-item ${c.ok ? 'ok' : 'pending'}">${c.ok ? '✓' : '○'} ${c.label}</span>`;
  });

  panel.innerHTML = html;
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${isError ? '#c94707' : '#2F2C2B'};color:#fff;
    padding:12px 20px;border-radius:8px;font-size:13px;font-family:var(--font);
    box-shadow:0 4px 20px rgba(0,0,0,0.25);
    animation:fadeIn 0.2s ease;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// START
// ============================================================
init();
