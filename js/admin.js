import { requireAuth, logout } from './auth.js';
import { db } from './firebase.js';
import { COST_LAYERS, COST_UNITS } from './config.js';
import {
  collection, getDocs, setDoc, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let currentUser = null;
let products = [];
let costItems = [];
let editingProductId = null;
let editingCostId = null;
let selectedPhoto = '';

const PRODUCT_PHOTOS = [
  'img/fillet-white.jpg',
  'img/fillet-pair.jpg',
  'img/fillet-color-individual.jpg',
  'img/fillet-vacpak-color.jpg',
  'img/fillet-vacpak-white.jpg',
  'img/butterfly-white.jpg',
  'img/smoked-rack.jpg',
  'img/smoked-patagonia-pack.jpg',
  'img/trout-board.jpg',
];

async function init() {
  currentUser = await requireAuth();
  document.getElementById('nav-user').textContent = currentUser.email;
  document.getElementById('btn-logout').addEventListener('click', logout);

  bindTabs();
  await Promise.all([loadProducts(), loadCostItems()]);
  bindProductForm();
  bindCostForm();
}

// ============================================================
// TABS
// ============================================================
function bindTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ============================================================
// PRODUCTOS
// ============================================================
async function loadProducts() {
  const snap = await getDocs(collection(db, 'products'));
  products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  products.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  renderProductList();
}

function renderProductList() {
  const container = document.getElementById('products-list');
  if (!products.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No hay productos. Creá el primero.</p></div>`;
    return;
  }
  container.innerHTML = '';
  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'admin-card';
    const thumbHTML = p.photo
      ? `<img class="admin-card-thumb" src="${p.photo}" alt="${p.name}">`
      : `<div class="admin-card-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>`;
    card.innerHTML = `
      ${thumbHTML}
      <div class="admin-card-body">
        <div class="admin-card-name">${p.name}</div>
        <div class="admin-card-sub">${p.presentation ?? ''} · Rend: ${p.default_yield_pct ?? '—'}%</div>
      </div>
      <div class="admin-card-actions">
        <button class="btn-secondary" style="padding:6px 12px;font-size:12px" data-edit="${p.id}">Editar</button>
      </div>
    `;
    card.querySelector('[data-edit]').addEventListener('click', () => openProductForm(p.id));
    container.appendChild(card);
  });
}

function renderPhotoPicker(currentPhotoSrc) {
  selectedPhoto = currentPhotoSrc ?? '';

  // Preview
  const preview = document.getElementById('p-photo-preview');
  if (selectedPhoto) {
    preview.innerHTML = `<img src="${selectedPhoto}" alt="">`;
    preview.classList.add('has-photo');
  } else {
    preview.innerHTML = '<span class="photo-picker-empty">Sin foto seleccionada</span>';
    preview.classList.remove('has-photo');
  }

  // Galería
  const gallery = document.getElementById('p-photo-gallery');
  gallery.innerHTML = '';

  // Opción "ninguna"
  const noneItem = document.createElement('div');
  noneItem.className = 'photo-pick-item photo-pick-none' + (!selectedPhoto ? ' selected' : '');
  noneItem.title = 'Sin foto';
  noneItem.innerHTML = '<span>✕</span>';
  noneItem.addEventListener('click', () => renderPhotoPicker(''));
  gallery.appendChild(noneItem);

  PRODUCT_PHOTOS.forEach(src => {
    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhoto ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.title = src.split('/').pop();
    item.addEventListener('click', () => renderPhotoPicker(src));
    gallery.appendChild(item);
  });
}

function bindProductForm() {
  document.getElementById('btn-new-product').addEventListener('click', () => openProductForm(null));
  document.getElementById('btn-cancel-product').addEventListener('click', () => closeProductForm());
  document.getElementById('btn-save-product').addEventListener('click', saveProduct);
  document.getElementById('btn-delete-product').addEventListener('click', deleteProduct);
  document.getElementById('btn-suggest-desc').addEventListener('click', renderDescriptionSuggestions);
}

function generateDescriptionSuggestions() {
  const name        = document.getElementById('p-name').value.trim();
  const presentation= document.getElementById('p-presentation').value.trim();
  const species     = document.getElementById('p-species').value.trim() || 'Rainbow Trout (Oncorhynchus mykiss)';
  const trim        = document.getElementById('p-trim').value.trim();
  const caliber     = document.getElementById('p-caliber').value.trim();
  const certs       = [...document.querySelectorAll('.cert-check:checked')].map(cb => cb.value);

  const pres     = presentation || name || 'Fillet';
  const presLow  = pres.toLowerCase();
  const speciesShort = species.includes('(') ? species.split('(')[0].trim() : species;
  const trimStr  = trim   ? `, ${trim}`            : '';
  const calStr   = caliber ? ` Available in ${caliber}.` : '';
  const certStr  = certs.includes('bap') ? ' BAP Certified.' : '';
  const noStr    = 'No antibiotics · No GMOs · No shortcuts.';
  const origin   = 'Raised in the pristine waters of Patagonia, Argentina.';

  return [
    `Premium Patagonian ${presLow}${trimStr}.${calStr} ${origin} ${noStr}`,
    `${species}. ${pres}${trimStr}.${calStr} From Manila S.A.'s Patagonia farm.${certStr} ${noStr}`,
    `${pres}${trimStr} of ${speciesShort.toLowerCase()} — farmed at Río Negro, Patagonia.${calStr} ${noStr}`,
    `Wild-quality, farm-raised precision. ${pres}${trimStr} of premium Patagonian trout.${calStr}${certStr}`,
    `Manila S.A. ${pres}${trimStr}. ${species}.${calStr} Argentina's finest aquaculture. ${noStr}`,
  ];
}

function renderDescriptionSuggestions() {
  const list = document.getElementById('suggestions-list');
  const suggestions = generateDescriptionSuggestions();
  list.innerHTML = '';
  suggestions.forEach(text => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      document.getElementById('p-notes').value = text;
      list.innerHTML = '';
    });
    list.appendChild(chip);
  });
}

function openProductForm(productId) {
  editingProductId = productId;
  const panel = document.getElementById('product-form-panel');
  const title = document.getElementById('product-form-title');
  const delBtn = document.getElementById('btn-delete-product');

  if (productId) {
    const p = products.find(x => x.id === productId);
    title.textContent = 'Editar producto';
    delBtn.style.display = '';
    document.getElementById('p-name').value = p.name ?? '';
    document.getElementById('p-presentation').value = p.presentation ?? '';
    document.getElementById('p-species').value = p.specs?.species ?? '';
    document.getElementById('p-trim').value = p.specs?.trim_cut ?? '';
    document.getElementById('p-caliber').value = p.specs?.caliber ?? '';
    document.getElementById('p-yield').value = p.default_yield_pct ?? '';
    renderPhotoPicker(p.photo ?? '');
    document.getElementById('p-order').value = p.order ?? 0;
    document.getElementById('p-notes').value = p.notes ?? '';
    document.querySelectorAll('.cert-check').forEach(cb => {
      cb.checked = (p.certifications ?? []).includes(cb.value);
    });
  } else {
    title.textContent = 'Nuevo producto';
    delBtn.style.display = 'none';
    document.getElementById('p-name').value = '';
    document.getElementById('p-presentation').value = '';
    document.getElementById('p-species').value = 'Rainbow Trout (Oncorhynchus mykiss)';
    document.getElementById('p-trim').value = '';
    document.getElementById('p-caliber').value = '';
    document.getElementById('p-yield').value = '50';
    renderPhotoPicker('');
    document.getElementById('p-order').value = products.length;
    document.getElementById('p-notes').value = '';
    document.querySelectorAll('.cert-check').forEach(cb => cb.checked = false);
  }

  panel.classList.add('open');
  document.getElementById('p-name').focus();
}

function closeProductForm() {
  document.getElementById('product-form-panel').classList.remove('open');
  editingProductId = null;
}

async function saveProduct() {
  const name = document.getElementById('p-name').value.trim();
  if (!name) { alert('El nombre es obligatorio'); return; }

  const id = editingProductId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const certifications = [...document.querySelectorAll('.cert-check:checked')].map(cb => cb.value);

  const product = {
    id,
    name,
    presentation: document.getElementById('p-presentation').value.trim(),
    specs: {
      species: document.getElementById('p-species').value.trim(),
      trim_cut: document.getElementById('p-trim').value.trim(),
      caliber: document.getElementById('p-caliber').value.trim()
    },
    default_yield_pct: parseFloat(document.getElementById('p-yield').value) || 50,
    photo: selectedPhoto,
    order: parseInt(document.getElementById('p-order').value) || 0,
    notes: document.getElementById('p-notes').value.trim(),
    certifications
  };

  await setDoc(doc(db, 'products', id), product);
  await loadProducts();
  closeProductForm();
}

async function deleteProduct() {
  if (!editingProductId) return;
  if (!confirm(`¿Eliminar el producto "${editingProductId}"? Las cotizaciones existentes conservarán su snapshot.`)) return;
  await deleteDoc(doc(db, 'products', editingProductId));
  await loadProducts();
  closeProductForm();
}

// ============================================================
// TABLAS DE COSTOS
// ============================================================
async function loadCostItems() {
  const snap = await getDocs(collection(db, 'cost_tables'));
  costItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCostList();
}

function renderCostList() {
  const container = document.getElementById('costs-list');
  if (!costItems.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><p>No hay ítems de referencia. Creá el primero.</p></div>`;
    return;
  }

  // Agrupar por capa
  const byLayer = {};
  COST_LAYERS.forEach(l => { byLayer[l.id] = []; });
  costItems.forEach(item => {
    if (!byLayer[item.layer]) byLayer[item.layer] = [];
    byLayer[item.layer].push(item);
  });

  container.innerHTML = '';
  COST_LAYERS.forEach(layer => {
    const items = byLayer[layer.id] ?? [];
    if (!items.length) return;

    const sectionTitle = document.createElement('h3');
    sectionTitle.style.cssText = 'font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--gray-500);margin:20px 0 8px;';
    sectionTitle.textContent = layer.name;
    container.appendChild(sectionTitle);

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'cost-table-item';
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit;
      el.innerHTML = `
        <span class="cti-name">${item.name}</span>
        <span class="cti-layer">${layer.name}</span>
        <span class="cti-val">${item.variable_value ?? 0} ${unitLabel}</span>
        <span class="cti-val">${item.variable_unit_kg ? item.variable_unit_kg + ' kg/u' : '—'}</span>
        <span class="cti-val">${item.fixed_per_shipment ? '$' + item.fixed_per_shipment + '/emb' : '—'}</span>
        <span class="cti-val">${item.fixed_per_quote ? '$' + item.fixed_per_quote + '/coti' : '—'}</span>
        <button class="btn-secondary" style="padding:5px 10px;font-size:12px" data-edit="${item.id}">Editar</button>
      `;
      el.querySelector('[data-edit]').addEventListener('click', () => openCostForm(item.id));
      container.appendChild(el);
    });
  });
}

function bindCostForm() {
  document.getElementById('btn-new-cost').addEventListener('click', () => openCostForm(null));
  document.getElementById('btn-cancel-cost').addEventListener('click', closeCostForm);
  document.getElementById('btn-save-cost').addEventListener('click', saveCostItem);
  document.getElementById('btn-delete-cost').addEventListener('click', deleteCostItem);

  // Toggle kg/unit field
  document.getElementById('c-unit').addEventListener('change', toggleUnitKg);
}

function toggleUnitKg() {
  const unit = document.getElementById('c-unit').value;
  const needsKg = COST_UNITS.find(u => u.id === unit)?.needs_unit_kg ?? false;
  document.getElementById('c-unitkg-wrap').style.display = needsKg ? '' : 'none';
}

function openCostForm(itemId) {
  editingCostId = itemId;
  const panel = document.getElementById('cost-form-panel');
  const delBtn = document.getElementById('btn-delete-cost');

  if (itemId) {
    const item = costItems.find(x => x.id === itemId);
    document.getElementById('cost-form-title').textContent = 'Editar ítem';
    delBtn.style.display = '';
    document.getElementById('c-name').value = item.name ?? '';
    document.getElementById('c-layer').value = item.layer ?? 'other';
    document.getElementById('c-value').value = item.variable_value ?? '';
    document.getElementById('c-unit').value = item.variable_unit ?? 'kg';
    document.getElementById('c-unitkg').value = item.variable_unit_kg ?? '';
    document.getElementById('c-fixed-ship').value = item.fixed_per_shipment ?? '';
    document.getElementById('c-fixed-quote').value = item.fixed_per_quote ?? '';
    document.getElementById('c-notes').value = item.notes ?? '';
  } else {
    document.getElementById('cost-form-title').textContent = 'Nuevo ítem de costo';
    delBtn.style.display = 'none';
    document.getElementById('c-name').value = '';
    document.getElementById('c-layer').value = 'transport';
    document.getElementById('c-value').value = '';
    document.getElementById('c-unit').value = 'kg';
    document.getElementById('c-unitkg').value = '';
    document.getElementById('c-fixed-ship').value = '';
    document.getElementById('c-fixed-quote').value = '';
    document.getElementById('c-notes').value = '';
  }

  toggleUnitKg();
  panel.classList.add('open');
  document.getElementById('c-name').focus();
}

function closeCostForm() {
  document.getElementById('cost-form-panel').classList.remove('open');
  editingCostId = null;
}

async function saveCostItem() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) { alert('El nombre es obligatorio'); return; }

  const id = editingCostId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  const unit = document.getElementById('c-unit').value;
  const needsKg = COST_UNITS.find(u => u.id === unit)?.needs_unit_kg ?? false;

  const item = {
    id,
    name,
    layer: document.getElementById('c-layer').value,
    variable_value: parseFloat(document.getElementById('c-value').value) || 0,
    variable_unit: unit,
    variable_unit_kg: needsKg ? (parseFloat(document.getElementById('c-unitkg').value) || null) : null,
    fixed_per_shipment: parseFloat(document.getElementById('c-fixed-ship').value) || 0,
    fixed_per_quote: parseFloat(document.getElementById('c-fixed-quote').value) || 0,
    notes: document.getElementById('c-notes').value.trim()
  };

  await setDoc(doc(db, 'cost_tables', id), item);
  await loadCostItems();
  closeCostForm();
}

async function deleteCostItem() {
  if (!editingCostId) return;
  if (!confirm('¿Eliminar este ítem de la tabla de costos?')) return;
  await deleteDoc(doc(db, 'cost_tables', editingCostId));
  await loadCostItems();
  closeCostForm();
}

init();
