import { requireAuth, logout } from './auth.js';
import { db } from './firebase.js';
import { COST_LAYERS, COST_UNITS, parseNum } from './config.js';
import {
  collection, getDocs, setDoc, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let currentUser = null;
let products = [];
let costItems = [];
let editingProductId = null;
let editingCostId = null;
let selectedPhoto = '';
let caliberEntries = [];  // [{ min, max, unit }]
let localPhotos = [];    // fotos propias del producto en edición

// Conversión de unidades a gramos
const CAL_TO_G = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

function formatCaliberEntry(min, max, unit) {
  const minVal = parseFloat(String(min).replace(',', '.'));
  const maxVal = parseFloat(String(max).replace(',', '.'));
  if (!minVal || !maxVal) return null;

  const minG = minVal * CAL_TO_G[unit];
  const maxG = maxVal * CAL_TO_G[unit];

  // Lado métrico
  let metric;
  if (minG >= 1000) {
    metric = `${(minG / 1000).toFixed(1)}-${(maxG / 1000).toFixed(1)} kg`;
  } else {
    metric = `${Math.round(minG)}-${Math.round(maxG)} g`;
  }

  // Lado imperial
  const minOz = minG / 28.3495;
  const maxOz = maxG / 28.3495;
  let imperial;
  if (minOz >= 16) {
    imperial = `${(minOz / 16).toFixed(1)}-${(maxOz / 16).toFixed(1)} lb`;
  } else {
    imperial = `${minOz.toFixed(1)}-${maxOz.toFixed(1)} oz`;
  }

  // Mostrar unidad ingresada primero
  if (unit === 'g' || unit === 'kg') {
    return `${metric} · ${imperial}`;
  } else {
    const imperialExact = `${minVal}-${maxVal} ${unit}`;
    return `${imperialExact} · ${metric}`;
  }
}

function getCaliberDisplayString() {
  return caliberEntries
    .map(e => formatCaliberEntry(e.min, e.max, e.unit))
    .filter(Boolean)
    .join(', ');
}

function renderCaliberBuilder() {
  const container = document.getElementById('caliber-builder');
  if (!container) return;
  if (caliberEntries.length === 0) {
    container.innerHTML = '<div class="caliber-empty">Sin calibres definidos</div>';
    return;
  }
  container.innerHTML = '';
  caliberEntries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'caliber-entry';

    const preview = formatCaliberEntry(entry.min, entry.max, entry.unit);

    row.innerHTML = `
      <input type="text" inputmode="decimal" placeholder="min" class="cal-min" value="${entry.min ?? ''}">
      <span class="cal-dash">—</span>
      <input type="text" inputmode="decimal" placeholder="max" class="cal-max" value="${entry.max ?? ''}">
      <select class="cal-unit">
        <option value="g"  ${entry.unit === 'g'  ? 'selected' : ''}>g</option>
        <option value="kg" ${entry.unit === 'kg' ? 'selected' : ''}>kg</option>
        <option value="oz" ${entry.unit === 'oz' ? 'selected' : ''}>oz</option>
        <option value="lb" ${entry.unit === 'lb' ? 'selected' : ''}>lb</option>
      </select>
      <span class="cal-preview">${preview ?? '—'}</span>
      <button type="button" class="btn-icon cal-remove" title="Eliminar">✕</button>
    `;

    // Eventos
    row.querySelector('.cal-min').addEventListener('input', e => {
      caliberEntries[idx].min = e.target.value;
      row.querySelector('.cal-preview').textContent = formatCaliberEntry(caliberEntries[idx].min, caliberEntries[idx].max, caliberEntries[idx].unit) ?? '—';
    });
    row.querySelector('.cal-max').addEventListener('input', e => {
      caliberEntries[idx].max = e.target.value;
      row.querySelector('.cal-preview').textContent = formatCaliberEntry(caliberEntries[idx].min, caliberEntries[idx].max, caliberEntries[idx].unit) ?? '—';
    });
    row.querySelector('.cal-unit').addEventListener('change', e => {
      caliberEntries[idx].unit = e.target.value;
      row.querySelector('.cal-preview').textContent = formatCaliberEntry(caliberEntries[idx].min, caliberEntries[idx].max, caliberEntries[idx].unit) ?? '—';
    });
    row.querySelector('.cal-remove').addEventListener('click', () => {
      caliberEntries.splice(idx, 1);
      renderCaliberBuilder();
    });

    container.appendChild(row);
  });
}

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

// Comprime y devuelve data URL base64 (se guarda en Firestore, sin Storage)
async function compressToBase64(file, maxDim = 600, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (!dataUrl || dataUrl === 'data:,') { reject(new Error('No se pudo procesar la imagen')); return; }
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
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

  // Fotos base globales (compartidas, sin eliminar)
  PRODUCT_PHOTOS.forEach(src => {
    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhoto ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.title = src.split('/').pop();
    item.addEventListener('click', () => renderPhotoPicker(src));
    gallery.appendChild(item);
  });

  // Fotos propias del producto (con X para eliminar)
  localPhotos.forEach((src, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-pick-wrapper';

    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhoto ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.title = 'Foto del producto';
    item.addEventListener('click', () => renderPhotoPicker(src));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'photo-pick-del';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Eliminar foto';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedPhoto === src) selectedPhoto = '';
      localPhotos.splice(idx, 1);
      renderPhotoPicker(selectedPhoto);
    });

    wrapper.appendChild(item);
    wrapper.appendChild(delBtn);
    gallery.appendChild(wrapper);
  });

  // Botón subir foto nueva — <label> wrapping <input> para máxima compatibilidad cross-browser
  const uploadLabel = document.createElement('label');
  uploadLabel.className = 'photo-pick-item photo-pick-upload';
  uploadLabel.title = 'Subir foto nueva';
  uploadLabel.style.cursor = 'pointer';
  uploadLabel.innerHTML = '<span>＋</span>';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.cssText = 'position:absolute;width:0;height:0;opacity:0;overflow:hidden;';
  uploadLabel.appendChild(fileInput);
  gallery.appendChild(uploadLabel);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadLabel.classList.add('uploading');
    uploadLabel.querySelector('span').textContent = '···';
    try {
      const dataUrl = await compressToBase64(file);
      localPhotos.push(dataUrl);
      renderPhotoPicker(dataUrl);
    } catch (err) {
      console.error('Error procesando imagen:', err);
      alert('Error al procesar la imagen: ' + err.message);
      uploadLabel.classList.remove('uploading');
      uploadLabel.querySelector('span').textContent = '＋';
    }
  });
}

function bindProductForm() {
  document.getElementById('btn-new-product').addEventListener('click', () => openProductForm(null));
  document.getElementById('btn-cancel-product').addEventListener('click', () => closeProductForm());
  document.getElementById('btn-save-product').addEventListener('click', saveProduct);
  document.getElementById('btn-delete-product').addEventListener('click', deleteProduct);
  document.getElementById('btn-suggest-desc').addEventListener('click', renderDescriptionSuggestions);
  document.getElementById('btn-add-caliber').addEventListener('click', () => {
    caliberEntries.push({ min: '', max: '', unit: 'oz' });
    renderCaliberBuilder();
    // Focus en el input min del último entry
    const entries = document.querySelectorAll('.caliber-entry');
    entries[entries.length - 1]?.querySelector('.cal-min')?.focus();
  });
}

function generateDescriptionSuggestions() {
  const name        = document.getElementById('p-name').value.trim();
  const presentation= document.getElementById('p-presentation').value.trim();
  const species     = document.getElementById('p-species').value.trim() || 'Rainbow Trout (Oncorhynchus mykiss)';
  const trim        = document.getElementById('p-trim').value.trim();
  const caliber     = getCaliberDisplayString();
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
    // Calibres: restaurar desde array estructurado (nuevo) o dejar vacío (legacy string se descarta)
    caliberEntries = (p.specs?.calibers ?? []).map(e => ({ ...e }));
    document.getElementById('p-yield').value = p.default_yield_pct ?? '';
    localPhotos = [...(p.available_photos ?? [])];
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
    caliberEntries = [];
    document.getElementById('p-yield').value = '50';
    localPhotos = [];
    renderPhotoPicker('');
    document.getElementById('p-order').value = products.length;
    document.getElementById('p-notes').value = '';
    document.querySelectorAll('.cert-check').forEach(cb => cb.checked = false);
  }

  renderCaliberBuilder();
  panel.classList.add('open');
  document.getElementById('p-name').focus();
}

function closeProductForm() {
  document.getElementById('product-form-panel').classList.remove('open');
  editingProductId = null;
  caliberEntries = [];
  localPhotos = [];
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
      calibers: caliberEntries.filter(e => e.min && e.max),  // array estructurado
      caliber: getCaliberDisplayString()                      // string para PDF
    },
    default_yield_pct: parseNum(document.getElementById('p-yield').value) || 50,
    photo: selectedPhoto,
    available_photos: [...localPhotos],
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
      const currency = item.currency ?? 'USD';
      el.innerHTML = `
        <span class="cti-name">${item.name}</span>
        <span class="cti-layer">${layer.name}</span>
        <span class="currency-badge ${currency === 'ARS' ? 'ars' : 'usd'}">${currency}</span>
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
    document.getElementById('c-currency').value = item.currency ?? 'USD';
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
    document.getElementById('c-currency').value = 'USD';
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
    currency: document.getElementById('c-currency').value,
    variable_value: parseNum(document.getElementById('c-value').value) || 0,
    variable_unit: unit,
    variable_unit_kg: needsKg ? (parseNum(document.getElementById('c-unitkg').value) || null) : null,
    fixed_per_shipment: parseNum(document.getElementById('c-fixed-ship').value) || 0,
    fixed_per_quote: parseNum(document.getElementById('c-fixed-quote').value) || 0,
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
