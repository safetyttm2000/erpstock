/* ============================================================
   ERP Stock System — app.js
   All UI logic: auth, navigation, dashboard, equipment CRUD,
   dispose, borrow/return, user management, QR, Excel, PDF print
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
let currentUser   = null;   // { token, username, fullName, role }
let equipCache    = [];     // latest equipment list from API
let locationsCache = [];
let borrowersCache = [];
let scannerInstance = null; // html5-qrcode instance

// ── Bootstrap modal helpers ──────────────────────────────────
const bsModal = id => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));

// ── DOM ready ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initLanguage();
  restoreSession();
  checkApiConnection();
});

// ============================================================
// PARTICLES — lightweight canvas animation
// ============================================================
function initParticles() {
  const canvas = document.getElementById('loginParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['rgba(230,57,70,', 'rgba(42,157,143,', 'rgba(244,163,0,', 'rgba(255,255,255,'];
  for (let i = 0; i < 55; i++) {
    particles.push({
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      r: Math.random() * 2.2 + 0.4,
      dx: (Math.random() - 0.5) * 0.35,
      dy: (Math.random() - 0.5) * 0.35,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.5 + 0.15
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + p.alpha + ')';
      ctx.fill();
    });
    // Draw faint connecting lines between nearby particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 * (1 - dist/110)) + ')';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ============================================================
// CONNECTION TEST
// ============================================================
async function checkApiConnection() {
  const el = document.getElementById('loginApiStatus');
  if (!el) return;
  const text = el.querySelector('.status-text');

  if (!window.APP_CONFIG || !window.APP_CONFIG.API_URL ||
      window.APP_CONFIG.API_URL.includes('PASTE_YOUR')) {
    el.className = 'fail';
    text.textContent = '⚠️ ยังไม่ได้ตั้งค่า API_URL ใน config.js';
    return;
  }

  text.textContent = 'กำลังตรวจสอบการเชื่อมต่อ...';

  // Timeout wrapper — GAS can take up to 6 s on cold start
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 8000)
  );

  try {
    const res = await Promise.race([Api.call('ping', {}), timeout]);
    if (res && res.success) {
      el.className = 'ok';
      text.textContent = 'เชื่อมต่อ Server สำเร็จ ✓';
    } else {
      el.className = 'fail';
      text.textContent = 'Server ตอบกลับผิดปกติ — ' + (res && res.message ? res.message : 'ตรวจสอบ Apps Script');
    }
  } catch (e) {
    el.className = 'fail';
    text.textContent = e.message === 'timeout'
      ? '⏱ Server ตอบช้าเกินไป (GAS cold start) — ลองใหม่อีกครั้ง'
      : '❌ เชื่อมต่อไม่ได้ — ตรวจสอบ API_URL ใน config.js';
  }
}

// ============================================================
// LANGUAGE
// ============================================================
function initLanguage() {
  const lang = localStorage.getItem('erp_lang') || 'th';
  window.applyLanguage(lang);
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.addEventListener('click', () => window.applyLanguage(btn.dataset.langBtn));
  });
}

// ============================================================
// SESSION / AUTH
// ============================================================
function restoreSession() {
  const token    = localStorage.getItem('erp_token');
  const userData = localStorage.getItem('erp_user');
  if (token && userData) {
    try {
      currentUser = JSON.parse(userData);
      currentUser.token = token;
      enterApp();
      return;
    } catch (e) { /* fall through */ }
  }
  showLogin();
}

function showLogin() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('appShell').style.display = 'none';
}

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  document.getElementById('topbarUser').textContent = currentUser.fullName || currentUser.username;
  const sidebarName = document.getElementById('sidebarUserName');
  if (sidebarName) sidebarName.textContent = currentUser.fullName || currentUser.username;
  document.getElementById('navUsers').style.display = currentUser.role === 'Admin' ? '' : 'none';
  navigateTo('dashboard');
  setupNav();
  setupTopbar();
  setupForms();
  setupExcelImportExport();
  setupPrintPdf();
}

window.handleSessionExpired = function () {
  doLogout();
  showToast(t('session_expired') || 'หมดเวลา Session กรุณาเข้าสู่ระบบใหม่', 'danger');
};

// ── Login form ──────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const btnText   = submitBtn.querySelector('.login-btn-text');
  const btnSpin   = submitBtn.querySelector('.login-btn-spinner');

  // Hide error, show loading
  errEl.style.display = 'none';
  submitBtn.disabled  = true;
  btnText.textContent = 'กำลังเข้าสู่ระบบ...';
  btnSpin.style.display = '';

  try {
    const res = await Api.call('loginUser', { username, password });

    if (!res.success) {
      errEl.textContent   = res.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      errEl.style.display = '';
      // Shake the card
      const card = document.querySelector('.login-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 600);
      return;
    }

    const d = res.data;
    localStorage.setItem('erp_token', d.token);
    localStorage.setItem('erp_user', JSON.stringify({
      username: d.username, fullName: d.fullName, role: d.role
    }));
    currentUser = { token: d.token, username: d.username, fullName: d.fullName, role: d.role };
    enterApp();

  } catch (err) {
    errEl.textContent   = 'เกิดข้อผิดพลาด: ' + (err.message || 'ไม่สามารถติดต่อ Server ได้');
    errEl.style.display = '';
  } finally {
    submitBtn.disabled  = false;
    btnText.textContent = t('loginBtn') || 'เข้าสู่ระบบ';
    btnSpin.style.display = 'none';
  }
});

// ── Password show/hide toggle ─────────────────────────────
document.getElementById('togglePasswordBtn')?.addEventListener('click', function () {
  const inp  = document.getElementById('loginPassword');
  const icon = document.getElementById('togglePasswordIcon');
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.className = 'bi bi-eye-slash';
  } else {
    inp.type = 'password';
    icon.className = 'bi bi-eye';
  }
  inp.focus();
});

// ── Logout ───────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', e => { e.preventDefault(); doLogout(); });

function doLogout() {
  if (currentUser) Api.call('logoutUser', {}).catch(() => {});
  localStorage.removeItem('erp_token');
  localStorage.removeItem('erp_user');
  currentUser = null;
  showLogin();
}

// ============================================================
// NAVIGATION
// ============================================================
function setupNav() {
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
      closeSidebar();
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-link[data-page]').forEach(l => l.classList.remove('active'));
  const active = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (active) active.classList.add('active');
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById('page-' + page);
  if (section) section.classList.add('active');
  const titleEl = document.getElementById('pageTitle');
  if (titleEl && active) titleEl.textContent = active.querySelector('[data-i18n]')?.textContent || '';

  // Load data for each page
  if (page === 'dashboard')     loadDashboard();
  if (page === 'equipmentList') loadEquipmentList();
  if (page === 'addEquipment')  loadAddEquipmentMeta();
  if (page === 'dispose')       loadDisposePage();
  if (page === 'borrow')        loadBorrowPage();
  if (page === 'users')         loadUsers();
}

// ── Sidebar mobile ──────────────────────────────────────────
function setupTopbar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    sidebar.classList.toggle('show');
    backdrop.classList.toggle('show');
  });
  backdrop.addEventListener('click', closeSidebar);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;min-width:260px;';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `alert alert-${type} shadow`;
  el.style.cssText = 'margin-bottom:8px;';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  try {
    const res = await Api.call('getDashboard', {});
    if (!res.success) return;
    const d = res.data;
    document.getElementById('statTotal').textContent       = d.totalEquipmentRecords ?? 0;
    document.getElementById('statRemaining').textContent   = d.totalRemaining ?? 0;
    document.getElementById('statLowStock').textContent    = d.lowStock ?? 0;
    document.getElementById('statExpired').textContent     = d.expired ?? 0;
    document.getElementById('statNearExpiry').textContent  = d.nearExpiry ?? 0;
    document.getElementById('statActiveBorrow').textContent = d.activeBorrow ?? 0;
    document.getElementById('statOverdue').textContent     = d.overdueBorrow ?? 0;

    // By-type cards
    const container = document.getElementById('byTypeCards');
    if (!container) return;
    const typeColors = { Firefighting: 'icon-red', Rescue: 'icon-amber', Chemical: 'icon-teal', Tools: 'icon-navy', Other: '' };
    const typeIcons  = { Firefighting: 'bi-fire', Rescue: 'bi-shield-plus', Chemical: 'bi-droplet-half', Tools: 'bi-tools', Other: 'bi-box' };
    container.innerHTML = '';
    (d.byType || []).forEach(bt => {
      const card = document.createElement('div');
      card.className = 'col-6 col-md-4 col-lg-3';
      card.innerHTML = `
        <div class="stat-card">
          <div class="stat-icon ${typeColors[bt.type] || ''}"><i class="bi ${typeIcons[bt.type] || 'bi-box'}"></i></div>
          <div class="stat-value">${bt.remaining ?? 0}</div>
          <div class="stat-label">${t('type_' + bt.type) || bt.type}</div>
        </div>`;
      container.appendChild(card);
    });
  } catch (err) { console.error('loadDashboard', err); }
}

// ============================================================
// EQUIPMENT LIST
// ============================================================
async function loadEquipmentList(force = false) {
  try {
    const res = await Api.call('listEquipment', {});
    if (!res.success) return;
    equipCache = res.data || [];
    renderEquipmentTable();
  } catch (err) { console.error('loadEquipmentList', err); }
}

function renderEquipmentTable() {
  const typeFilter  = document.getElementById('filterType')?.value || '';
  const searchVal   = (document.getElementById('searchEquipment')?.value || '').toLowerCase();
  const tbody       = document.getElementById('equipmentTableBody');
  if (!tbody) return;

  let rows = equipCache;
  if (typeFilter) rows = rows.filter(r => r.Type === typeFilter);
  if (searchVal)  rows = rows.filter(r =>
    (r.ID||'').toLowerCase().includes(searchVal) ||
    (r.Name||'').toLowerCase().includes(searchVal) ||
    (r.Location||'').toLowerCase().includes(searchVal)
  );

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">${t('noData') || 'ไม่พบข้อมูล'}</td></tr>`;
    return;
  }

  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    const statusClass = {
      Available: 'tag-available', LowStock: 'tag-lowstock', OutOfStock: 'tag-outofstock',
      NearExpiry: 'tag-nearexpiry', Expired: 'tag-expired'
    }[row.Status] || '';
    const statusLabel = t('status_' + row.Status) || row.Status;
    const typeName    = row.Type ? (t('type_' + row.Type) || row.Type) : '—';
    const imgHtml     = row.ImageURL
      ? `<img src="${row.ImageURL}" class="equip-thumb" alt="" onerror="this.style.display='none'">`
      : '<span class="text-muted" style="font-size:.8rem;">—</span>';

    // col 1: QR mini canvas (generated after insert)
    // col 2: ID
    // col 3: Image
    // col 4: Name
    // col 5: Type
    // col 6: Remaining / Total
    // col 7: Location
    // col 8: Expiry
    // col 9: Status badge
    // col 10: Actions
    tr.innerHTML = `
      <td class="text-center text-muted small fw-bold">${i + 1}</td>
      <td class="font-monospace small">${esc(row.ID)}</td>
      <td>${imgHtml}</td>
      <td>${esc(row.Name)}</td>
      <td>${typeName}</td>
      <td>${row.Remaining ?? 0} / ${row.Quantity ?? 0}</td>
      <td>${esc(row.Location || '—')}</td>
      <td class="small">${row.ExpiryDate || '—'}</td>
      <td><span class="tag ${statusClass}">${statusLabel}</span></td>
      <td>
        <button class="btn btn-sm btn-outline-secondary me-1 eq-edit-btn" data-idx="${i}" title="แก้ไข"><i class="bi bi-pencil"></i></button>
        ${currentUser.role === 'Admin' ? `<button class="btn btn-sm btn-outline-danger eq-del-btn" data-idx="${i}" title="ลบ"><i class="bi bi-trash3"></i></button>` : ''}
      </td>`;
    tbody.appendChild(tr);

    tr.addEventListener('click', e => { if (e.target.closest('button')) return; openDetailModal(row); });
    tr.querySelector('.eq-edit-btn')?.addEventListener('click', e => { e.stopPropagation(); editEquipment(i); });
    tr.querySelector('.eq-del-btn')?.addEventListener('click',  e => { e.stopPropagation(); confirmDelete(() => deleteEquipment(row._row)); });
  });
}

function openDetailModal(row) {
  const body = document.getElementById('detailModalBody');
  if (!body) return;
  const statusClass = {
    Available: 'tag-available', LowStock: 'tag-lowstock', OutOfStock: 'tag-outofstock',
    NearExpiry: 'tag-nearexpiry', Expired: 'tag-expired'
  }[row.Status] || '';
  body.innerHTML = `
    <div class="row g-3">
      ${row.ImageURL ? `<div class="col-12 text-center"><img src="${row.ImageURL}" style="max-height:200px;border-radius:8px;" alt=""></div>` : ''}
      <div class="col-6"><strong>${t('col_id')||'รหัส'}</strong><br>${esc(row.ID)}</div>
      <div class="col-6"><strong>${t('field_type')||'ประเภท'}</strong><br>${t('type_'+row.Type)||row.Type}</div>
      <div class="col-6"><strong>${t('col_name')||'ชื่อ'}</strong><br>${esc(row.Name)}</div>
      <div class="col-6"><strong>${t('col_qty')||'จำนวน'}</strong><br>${row.Remaining ?? row.Quantity ?? 0} / ${row.Quantity ?? 0}</div>
      <div class="col-6"><strong>${t('field_minQty')||'จำนวนขั้นต่ำ'}</strong><br>${row.MinQuantity ?? ''}</div>
      <div class="col-6"><strong>${t('field_location')||'สถานที่'}</strong><br>${esc(row.Location)}</div>
      <div class="col-6"><strong>${t('field_expiry')||'วันหมดอายุ'}</strong><br>${row.ExpiryDate||'—'}</div>
      <div class="col-6"><strong>${t('field_calibrate')||'วันตรวจเช็ค'}</strong><br>${row.CalibrateDate||'—'}</div>
      <div class="col-12"><strong>${t('col_status')||'สถานะ'}</strong><br><span class="tag ${statusClass}">${t('status_'+row.Status)||row.Status}</span></div>
      ${row.Description ? `<div class="col-12"><strong>${t('field_description')||'รายละเอียด'}</strong><br>${esc(row.Description)}</div>` : ''}
    </div>
    <div id="detailQrArea" class="text-center mt-3"></div>`;
  // QR in detail modal
  const qrArea = document.getElementById('detailQrArea');
  if (qrArea && row.ID) {
    qrArea.innerHTML = '';
    setTimeout(() => makeQrCode(qrArea, row.ID, 120), 100);
  }
  bsModal('detailModal').show();
}

// Equipment filter/search controls
document.getElementById('filterType')?.addEventListener('change', renderEquipmentTable);
document.getElementById('searchEquipment')?.addEventListener('input', debounce(renderEquipmentTable, 250));

// ============================================================
// ADD / EDIT EQUIPMENT
// ============================================================
async function loadAddEquipmentMeta() {
  await refreshLocations();
}

async function refreshLocations() {
  try {
    const res = await Api.call('listLocations', {});
    if (res.success) {
      locationsCache = res.data || [];
      populateLocationDropdown(document.getElementById('eqLocation'), locationsCache);
    }
  } catch (e) {}
}

function populateLocationDropdown(sel, locs) {
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${t('select_placeholder')||'-- เลือก --'}</option>`;
  (locs || []).forEach(l => {
    const opt = document.createElement('option');
    opt.value = l; opt.textContent = l;
    sel.appendChild(opt);
  });
  const otherOpt = document.createElement('option');
  otherOpt.value = '__other__'; otherOpt.dataset.i18n = 'location_other';
  otherOpt.textContent = t('location_other') || 'อื่นๆ (ระบุ)';
  sel.appendChild(otherOpt);
  if (current) sel.value = current;
}

function setupForms() {
  // Location other-reveal
  document.getElementById('eqLocation')?.addEventListener('change', function () {
    const wrap = document.getElementById('eqOtherLocationWrap');
    if (wrap) wrap.style.display = this.value === '__other__' ? '' : 'none';
  });

  // Image source toggle
  document.getElementById('eqImageFile')?.addEventListener('change', function () {
    if (this.files[0]) previewImageFile(this.files[0]);
  });
  document.getElementById('eqImageUrl')?.addEventListener('input', function () {
    const prev = document.getElementById('eqImagePreview');
    if (prev) prev.src = this.value || '';
  });

  // Add/Edit Equipment form
  document.getElementById('equipmentForm')?.addEventListener('submit', submitEquipmentForm);
  document.getElementById('eqCancelEditBtn')?.addEventListener('click', resetEquipmentForm);

  // Dispose
  document.getElementById('dispType')?.addEventListener('change', () => populateEquipmentDropdown('dispType', 'dispEquipment', true));
  document.getElementById('disposeForm')?.addEventListener('submit', submitDispose);
  document.getElementById('dispCancelEditBtn')?.addEventListener('click', resetDisposeForm);
  document.getElementById('dispScanBtn')?.addEventListener('click', () => openScanner('dispose'));

  // Borrow
  document.getElementById('brwType')?.addEventListener('change', () => populateEquipmentDropdown('brwType', 'brwEquipment', false));
  document.getElementById('borrowForm')?.addEventListener('submit', submitBorrow);
  document.getElementById('brwCancelEditBtn')?.addEventListener('click', resetBorrowForm);
  document.getElementById('brwScanBtn')?.addEventListener('click', () => openScanner('borrow'));

  // Users
  document.getElementById('addUserBtn')?.addEventListener('click', openAddUser);
  document.getElementById('userForm')?.addEventListener('submit', submitUser);
}

function previewImageFile(file) {
  const prev = document.getElementById('eqImagePreview');
  if (!prev) return;
  const reader = new FileReader();
  reader.onload = e => { prev.src = e.target.result; prev.style.display = ''; };
  reader.readAsDataURL(file);
}

async function getImageBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const b64 = e.target.result.split(',')[1];
      resolve({ base64: b64, mimeType: file.type, fileName: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitEquipmentForm(e) {
  e.preventDefault();
  const rowVal = document.getElementById('eqRow')?.value || '';
  const isEdit = !!rowVal;

  // ── Validate required fields manually (avoid cryptic browser popups) ──
  const eqType = document.getElementById('eqType')?.value || '';
  const eqName = (document.getElementById('eqName')?.value || '').trim();
  const eqQty  = document.getElementById('eqQuantity')?.value;

  if (!eqType) { showToast('กรุณาเลือกประเภทอุปกรณ์', 'danger'); return; }
  if (!eqName) { showToast('กรุณากรอกชื่ออุปกรณ์', 'danger'); return; }
  if (eqQty === '' || eqQty === null) { showToast('กรุณากรอกจำนวนอุปกรณ์', 'danger'); return; }

  // ── Location ──
  let location = document.getElementById('eqLocation')?.value || '';
  if (location === '__other__') {
    location = (document.getElementById('eqOtherLocation')?.value || '').trim();
    if (!location) { showToast('กรุณาระบุสถานที่เก็บ', 'danger'); return; }
  }
  // ไม่บังคับ location ถ้าไม่ได้เลือก

  const equipment = {
    Type:          eqType,
    Name:          eqName,
    Description:   document.getElementById('eqDescription')?.value || '',
    Quantity:      parseInt(eqQty) || 0,
    MinQuantity:   parseInt(document.getElementById('eqMinQuantity')?.value) || 0,
    Location:      location,
    ExpiryDate:    document.getElementById('eqExpiryDate')?.value || '',
    CalibrateDate: document.getElementById('eqCalibrateDate')?.value || '',
    ImageURL:      document.getElementById('eqImageUrl')?.value || '',
  };

  // ── Loading state ──
  const saveBtn = document.getElementById('eqSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...'; }

  try {
    // Image file upload (optional)
    const fileInput = document.getElementById('eqImageFile');
    if (fileInput?.files[0]) {
      try {
        const imgData = await getImageBase64(fileInput.files[0]);
        const upRes = await Api.call('uploadImage', imgData);
        if (upRes.success) equipment.ImageURL = upRes.data.url;
        else showToast('อัปโหลดรูปภาพไม่สำเร็จ: ' + upRes.message, 'warning');
      } catch (err) { showToast('อัปโหลดรูปล้มเหลว', 'danger'); return; }
    }

    const action  = isEdit ? 'updateEquipment' : 'addEquipment';
    const payload = isEdit ? { row: parseInt(rowVal), equipment } : { equipment };
    const res = await Api.call(action, payload);

    if (!res.success) {
      showToast('บันทึกไม่สำเร็จ: ' + (res.message || 'เกิดข้อผิดพลาด'), 'danger');
      return;
    }

    showToast('บันทึกสำเร็จ ✓', 'success');
    equipCache = [];

    if (!isEdit && res.data?.id) {
      showQrModal(res.data.id);
    } else {
      resetEquipmentForm();
    }

  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + (err.message || 'ไม่ทราบสาเหตุ'), 'danger');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('save') || 'บันทึก'; }
  }
}

// ── QR helper — works with qrcodejs (new QRCode) ──────────
function makeQrCode(container, text, size) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return;
  container.innerHTML = '';
  if (window.QRCode) {
    try {
      new QRCode(container, {
        text:         text,
        width:        size,
        height:       size,
        colorDark:    '#1B2430',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (err) {
      container.innerHTML = `<span class="text-danger small">QR Error: ${err.message}</span>`;
    }
  } else {
    // Fallback: Google Charts QR API
    const img = document.createElement('img');
    img.src = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(text)}&chld=M|2`;
    img.width = size; img.height = size;
    img.style.borderRadius = '4px';
    container.appendChild(img);
  }
}

function showQrModal(equipId) {
  const titleEl = document.getElementById('qrModalTitle');
  if (titleEl) titleEl.textContent = `QR Code: ${equipId}`;

  const modal = bsModal('qrModal');
  modal.show();

  // Generate QR after modal animation finishes
  document.getElementById('qrModal').addEventListener('shown.bs.modal', function onShown() {
    document.getElementById('qrModal').removeEventListener('shown.bs.modal', onShown);
    const box = document.getElementById('qrPreviewBox');
    if (box) makeQrCode(box, equipId, 220);

    // Download button — grab the canvas/img created by qrcodejs
    const dlBtn = document.getElementById('downloadQrBtn');
    if (dlBtn) {
      dlBtn.onclick = () => {
        const canvas = document.querySelector('#qrPreviewBox canvas');
        if (canvas) {
          const a = document.createElement('a');
          a.download = `QR_${equipId}.png`;
          a.href = canvas.toDataURL('image/png');
          a.click();
        } else {
          const img = document.querySelector('#qrPreviewBox img');
          if (img) window.open(img.src, '_blank');
        }
      };
    }
  });

  document.getElementById('qrModal').addEventListener('hidden.bs.modal', resetEquipmentForm, { once: true });
}

function resetEquipmentForm() {
  document.getElementById('equipmentForm')?.reset();
  document.getElementById('eqRow').value = '';
  document.getElementById('eqImagePreview').src = '';
  document.getElementById('eqOtherLocationWrap').style.display = 'none';
  var _ecb = document.getElementById('eqCancelEditBtn'); if(_ecb) _ecb.style.display = 'none';
  const heading = document.querySelector('#page-addEquipment h6[data-i18n="nav_addEquipment"]');
  if (heading) heading.textContent = t('nav_addEquipment') || 'เพิ่มอุปกรณ์';
  // Re-populate locations
  refreshLocations();
}

function editEquipment(idx) {
  const row = equipCache[idx];
  if (!row) return;
  navigateTo('addEquipment');
  // Wait for meta to load then fill form
  setTimeout(() => {
    document.getElementById('eqRow').value   = row._row;
    document.getElementById('eqType').value  = row.Type || '';
    document.getElementById('eqName').value  = row.Name || '';
    document.getElementById('eqDescription').value = row.Description || '';
    document.getElementById('eqQuantity').value    = row.Quantity || '';
    document.getElementById('eqMinQuantity').value = row.MinQuantity || '';
    document.getElementById('eqExpiryDate').value  = row.ExpiryDate || '';
    document.getElementById('eqCalibrateDate').value = row.CalibrateDate || '';
    document.getElementById('eqImageUrl').value    = row.ImageURL || '';
    document.getElementById('eqImagePreview').src    = row.ImageURL || '';
    // Location
    const locSel = document.getElementById('eqLocation');
    if (locSel) {
      const found = [...locSel.options].some(o => { if (o.value === row.Location) { locSel.value = row.Location; return true; } return false; });
      if (!found && row.Location) {
        locSel.value = '__other__';
        document.getElementById('eqOtherLocationWrap').style.display = '';
        document.getElementById('eqOtherLocation').value = row.Location;
      }
    }
    var _ecb2 = document.getElementById('eqCancelEditBtn'); if(_ecb2) _ecb2.style.display = '';
    const heading = document.querySelector('#page-addEquipment h6[data-i18n="nav_addEquipment"]');
    if (heading) heading.textContent = t('edit') + ' — ' + row.Name;
  }, 200);
}

async function deleteEquipment(rowNum) {
  try {
    const res = await Api.call('deleteEquipment', { row: rowNum });
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('deleted') || 'ลบสำเร็จ', 'success');
    equipCache = [];
    loadEquipmentList();
  } catch (err) { showToast(err.message, 'danger'); }
}

// ============================================================
// DISPOSE PAGE
// ============================================================
async function loadDisposePage() {
  // Ensure equipment is loaded before populating dropdown
  if (!equipCache.length) {
    const res = await Api.call('listEquipment', {}).catch(() => null);
    if (res?.success) equipCache = res.data || [];
    else showToast('โหลดรายการอุปกรณ์ไม่สำเร็จ — ลอง Refresh หน้า', 'warning');
  }
  populateEquipmentDropdown('dispType', 'dispEquipment', true);

  // Lock disposer name to current user
  const dispByEl = document.getElementById('dispBy');
  if (dispByEl) dispByEl.value = currentUser?.fullName || currentUser?.username || '';

  // Default date to today
  const dispDateEl = document.getElementById('dispDate');
  if (dispDateEl && !dispDateEl.value) dispDateEl.value = todayStr();

  loadDisposeHistory();
}

async function loadDisposeHistory() {
  try {
    const res = await Api.call('listDispose', {});
    if (!res.success) return;
    renderDisposeHistory(res.data || []);
  } catch (e) {}
}

function renderDisposeHistory(rows) {
  const tbody = document.getElementById('disposeTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${t('noData')||'ไม่มีข้อมูล'}</td></tr>`;
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.EquipmentID)}</td>
      <td>${esc(r.EquipmentName)}</td>
      <td>${r.Quantity}</td>
      <td>${esc(r.DisposedBy)}</td>
      <td>${r.DisposeDate||''}</td>
      <td>${esc(r.Reason)}</td>
      <td>${currentUser.role === 'Admin' ? `
        <button class="btn btn-sm btn-outline-secondary me-1 dsp-edit" data-row="${r._row}" data-json='${safeJson(r)}'><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger dsp-del" data-row="${r._row}"><i class="bi bi-trash3"></i></button>` : '—'}</td>`;
    tbody.appendChild(tr);
  });
  if (currentUser.role === 'Admin') {
    tbody.querySelectorAll('.dsp-edit').forEach(btn => btn.addEventListener('click', () => fillDisposeEditForm(JSON.parse(btn.dataset.json))));
    tbody.querySelectorAll('.dsp-del').forEach(btn => btn.addEventListener('click', () => confirmDelete(() => deleteDispose(parseInt(btn.dataset.row)))));
  }
}

function fillDisposeEditForm(r) {
  document.getElementById('dispRow').value = r._row;
  document.getElementById('dispEquipment').value = r.EquipmentID || '';
  document.getElementById('dispQuantity').value   = r.Quantity || '';
  document.getElementById('dispDate').value        = r.DisposeDate || '';
  document.getElementById('dispReason').value      = r.Reason || '';
  document.getElementById('dispCancelEditBtn').style.display = '';
  document.querySelector('#page-dispose .panel h6')?.scrollIntoView();
}

function resetDisposeForm() {
  document.getElementById('disposeForm')?.reset();
  document.getElementById('dispRow').value = '';
  document.getElementById('dispBy').value  = currentUser.fullName || currentUser.username;
  document.getElementById('dispDate').value = todayStr();
  document.getElementById('dispCancelEditBtn').style.display = 'none';
}

async function submitDispose(e) {
  e.preventDefault();
  const rowVal   = document.getElementById('dispRow').value;
  const isEdit   = !!rowVal;
  const equipSel = document.getElementById('dispEquipment');
  const equipId  = equipSel?.value || '';
  const qty      = parseInt(document.getElementById('dispQuantity')?.value) || 0;

  // ── Validate ──
  if (!equipId)  { showToast('กรุณาเลือกรายการอุปกรณ์', 'danger'); return; }
  if (qty <= 0)  { showToast('กรุณากรอกจำนวนที่ต้องการจำหน่าย', 'danger'); return; }

  const equip    = equipCache.find(r => r.ID === equipId);
  const dispose  = {
    EquipmentID:   equipId,
    EquipmentName: equip?.Name || equipSel?.selectedOptions[0]?.text?.split(' — ')[0] || '',
    Type:          equip?.Type || '',
    Quantity:      qty,
    DisposedBy:    document.getElementById('dispBy')?.value || currentUser?.fullName || currentUser?.username || '',
    DisposeDate:   document.getElementById('dispDate')?.value || todayStr(),
    Reason:        document.getElementById('dispReason')?.value || '',
  };

  const saveBtn = e.target.querySelector('button[type="submit"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...'; }

  try {
    const action  = isEdit ? 'updateDispose' : 'addDispose';
    const payload = isEdit ? { row: parseInt(rowVal), dispose } : { dispose };
    const res = await Api.call(action, payload);

    if (!res.success) {
      showToast('บันทึกไม่สำเร็จ: ' + (res.message || 'เกิดข้อผิดพลาด'), 'danger');
      return;
    }
    showToast('บันทึกการจำหน่ายสำเร็จ ✓', 'success');
    resetDisposeForm();
    equipCache = [];
    await ensureEquipCache();
    loadDisposeHistory();
    populateEquipmentDropdown('dispType', 'dispEquipment', true);
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + (err.message || 'ไม่ทราบสาเหตุ'), 'danger');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'บันทึก'; }
  }
}

async function deleteDispose(row) {
  try {
    const res = await Api.call('deleteDispose', { row });
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('deleted') || 'ลบสำเร็จ', 'success');
    equipCache = [];
    loadDisposeHistory();
    populateEquipmentDropdown('dispType', 'dispEquipment', true);
  } catch (err) { showToast(err.message, 'danger'); }
}

// ============================================================
// BORROW / RETURN PAGE
// ============================================================
async function loadBorrowPage() {
  await ensureEquipCache();
  populateEquipmentDropdown('brwType', 'brwEquipment', false);
  // Lock lender
  const lenderEl = document.getElementById('brwLender');
  if (lenderEl) lenderEl.value = currentUser.fullName || currentUser.username;
  // Default borrow date today
  const bdEl = document.getElementById('brwBorrowDate');
  if (bdEl && !bdEl.value) bdEl.value = todayStr();
  // Borrower autocomplete
  await loadBorrowerAutocomplete();
  loadBorrowHistory();
}

async function loadBorrowerAutocomplete() {
  try {
    const res = await Api.call('listBorrowers', {});
    if (!res.success) return;
    borrowersCache = res.data || [];
    const namesDl = document.getElementById('borrowerNames');
    const deptsDl  = document.getElementById('borrowerDepts');
    if (namesDl) {
      namesDl.innerHTML = '';
      [...new Set(borrowersCache.map(b => b.Name))].forEach(n => {
        const opt = document.createElement('option'); opt.value = n; namesDl.appendChild(opt);
      });
    }
    if (deptsDl) {
      deptsDl.innerHTML = '';
      [...new Set(borrowersCache.map(b => b.Department).filter(Boolean))].forEach(d => {
        const opt = document.createElement('option'); opt.value = d; deptsDl.appendChild(opt);
      });
    }
  } catch (e) {}
}

async function loadBorrowHistory() {
  try {
    const res = await Api.call('listBorrow', {});
    if (!res.success) return;
    renderBorrowHistory(res.data || []);
  } catch (e) {}
}

function renderBorrowHistory(rows) {
  const tbody = document.getElementById('borrowTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">${t('noData')||'ไม่มีข้อมูล'}</td></tr>`;
    return;
  }
  rows.forEach(r => {
    const statusClass = { Borrowed: 'tag-borrowed', Returned: 'tag-returned', Overdue: 'tag-overdue' }[r.Status] || '';
    const statusLabel = t('status_' + r.Status) || r.Status;
    const canReturn   = (r.Status === 'Borrowed' || r.Status === 'Overdue');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.EquipmentID)}</td>
      <td>${esc(r.EquipmentName)}</td>
      <td>${r.Quantity}</td>
      <td>${esc(r.BorrowerName)}</td>
      <td>${esc(r.Department)}</td>
      <td>${r.BorrowDate||''}</td>
      <td>${r.DueDate||''}</td>
      <td><span class="tag ${statusClass}">${statusLabel}</span></td>
      <td>
        ${canReturn ? `<button class="btn btn-sm btn-outline-teal me-1 brw-return" data-row="${r._row}" title="${t('return')||'คืน'}"><i class="bi bi-arrow-return-left"></i></button>` : ''}
        ${currentUser.role === 'Admin' ? `
          <button class="btn btn-sm btn-outline-secondary me-1 brw-edit" data-row="${r._row}" data-json='${safeJson(r)}'><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger brw-del" data-row="${r._row}"><i class="bi bi-trash3"></i></button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.brw-return').forEach(btn => btn.addEventListener('click', () => returnBorrow(parseInt(btn.dataset.row))));
  if (currentUser.role === 'Admin') {
    tbody.querySelectorAll('.brw-edit').forEach(btn => btn.addEventListener('click', () => fillBorrowEditForm(JSON.parse(btn.dataset.json))));
    tbody.querySelectorAll('.brw-del').forEach(btn => btn.addEventListener('click', () => confirmDelete(() => deleteBorrow(parseInt(btn.dataset.row)))));
  }
}

function fillBorrowEditForm(r) {
  document.getElementById('brwRow').value        = r._row;
  document.getElementById('brwEquipment').value  = r.EquipmentID || '';
  document.getElementById('brwQuantity').value   = r.Quantity || '';
  document.getElementById('brwBorrower').value   = r.BorrowerName || '';
  document.getElementById('brwDepartment').value = r.Department || '';
  document.getElementById('brwBorrowDate').value = r.BorrowDate || '';
  document.getElementById('brwDueDate').value    = r.DueDate || '';
  document.getElementById('brwReason').value     = r.Reason || '';
  document.getElementById('brwCancelEditBtn').style.display = '';
  document.querySelector('#page-borrow .panel h6')?.scrollIntoView();
}

function resetBorrowForm() {
  document.getElementById('borrowForm')?.reset();
  document.getElementById('brwRow').value = '';
  document.getElementById('brwLender').value = currentUser.fullName || currentUser.username;
  document.getElementById('brwBorrowDate').value = todayStr();
  document.getElementById('brwCancelEditBtn').style.display = 'none';
}

async function submitBorrow(e) {
  e.preventDefault();
  const rowVal = document.getElementById('brwRow').value;
  const isEdit = !!rowVal;
  const equipSel = document.getElementById('brwEquipment');
  const equipId  = equipSel?.value || '';
  const borrow = {
    EquipmentID:   equipId,
    EquipmentName: (equipSel?.selectedOptions[0]?.text || '').split(' — ')[0],
    Type:          equipCache.find(r => r.ID === equipId)?.Type || '',
    Quantity:      parseInt(document.getElementById('brwQuantity').value) || 0,
    BorrowerName:  document.getElementById('brwBorrower').value,
    Department:    document.getElementById('brwDepartment').value,
    Reason:        document.getElementById('brwReason').value,
    BorrowDate:    document.getElementById('brwBorrowDate').value,
    DueDate:       document.getElementById('brwDueDate').value,
  };
  try {
    const action  = isEdit ? 'updateBorrow' : 'addBorrow';
    const payload = isEdit ? { row: parseInt(rowVal), borrow } : { borrow };
    const res = await Api.call(action, payload);
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('saved') || 'บันทึกสำเร็จ', 'success');
    resetBorrowForm();
    equipCache = [];
    loadBorrowHistory();
    loadBorrowerAutocomplete();
    populateEquipmentDropdown('brwType', 'brwEquipment', false);
  } catch (err) { showToast(err.message, 'danger'); }
}

async function returnBorrow(row) {
  try {
    const res = await Api.call('returnBorrow', { row });
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('returned') || 'คืนอุปกรณ์สำเร็จ', 'success');
    equipCache = [];
    loadBorrowHistory();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function deleteBorrow(row) {
  try {
    const res = await Api.call('deleteBorrow', { row });
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('deleted') || 'ลบสำเร็จ', 'success');
    equipCache = [];
    loadBorrowHistory();
    populateEquipmentDropdown('brwType', 'brwEquipment', false);
  } catch (err) { showToast(err.message, 'danger'); }
}

// ============================================================
// USERS MANAGEMENT (Admin only)
// ============================================================
async function loadUsers() {
  if (currentUser.role !== 'Admin') return;
  const tbody = document.getElementById('usersTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</td></tr>`;
  try {
    const res = await Api.call('listUsers', {});
    if (!res.success) {
      showToast('โหลดข้อมูลผู้ใช้ไม่สำเร็จ: ' + res.message, 'danger');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${res.message}</td></tr>`;
      return;
    }
    renderUsers(res.data || []);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

function renderUsers(rows) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.Username)}</td>
      <td>${esc(r.FullName)}</td>
      <td>${esc(r.Role)}</td>
      <td><span class="tag ${r.Status === 'Active' ? 'tag-available' : 'tag-outofstock'}">${r.Status}</span></td>
      <td>${r.CreatedDate||''}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary me-1 usr-edit" data-json='${safeJson(r)}'><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger usr-del" data-row="${r._row}"><i class="bi bi-trash3"></i></button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.usr-edit').forEach(btn => btn.addEventListener('click', () => openEditUser(JSON.parse(btn.dataset.json))));
  tbody.querySelectorAll('.usr-del').forEach(btn => btn.addEventListener('click', () => confirmDelete(() => deleteUser(parseInt(btn.dataset.row)))));
}

function openAddUser() {
  document.getElementById('userForm')?.reset();
  document.getElementById('userRow').value = '';
  document.getElementById('userModalTitle').textContent = t('addUser') || 'เพิ่มผู้ใช้งาน';
  document.getElementById('userStatusWrap').style.display = 'none';
  document.getElementById('userUsername').disabled = false;
  bsModal('userModal').show();
}

function openEditUser(r) {
  document.getElementById('userRow').value     = r._row;
  document.getElementById('userUsername').value = r.Username;
  document.getElementById('userFullName').value = r.FullName;
  document.getElementById('userRole').value     = r.Role;
  document.getElementById('userStatus').value   = r.Status;
  document.getElementById('userPassword').value = '';
  document.getElementById('userModalTitle').textContent = t('editUser') || 'แก้ไขผู้ใช้งาน';
  document.getElementById('userStatusWrap').style.display = '';
  document.getElementById('userUsername').disabled = true; // username immutable
  bsModal('userModal').show();
}

async function submitUser(e) {
  e.preventDefault();
  const rowVal  = document.getElementById('userRow').value;
  const isEdit  = !!rowVal;
  const username = (document.getElementById('userUsername')?.value || '').trim();
  const fullName = (document.getElementById('userFullName')?.value || '').trim();
  const password = (document.getElementById('userPassword')?.value || '').trim();
  const role     = document.getElementById('userRole')?.value || 'User';

  if (!username) { showToast('กรุณากรอกชื่อผู้ใช้', 'danger'); return; }
  if (!fullName) { showToast('กรุณากรอกชื่อ-นามสกุล', 'danger'); return; }
  if (!isEdit && !password) { showToast('กรุณากรอกรหัสผ่าน', 'danger'); return; }

  const user = { Username: username, FullName: fullName, Role: role, Password: password };
  if (isEdit) user.Status = document.getElementById('userStatus')?.value || 'Active';

  const action  = isEdit ? 'updateUser' : 'addUser';
  const payload = isEdit ? { row: parseInt(rowVal), user } : { user };

  const saveBtn = document.getElementById('userSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...'; }

  try {
    const res = await Api.call(action, payload);
    if (!res.success) { showToast('บันทึกไม่สำเร็จ: ' + (res.message || 'เกิดข้อผิดพลาด'), 'danger'); return; }
    showToast('บันทึกสำเร็จ ✓', 'success');
    bsModal('userModal').hide();
    loadUsers();
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + (err.message || 'ไม่ทราบสาเหตุ'), 'danger');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('save') || 'บันทึก'; }
  }
}

async function deleteUser(row) {
  try {
    const res = await Api.call('deleteUser', { row });
    if (!res.success) { showToast(res.message, 'danger'); return; }
    showToast(t('deleted') || 'ลบสำเร็จ', 'success');
    loadUsers();
  } catch (err) { showToast(err.message, 'danger'); }
}

// ============================================================
// QR SCANNER
// ============================================================
let scanTarget = null; // 'dispose' | 'borrow'

function openScanner(target) {
  scanTarget = target;
  bsModal('scanModal').show();
  setTimeout(startScanner, 300);
}

function startScanner() {
  if (scannerInstance) { try { scannerInstance.stop(); } catch (e) {} }
  const el = document.getElementById('qrReader');
  if (!el || !window.Html5Qrcode) return;
  scannerInstance = new Html5Qrcode('qrReader');
  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras.length) return;
    scannerInstance.start(cameras[cameras.length - 1].id, { fps: 10, qrbox: 200 }, onScanSuccess, () => {}).catch(err => console.warn('Scanner start error', err));
  });
}

function onScanSuccess(decoded) {
  // Match decoded text (equipment ID) to dropdown
  const selId = scanTarget === 'dispose' ? 'dispEquipment' : 'brwEquipment';
  const sel = document.getElementById(selId);
  if (sel) {
    const opt = [...sel.options].find(o => o.value === decoded || o.text.includes(decoded));
    if (opt) sel.value = opt.value;
    else showToast((t('qr_not_found') || 'ไม่พบอุปกรณ์') + ': ' + decoded, 'warning');
  }
  if (scannerInstance) { try { scannerInstance.stop(); } catch (e) {} }
  bsModal('scanModal').hide();
}

document.getElementById('scanModal')?.addEventListener('hide.bs.modal', () => {
  if (scannerInstance) { try { scannerInstance.stop(); } catch (e) {} }
});

// ============================================================
// CONFIRM DELETE MODAL
// ============================================================
let pendingDeleteFn = null;

function confirmDelete(fn) {
  pendingDeleteFn = fn;
  bsModal('confirmModal').show();
}

document.getElementById('confirmActionBtn')?.addEventListener('click', () => {
  bsModal('confirmModal').hide();
  if (pendingDeleteFn) { pendingDeleteFn(); pendingDeleteFn = null; }
});

// ============================================================
// EXCEL IMPORT / EXPORT
// ============================================================
function setupExcelImportExport() {
  document.getElementById('exportExcelBtn')?.addEventListener('click', exportExcel);
  document.getElementById('importExcelBtn')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls';
    inp.onchange = e => { if (e.target.files[0]) importExcel(e.target.files[0]); };
    inp.click();
  });
}

function exportExcel() {
  if (!window.XLSX) { showToast('XLSX library not loaded', 'danger'); return; }
  const data = equipCache.map(r => ({
    'รหัส (ID)':       r.ID,
    'ประเภท (Type)':   t('type_' + r.Type) || r.Type,
    'ชื่อ (Name)':     r.Name,
    'รายละเอียด':      r.Description,
    'จำนวนทั้งหมด':   r.Quantity,
    'จำนวนขั้นต่ำ':   r.MinQuantity,
    'คงเหลือ':         r.Remaining,
    'สถานที่':         r.Location,
    'วันหมดอายุ':      r.ExpiryDate,
    'วันตรวจเช็ค':     r.CalibrateDate,
    'สถานะ':           t('status_' + r.Status) || r.Status,
    'URL รูปภาพ':      r.ImageURL,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Equipment');
  XLSX.writeFile(wb, 'ERP_Equipment_Export.xlsx');
}

async function importExcel(file) {
  if (!window.XLSX) { showToast('XLSX library not loaded', 'danger'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const rows     = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) { showToast('ไม่พบข้อมูลใน Excel', 'warning'); return; }
      let ok = 0, fail = 0;
      const colMap = { id:'ID', type:'Type', name:'Name', description:'Description', quantity:'Quantity',
        minquantity:'MinQuantity', location:'Location', expirydate:'ExpiryDate', calibratedate:'CalibrateDate', imageurl:'ImageURL' };
      for (const row of rows) {
        const eq = {};
        Object.keys(row).forEach(k => {
          const mapped = colMap[k.toLowerCase().replace(/\s|\(.*?\)/g, '')] || k;
          eq[mapped] = String(row[k] ?? '');
        });
        if (!eq.Name || !eq.Type) { fail++; continue; }
        const res = await Api.call('addEquipment', { equipment: eq });
        res.success ? ok++ : fail++;
      }
      showToast(`นำเข้าสำเร็จ ${ok} รายการ${fail ? ` / ล้มเหลว ${fail} รายการ` : ''}`, ok ? 'success' : 'warning');
      equipCache = [];
      loadEquipmentList();
    } catch (err) { showToast('อ่านไฟล์ Excel ล้มเหลว: ' + err.message, 'danger'); }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// PDF REPORT (browser print)
// ============================================================
function setupPrintPdf() {
  document.getElementById('printPdfBtn')?.addEventListener('click', printPdfReport);
}

function printPdfReport() {
  const area = document.getElementById('pdfReportArea');
  if (!area) return;
  const typeFilter = document.getElementById('filterType')?.value || '';
  const rows = typeFilter ? equipCache.filter(r => r.Type === typeFilter) : equipCache;
  const reportTitle = t('reportTitle') || 'รายงานอุปกรณ์ ERP Stock System';
  const logoUrl = window.APP_CONFIG?.LOGO_URL || '';
  area.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      ${logoUrl ? `<img src="${logoUrl}" style="height:60px;margin-bottom:8px;" alt="Logo">` : ''}
      <h2 style="font-family:Sarabun,sans-serif;font-size:18px;font-weight:700;">${reportTitle}</h2>
      <div style="font-size:12px;color:#666;">${t('printDate')||'วันที่พิมพ์'}: ${todayStr()}</div>
    </div>
    <table>
      <thead><tr>
        <th>${t('col_id')||'รหัส'}</th>
        <th>${t('col_name')||'ชื่อ'}</th>
        <th>${t('field_type')||'ประเภท'}</th>
        <th>${t('col_qty')||'จำนวน'}</th>
        <th>${t('col_remaining')||'คงเหลือ'}</th>
        <th>${t('field_location')||'สถานที่'}</th>
        <th>${t('field_expiry')||'วันหมดอายุ'}</th>
        <th>${t('col_status')||'สถานะ'}</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${esc(r.ID)}</td>
          <td>${esc(r.Name)}</td>
          <td>${t('type_'+r.Type)||r.Type}</td>
          <td>${r.Quantity??0}</td>
          <td>${r.Remaining??0}</td>
          <td>${esc(r.Location)}</td>
          <td>${r.ExpiryDate||'—'}</td>
          <td>${t('status_'+r.Status)||r.Status}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  // Move area to visible during print (CSS handles visibility, just clear negative offset temporarily)
  area.style.left = '0';
  window.print();
  setTimeout(() => { area.style.left = '-9999px'; }, 500);
}

// ============================================================
// HELPERS
// ============================================================
function populateEquipmentDropdown(typeSelId, equipSelId, filterByRemaining) {
  const typeSel  = document.getElementById(typeSelId);
  const equipSel = document.getElementById(equipSelId);
  if (!equipSel) return;
  const filterType = typeSel?.value || '';
  let rows = equipCache;
  if (filterType) rows = rows.filter(r => r.Type === filterType);
  if (filterByRemaining) rows = rows.filter(r => (r.Remaining ?? r.Quantity ?? 0) > 0);
  const prev = equipSel.value;
  equipSel.innerHTML = `<option value="">${t('select_placeholder')||'-- เลือก --'}</option>`;
  rows.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.ID;
    opt.textContent = `${r.ID} — ${r.Name} (คงเหลือ: ${r.Remaining ?? r.Quantity ?? 0})`;
    equipSel.appendChild(opt);
  });
  if (prev) equipSel.value = prev;
}

async function ensureEquipCache() {
  if (!equipCache.length) {
    const res = await Api.call('listEquipment', {}).catch(() => null);
    if (res?.success) equipCache = res.data || [];
  }
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
