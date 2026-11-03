// CCMS frontend. Plain JavaScript, no framework and no build step.
// Each service is called on its own port; in AWS these all sit behind
// one API Gateway URL, so only these three constants would change.
const AUTH = 'http://localhost:3000';
const COMPLAINT = 'http://localhost:3001';
const NOTIFICATION = 'http://localhost:3002';

let token = sessionStorage.getItem('ccms_token') || null;
let user = JSON.parse(sessionStorage.getItem('ccms_user') || 'null');

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);

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

// ---------- auth ----------

async function signIn(email, password) {
  const data = await api(AUTH, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  token = data.token; user = data.user;
  sessionStorage.setItem('ccms_token', token);
  sessionStorage.setItem('ccms_user', JSON.stringify(user));
  render();
}

$('btn-login').onclick = async () => {
  $('login-error').textContent = '';
  try {
    await signIn($('login-email').value, $('login-password').value);
  } catch (err) {
    $('login-error').textContent = err.message;
  }
};

// ---------- sign up ----------

$('link-signup').onclick = (e) => { e.preventDefault(); showSignup(true); };
$('link-signin').onclick = (e) => { e.preventDefault(); showSignup(false); };

function showSignup(on) {
  $('signup-error').textContent = '';
  show('view-signup', on);
  show('view-login', !on);
}

$('btn-signup').onclick = async () => {
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  $('signup-error').textContent = '';
  try {
    await api(AUTH, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: $('signup-name').value.trim(), email, password }),
    });
    // Sign straight in with the new account rather than making the student retype it.
    $('login-email').value = email;
    await signIn(email, password);
  } catch (err) {
    $('signup-error').textContent = err.message;
  }
};

function logout() {
  token = null; user = null;
  sessionStorage.clear();
  render();
}

// ---------- rendering ----------

function render() {
  const signedIn = Boolean(token && user);
  show('view-login', !signedIn);
  if (signedIn) show('view-signup', false);
  show('view-submit', signedIn && user.role === 'STUDENT');
  show('view-list', signedIn);
  show('view-stats', signedIn && user.role === 'ADMIN');
  show('view-notifications', signedIn);

  if (!signedIn) { $('whoami').textContent = ''; return; }

  $('whoami').innerHTML = `${user.fullName} (${user.role}) `;
  const out = document.createElement('button');
  out.textContent = 'Sign out'; out.className = 'small secondary'; out.onclick = logout;
  $('whoami').appendChild(out);

  $('list-title').textContent = { STUDENT: 'My complaints', STAFF: 'Assigned to me', ADMIN: 'All complaints' }[user.role];

  if (user.role === 'STUDENT') loadReferenceData();
  if (user.role === 'ADMIN') { loadStaffList(); loadStats(); }
  loadComplaints();
  loadNotifications();
}

async function loadReferenceData() {
  try {
    const [categories, locations] = await Promise.all([
      api(COMPLAINT, '/api/categories'), api(COMPLAINT, '/api/locations'),
    ]);
    $('f-category').innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    $('f-location').innerHTML = locations.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  } catch (err) {
    $('submit-msg').innerHTML = `<span class="error">Could not load form options: ${err.message}</span>`;
  }
}

let staffList = [];
async function loadStaffList() {
  try {
    staffList = (await api(AUTH, '/api/users')).filter((u) => u.role === 'STAFF' && u.isActive);
  } catch { staffList = []; }
}

// ---------- submit a complaint ----------

$('btn-submit').onclick = async () => {
  const btn = $('btn-submit'); btn.disabled = true;
  $('submit-msg').textContent = 'Submitting...';
  try {
    let imageKey = null;
    const file = $('f-photo').files[0];
    if (file) {
      // Two-step upload: ask for an upload URL, then send the file straight
      // to it. In AWS the URL is an S3 pre-signed PUT and this code is unchanged.
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
        categoryId: Number($('f-category').value), locationId: Number($('f-location').value),
        title: $('f-title').value, description: $('f-description').value, imageKey,
      }),
    });
    $('submit-msg').innerHTML = `Submitted. Your reference number is <strong>${complaint.reference_no}</strong>.`;
    $('f-title').value = ''; $('f-description').value = ''; $('f-photo').value = '';
    loadComplaints(); loadNotifications();
  } catch (err) {
    $('submit-msg').innerHTML = `<span class="error">${err.message}</span>`;
  } finally {
    btn.disabled = false;
  }
};

// ---------- complaint list ----------

$('btn-refresh').onclick = () => { loadComplaints(); loadNotifications(); };

async function loadComplaints() {
  try {
    const complaints = await api(COMPLAINT, '/api/complaints');
    $('list').innerHTML = complaints.length ? '' : '<p class="hint">No complaints yet.</p>';
    complaints.forEach((c) => $('list').appendChild(complaintCard(c)));
  } catch (err) {
    $('list').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// Which status changes each role may make, matching the rules the
// Complaint Service enforces. The server is the real gatekeeper; this
// only decides which buttons to show.
function nextActions(c) {
  if (user.role === 'STAFF' && c.assigned_staff_id === user.id) {
    if (c.status === 'ASSIGNED') return ['IN_PROGRESS'];
    if (c.status === 'IN_PROGRESS') return ['RESOLVED'];
  }
  if (c.status === 'RESOLVED' && (user.role === 'ADMIN' || c.student_id === user.id)) return ['CLOSED'];
  return [];
}

function complaintCard(c) {
  const el = document.createElement('div');
  el.className = 'complaint';
  el.innerHTML = `
    <h3>${c.title} <span class="status ${c.status}">${c.status.replace('_', ' ')}</span></h3>
    <div class="meta">${c.reference_no} &middot; submitted ${new Date(c.created_at).toLocaleString()}</div>
    <div>${c.description}</div>`;

  if (c.image_key) {
    const img = document.createElement('img');
    img.src = `${COMPLAINT}/api/complaints/uploads/file/${c.image_key}`;
    img.style.cssText = 'max-width:220px;margin-top:8px;border-radius:5px';
    el.appendChild(img);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  // Admin: assign or reassign to a staff member
  if (user.role === 'ADMIN' && ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'].includes(c.status)) {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">Assign to…</option>' +
      staffList.map((s) => `<option value="${s.id}">${s.fullName}</option>`).join('');
    const go = document.createElement('button');
    go.textContent = 'Assign'; go.className = 'small';
    go.onclick = async () => {
      if (!select.value) return;
      await act(() => api(COMPLAINT, `/api/complaints/${c.id}/assign`, {
        method: 'PATCH', body: JSON.stringify({ staffId: select.value }),
      }), el);
    };
    actions.append(select, go);
  }

  nextActions(c).forEach((status) => {
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = { IN_PROGRESS: 'Start work', RESOLVED: 'Mark resolved', CLOSED: 'Close' }[status];
    btn.onclick = async () => {
      let note = null;
      if (status === 'RESOLVED') {
        note = prompt('Resolution note (required):');
        if (!note) return;
      }
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
    loadComplaints(); loadNotifications();
    if (user.role === 'ADMIN') loadStats();
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'error'; p.textContent = err.message;
    el.appendChild(p);
  }
}

// ---------- admin statistics ----------

async function loadStats() {
  try {
    const s = await api(COMPLAINT, '/api/stats/summary');
    const rows = (list, label) => list.map((r) => `<tr><td>${r[label]}</td><td>${r.count}</td></tr>`).join('');
    $('stats').innerHTML = `
      <table><tr><th>Status</th><th>Count</th></tr>${rows(s.byStatus, 'status')}</table>
      <table style="margin-top:12px"><tr><th>Category</th><th>Count</th></tr>${rows(s.byCategory, 'name')}</table>
      <p class="hint">Average time to resolve: ${s.avgResolutionHours ?? 'n/a'} hours</p>`;
  } catch (err) {
    $('stats').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// ---------- notifications ----------

async function loadNotifications() {
  try {
    const items = await api(NOTIFICATION, '/api/notifications');
    $('notifications').innerHTML = items.length ? '' : '<p class="hint">Nothing yet.</p>';
    items.forEach((n) => {
      const d = document.createElement('div');
      d.className = `notif ${n.is_read ? '' : 'unread'}`;
      d.textContent = n.message;
      if (!n.is_read) {
        const b = document.createElement('button');
        b.textContent = 'Mark read'; b.className = 'small secondary'; b.style.marginLeft = '8px';
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
