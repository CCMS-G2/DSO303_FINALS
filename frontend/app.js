// CCMS frontend. Plain JavaScript, no framework and no build step.
// Each service is called on its own port; in AWS these all sit behind
// one API Gateway URL, so only these three constants would change.
const AUTH         = 'http://localhost:3000';
const COMPLAINT    = 'http://localhost:3001';
const NOTIFICATION = 'http://localhost:3002';

let token = sessionStorage.getItem('ccms_token') || null;
let user  = JSON.parse(sessionStorage.getItem('ccms_user') || 'null');

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);

// ── Toast notifications ──────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Resolution note modal (replaces prompt()) ────────────────────
function askNote() {
  return new Promise((resolve) => {
    $('modal-note').value = '';
    show('modal-overlay', true);
    $('modal-note').focus();

    const confirm = () => {
      const note = $('modal-note').value.trim();
      if (!note) { $('modal-note').focus(); return; }
      cleanup();
      resolve(note);
    };
    const cancel = () => { cleanup(); resolve(null); };

    function cleanup() {
      show('modal-overlay', false);
      $('modal-confirm').onclick = null;
      $('modal-cancel').onclick  = null;
    }

    $('modal-confirm').onclick = confirm;
    $('modal-cancel').onclick  = cancel;
  });
}

// ── Button loading state ─────────────────────────────────────────
function setBtnLoading(btn, loading) {
  if (loading) {
    btn._label = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {
    if (btn._label !== undefined) btn.innerHTML = btn._label;
    btn.disabled = false;
  }
}

// ── API client ───────────────────────────────────────────────────
async function api(base, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { ...options, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────
async function signIn(email, password) {
  const data = await api(AUTH, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  token = data.token;
  user  = data.user;
  sessionStorage.setItem('ccms_token', token);
  sessionStorage.setItem('ccms_user', JSON.stringify(user));
  render();
}

$('btn-login').onclick = async () => {
  const btn = $('btn-login');
  $('login-error').textContent = '';
  setBtnLoading(btn, true);
  try {
    await signIn($('login-email').value, $('login-password').value);
  } catch (err) {
    $('login-error').textContent = err.message;
    setBtnLoading(btn, false);
  }
};

// ── Sign up ──────────────────────────────────────────────────────
$('link-signup').onclick = (e) => { e.preventDefault(); showSignup(true); };
$('link-signin').onclick = (e) => { e.preventDefault(); showSignup(false); };

function showSignup(on) {
  $('signup-error').textContent = '';
  show('view-signup', on);
  show('view-login', !on);
}

$('btn-signup').onclick = async () => {
  const btn   = $('btn-signup');
  const email = $('signup-email').value.trim();
  const pass  = $('signup-password').value;
  $('signup-error').textContent = '';
  setBtnLoading(btn, true);
  try {
    await api(AUTH, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: $('signup-name').value.trim(), email, password: pass }),
    });
    $('login-email').value = email;
    await signIn(email, pass);
  } catch (err) {
    $('signup-error').textContent = err.message;
    setBtnLoading(btn, false);
  }
};

function logout() {
  token = null; user = null;
  sessionStorage.clear();
  render();
}

// ── Navigation ───────────────────────────────────────────────────
const APP_VIEWS = ['view-submit', 'view-list', 'view-stats', 'view-notifications'];

function showView(id) {
  APP_VIEWS.forEach((v) => show(v, v === id));
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === id);
  });
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.target));
});

// ── Render (called on login/logout) ─────────────────────────────
function render() {
  const signedIn = Boolean(token && user);

  show('view-login',  !signedIn);
  show('view-signup', false);
  show('app-nav',     signedIn);

  if (!signedIn) {
    APP_VIEWS.forEach((v) => show(v, false));
    $('whoami').textContent = '';
    return;
  }

  // Header user info
  $('whoami').innerHTML =
    `<span class="user-name">${user.fullName}</span>` +
    `<span class="user-role">${user.role}</span>`;
  const signOutBtn = document.createElement('button');
  signOutBtn.textContent = 'Sign out';
  signOutBtn.className = 'btn-ghost btn-sm';
  signOutBtn.style.cssText = 'color:#fff;border-color:rgba(255,255,255,.3);';
  signOutBtn.onclick = logout;
  $('whoami').appendChild(signOutBtn);

  // Show/hide role-specific nav items
  show('nav-submit', user.role === 'STUDENT');
  show('nav-stats',  user.role === 'ADMIN');

  $('list-title').textContent = {
    STUDENT: 'My Complaints',
    STAFF:   'Assigned to Me',
    ADMIN:   'All Complaints',
  }[user.role];

  if (user.role === 'STUDENT') loadReferenceData();
  if (user.role === 'ADMIN')   { loadStaffList(); loadStats(); }

  loadComplaints();
  loadNotifications();
  showView('view-list');
}

// ── Reference data ───────────────────────────────────────────────
async function loadReferenceData() {
  try {
    const [categories, locations] = await Promise.all([
      api(COMPLAINT, '/api/categories'),
      api(COMPLAINT, '/api/locations'),
    ]);
    $('f-category').innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    $('f-location').innerHTML = locations.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  } catch (err) {
    $('submit-msg').innerHTML = `<p class="error">Could not load form options: ${err.message}</p>`;
  }
}

let staffList = [];
async function loadStaffList() {
  try {
    staffList = (await api(AUTH, '/api/users')).filter((u) => u.role === 'STAFF' && u.isActive);
  } catch { staffList = []; }
}

// ── Submit complaint ─────────────────────────────────────────────
$('btn-submit').onclick = async () => {
  const btn = $('btn-submit');
  setBtnLoading(btn, true);
  $('submit-msg').innerHTML = '';
  try {
    let imageKey = null;
    const file = $('f-photo').files[0];
    if (file) {
      const { key, uploadUrl } = await api(COMPLAINT, '/api/complaints/uploads', {
        method: 'POST', body: JSON.stringify({ contentType: file.type }),
      });
      const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Photo upload failed');
      imageKey = key;
    }
    const complaint = await api(COMPLAINT, '/api/complaints', {
      method: 'POST',
      body: JSON.stringify({
        categoryId:  Number($('f-category').value),
        locationId:  Number($('f-location').value),
        title:       $('f-title').value,
        description: $('f-description').value,
        imageKey,
      }),
    });
    $('submit-msg').innerHTML =
      `<div class="submit-success">✓ Submitted! Reference: <strong>${complaint.reference_no}</strong></div>`;
    $('f-title').value = '';
    $('f-description').value = '';
    $('f-photo').value = '';
    toast(`Complaint submitted: ${complaint.reference_no}`, 'success');
    loadComplaints();
    loadNotifications();
  } catch (err) {
    $('submit-msg').innerHTML = `<p class="error">${err.message}</p>`;
    toast(err.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
};

// ── Complaint list ───────────────────────────────────────────────
$('btn-refresh').onclick = () => { loadComplaints(); loadNotifications(); };

async function loadComplaints() {
  $('list').innerHTML = '<p class="hint" style="text-align:center;padding:24px">Loading…</p>';
  try {
    const complaints = await api(COMPLAINT, '/api/complaints');
    if (!complaints.length) {
      $('list').innerHTML =
        '<div class="empty-state"><span class="empty-icon">📋</span><p>No complaints yet.</p></div>';
      return;
    }
    $('list').innerHTML = '';
    complaints.forEach((c) => $('list').appendChild(complaintCard(c)));
  } catch (err) {
    $('list').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function nextActions(c) {
  if (user.role === 'STAFF' && c.assigned_staff_id === user.id) {
    if (c.status === 'ASSIGNED')     return ['IN_PROGRESS'];
    if (c.status === 'IN_PROGRESS')  return ['RESOLVED'];
  }
  if (c.status === 'RESOLVED' && (user.role === 'ADMIN' || c.student_id === user.id)) return ['CLOSED'];
  return [];
}

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function complaintCard(c) {
  const el = document.createElement('div');
  el.className = `complaint s-${c.status}`;

  el.innerHTML = `
    <div class="complaint-top">
      <div class="complaint-title">${c.title}</div>
      <span class="status ${c.status}">${c.status.replace('_', '\u202f')}</span>
    </div>
    <div class="complaint-meta">
      <span>${c.reference_no}</span>
      <span>${timeAgo(c.created_at)}</span>
    </div>
    <div class="complaint-desc">${c.description}</div>`;

  if (c.image_key) {
    const img = document.createElement('img');
    img.src = `${COMPLAINT}/api/complaints/uploads/file/${c.image_key}`;
    el.appendChild(img);
  }

  const actions = document.createElement('div');
  actions.className = 'complaint-actions';

  // Admin: assign/reassign
  if (user.role === 'ADMIN' && ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'].includes(c.status)) {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">Assign to…</option>' +
      staffList.map((s) => `<option value="${s.id}">${s.fullName}</option>`).join('');
    const go = document.createElement('button');
    go.textContent = 'Assign'; go.className = 'btn-sm btn-primary';
    go.onclick = async () => {
      if (!select.value) return;
      setBtnLoading(go, true);
      await act(() => api(COMPLAINT, `/api/complaints/${c.id}/assign`, {
        method: 'PATCH', body: JSON.stringify({ staffId: select.value }),
      }), el);
      setBtnLoading(go, false);
    };
    actions.append(select, go);
  }

  // Status transition buttons
  const btnLabels = { IN_PROGRESS: 'Start Work', RESOLVED: 'Mark Resolved', CLOSED: 'Close' };
  nextActions(c).forEach((status) => {
    const btn = document.createElement('button');
    btn.className = 'btn-sm btn-primary';
    btn.textContent = btnLabels[status];
    btn.onclick = async () => {
      let note = null;
      if (status === 'RESOLVED') {
        note = await askNote();
        if (!note) return;
      }
      setBtnLoading(btn, true);
      await act(() => api(COMPLAINT, `/api/complaints/${c.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status, note }),
      }), el);
    };
    actions.appendChild(btn);
  });

  if (actions.children.length) el.appendChild(actions);
  return el;
}

async function act(fn, el) {
  try {
    await fn();
    toast('Updated successfully', 'success');
    loadComplaints();
    loadNotifications();
    if (user.role === 'ADMIN') loadStats();
  } catch (err) {
    toast(err.message, 'error');
    const p = document.createElement('p');
    p.className = 'error'; p.textContent = err.message;
    el.appendChild(p);
  }
}

// ── Admin statistics ─────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api(COMPLAINT, '/api/stats/summary');

    const statusCards = s.byStatus.map((r) => `
      <div class="stat-card s-${r.status}">
        <div class="stat-label">${r.status.replace('_', ' ')}</div>
        <div class="stat-value">${r.count}</div>
      </div>`).join('');

    const categoryRows = s.byCategory.map((r) => `
      <tr><td>${r.name}</td><td style="font-weight:600;text-align:right">${r.count}</td></tr>`).join('');

    $('stats').innerHTML = `
      <div class="stats-section">
        <div class="stats-section-title">By Status</div>
        <div class="stats-grid">${statusCards}</div>
      </div>
      <div class="stats-section">
        <div class="stats-section-title">By Category</div>
        <div class="table-card">
          <table>
            <thead><tr><th>Category</th><th style="text-align:right">Count</th></tr></thead>
            <tbody>${categoryRows}</tbody>
          </table>
        </div>
      </div>
      <div class="stats-footer">
        ⏱ Average resolution time:
        <strong>${s.avgResolutionHours ?? 'n/a'}</strong>
        ${s.avgResolutionHours != null ? 'hours' : ''}
      </div>`;
  } catch (err) {
    $('stats').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// ── Notifications ────────────────────────────────────────────────
async function loadNotifications() {
  try {
    const items = await api(NOTIFICATION, '/api/notifications');

    // Update nav badge
    const unread = items.filter((n) => !n.is_read).length;
    const badge  = $('notif-badge');
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);

    if (!items.length) {
      $('notifications').innerHTML =
        '<div class="empty-state"><span class="empty-icon">🔔</span><p>No notifications yet.</p></div>';
      return;
    }

    $('notifications').innerHTML = '';
    items.forEach((n) => {
      const d = document.createElement('div');
      d.className = `notif${n.is_read ? '' : ' unread'}`;

      const dot = document.createElement('div');
      dot.className = n.is_read ? 'notif-spacer' : 'notif-dot';

      const content = document.createElement('div');
      content.className = 'notif-content';
      content.innerHTML =
        `<div class="notif-msg">${n.message}</div>` +
        `<div class="notif-time">${timeAgo(n.created_at)}</div>`;

      d.append(dot, content);

      if (!n.is_read) {
        const b = document.createElement('button');
        b.textContent = 'Mark read';
        b.className = 'btn-sm btn-ghost';
        b.onclick = async () => {
          await api(NOTIFICATION, `/api/notifications/${n.id}/read`, { method: 'PATCH' });
          loadNotifications();
        };
        d.appendChild(b);
      }

      $('notifications').appendChild(d);
    });
  } catch (err) {
    $('notifications').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

render();
