import { requireAuth, logout } from './auth.js';
import { db, storage } from './firebase.js';
import { COST_LAYERS, LOCAL_COST_LAYERS, COST_UNITS, parseNum } from './config.js';
import {
  collection, getDocs, setDoc, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

let currentUser = null;
let products = [];
let productsLocal = [];
let costItems = [];
let editingProductId = null;
let editingCostId = null;
let editingProductLocalId = null;
let selectedPhoto = '';
let selectedPhotoLocal = '';
let caliberEntries = [];  // [{ min, max, unit }]
let localPhotos = [];    // fotos propias del producto en edición
let localPhotosLocal = [];  // fotos propias del producto local en edición

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
  await Promise.all([loadProducts(), loadProductsLocal(), loadCostItems()]);
  bindProductForm();
  bindProductLocalForm();
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
        <div class="admin-card-name">${p.name}${p.specs?.caliber ? ` — ${p.specs.caliber}` : ''}</div>
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

// Sube imagen a Firebase Storage y retorna URL pública
async function uploadProductPhoto(file, productId, collection = 'products') {
  // Comprimir a canvas → blob JPEG
  const img = new Image();
  const url = URL.createObjectURL(file);
  const blob = await new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const maxDim = 800;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo crear blob')), 'image/jpeg', 0.82);
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
  });

  const fileName = `${collection}/${productId}/${Date.now()}.jpg`;
  const storageRef = ref(storage, fileName);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
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

  // Fotos base globales (con opción de eliminar)
  PRODUCT_PHOTOS.forEach((src, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-pick-wrapper';
    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhoto ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.title = src.split('/').pop();
    item.addEventListener('click', () => renderPhotoPicker(src));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'photo-pick-del';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Eliminar foto';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedPhoto === src) selectedPhoto = '';
      PRODUCT_PHOTOS.splice(idx, 1);
      renderPhotoPicker(selectedPhoto);
    });
    wrapper.appendChild(item);
    wrapper.appendChild(delBtn);
    gallery.appendChild(wrapper);
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
      const productId = editingProductId || 'new-' + Date.now();
      const photoUrl = await uploadProductPhoto(file, productId, 'products');
      localPhotos.push(photoUrl);
      renderPhotoPicker(photoUrl);
    } catch (err) {
      console.error('Error subiendo imagen:', err);
      alert('Error al subir la imagen: ' + err.message);
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

function generateDescriptionSuggestionsLocal() {
  const name        = document.getElementById('pl-name').value.trim();
  const presentation= document.getElementById('pl-presentation').value.trim();
  const species     = document.getElementById('pl-species').value.trim() || 'Trucha Arcoíris';
  const trim        = document.getElementById('pl-trim').value.trim();
  const caliber     = document.getElementById('pl-caliber').value.trim();
  const conservation= document.getElementById('pl-conservation').value;
  const labelBrand  = document.getElementById('pl-label-brand').value;

  const pres     = presentation || name || 'Filete';
  const presLow  = pres.toLowerCase();
  const speciesShort = species.includes('(') ? species.split('(')[0].trim() : species;
  const trimStr  = trim ? `, ${trim}` : '';
  const calStr   = caliber ? ` Calibre: ${caliber}.` : '';
  const consStr  = conservation === 'refrigerado' ? 'Producto refrigerado.' : conservation === 'congelado' ? 'Producto congelado.' : '';
  const brandStr = labelBrand ? ` Marca: ${labelBrand}.` : '';
  const origen   = 'Criada en aguas puras de la Patagonia Argentina.';

  return [
    `${speciesShort} — ${presLow}${trimStr}.${calStr} ${origen} Sin antibióticos, sin transgénicos.`,
    `${pres}${trimStr} de ${speciesShort.toLowerCase()}, producida en Río Negro, Patagonia.${calStr} ${consStr}`,
    `Manila S.A. — ${presLow}${trimStr}. ${species}.${calStr} Acuicultura premium argentina.${brandStr}`,
    `${pres}${trimStr} de trucha patagónica premium.${calStr} ${consStr} ${origen}`,
    `${speciesShort}, ${presLow}${trimStr}. Calidad de exportación para el mercado local.${calStr}${brandStr}`,
  ];
}

function renderDescriptionSuggestionsLocal() {
  const list = document.getElementById('suggestions-list-local');
  const suggestions = generateDescriptionSuggestionsLocal();
  list.innerHTML = '';
  suggestions.forEach(text => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      document.getElementById('pl-notes').value = text;
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
  const caliberStr = getCaliberDisplayString();
  if (!caliberStr) { alert('Debe definir al menos un calibre'); return; }

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

// Estado de grupos colapsados
const collapsedGroups = {};

function renderCostList() {
  const container = document.getElementById('costs-list');
  if (!costItems.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><p>No hay ítems de referencia. Creá el primero.</p></div>`;
    return;
  }

  // Todas las capas (export + local)
  const ALL_LAYERS = [
    ...COST_LAYERS,
    ...LOCAL_COST_LAYERS.filter(l => !COST_LAYERS.find(cl => cl.id === l.id))
  ];

  // Agrupar por capa
  const byLayer = {};
  ALL_LAYERS.forEach(l => { byLayer[l.id] = []; });
  costItems.forEach(item => {
    if (!byLayer[item.layer]) byLayer[item.layer] = [];
    byLayer[item.layer].push(item);
  });

  // Tabla HTML
  let html = '<table class="cost-admin-table"><thead><tr>';
  html += '<th>Nombre</th><th>Moneda</th><th>Valor</th><th>Unidad</th><th>kg/u</th>';
  html += '<th>Fijo/emb</th><th>Fijo/coti</th><th>Notas</th><th>Actualizado</th><th></th>';
  html += '</tr></thead>';

  ALL_LAYERS.forEach(layer => {
    const items = byLayer[layer.id] ?? [];
    if (!items.length) return;

    const isCollapsed = collapsedGroups[layer.id] ?? false;
    const arrow = isCollapsed ? '▶' : '▼';

    html += `<tbody data-layer="${layer.id}">`;
    html += `<tr class="cat-group-header" data-toggle="${layer.id}"><td colspan="10">${arrow} ${layer.name} (${items.length})</td></tr>`;

    items.forEach(item => {
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit;
      const currency = item.currency ?? 'USD';
      const dateStr = item.updated_at
        ? new Date(item.updated_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })
        : '—';
      const notes = item.notes ? `<span title="${item.notes.replace(/"/g, '&quot;')}">${item.notes.length > 20 ? item.notes.slice(0, 20) + '…' : item.notes}</span>` : '—';

      html += `<tr class="cat-item-row" style="${isCollapsed ? 'display:none' : ''}">`;
      html += `<td class="cti-name">${item.name}</td>`;
      html += `<td><span class="currency-badge ${currency === 'ARS' ? 'ars' : 'usd'}">${currency}</span></td>`;
      html += `<td class="cti-val">${item.variable_value ?? 0}</td>`;
      html += `<td class="cti-val">${unitLabel}</td>`;
      html += `<td class="cti-val">${item.variable_unit_kg ?? '—'}</td>`;
      html += `<td class="cti-val">${item.fixed_per_shipment ? '$' + item.fixed_per_shipment : '—'}</td>`;
      html += `<td class="cti-val">${item.fixed_per_quote ? '$' + item.fixed_per_quote : '—'}</td>`;
      html += `<td class="cti-notes">${notes}</td>`;
      html += `<td class="cti-date">${dateStr}</td>`;
      html += `<td><button class="btn-secondary" style="padding:5px 10px;font-size:12px" data-edit="${item.id}">Editar</button></td>`;
      html += `</tr>`;
    });

    html += `</tbody>`;
  });

  html += '</table>';
  container.innerHTML = html;

  // Bind toggle events
  container.querySelectorAll('.cat-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const layerId = header.dataset.toggle;
      collapsedGroups[layerId] = !collapsedGroups[layerId];
      const tbody = header.closest('tbody');
      const rows = tbody.querySelectorAll('.cat-item-row');
      rows.forEach(r => r.style.display = collapsedGroups[layerId] ? 'none' : '');
      const arrow = collapsedGroups[layerId] ? '▶' : '▼';
      header.querySelector('td').textContent = `${arrow} ${header.querySelector('td').textContent.slice(2)}`;
    });
  });

  // Bind edit buttons
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openCostForm(btn.dataset.edit));
  });
}

function exportCostsCSV() {
  const headers = ['Nombre', 'Capa', 'Moneda', 'Valor', 'Unidad', 'kg/u', 'Fijo/emb', 'Fijo/coti', 'Notas', 'Actualizado'];
  const ALL_LAYERS = [
    ...COST_LAYERS,
    ...LOCAL_COST_LAYERS.filter(l => !COST_LAYERS.find(cl => cl.id === l.id))
  ];
  const rows = costItems.map(item => {
    const layerName = ALL_LAYERS.find(l => l.id === item.layer)?.name ?? item.layer;
    return [
      item.name, layerName, item.currency ?? 'USD', item.variable_value ?? 0,
      item.variable_unit ?? '', item.variable_unit_kg ?? '', item.fixed_per_shipment ?? 0,
      item.fixed_per_quote ?? 0, item.notes ?? '', item.updated_at ?? ''
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `costos-manila-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function bindCostForm() {
  document.getElementById('btn-new-cost').addEventListener('click', () => openCostForm(null));
  document.getElementById('btn-cancel-cost').addEventListener('click', closeCostForm);
  document.getElementById('btn-save-cost').addEventListener('click', saveCostItem);
  document.getElementById('btn-delete-cost').addEventListener('click', deleteCostItem);
  document.getElementById('btn-export-costs').addEventListener('click', exportCostsCSV);

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
    notes: document.getElementById('c-notes').value.trim(),
    updated_at: new Date().toISOString()
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

// ============================================================
// PRODUCTOS LOCAL
// ============================================================
async function loadProductsLocal() {
  const snap = await getDocs(collection(db, 'products-local'));
  productsLocal = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  productsLocal.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  renderProductLocalList();
}

function renderProductLocalList() {
  const container = document.getElementById('products-local-list');
  if (!productsLocal.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No hay productos locales. Creá el primero.</p></div>`;
    return;
  }
  container.innerHTML = '';
  productsLocal.forEach(p => {
    const card = document.createElement('div');
    card.className = 'admin-card';
    const thumbHTML = p.photo
      ? `<img class="admin-card-thumb" src="${p.photo}" alt="${p.name}">`
      : `<div class="admin-card-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>`;
    card.innerHTML = `
      ${thumbHTML}
      <div class="admin-card-body">
        <div class="admin-card-name">${p.name}${p.specs?.caliber ? ` — ${p.specs.caliber}` : ''}</div>
        <div class="admin-card-sub">${p.presentation ?? ''} · Rend: ${p.default_yield_pct ?? '—'}%</div>
      </div>
      <div class="admin-card-actions">
        <button class="btn-secondary" style="padding:6px 12px;font-size:12px" data-edit-local="${p.id}">Editar</button>
      </div>
    `;
    card.querySelector('[data-edit-local]').addEventListener('click', () => openProductLocalForm(p.id));
    container.appendChild(card);
  });
}

function bindProductLocalForm() {
  document.getElementById('btn-new-product-local').addEventListener('click', () => openProductLocalForm(null));
  document.getElementById('btn-cancel-product-local').addEventListener('click', () => closeProductLocalForm());
  document.getElementById('btn-save-product-local').addEventListener('click', saveProductLocal);
  document.getElementById('btn-delete-product-local').addEventListener('click', deleteProductLocal);

  document.getElementById('btn-suggest-desc-local').addEventListener('click', renderDescriptionSuggestionsLocal);

  // Auto-fill shelf life cuando cambia conservación
  document.getElementById('pl-conservation').addEventListener('change', () => {
    const conservation = document.getElementById('pl-conservation').value;
    const shelfInput = document.getElementById('pl-shelf-life');
    if (conservation === 'refrigerado') shelfInput.value = 15;
    else if (conservation === 'congelado') shelfInput.value = 365;
  });
}

function renderPhotoPickerLocal(currentPhotoSrc) {
  selectedPhotoLocal = currentPhotoSrc ?? '';

  const preview = document.getElementById('pl-photo-preview');
  if (selectedPhotoLocal) {
    preview.innerHTML = `<img src="${selectedPhotoLocal}" alt="">`;
    preview.classList.add('has-photo');
  } else {
    preview.innerHTML = '<span class="photo-picker-empty">Sin foto seleccionada</span>';
    preview.classList.remove('has-photo');
  }

  const gallery = document.getElementById('pl-photo-gallery');
  gallery.innerHTML = '';

  // Opción "ninguna"
  const noneItem = document.createElement('div');
  noneItem.className = 'photo-pick-item photo-pick-none' + (!selectedPhotoLocal ? ' selected' : '');
  noneItem.title = 'Sin foto';
  noneItem.innerHTML = '<span>✕</span>';
  noneItem.addEventListener('click', () => renderPhotoPickerLocal(''));
  gallery.appendChild(noneItem);

  // Fotos base globales (con opción de eliminar)
  PRODUCT_PHOTOS.forEach((src, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-pick-wrapper';
    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhotoLocal ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.title = src.split('/').pop();
    item.addEventListener('click', () => renderPhotoPickerLocal(src));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'photo-pick-del';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Eliminar foto';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedPhotoLocal === src) selectedPhotoLocal = '';
      PRODUCT_PHOTOS.splice(idx, 1);
      renderPhotoPickerLocal(selectedPhotoLocal);
    });
    wrapper.appendChild(item);
    wrapper.appendChild(delBtn);
    gallery.appendChild(wrapper);
  });

  // Fotos propias del producto local
  localPhotosLocal.forEach((src, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-pick-wrapper';
    const item = document.createElement('div');
    item.className = 'photo-pick-item' + (src === selectedPhotoLocal ? ' selected' : '');
    item.innerHTML = `<img src="${src}" alt="">`;
    item.addEventListener('click', () => renderPhotoPickerLocal(src));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'photo-pick-del';
    delBtn.innerHTML = '✕';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (selectedPhotoLocal === src) selectedPhotoLocal = '';
      localPhotosLocal.splice(idx, 1);
      renderPhotoPickerLocal(selectedPhotoLocal);
    });
    wrapper.appendChild(item);
    wrapper.appendChild(delBtn);
    gallery.appendChild(wrapper);
  });

  // Botón subir foto
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
      const productId = editingProductLocalId || 'new-' + Date.now();
      const photoUrl = await uploadProductPhoto(file, productId, 'products-local');
      localPhotosLocal.push(photoUrl);
      renderPhotoPickerLocal(photoUrl);
    } catch (err) {
      console.error('Error subiendo imagen:', err);
      alert('Error al subir la imagen: ' + err.message);
      uploadLabel.classList.remove('uploading');
      uploadLabel.querySelector('span').textContent = '＋';
    }
  });
}

function openProductLocalForm(productId) {
  editingProductLocalId = productId;
  const panel = document.getElementById('product-local-form-panel');
  const title = document.getElementById('product-local-form-title');
  const delBtn = document.getElementById('btn-delete-product-local');

  if (productId) {
    const p = productsLocal.find(x => x.id === productId);
    title.textContent = 'Editar producto local';
    delBtn.style.display = '';
    document.getElementById('pl-name').value = p.name ?? '';
    document.getElementById('pl-presentation').value = p.presentation ?? '';
    document.getElementById('pl-species').value = p.specs?.species ?? '';
    document.getElementById('pl-trim').value = p.specs?.trim_cut ?? '';
    document.getElementById('pl-caliber').value = p.specs?.caliber ?? '';
    document.getElementById('pl-yield').value = p.default_yield_pct ?? '';
    document.getElementById('pl-order').value = p.order ?? 0;
    document.getElementById('pl-unit').value = p.sale_unit ?? '';
    document.getElementById('pl-conservation').value = p.conservation ?? '';
    document.getElementById('pl-shelf-life').value = p.shelf_life_days ?? '';
    document.getElementById('pl-label-brand').value = p.label_brand ?? '';
    document.getElementById('pl-notes').value = p.notes ?? '';
    localPhotosLocal = [...(p.available_photos ?? [])];
    renderPhotoPickerLocal(p.photo ?? '');
  } else {
    title.textContent = 'Nuevo producto local';
    delBtn.style.display = 'none';
    document.getElementById('pl-name').value = '';
    document.getElementById('pl-presentation').value = '';
    document.getElementById('pl-species').value = 'Trucha Arcoíris (Oncorhynchus mykiss)';
    document.getElementById('pl-trim').value = '';
    document.getElementById('pl-caliber').value = '';
    document.getElementById('pl-yield').value = '50';
    document.getElementById('pl-order').value = productsLocal.length;
    document.getElementById('pl-unit').value = 'kg';
    document.getElementById('pl-conservation').value = '';
    document.getElementById('pl-shelf-life').value = '';
    document.getElementById('pl-label-brand').value = '';
    document.getElementById('pl-notes').value = '';
    localPhotosLocal = [];
    renderPhotoPickerLocal('');
  }

  panel.classList.add('open');
  document.getElementById('pl-name').focus();
}

function closeProductLocalForm() {
  document.getElementById('product-local-form-panel').classList.remove('open');
  editingProductLocalId = null;
  localPhotosLocal = [];
}

async function saveProductLocal() {
  const name = document.getElementById('pl-name').value.trim();
  if (!name) { alert('El nombre es obligatorio'); return; }
  const caliber = document.getElementById('pl-caliber').value.trim();
  if (!caliber) { alert('El calibre es obligatorio'); return; }

  const id = editingProductLocalId || name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '-').replace(/^-|-$/g, '');

  const conservation = document.getElementById('pl-conservation').value;
  const shelfLife = parseInt(document.getElementById('pl-shelf-life').value) || null;
  const labelBrand = document.getElementById('pl-label-brand').value;

  const product = {
    id,
    name,
    presentation: document.getElementById('pl-presentation').value.trim(),
    specs: {
      species: document.getElementById('pl-species').value.trim(),
      trim_cut: document.getElementById('pl-trim').value.trim(),
      caliber: document.getElementById('pl-caliber').value.trim()
    },
    default_yield_pct: parseNum(document.getElementById('pl-yield').value) || 50,
    photo: selectedPhotoLocal,
    available_photos: [...localPhotosLocal],
    order: parseInt(document.getElementById('pl-order').value) || 0,
    sale_unit: document.getElementById('pl-unit').value.trim(),
    conservation: conservation || null,
    shelf_life_days: shelfLife,
    label_brand: labelBrand || null,
    notes: document.getElementById('pl-notes').value.trim()
  };

  await setDoc(doc(db, 'products-local', id), product);
  await loadProductsLocal();
  closeProductLocalForm();
}

async function deleteProductLocal() {
  if (!editingProductLocalId) return;
  if (!confirm(`¿Eliminar el producto local "${editingProductLocalId}"?`)) return;
  await deleteDoc(doc(db, 'products-local', editingProductLocalId));
  await loadProductsLocal();
  closeProductLocalForm();
}

init();
