import { requireAuth, logout, getCurrentUser } from './auth.js';
import { db } from './firebase.js';
import { BRANDS, CERTIFICATIONS, INCOTERMS, COST_LAYERS, COST_UNITS, CONTACT, INCOTERM_LAYERS, parseNum } from './config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ============================================================
// ESTADO
// ============================================================
let currentUser = null;
let products = [];
let costTables = [];   // ítems de tablas maestras
let currentBrand = 'patagonia';
let currentProduct = null;
let currentQuoteId = null;   // si estamos editando un draft
let currentQuoteNumber = null;
let isDraft = false;

// Capas de costo: array paralelo a COST_LAYERS
let layers = COST_LAYERS.map(l => ({
  ...l,
  items: []
}));

// Comisión
let commission = {
  pct: 0,
  base: 'cost',
  fixed_per_shipment: 0,
  fixed_per_quote: 0
};

// Modo de bloqueo: 'margin' = precio se ajusta al cambiar costos
//                 'price'  = margen se ajusta al cambiar costos
let lockMode = 'margin';

// ============================================================
// INIT
// ============================================================
async function init() {
  currentUser = await requireAuth();
  document.getElementById('nav-user').textContent = currentUser.email;
  document.getElementById('btn-logout').addEventListener('click', logout);

  await Promise.all([loadProducts(), loadCostTables()]);
  populateIncoterms();
  renderLayers();
  bindPanelEvents();
  recalculate();

  // ¿Viene con ?draft=ID, ?copy=ID o ?print=client/internal?
  const params = new URLSearchParams(window.location.search);
  const draftId = params.get('draft');
  const copyId = params.get('copy');
  const printMode = params.get('print');
  if (draftId) {
    await loadDraft(draftId);
    // Auto-imprimir si viene con ?print=client o ?print=internal
    if (printMode === 'client' || printMode === 'internal') {
      const isReadOnly = params.get('readonly') === '1';
      if (isReadOnly) {
        // Modo solo lectura: ocultar el formulario, imprimir y volver al historial
        document.querySelector('.quote-layout').style.display = 'none';
        window.addEventListener('afterprint', () => {
          window.location.href = 'history.html';
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
  const snap = await getDocs(collection(db, 'products'));
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
      nextNum = snap.exists() ? (snap.data().quote_next ?? 1) : 1;
      tx.set(counterRef, { quote_next: nextNum + 1 }, { merge: true });
    });
    const year = new Date().getFullYear();
    currentQuoteNumber = `COT-${year}-${String(nextNum).padStart(3, '0')}`;
    currentQuoteId = currentQuoteNumber;
  } catch (e) {
    currentQuoteNumber = `COT-TEMP-${Date.now()}`;
    currentQuoteId = currentQuoteNumber;
  }
  document.getElementById('panel-quote-number').textContent = currentQuoteNumber;
}

async function loadDraft(id) {
  const snap = await getDoc(doc(db, 'quotes', id));
  if (!snap.exists()) return;
  const data = snap.data();
  currentQuoteId = id;
  currentQuoteNumber = data.quote_number;
  isDraft = true;
  document.getElementById('panel-quote-number').textContent = currentQuoteNumber + ' (borrador)';
  populateFromData(data);
}

async function loadCopy(id) {
  const snap = await getDoc(doc(db, 'quotes', id));
  if (!snap.exists()) return;
  const data = snap.data();
  // Asignar número nuevo
  await assignQuoteNumber();
  document.title = `Cotización copiada de ${data.quote_number}`;
  populateFromData(data, true);
}

function populateFromData(data, isCopy = false) {
  if (data.brand) setBrand(data.brand);
  if (data.client) {
    document.getElementById('client-name').value = data.client.name ?? '';
    document.getElementById('client-country').value = data.client.country ?? '';
    document.getElementById('client-contact').value = data.client.contact ?? '';
    document.getElementById('client-dest-port').value = data.client.dest_port ?? '';
  }
  if (data.incoterm) document.getElementById('incoterm-select').value = data.incoterm;
  if (data.origin_port) document.getElementById('origin-port').value = data.origin_port;
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

  // Producto: usar snapshot directamente para no depender del catálogo actual
  if (data.product) {
    currentProduct = data.product;
    const productSel = document.getElementById('product-select');
    productSel.value = data.product.id ?? '';
    // Thumbnail manual (sin llamar onProductChange para no sobreescribir yield)
    const thumbWrap = document.getElementById('product-thumb-wrap');
    if (currentProduct.photo) {
      thumbWrap.innerHTML = `<img class="product-thumb" src="${currentProduct.photo}" alt="${currentProduct.name}">`;
      thumbWrap.className = '';
    } else {
      thumbWrap.innerHTML = '<span>📦</span>';
      thumbWrap.className = 'product-thumb-placeholder';
    }
  }

  // yield_pct ya no es campo global — está guardado en cada ítem de Proceso en Planta

  // Comisión ANTES de renderLayers para que se renderice con valores correctos
  if (data.commission) {
    commission = { ...data.commission };
  }

  if (data.cost_layers) {
    layers = COST_LAYERS.map(l => {
      const saved = data.cost_layers.find(sl => sl.layer_id === l.id);
      return {
        ...l,
        items: saved ? saved.items.map(item => ({ ...item })) : []
      };
    });
    renderLayers();
  }

  // Cert picker con producto del snapshot + restaurar selección
  if (data.product) {
    renderCertPicker(currentProduct);
    if (data.selected_certs?.length) {
      document.querySelectorAll('.cert-pick').forEach(cb => {
        cb.checked = data.selected_certs.includes(cb.value);
      });
    }
  }

  recalculate();
}

// ============================================================
// POPULATE INCOTERMS
// ============================================================
function populateIncoterms() {
  const sel = document.getElementById('incoterm-select');
  INCOTERMS.forEach(inc => {
    const opt = document.createElement('option');
    opt.value = inc.id;
    opt.textContent = inc.name;
    sel.appendChild(opt);
  });
}

// ============================================================
// EVENTOS DEL PANEL
// ============================================================
function bindPanelEvents() {
  document.querySelectorAll('.brand-btn').forEach(btn => {
    btn.addEventListener('click', () => setBrand(btn.dataset.brand));
  });

  document.getElementById('product-select').addEventListener('change', onProductChange);

  const panelInputs = ['volume-kg', 'num-shipments', 'margin-pct', 'usd-ars-rate'];
  panelInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', recalculate);
  });
  document.getElementById('incoterm-select').addEventListener('change', recalculate);
  document.getElementById('target-price').addEventListener('input', onTargetPriceChange);

  // Toggle fijar margen / fijar precio
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', () => setLockMode(btn.dataset.lock));
  });
  // Estado inicial visual del toggle
  setLockMode('margin');

  document.getElementById('btn-confirm').addEventListener('click', confirmQuote);
  document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
  document.getElementById('btn-print-client').addEventListener('click', () => printQuote('client'));
  document.getElementById('btn-print-internal').addEventListener('click', () => printQuote('internal'));
}

function setBrand(brandId) {
  currentBrand = brandId;
  const brand = BRANDS[brandId];
  document.documentElement.style.setProperty('--accent', brand.accent);
  document.documentElement.style.setProperty('--accent-light', brand.accent_light);
  document.querySelectorAll('.brand-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.brand === brandId);
  });
}

function onProductChange() {
  const sel = document.getElementById('product-select');
  const p = products.find(x => x.id === sel.value);
  currentProduct = p ?? null;

  const thumbWrap = document.getElementById('product-thumb-wrap');
  if (p && p.photo) {
    thumbWrap.innerHTML = `<img class="product-thumb" src="${p.photo}" alt="${p.name}">`;
    thumbWrap.className = '';
  } else {
    thumbWrap.innerHTML = '<span>📦</span>';
    thumbWrap.className = 'product-thumb-placeholder';
  }

  // yield_pct ya no es campo global — vive en cada ítem de Proceso en Planta

  // Renderizar cert picker
  renderCertPicker(p);

  recalculate();
}

function renderCertPicker(product) {
  const wrap = document.getElementById('cert-picker-wrap');
  const container = document.getElementById('cert-picker');
  const certs = product?.certifications ?? [];

  if (!certs.length) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  container.innerHTML = '';
  certs.forEach(certId => {
    const cert = CERTIFICATIONS[certId];
    if (!cert) return;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" class="cert-pick" value="${certId}" checked> ${cert.name}`;
    label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:5px 10px;border:1px solid var(--gray-200);border-radius:4px;';
    container.appendChild(label);
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
      ? `<span class="layer-yield-effective" id="processing-yield-display">Rdto: —</span>`
      : '';

    section.innerHTML = `
      <div class="layer-header" data-layer="${layerIdx}">
        <span class="layer-toggle">▼</span>
        <h3>${layer.name}</h3>
        ${yieldBadge}${processingYieldSlot}
        <span class="layer-total" id="layer-total-${layerIdx}">$0.00/kg</span>
      </div>
      <div class="layer-body" id="layer-body-${layerIdx}">
        <div class="cost-items-header">
          <span>Concepto</span>
          <span>Fuente</span>
          <span>Valor</span>
          <span>Unidad</span>
          <span>kg/u</span>
          <span>Fijo/emb.</span>
          <span>Fijo/coti.</span>
          ${layer.id === 'processing' ? '<span>Rdto%</span>' : '<span></span>'}
          <span></span>
        </div>
        <div id="layer-items-${layerIdx}"></div>
        <button class="btn-add" data-layer="${layerIdx}">＋ Agregar ítem</button>
      </div>
    `;

    container.appendChild(section);

    // Toggle collapse
    section.querySelector('.layer-header').addEventListener('click', (e) => {
      if (e.target.closest('.btn-add')) return;
      const body = section.querySelector('.layer-body');
      const header = section.querySelector('.layer-header');
      body.style.display = body.style.display === 'none' ? '' : 'none';
      header.classList.toggle('collapsed', body.style.display === 'none');
    });

    // Add item
    section.querySelector('.btn-add').addEventListener('click', (e) => {
      e.stopPropagation();
      addItem(layerIdx);
    });

    // Render items existentes
    renderLayerItems(layerIdx);
  });

  // Sección de comisión
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
  row.dataset.item = itemIdx;

  const unitOptions = COST_UNITS.map(u =>
    `<option value="${u.id}" ${item.variable_unit === u.id ? 'selected' : ''}>${u.label}</option>`
  ).join('');

  const needsUnitKg = COST_UNITS.find(u => u.id === item.variable_unit)?.needs_unit_kg ?? false;
  const isArs = item.currency === 'ARS';
  if (isArs) row.classList.add('ars-item');

  row.innerHTML = `
    <div class="cost-item-row1">
      <div class="item-name">
        <input type="text" placeholder="Concepto..." value="${item.name ?? ''}" data-field="name">
      </div>
      <div class="source-toggle">
        <button class="${item.source !== 'table' ? 'active' : ''}" data-src="manual">Manual</button>
        <button class="${item.source === 'table' ? 'active' : ''}" data-src="table">Tabla</button>
      </div>
      <div class="currency-toggle">
        <button class="${!isArs ? 'active' : ''}" data-currency="USD">USD</button>
        <button class="${isArs ? 'active ars-active' : ''}" data-currency="ARS">ARS $</button>
      </div>
      <button class="btn-icon" title="Eliminar">✕</button>
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
        <label>Fijo/emb. $</label>
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

  // Toggle de moneda
  row.querySelectorAll('.currency-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      item.currency = btn.dataset.currency;
      row.querySelectorAll('.currency-toggle button').forEach(b => {
        b.classList.remove('active', 'ars-active');
      });
      btn.classList.add('active');
      if (item.currency === 'ARS') {
        btn.classList.add('ars-active');
        row.classList.add('ars-item');
      } else {
        row.classList.remove('ars-item');
      }
      recalculate();
    });
  });

  // Fuente: toggle tabla/manual
  row.querySelectorAll('.source-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.src;
      item.source = src;
      row.querySelectorAll('.source-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (src === 'table') showTablePicker(layerIdx, itemIdx, row);
      recalculate();
    });
  });

  // Cambios en campos
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

  // Eliminar
  row.querySelector('.btn-icon').addEventListener('click', () => {
    layers[layerIdx].items.splice(itemIdx, 1);
    renderLayerItems(layerIdx);
    recalculate();
  });

  return row;
}

function addItem(layerIdx) {
  const isProcessing = layers[layerIdx].id === 'processing';
  layers[layerIdx].items.push({
    name: '',
    source: 'manual',
    table_ref: null,
    currency: 'USD',
    variable_value: 0,
    variable_unit: 'kg',
    variable_unit_kg: null,
    fixed_per_shipment: 0,
    fixed_per_quote: 0,
    cost_per_kg_calc: 0,
    notes: '',
    ...(isProcessing ? { yield_pct: null } : {})
  });
  renderLayerItems(layerIdx);
  // Focus en el nuevo ítem
  const newRow = document.getElementById(`layer-items-${layerIdx}`).lastElementChild;
  if (newRow) newRow.querySelector('input[data-field="name"]')?.focus();
  recalculate();
}

// Picker simple para traer dato de tabla
function showTablePicker(layerIdx, itemIdx, row) {
  const layerId = layers[layerIdx].id;
  const tables = costTables.filter(t => t.layer === layerId);
  if (!tables.length) {
    alert('No hay ítems de tabla para esta capa. Agregalos en Admin → Tablas de costos.');
    return;
  }

  const select = document.createElement('select');
  select.style.cssText = 'position:fixed;z-index:999;background:#fff;border:2px solid var(--accent);padding:8px;border-radius:6px;font-size:13px;font-family:var(--font);box-shadow:0 4px 20px rgba(0,0,0,0.15)';
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
      item.name = item.name || t.name;
      item.table_ref = t.id;
      item.currency = t.currency ?? 'USD';
      item.variable_value = t.variable_value ?? 0;
      item.variable_unit = t.variable_unit ?? 'kg';
      item.variable_unit_kg = t.variable_unit_kg ?? null;
      item.fixed_per_shipment = t.fixed_per_shipment ?? 0;
      item.fixed_per_quote = t.fixed_per_quote ?? 0;
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
        <label>Fijo/embarque ($)</label>
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
// PRECIO SALIDA DE PLANTA — base para comisión "plant_exit"
// Capas que forman el costo de producto terminado listo para despachar:
// Materia Prima + Proceso en Planta + Materiales/Embalaje
// ============================================================
const PLANT_LAYERS = ['raw_material', 'processing', 'packaging'];

function getPlantExitCost() {
  return layers
    .filter(l => PLANT_LAYERS.includes(l.id))
    .reduce((sum, l) => sum + l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0), 0);
}

// ============================================================
// YIELD EFECTIVO — producto de todos los Rdto% de Proceso en Planta
// ============================================================
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
// CÁLCULO PRINCIPAL
// ============================================================
function recalculate() {
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShipmentsEl = document.getElementById('num-shipments');
  if (volumeKg === 0 && parseInt(numShipmentsEl.value) > 1) numShipmentsEl.value = 1;
  const numShipments = parseInt(numShipmentsEl.value) || 1;
  const effectiveYield = computeEffectiveYield();  // producto de yields de Proceso en Planta
  let marginPct = parseNum(document.getElementById('margin-pct').value) / 100 || 0;
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || 0;

  // Actualizar display del yield efectivo en header de Proceso en Planta
  const yieldDisplay = document.getElementById('processing-yield-display');
  if (yieldDisplay) {
    const hasYield = layers.find(l => l.id === 'processing')?.items.some(i => i.yield_pct > 0);
    yieldDisplay.textContent = hasYield
      ? `Rdto efectivo: ${(effectiveYield * 100).toFixed(1)}%`
      : 'Rdto: sin definir';
    yieldDisplay.className = 'layer-yield-effective' + (hasYield ? '' : ' undefined');
  }

  // Badge de Materia Prima: mostrar el yield efectivo también ahí
  const mpBadge = document.getElementById('materia-prima-yield-badge');
  if (mpBadge && effectiveYield < 1) {
    mpBadge.textContent = `÷ ${(effectiveYield * 100).toFixed(1)}% rdto`;
  }

  // Validación: si hay ítems ARS sin tipo de cambio, advertir
  const rateInput = document.getElementById('usd-ars-rate');
  const rateLabel = rateInput?.closest('.form-row')?.querySelector('label');
  if (hasArsItems() && !usdArsRate) {
    rateInput?.classList.add('rate-warning');
    if (rateLabel) rateLabel.classList.add('rate-warning-label');
  } else {
    rateInput?.classList.remove('rate-warning');
    if (rateLabel) rateLabel.classList.remove('rate-warning-label');
  }

  let totalCostPerKg = 0;

  layers.forEach((layer, idx) => {
    let layerTotal = 0;

    layer.items.forEach((item, itemIdx) => {
      const rawPerKg    = calcItemCostPerKgRaw(item, volumeKg, numShipments);
      const costPerKg   = item.currency === 'ARS'
        ? (usdArsRate > 0 ? rawPerKg / usdArsRate : 0)
        : rawPerKg;
      const adjusted    = layer.applies_yield && effectiveYield > 0 ? costPerKg / effectiveYield : costPerKg;
      const rawAdjARS   = layer.applies_yield && effectiveYield > 0 ? rawPerKg / effectiveYield : rawPerKg;
      item.cost_per_kg_calc = adjusted;
      layerTotal += adjusted;

      // Actualizar resultado visual por ítem
      const resultEl = document.querySelector(`[data-result="${idx}-${itemIdx}"]`);
      if (resultEl) {
        if (item.currency === 'ARS') {
          const arsStr = rawAdjARS.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (usdArsRate > 0) {
            resultEl.innerHTML = `<span class="ars-raw">ARS $${arsStr}/kg</span><span class="ars-usd">→ $${adjusted.toFixed(3)}/kg</span>`;
          } else {
            resultEl.innerHTML = `<span class="ars-raw">ARS $${arsStr}/kg</span><span class="ars-notc">⚠ sin TC</span>`;
          }
          resultEl.classList.remove('na');
        } else {
          resultEl.textContent = `$${adjusted.toFixed(3)}/kg`;
          resultEl.classList.toggle('na', adjusted === 0);
        }
      }
    });

    totalCostPerKg += layerTotal;

    // Actualizar total de la capa en el UI
    const totalEl = document.getElementById(`layer-total-${idx}`);
    if (totalEl) totalEl.textContent = `$${layerTotal.toFixed(3)}/kg`;
  });

  // Si "Fijar precio": back-calcular margen desde el precio objetivo antes de calcular comisión
  if (lockMode === 'price') {
    const tp = parseNum(document.getElementById('target-price').value);
    if (tp > 0) {
      const cfl = volumeKg > 0
        ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
        : 0;
      let nm;
      if (commission.base === 'cost') {
        const base = totalCostPerKg * (1 + commission.pct / 100) + cfl;
        nm = base > 0 ? (tp / base - 1) * 100 : 0;
      } else if (commission.base === 'plant_exit') {
        const pe = getPlantExitCost();
        const base = totalCostPerKg + pe * (commission.pct / 100);
        nm = base > 0 ? ((tp - cfl) / base - 1) * 100 : 0;
      } else {
        const netP = tp * (1 - commission.pct / 100) - cfl;
        nm = totalCostPerKg > 0 ? (netP / totalCostPerKg - 1) * 100 : 0;
      }
      if (isFinite(nm) && nm >= -99) {
        marginPct = Math.max(0, nm) / 100;
        const marginEl = document.getElementById('margin-pct');
        if (document.activeElement !== marginEl) {
          marginEl.value = Math.max(0, nm).toFixed(1);
        }
      }
    }
  }

  // Comisión
  const commFixedPerKg = volumeKg > 0
    ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
    : 0;

  let commPerKg = 0;
  let pricePerKg = 0;

  if (commission.base === 'cost') {
    // Comisión sobre costo total
    commPerKg = totalCostPerKg * (commission.pct / 100) + commFixedPerKg;
    pricePerKg = (totalCostPerKg + commPerKg) * (1 + marginPct);
  } else if (commission.base === 'plant_exit') {
    // Comisión sobre precio de salida de planta (MP + MO + Embalaje) × (1 + margen)
    const plantExitPrice = getPlantExitCost() * (1 + marginPct);
    commPerKg = plantExitPrice * (commission.pct / 100) + commFixedPerKg;
    pricePerKg = totalCostPerKg * (1 + marginPct) + commPerKg;
  } else {
    // Comisión sobre precio final de venta → álgebra inversa
    // price = (totalCost × (1 + margin) + commFixed) / (1 - commPct/100)
    const base = totalCostPerKg * (1 + marginPct) + commFixedPerKg;
    pricePerKg = base / (1 - commission.pct / 100);
    commPerKg = pricePerKg * (commission.pct / 100) + commFixedPerKg;
  }

  const pricePerLb = pricePerKg / 2.20462;

  // Actualizar comisión total
  const commTotalEl = document.getElementById('comm-total');
  if (commTotalEl) commTotalEl.textContent = `$${commPerKg.toFixed(3)}/kg`;

  // Actualizar resumen
  renderSummary(layers, totalCostPerKg, commPerKg, marginPct, pricePerKg, volumeKg, usdArsRate);

  // Precio destacado
  if (pricePerKg > 0) {
    document.getElementById('price-kg').textContent = `$${pricePerKg.toFixed(2)}/kg`;
    document.getElementById('price-lb').textContent = `$${pricePerLb.toFixed(2)}/lb`;
    document.getElementById('btn-confirm').disabled = false;
    document.getElementById('btn-print-client').disabled = false;
    document.getElementById('btn-print-internal').disabled = false;
  } else {
    document.getElementById('price-kg').textContent = 'USD —';
    document.getElementById('price-lb').textContent = '— /lb';
    document.getElementById('btn-confirm').disabled = true;
    document.getElementById('btn-print-client').disabled = true;
    document.getElementById('btn-print-internal').disabled = true;
  }

  // Sync target-price input (solo en modo margen fijo y cuando no está siendo editado)
  const targetPriceEl = document.getElementById('target-price');
  if (lockMode !== 'price' && targetPriceEl && document.activeElement !== targetPriceEl) {
    targetPriceEl.value = pricePerKg > 0 ? pricePerKg.toFixed(2) : '';
  }

  // Checklist Incoterm
  renderIncotermCoverage();

  // Advertencias de incoherencia
  renderWarnings(effectiveYield, totalCostPerKg, marginPct);

  return { totalCostPerKg, commPerKg, pricePerKg, pricePerLb, marginPct };
}

// Back-calcular margen desde precio objetivo
function onTargetPriceChange() {
  const targetPrice = parseNum(document.getElementById('target-price').value);
  if (!targetPrice || targetPrice <= 0) { recalculate(); return; }

  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShipmentsEl2 = document.getElementById('num-shipments');
  if (volumeKg === 0 && parseInt(numShipmentsEl2.value) > 1) numShipmentsEl2.value = 1;
  const numShipments = parseInt(numShipmentsEl2.value) || 1;
  const effectiveYield = computeEffectiveYield();

  let totalCost = 0;
  layers.forEach(layer => {
    layer.items.forEach(item => {
      const cost = calcItemCostPerKg(item, volumeKg, numShipments);
      totalCost += layer.applies_yield && effectiveYield > 0 ? cost / effectiveYield : cost;
    });
  });

  const commFixedPerKg = volumeKg > 0
    ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
    : 0;

  let newMargin;
  if (commission.base === 'cost') {
    // precio = (costo + comisión_costo) × (1 + margen)
    // precio = costo × (1 + commPct/100) × (1 + margen) + commFijo × (1 + margen)
    const commRate = 1 + commission.pct / 100;
    const base = totalCost * commRate + commFixedPerKg;
    newMargin = base > 0 ? (targetPrice / base - 1) * 100 : 0;
  } else if (commission.base === 'plant_exit') {
    // precio = totalCosto × (1 + margen) + plantExit × (1 + margen) × commPct/100 + commFijo
    // precio = (1 + margen) × (totalCosto + plantExit × commPct/100) + commFijo
    const plantExit = getPlantExitCost();
    const base = totalCost + plantExit * (commission.pct / 100);
    newMargin = base > 0 ? ((targetPrice - commFixedPerKg) / base - 1) * 100 : 0;
  } else {
    // precio × (1 - commPct/100) = totalCosto × (1 + margen) + commFijo
    const netPrice = targetPrice * (1 - commission.pct / 100) - commFixedPerKg;
    newMargin = totalCost > 0 ? (netPrice / totalCost - 1) * 100 : 0;
  }

  if (isFinite(newMargin) && newMargin >= -99) {
    document.getElementById('margin-pct').value = Math.max(0, newMargin).toFixed(1);
  }
  recalculate();
}

// ============================================================
// TOGGLE: FIJAR MARGEN / FIJAR PRECIO
// ============================================================
function setLockMode(mode) {
  lockMode = mode;
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lock === mode);
  });
  const marginEl = document.getElementById('margin-pct');
  const priceEl  = document.getElementById('target-price');
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
// ADVERTENCIAS DE INCOHERENCIA
// ============================================================
function renderWarnings(effectiveYield, totalCostPerKg, marginPct) {
  const container = document.getElementById('quote-warnings');
  if (!container) return;

  const warnings = [];

  // Sin materia prima
  const mpLayer = layers.find(l => l.id === 'raw_material');
  if (mpLayer && mpLayer.items.length === 0) {
    warnings.push('Sin materia prima — ¿falta agregar el costo del pescado?');
  }

  // Sin proceso en planta (sin MO)
  const procLayer = layers.find(l => l.id === 'processing');
  if (procLayer && procLayer.items.length === 0) {
    warnings.push('Sin Proceso en Planta — el costo de mano de obra no está incluido.');
  }

  // Rendimiento efectivo al 100% con materia prima cargada
  if (mpLayer && mpLayer.items.length > 0 && effectiveYield >= 0.99) {
    warnings.push('Rendimiento 100% — el costo de MP no está ajustado por merma. ¿Olvidaste agregar el proceso?');
  }

  // Margen negativo o cero
  if (totalCostPerKg > 0 && marginPct <= 0) {
    warnings.push('Margen 0% o negativo — la cotización no genera ganancia.');
  }

  // Margen mayor al 100%
  if (marginPct > 1) {
    warnings.push(`Margen ${(marginPct * 100).toFixed(0)}% — ¿es correcto? Parece muy alto.`);
  }

  // Sin embalaje con materia prima cargada
  const packLayer = layers.find(l => l.id === 'packaging');
  if (mpLayer && mpLayer.items.length > 0 && packLayer && packLayer.items.length === 0) {
    warnings.push('Sin Materiales y Embalaje — ¿el packaging está incluido?');
  }

  // Render
  if (warnings.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  container.innerHTML = warnings.map(w =>
    `<div class="quote-warning-item">⚠ ${w}</div>`
  ).join('');
}

// Costo por kg en la moneda propia del ítem (ARS o USD, sin convertir)
function calcItemCostPerKgRaw(item, volumeKg, numShipments) {
  const val = parseFloat(item.variable_value) || 0;
  const unitKg = parseFloat(item.variable_unit_kg) || 1;
  const fixedShip = parseFloat(item.fixed_per_shipment) || 0;
  const fixedQuote = parseFloat(item.fixed_per_quote) || 0;

  let varPerKg = 0;
  switch (item.variable_unit) {
    case 'kg':   varPerKg = val; break;
    case 'unit':
    case 'box':  varPerKg = unitKg > 0 ? val / unitKg : 0; break;
    case 'load': varPerKg = volumeKg > 0 ? val / volumeKg : 0; break;
    case 'pct_cost':
    case 'pct_price': varPerKg = 0; break;
  }

  const fixedPerKg = volumeKg > 0
    ? (fixedShip * numShipments + fixedQuote) / volumeKg
    : 0;

  return varPerKg + fixedPerKg;
}

// Costo por kg siempre en USD (convierte ARS usando el tipo de cambio)
function calcItemCostPerKg(item, volumeKg, numShipments, usdArsRate) {
  const raw = calcItemCostPerKgRaw(item, volumeKg, numShipments);
  if (item.currency === 'ARS') {
    return usdArsRate > 0 ? raw / usdArsRate : 0;
  }
  return raw;
}

function hasArsItems() {
  return layers.some(l => l.items.some(i => i.currency === 'ARS'));
}

function renderIncotermCoverage() {
  const container = document.getElementById('incoterm-coverage');
  if (!container) return;
  const incotermId = document.getElementById('incoterm-select').value;
  if (!incotermId) { container.innerHTML = ''; return; }

  const def = INCOTERM_LAYERS[incotermId];
  if (!def) { container.innerHTML = ''; return; }

  // Verificar capas requeridas
  const checks = def.required.map(layerId => {
    const layer = layers.find(l => l.id === layerId);
    const hasItems = layer?.items?.length > 0;
    const layerName = layer?.name ?? layerId;
    return { layerName, hasItems };
  });

  const allOk = checks.every(c => c.hasItems);
  const hasRequired = def.required.length > 0;

  let html = `<div class="incoterm-coverage">`;
  html += `<div class="incoterm-hint">${def.hint}</div>`;

  if (hasRequired) {
    html += `<div class="incoterm-checklist">`;
    checks.forEach(({ layerName, hasItems }) => {
      html += `<span class="incoterm-check ${hasItems ? 'ok' : 'missing'}">
        ${hasItems ? '✓' : '⚠'} ${layerName}
      </span>`;
    });
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function renderSummary(layers, totalCost, commPerKg, marginPct, pricePerKg, volumeKg, usdArsRate = 0) {
  const container = document.getElementById('cost-summary');
  let html = '';

  const effectiveYield = computeEffectiveYield();
  const mpTotal   = layers.find(l => l.id === 'raw_material')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
  const procTotal = layers.find(l => l.id === 'processing')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
  const productionSubtotal = mpTotal + procTotal;

  // Totales en $ — "Costo de mercadería" (solo cuando hay volumen ingresado)
  const hasVol = volumeKg > 0;
  const mpRawAmt = hasVol ? mpTotal * effectiveYield * volumeKg : 0;  // costo bruto del pescado
  const mpAdjAmt = hasVol ? mpTotal * volumeKg : 0;                   // costo MP ajustado por rdto
  const procAmt  = hasVol ? procTotal * volumeKg : 0;                 // costo proceso total
  const mercAmt  = mpAdjAmt + procAmt;                                 // costo de mercadería total
  const fmtAmt = (v) => '$' + Math.round(v).toLocaleString('es-AR');

  layers.forEach(l => {
    const layerTotal = l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0);
    if (layerTotal === 0 && l.items.length === 0) return;

    if (l.id === 'raw_material' && mpTotal > 0 && effectiveYield < 1) {
      const mpRaw = mpTotal * effectiveYield;
      html += `<div class="cost-summary-row">
        <span class="label">Materia Prima
          <em class="yield-annotation">$${mpRaw.toFixed(3)} ÷ ${(effectiveYield * 100).toFixed(1)}%</em>
        </span>
        <div class="value-stack">
          <span class="value">$${mpTotal.toFixed(3)}/kg</span>
          ${hasVol ? `<em class="total-annotation">${fmtAmt(mpRawAmt)} → <strong>${fmtAmt(mpAdjAmt)}</strong></em>` : ''}
        </div>
      </div>`;
    } else {
      const showTotal = (l.id === 'raw_material' || l.id === 'processing') && hasVol && layerTotal > 0;
      const layerAmt  = l.id === 'processing' ? procAmt : (hasVol ? layerTotal * volumeKg : 0);
      html += `<div class="cost-summary-row">
        <span class="label">${l.name}</span>
        ${showTotal
          ? `<div class="value-stack"><span class="value">$${layerTotal.toFixed(3)}/kg</span><em class="total-annotation">${fmtAmt(layerAmt)}</em></div>`
          : `<span class="value">$${layerTotal.toFixed(3)}/kg</span>`}
      </div>`;
    }

    // Subtotal de mercadería tras Proceso en Planta
    if (l.id === 'processing' && (mpTotal > 0 || procTotal > 0)) {
      html += `<div class="cost-summary-row production-subtotal">
        <span class="label">↳ Costo Mercadería+MO</span>
        <div class="value-stack">
          <span class="value">$${productionSubtotal.toFixed(3)}/kg</span>
          ${hasVol ? `<em class="total-annotation">${fmtAmt(mercAmt)}</em>` : ''}
        </div>
      </div>`;
    }
  });

  // Nota tipo de cambio si hay ítems en ARS
  if (hasArsItems()) {
    if (usdArsRate > 0) {
      html += `<div class="cost-summary-row ars-rate-note">
        <span class="label">💱 TC ARS/USD</span>
        <span class="value">$${usdArsRate.toLocaleString('es-AR')}/USD</span>
      </div>`;
    } else {
      html += `<div class="cost-summary-row ars-rate-warn">
        <span class="label">⚠ Ítems en ARS sin TC</span>
        <span class="value">—</span>
      </div>`;
    }
  }

  html += `<div class="cost-summary-row separator">
    <span class="label">Subtotal costos</span>
    <span class="value">$${totalCost.toFixed(3)}/kg</span>
  </div>`;

  if (commPerKg > 0) {
    html += `<div class="cost-summary-row">
      <span class="label">Comisión</span>
      <span class="value">$${commPerKg.toFixed(3)}/kg</span>
    </div>`;
  }

  html += `<div class="cost-summary-row">
    <span class="label">Margen (${(marginPct * 100).toFixed(1)}%)</span>
    <span class="value">$${(pricePerKg - totalCost - commPerKg).toFixed(3)}/kg</span>
  </div>`;

  container.innerHTML = html;
}

// ============================================================
// GUARDAR / CONFIRMAR
// ============================================================
function getSelectedCerts() {
  return [...document.querySelectorAll('.cert-pick:checked')].map(cb => cb.value);
}

function buildQuoteObject(status) {
  const calc = recalculate();
  const pricePerKg = parseNum(document.getElementById('price-kg').textContent.replace(/[^0-9.,]/g, '')) || 0;
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShipments = parseInt(document.getElementById('num-shipments').value) || 1;

  const costLayersSnapshot = layers.map(l => ({
    layer_id: l.id,
    layer_name: l.name,
    applies_yield: l.applies_yield,
    items: l.items.map(item => ({ ...item })),
    total_per_kg: l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0)
  }));

  return {
    quote_number: currentQuoteNumber,
    status,
    created_by: currentUser.email,
    created_at: new Date().toISOString(),
    ...(status === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}),

    brand: currentBrand,
    client: {
      name: document.getElementById('client-name').value.trim(),
      country: document.getElementById('client-country').value.trim(),
      contact: document.getElementById('client-contact').value.trim(),
      dest_port: document.getElementById('client-dest-port').value.trim()
    },
    incoterm: document.getElementById('incoterm-select').value,
    origin_port: document.getElementById('origin-port').value.trim(),
    transport_type: document.getElementById('transport-type').value,
    valid_days: parseInt(document.getElementById('valid-days').value) || 15,
    lead_time: document.getElementById('lead-time').value.trim(),
    usd_ars_rate: parseNum(document.getElementById('usd-ars-rate').value) || null,
    client_comments: document.getElementById('client-comments').value.trim(),
    notes: document.getElementById('quote-notes').value.trim(),
    alias: document.getElementById('quote-alias')?.value.trim() ?? '',
    selected_certs: getSelectedCerts(),

    product: currentProduct ? { ...currentProduct } : null,
    volume_kg: volumeKg,
    num_shipments: numShipments,
    effective_yield_pct: Math.round(computeEffectiveYield() * 10000) / 100,  // % con 2 decimales

    cost_layers: costLayersSnapshot,
    commission: { ...commission },

    total_cost_per_kg: calc?.totalCostPerKg ?? 0,
    margin_pct: parseNum(document.getElementById('margin-pct').value) || 0,
    price_per_kg: pricePerKg,
    price_per_lb: pricePerKg / 2.20462
  };
}

async function saveDraft() {
  const quote = buildQuoteObject('draft');
  try {
    await setDoc(doc(db, 'quotes', currentQuoteId), quote);
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
  if (!document.getElementById('incoterm-select').value) {
    showToast('Seleccioná el Incoterm antes de confirmar', true);
    return;
  }
  if (hasArsItems() && !(parseNum(document.getElementById('usd-ars-rate').value) > 0)) {
    showToast('Hay ítems en ARS $ — completá la cotización del dólar para confirmar', true);
    document.getElementById('usd-ars-rate').focus();
    return;
  }

  const confirmed = confirm(`¿Confirmar la cotización ${currentQuoteNumber}? Una vez confirmada no se puede editar.`);
  if (!confirmed) return;

  const quote = buildQuoteObject('confirmed');
  try {
    await setDoc(doc(db, 'quotes', currentQuoteId), quote);
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
  const brand = BRANDS[currentBrand];
  const priceKg = parseNum(document.getElementById('price-kg').textContent.replace(/[^0-9.,]/g, '')) || 0;
  const priceLb = priceKg / 2.20462;
  const incoterm = document.getElementById('incoterm-select').value;
  const originPort = document.getElementById('origin-port').value.trim();
  const transportType = document.getElementById('transport-type').value;
  const today = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
  const validDays = parseInt(document.getElementById('valid-days').value) || 15;
  const validUntil = new Date(Date.now() + validDays * 86400000)
    .toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });

  // Accent color en todas las páginas
  document.querySelectorAll('.pdf-page').forEach(p => {
    p.style.setProperty('--pdf-accent', brand.accent);
  });

  // ---- Página cliente ----
  document.getElementById('pdf-logo').src = brand.logo;

  // Logo Manila pequeño: solo para Patagonia/Andes (como en fichas)
  const manilaSmall = document.getElementById('pdf-manila-logo-small');
  if (manilaSmall) manilaSmall.style.display = currentBrand !== 'manila' ? '' : 'none';
  document.getElementById('pdf-quote-number').textContent = currentQuoteNumber;
  document.getElementById('pdf-date').textContent = today;
  document.getElementById('pdf-valid').textContent = `Valid ${validDays} days`;

  // Incoterm + origen en el bloque de precio
  const incotermLabel = originPort
    ? `${incoterm} — ${originPort}`
    : incoterm;
  document.getElementById('pdf-incoterm-label').textContent = incotermLabel;
  document.getElementById('pdf-price-main').textContent = `$${priceKg.toFixed(2)}`;
  document.getElementById('pdf-price-lb-val').textContent = `$${priceLb.toFixed(2)}`;

  // Info grid
  document.getElementById('pdf-client-val').textContent =
    [document.getElementById('client-name').value,
     document.getElementById('client-contact').value].filter(Boolean).join(' · ');
  document.getElementById('pdf-dest-val').textContent =
    document.getElementById('client-dest-port').value || document.getElementById('client-country').value;
  document.getElementById('pdf-origin-label').textContent =
    incoterm ? `${incoterm} Point` : 'Port of Origin';
  document.getElementById('pdf-origin-val').textContent = originPort || 'Buenos Aires, Argentina';
  document.getElementById('pdf-transport-val').textContent = transportType || '—';
  const volumeKg = parseNum(document.getElementById('volume-kg').value) || 0;
  const numShip = parseInt(document.getElementById('num-shipments').value) || 1;
  document.getElementById('pdf-volume-val').textContent =
    `${volumeKg.toLocaleString()} kg — ${numShip} shipment${numShip > 1 ? 's' : ''}`;
  document.getElementById('pdf-leadtime-val').textContent = document.getElementById('lead-time').value || '—';
  document.getElementById('pdf-validuntil-val').textContent = validUntil;

  // Foto producto — siempre visible (fallback de color brand si no hay foto)
  const photoWrap = document.getElementById('pdf-photo-wrap');
  const productImg = document.getElementById('pdf-product-img');
  if (currentProduct?.photo) {
    productImg.src = currentProduct.photo;
    productImg.style.display = 'block';
    photoWrap.classList.add('has-photo');
  } else {
    productImg.style.display = 'none';
    photoWrap.classList.remove('has-photo');
  }

  // Nombre y specs
  document.getElementById('pdf-product-name').textContent = currentProduct?.name ?? '';
  document.getElementById('pdf-product-spec').textContent =
    [currentProduct?.specs?.trim_cut, currentProduct?.specs?.caliber].filter(Boolean).join(' — ');

  // Certificaciones (solo las seleccionadas)
  const selectedCerts = getSelectedCerts();
  const certsEl = document.getElementById('pdf-certs');
  certsEl.innerHTML = '';
  selectedCerts.forEach(certId => {
    const cert = CERTIFICATIONS[certId];
    if (!cert) return;
    const el = document.createElement('div');
    el.className = 'pdf-cert-item';
    if (cert.logo) {
      el.innerHTML = `<img src="${cert.logo}" alt="${cert.name}"><span class="pdf-cert-name">${cert.name}</span>`;
    } else {
      el.innerHTML = `<span class="pdf-cert-badge">${certId.toUpperCase()}</span><span class="pdf-cert-name">${cert.name}</span>`;
    }
    certsEl.appendChild(el);
  });

  // Comentarios para el cliente
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
  const calc = recalculate();   // primero calc para pasar al resumen
  buildInternalTable(calc);     // luego tabla + breakdown con calc
  document.getElementById('pdf-sum-cost').textContent = `$${(calc?.totalCostPerKg ?? 0).toFixed(3)}`;
  document.getElementById('pdf-sum-margin').textContent = `${document.getElementById('margin-pct').value}%`;
  document.getElementById('pdf-sum-price').textContent = `$${priceKg.toFixed(2)}`;
  document.getElementById('pdf-sum-price-lb').textContent = `$${priceLb.toFixed(2)}/lb`;
  // Cotización del dólar
  const usdArsRate = parseNum(document.getElementById('usd-ars-rate').value) || null;
  const rateEl = document.getElementById('pdf-rate-note');
  if (usdArsRate) {
    rateEl.textContent = `Tipo de cambio: USD 1 = ARS $${usdArsRate.toLocaleString('es-AR')} — ${today}`;
    rateEl.classList.add('visible');
  } else {
    rateEl.textContent = '';
    rateEl.classList.remove('visible');
  }

  // Alias en PDF interno
  const alias = document.getElementById('quote-alias')?.value.trim() ?? '';
  const aliasEl = document.getElementById('pdf-int-alias');
  if (aliasEl) aliasEl.textContent = alias ? ` — ${alias}` : '';

  // Logística en PDF interno
  const clientName = document.getElementById('client-name').value.trim();
  const clientCountry = document.getElementById('client-country').value.trim();
  const destPort = document.getElementById('client-dest-port').value.trim();
  const leadTime = document.getElementById('lead-time').value.trim();
  const numShipIntern = parseInt(document.getElementById('num-shipments').value) || 1;
  const volumeKgIntern = parseNum(document.getElementById('volume-kg').value) || 0;
  const logEl = document.getElementById('pdf-int-logistics');
  if (logEl) {
    const cells = [
      ['Incoterm', incoterm || '—'],
      ['Origen',   originPort || '—'],
      ['Destino',  destPort || clientCountry || '—'],
      ['País',     clientCountry || '—'],
      ['Transporte', transportType || '—'],
      ['Volumen',  `${volumeKgIntern.toLocaleString('es-AR')} kg`],
      ['Embarques', numShipIntern],
      ['Lead Time', leadTime || '—'],
      ['Cliente',  clientName || '—'],
    ];
    logEl.innerHTML = `<div class="pil-grid">${
      cells.map(([l, v]) => `<div class="pil-cell"><span class="pil-label">${l}</span><span class="pil-val">${v}</span></div>`).join('')
    }</div>`;
  }

  document.getElementById('pdf-meta-footer').textContent =
    `Created by: ${currentUser.email} — ${new Date().toLocaleString('es-AR')} — INTERNAL USE ONLY`;

  // Aplicar modo de impresión
  document.body.classList.remove('print-client', 'print-internal');
  document.body.classList.add(mode === 'client' ? 'print-client' : 'print-internal');

  // Esperar que todas las imágenes del PDF carguen antes de imprimir
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

  layers.forEach(layer => {
    if (layer.items.length === 0) return;

    const layerRow = document.createElement('tr');
    layerRow.className = 'layer-title';
    const ey = computeEffectiveYield();
    const yieldNote = layer.applies_yield && ey < 1
      ? ` (÷ ${(ey * 100).toFixed(1)}% rdto → ×${(1/ey).toFixed(2)})`
      : '';
    layerRow.innerHTML = `<td colspan="6">${layer.name}${yieldNote}</td>`;
    tbody.appendChild(layerRow);

    let layerTotal = 0;
    const layerHasArs = layer.items.some(i => i.currency === 'ARS');
    layer.items.forEach(item => {
      const tr = document.createElement('tr');
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit;
      const cur = item.currency === 'ARS' ? 'ARS $' : 'USD';
      const curBadge = `<span style="font-size:8pt;font-weight:700;padding:1px 4px;border-radius:3px;background:${item.currency === 'ARS' ? '#fef3cd' : '#dce9f0'};color:${item.currency === 'ARS' ? '#7c5a00' : '#365A6E'}">${cur}</span>`;
      tr.innerHTML = `
        <td>${item.name || '—'}</td>
        <td>${item.source === 'table' ? 'Tabla' : 'Manual'} ${curBadge}</td>
        <td class="num">${(item.variable_value ?? 0).toFixed(2)} ${unitLabel}</td>
        <td class="num">${item.fixed_per_shipment ? (item.currency === 'ARS' ? 'ARS $' : '$') + item.fixed_per_shipment.toFixed(2) : '—'}</td>
        <td class="num">${item.fixed_per_quote ? (item.currency === 'ARS' ? 'ARS $' : '$') + item.fixed_per_quote.toFixed(2) : '—'}</td>
        <td class="num">$${(item.cost_per_kg_calc ?? 0).toFixed(4)}</td>
      `;
      tbody.appendChild(tr);
      layerTotal += item.cost_per_kg_calc ?? 0;
    });

    if (layer.items.length > 1) {
      const subRow = document.createElement('tr');
      subRow.className = 'subtotal';
      subRow.innerHTML = `<td colspan="5">Subtotal ${layer.name}</td><td class="num">$${layerTotal.toFixed(4)}</td>`;
      tbody.appendChild(subRow);
    }
  });

  // Comisión row
  if (commission.pct > 0 || commission.fixed_per_shipment || commission.fixed_per_quote) {
    const commRow = document.createElement('tr');
    commRow.className = 'layer-title';
    const commBaseLabel = commission.base === 'plant_exit' ? 'precio salida de planta' : commission.base === 'cost' ? 'costo total' : 'precio final venta';
    commRow.innerHTML = `<td colspan="6">Comisión comercial (${commission.pct}% sobre ${commBaseLabel})</td>`;
    tbody.appendChild(commRow);
  }

  // Resumen de costos (breakdown por capa)
  const breakdownEl = document.getElementById('pdf-cost-breakdown');
  if (breakdownEl && calc) {
    const { totalCostPerKg, commPerKg, pricePerKg, pricePerLb, marginPct } = calc;
    const effectiveYield = computeEffectiveYield();
    const mpTotal   = layers.find(l => l.id === 'raw_material')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
    const procTotal = layers.find(l => l.id === 'processing')?.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0) ?? 0;
    const productionSubtotal = mpTotal + procTotal;

    // Totales en $ para PDF interno
    const pdfVol    = parseNum(document.getElementById('volume-kg').value) || 0;
    const pdfHasVol = pdfVol > 0;
    const pdfMpRaw  = pdfHasVol ? mpTotal * effectiveYield * pdfVol : 0;
    const pdfMpAdj  = pdfHasVol ? mpTotal * pdfVol : 0;
    const pdfProc   = pdfHasVol ? procTotal * pdfVol : 0;
    const pdfMerc   = pdfMpAdj + pdfProc;
    const pdfFmt = (v) => '$' + Math.round(v).toLocaleString('es-AR');
    const pdfTotalSpan = (v) => `<span style="font-size:6.5pt;opacity:.65"> (${pdfFmt(v)})</span>`;

    let html = '<div class="pdf-cost-breakdown-title">Resumen por capa</div>';

    layers.forEach(l => {
      if (l.items.length === 0) return;
      const layerTotal = l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0);

      if (l.id === 'raw_material' && mpTotal > 0 && effectiveYield < 1) {
        const mpRaw = mpTotal * effectiveYield;
        html += `<div class="pdf-breakdown-row">
          <span class="bd-label">Materia Prima <em style="opacity:.65;font-size:7pt">($${mpRaw.toFixed(3)} ÷ ${(effectiveYield * 100).toFixed(1)}%)</em></span>
          <span class="bd-val">$${mpTotal.toFixed(3)}/kg${pdfHasVol ? ` <span style="font-size:6.5pt;opacity:.65">(${pdfFmt(pdfMpRaw)} → ${pdfFmt(pdfMpAdj)})</span>` : ''}</span>
        </div>`;
      } else {
        const showPdfTotal = (l.id === 'raw_material' || l.id === 'processing') && pdfHasVol && layerTotal > 0;
        const pdfLayerAmt = l.id === 'processing' ? pdfProc : (pdfHasVol ? layerTotal * pdfVol : 0);
        html += `<div class="pdf-breakdown-row"><span class="bd-label">${l.name}</span><span class="bd-val">$${layerTotal.toFixed(3)}/kg${showPdfTotal ? pdfTotalSpan(pdfLayerAmt) : ''}</span></div>`;
      }

      if (l.id === 'processing' && (mpTotal > 0 || procTotal > 0)) {
        html += `<div class="pdf-breakdown-row production-subtotal-pdf"><span class="bd-label">↳ Costo Mercadería+MO</span><span class="bd-val">$${productionSubtotal.toFixed(3)}/kg${pdfHasVol ? pdfTotalSpan(pdfMerc) : ''}</span></div>`;
      }
    });

    if (commPerKg > 0) {
      const bLabel = commission.base === 'plant_exit' ? 'salida planta' : commission.base === 'cost' ? 'costo' : 'precio final';
      html += `<div class="pdf-breakdown-row"><span class="bd-label">Comisión (${commission.pct}% s/${bLabel})</span><span class="bd-val">$${commPerKg.toFixed(3)}/kg</span></div>`;
    }

    const marginAmount = pricePerKg - totalCostPerKg - commPerKg;
    html += `<div class="pdf-breakdown-row separator"><span class="bd-label">Subtotal costos</span><span class="bd-val">$${totalCostPerKg.toFixed(3)}/kg</span></div>`;
    html += `<div class="pdf-breakdown-row"><span class="bd-label">Margen (${(marginPct * 100).toFixed(1)}%)</span><span class="bd-val">+$${marginAmount.toFixed(3)}/kg</span></div>`;
    html += `<div class="pdf-breakdown-row total"><span class="bd-label">Precio final</span><span class="bd-val">$${pricePerKg.toFixed(2)}/kg · $${pricePerLb.toFixed(2)}/lb</span></div>`;

    const usdArsRatePdf = parseNum(document.getElementById('usd-ars-rate').value) || 0;
    if (hasArsItems() && usdArsRatePdf > 0) {
      html += `<div class="pdf-breakdown-row" style="margin-top:2mm;border-top:1px solid #e5e3e0;padding-top:2mm;color:#7c5a00;font-size:7pt"><span class="bd-label">💱 Tipo de cambio ARS/USD</span><span class="bd-val">$${usdArsRatePdf.toLocaleString('es-AR')}/USD</span></div>`;
    }

    breakdownEl.innerHTML = html;
  }
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
