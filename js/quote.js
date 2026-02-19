import { requireAuth, logout, getCurrentUser } from './auth.js';
import { db } from './firebase.js';
import { BRANDS, CERTIFICATIONS, INCOTERMS, COST_LAYERS, COST_UNITS, CONTACT } from './config.js';
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

  // ¿Viene con ?draft=ID o ?copy=ID?
  const params = new URLSearchParams(window.location.search);
  const draftId = params.get('draft');
  const copyId = params.get('copy');
  if (draftId) await loadDraft(draftId);
  else if (copyId) await loadCopy(copyId);
  else await assignQuoteNumber();
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
  }
  if (data.incoterm) document.getElementById('incoterm-select').value = data.incoterm;
  if (data.volume_kg) document.getElementById('volume-kg').value = data.volume_kg;
  if (data.num_shipments) document.getElementById('num-shipments').value = data.num_shipments;
  if (data.yield_pct) document.getElementById('yield-pct').value = data.yield_pct;
  if (data.valid_days) document.getElementById('valid-days').value = data.valid_days;
  if (data.lead_time) document.getElementById('lead-time').value = data.lead_time;
  if (data.notes) document.getElementById('quote-notes').value = data.notes;
  if (data.margin_pct) document.getElementById('margin-pct').value = data.margin_pct;

  if (data.product) {
    const productSel = document.getElementById('product-select');
    productSel.value = data.product.id ?? '';
    onProductChange();
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

  if (data.commission) {
    commission = { ...data.commission };
    renderCommissionSection();
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
  // Brand switcher
  document.querySelectorAll('.brand-btn').forEach(btn => {
    btn.addEventListener('click', () => setBrand(btn.dataset.brand));
  });

  // Product
  document.getElementById('product-select').addEventListener('change', onProductChange);

  // Recalc on any panel input change
  const panelInputs = ['volume-kg', 'num-shipments', 'yield-pct', 'margin-pct'];
  panelInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', recalculate);
  });

  // Confirm & save
  document.getElementById('btn-confirm').addEventListener('click', confirmQuote);
  document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
  document.getElementById('btn-print').addEventListener('click', printQuote);
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
  } else {
    thumbWrap.innerHTML = '<span>📦</span>';
    thumbWrap.className = 'product-thumb-placeholder';
  }

  if (p && p.default_yield_pct) {
    document.getElementById('yield-pct').value = p.default_yield_pct;
  }

  recalculate();
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
      ? `<span class="layer-yield-badge">aplica rendimiento</span>`
      : '';

    section.innerHTML = `
      <div class="layer-header" data-layer="${layerIdx}">
        <span class="layer-toggle">▼</span>
        <h3>${layer.name}</h3>
        ${yieldBadge}
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
  const row = document.createElement('div');
  row.className = 'cost-item';
  row.dataset.item = itemIdx;

  const unitOptions = COST_UNITS.map(u =>
    `<option value="${u.id}" ${item.variable_unit === u.id ? 'selected' : ''}>${u.label}</option>`
  ).join('');

  const tableOptions = costTables
    .filter(t => t.layer === layers[layerIdx].id)
    .map(t => `<option value="${t.id}">${t.name}</option>`)
    .join('');

  const needsUnitKg = COST_UNITS.find(u => u.id === item.variable_unit)?.needs_unit_kg ?? false;

  row.innerHTML = `
    <input type="text" placeholder="Concepto..." value="${item.name ?? ''}" data-field="name">
    <div class="source-toggle">
      <button class="${item.source !== 'table' ? 'active' : ''}" data-src="manual">Manual</button>
      <button class="${item.source === 'table' ? 'active' : ''}" data-src="table">Tabla</button>
    </div>
    <input type="number" placeholder="0.00" value="${item.variable_value ?? ''}" step="0.01" min="0" data-field="variable_value">
    <select data-field="variable_unit">${unitOptions}</select>
    <input type="number" placeholder="kg/u" value="${item.variable_unit_kg ?? ''}" step="0.01" min="0"
           data-field="variable_unit_kg" style="display:${needsUnitKg ? '' : 'none'}">
    <input type="number" placeholder="0" value="${item.fixed_per_shipment ?? ''}" step="0.01" min="0" data-field="fixed_per_shipment">
    <input type="number" placeholder="0" value="${item.fixed_per_quote ?? ''}" step="0.01" min="0" data-field="fixed_per_quote">
    <button class="btn-icon" title="Eliminar">✕</button>
  `;

  // Fuente: toggle tabla/manual
  row.querySelectorAll('.source-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.src;
      item.source = src;
      row.querySelectorAll('.source-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Si tabla, mostrar modal de selección
      if (src === 'table' && tableOptions) {
        showTablePicker(layerIdx, itemIdx, row);
      }
      recalculate();
    });
  });

  // Cambios en campos
  row.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const field = input.dataset.field;
      item[field] = input.type === 'number' ? (parseFloat(input.value) || 0) : input.value;

      // Mostrar/ocultar kg/u
      if (field === 'variable_unit') {
        const needsKg = COST_UNITS.find(u => u.id === item.variable_unit)?.needs_unit_kg ?? false;
        row.querySelector('[data-field="variable_unit_kg"]').style.display = needsKg ? '' : 'none';
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
  layers[layerIdx].items.push({
    name: '',
    source: 'manual',
    table_ref: null,
    variable_value: 0,
    variable_unit: 'kg',
    variable_unit_kg: null,
    fixed_per_shipment: 0,
    fixed_per_quote: 0,
    cost_per_kg_calc: 0,
    notes: ''
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
        <input type="number" id="comm-pct" value="${commission.pct}" min="0" max="100" step="0.1" placeholder="0">
      </div>
      <div>
        <label>Base de cálculo</label>
        <select id="comm-base">
          <option value="cost" ${commission.base === 'cost' ? 'selected' : ''}>% sobre costo total</option>
          <option value="price" ${commission.base === 'price' ? 'selected' : ''}>% sobre precio venta</option>
        </select>
      </div>
      <div>
        <label>Fijo/embarque ($)</label>
        <input type="number" id="comm-fixed-ship" value="${commission.fixed_per_shipment}" min="0" step="0.01" placeholder="0">
      </div>
      <div>
        <label>Fijo/cotización ($)</label>
        <input type="number" id="comm-fixed-quote" value="${commission.fixed_per_quote}" min="0" step="0.01" placeholder="0">
      </div>
    </div>
  `;

  wrap.appendChild(section);

  ['comm-pct', 'comm-base', 'comm-fixed-ship', 'comm-fixed-quote'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      commission.pct = parseFloat(document.getElementById('comm-pct').value) || 0;
      commission.base = document.getElementById('comm-base').value;
      commission.fixed_per_shipment = parseFloat(document.getElementById('comm-fixed-ship').value) || 0;
      commission.fixed_per_quote = parseFloat(document.getElementById('comm-fixed-quote').value) || 0;
      recalculate();
    });
  });
}

// ============================================================
// CÁLCULO PRINCIPAL
// ============================================================
function recalculate() {
  const volumeKg = parseFloat(document.getElementById('volume-kg').value) || 0;
  const numShipments = parseInt(document.getElementById('num-shipments').value) || 1;
  const yieldPct = parseFloat(document.getElementById('yield-pct').value) / 100 || 1;
  const marginPct = parseFloat(document.getElementById('margin-pct').value) / 100 || 0;

  let totalCostPerKg = 0;

  layers.forEach((layer, idx) => {
    let layerTotal = 0;

    layer.items.forEach(item => {
      const costPerKg = calcItemCostPerKg(item, volumeKg, numShipments);
      const adjusted = layer.applies_yield && yieldPct > 0 ? costPerKg / yieldPct : costPerKg;
      item.cost_per_kg_calc = adjusted;
      layerTotal += adjusted;
    });

    totalCostPerKg += layerTotal;

    // Actualizar total de la capa en el UI
    const totalEl = document.getElementById(`layer-total-${idx}`);
    if (totalEl) totalEl.textContent = `$${layerTotal.toFixed(3)}/kg`;
  });

  // Comisión
  const commFixedPerKg = volumeKg > 0
    ? (commission.fixed_per_shipment * numShipments + commission.fixed_per_quote) / volumeKg
    : 0;

  let commPerKg = 0;
  let pricePerKg = 0;

  if (commission.base === 'cost') {
    commPerKg = totalCostPerKg * (commission.pct / 100) + commFixedPerKg;
    const costWithComm = totalCostPerKg + commPerKg;
    pricePerKg = costWithComm * (1 + marginPct);
  } else {
    // Comisión sobre precio de venta → álgebra inversa
    // price = (totalCost + commFixed) / (1 - commPct/100) * (1 + margin)
    // Pero margen también va sobre costo, no precio...
    // Resolución: price = (totalCost + commFixed) / (1 - commPct/100) → precio antes de margen
    // Luego margin sobre ese precio? No — margen es siempre sobre costo.
    // Fórmula: price = (totalCost + commFixed) / (1 - commPct/100) × (1 + margin)
    const basePrice = commFixedPerKg + totalCostPerKg;
    pricePerKg = basePrice * (1 + marginPct) / (1 - commission.pct / 100);
    commPerKg = pricePerKg * (commission.pct / 100) + commFixedPerKg;
  }

  const pricePerLb = pricePerKg / 2.20462;

  // Actualizar comisión total
  const commTotalEl = document.getElementById('comm-total');
  if (commTotalEl) commTotalEl.textContent = `$${commPerKg.toFixed(3)}/kg`;

  // Actualizar resumen
  renderSummary(layers, totalCostPerKg, commPerKg, marginPct, pricePerKg, volumeKg);

  // Precio destacado
  if (pricePerKg > 0) {
    document.getElementById('price-kg').textContent = `USD $${pricePerKg.toFixed(2)}/kg`;
    document.getElementById('price-lb').textContent = `USD $${pricePerLb.toFixed(2)}/lb`;
    document.getElementById('btn-confirm').disabled = false;
    document.getElementById('btn-print').disabled = false;
  } else {
    document.getElementById('price-kg').textContent = 'USD —';
    document.getElementById('price-lb').textContent = '— /lb';
    document.getElementById('btn-confirm').disabled = true;
    document.getElementById('btn-print').disabled = true;
  }

  return { totalCostPerKg, commPerKg, pricePerKg, pricePerLb, marginPct };
}

function calcItemCostPerKg(item, volumeKg, numShipments) {
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
    case 'pct_price': varPerKg = 0; break; // se calcula aparte
  }

  const fixedPerKg = volumeKg > 0
    ? (fixedShip * numShipments + fixedQuote) / volumeKg
    : 0;

  return varPerKg + fixedPerKg;
}

function renderSummary(layers, totalCost, commPerKg, marginPct, pricePerKg, volumeKg) {
  const container = document.getElementById('cost-summary');
  let html = '';

  layers.forEach(l => {
    const layerTotal = l.items.reduce((s, i) => s + (i.cost_per_kg_calc ?? 0), 0);
    if (layerTotal === 0 && l.items.length === 0) return;
    html += `<div class="cost-summary-row">
      <span class="label">${l.name}</span>
      <span class="value">$${layerTotal.toFixed(3)}/kg</span>
    </div>`;
  });

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
function buildQuoteObject(status) {
  const calc = recalculate();
  const pricePerKg = parseFloat(document.getElementById('price-kg').textContent.replace(/[^0-9.]/g, '')) || 0;
  const volumeKg = parseFloat(document.getElementById('volume-kg').value) || 0;
  const numShipments = parseInt(document.getElementById('num-shipments').value) || 1;

  // Snapshot de capas con cost_per_kg_calc guardado
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
      contact: document.getElementById('client-contact').value.trim()
    },
    incoterm: document.getElementById('incoterm-select').value,
    valid_days: parseInt(document.getElementById('valid-days').value) || 15,
    lead_time: document.getElementById('lead-time').value.trim(),
    notes: document.getElementById('quote-notes').value.trim(),

    product: currentProduct ? { ...currentProduct } : null,
    volume_kg: volumeKg,
    num_shipments: numShipments,
    yield_pct: parseFloat(document.getElementById('yield-pct').value) || 100,

    cost_layers: costLayersSnapshot,
    commission: { ...commission },

    total_cost_per_kg: calc?.totalCostPerKg ?? 0,
    margin_pct: parseFloat(document.getElementById('margin-pct').value) || 0,
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
function printQuote() {
  const brand = BRANDS[currentBrand];
  const priceKg = parseFloat(document.getElementById('price-kg').textContent.replace(/[^0-9.]/g, '')) || 0;
  const priceLb = priceKg / 2.20462;
  const incoterm = document.getElementById('incoterm-select').value;
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const validDays = document.getElementById('valid-days').value;

  // PDF page accent color
  document.querySelectorAll('.pdf-page').forEach(p => {
    p.style.setProperty('--pdf-accent', brand.accent);
  });

  // Página 1 — cliente
  document.getElementById('pdf-logo').src = brand.logo;
  document.getElementById('pdf-quote-number').textContent = currentQuoteNumber;
  document.getElementById('pdf-date').textContent = today;
  document.getElementById('pdf-valid').textContent = `Válida por ${validDays} días`;
  document.getElementById('pdf-incoterm').textContent = incoterm;
  document.getElementById('pdf-price-main').textContent = `USD $${priceKg.toFixed(2)}/kg`;
  document.getElementById('pdf-price-lb-text').textContent = `USD $${priceLb.toFixed(2)}/lb`;
  document.getElementById('pdf-client').textContent = document.getElementById('client-name').value;
  document.getElementById('pdf-country').textContent = document.getElementById('client-country').value;
  document.getElementById('pdf-leadtime').textContent = document.getElementById('lead-time').value;
  document.getElementById('pdf-volume').textContent =
    `${(parseFloat(document.getElementById('volume-kg').value) || 0).toLocaleString()} kg`;

  if (currentProduct) {
    document.getElementById('pdf-product-name').textContent = currentProduct.name ?? '';
    document.getElementById('pdf-product-spec').textContent =
      [currentProduct.specs?.trim_cut, currentProduct.specs?.caliber].filter(Boolean).join(' — ');
    if (currentProduct.photo) {
      const img = document.getElementById('pdf-product-img');
      img.src = currentProduct.photo;
      img.style.display = '';
    }

    // Certs
    const certsEl = document.getElementById('pdf-certs');
    certsEl.innerHTML = '';
    (currentProduct.certifications ?? []).forEach(certId => {
      const cert = CERTIFICATIONS[certId];
      if (!cert) return;
      const el = document.createElement('div');
      el.className = 'pdf-cert-item';
      if (cert.logo) {
        el.innerHTML = `<img src="${cert.logo}" alt="${cert.name}"> <span>${cert.name}</span>`;
      } else {
        el.innerHTML = `<span class="pdf-cert-badge">${certId.toUpperCase()}</span> <span>${cert.name}</span>`;
      }
      certsEl.appendChild(el);
    });
  }

  // Página 2 — interna
  document.getElementById('pdf-int-quote-number').textContent = currentQuoteNumber;
  buildInternalTable();

  const calc = recalculate();
  document.getElementById('pdf-sum-cost').textContent = `$${(calc?.totalCostPerKg ?? 0).toFixed(3)}`;
  document.getElementById('pdf-sum-margin').textContent = `${document.getElementById('margin-pct').value}%`;
  document.getElementById('pdf-sum-price').textContent = `$${priceKg.toFixed(2)}`;
  document.getElementById('pdf-sum-price-lb').textContent = `$${priceLb.toFixed(2)}/lb`;
  document.getElementById('pdf-meta-footer').textContent =
    `Generada por: ${currentUser.email} — ${new Date().toLocaleString('es-AR')} — USO INTERNO MANILA S.A.`;

  window.print();
}

function buildInternalTable() {
  const tbody = document.getElementById('pdf-cost-tbody');
  tbody.innerHTML = '';

  layers.forEach(layer => {
    if (layer.items.length === 0) return;

    const layerRow = document.createElement('tr');
    layerRow.className = 'layer-title';
    layerRow.innerHTML = `<td colspan="6">${layer.name}${layer.applies_yield ? ' (ajustado por rendimiento)' : ''}</td>`;
    tbody.appendChild(layerRow);

    let layerTotal = 0;
    layer.items.forEach(item => {
      const tr = document.createElement('tr');
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit;
      tr.innerHTML = `
        <td>${item.name || '—'}</td>
        <td>${item.source === 'table' ? 'Tabla' : 'Manual'}</td>
        <td class="num">$${(item.variable_value ?? 0).toFixed(2)} ${unitLabel}</td>
        <td class="num">${item.fixed_per_shipment ? '$' + item.fixed_per_shipment.toFixed(2) : '—'}</td>
        <td class="num">${item.fixed_per_quote ? '$' + item.fixed_per_quote.toFixed(2) : '—'}</td>
        <td class="num">$${(item.cost_per_kg_calc ?? 0).toFixed(4)}</td>
      `;
      tbody.appendChild(tr);
      layerTotal += item.cost_per_kg_calc ?? 0;
    });

    const subRow = document.createElement('tr');
    subRow.className = 'subtotal';
    subRow.innerHTML = `<td colspan="5">Subtotal ${layer.name}</td><td class="num">$${layerTotal.toFixed(4)}</td>`;
    tbody.appendChild(subRow);
  });

  // Comisión row
  if (commission.pct > 0 || commission.fixed_per_shipment || commission.fixed_per_quote) {
    const commRow = document.createElement('tr');
    commRow.className = 'layer-title';
    commRow.innerHTML = `<td colspan="6">Comisión comercial (${commission.pct}% sobre ${commission.base === 'cost' ? 'costo' : 'precio venta'})</td>`;
    tbody.appendChild(commRow);
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
