// ============================================================
//  SHARED UTILITIES
// ============================================================

// ---- ID / Code Generators ----
function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---- Toast Notifications ----
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️', gold: '⭐' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(16px)';
    toast.style.transition = 'all .3s ease';
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ---- Modal helpers ----
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// ---- String helpers ----
function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- Position CSS class ----
function posClass(pos = '') {
  const p = pos.toLowerCase();
  if (p.includes('forward') || p.includes('striker') || p.includes('attack')) return 'forward';
  if (p.includes('mid')) return 'midfielder';
  if (p.includes('defend') || p.includes('back')) return 'defender';
  if (p.includes('goal') || p.includes('keeper') || p.includes('gk')) return 'goalkeeper';
  return 'other';
}

// ---- Avatar color palette (indexed by captain index) ----
const AVATAR_COLORS = [
  { bg: 'rgba(99,102,241,.2)',  border: '#6366f1', text: '#818cf8' },
  { bg: 'rgba(245,158,11,.2)', border: '#f59e0b', text: '#fbbf24' },
  { bg: 'rgba(16,185,129,.2)', border: '#10b981', text: '#34d399' },
  { bg: 'rgba(239,68,68,.2)',  border: '#ef4444', text: '#f87171' },
  { bg: 'rgba(168,85,247,.2)', border: '#a855f7', text: '#c084fc' },
  { bg: 'rgba(20,184,166,.2)', border: '#14b8a6', text: '#2dd4bf' },
  { bg: 'rgba(249,115,22,.2)', border: '#f97316', text: '#fb923c' },
  { bg: 'rgba(59,130,246,.2)', border: '#3b82f6', text: '#60a5fa' },
];
function avatarStyle(idx) {
  const c = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  return `background:${c.bg};border-color:${c.border};color:${c.text};border:2px solid ${c.border};`;
}

// ---- Simple CSV parser ----
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]);
    if (!vals[0] || !vals[0].trim()) continue;
    const row = {};
    headers.forEach((h, j) => row[h] = (vals[j] || '').trim());
    rows.push({
      name: row['name'] || row['player'] || row['player name'] || '',
      position: row['position'] || row['pos'] || row['role'] || '',
      info: row['info'] || row['stats'] || row['notes'] || row['description'] || ''
    });
  }
  return rows.filter(r => r.name);
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += line[i]; }
  }
  result.push(cur);
  return result;
}

// ---- Copy to clipboard ----
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch(e) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
    return true;
  }
}

// ---- Presence setup ----
function setupPresence(roomId, userId) {
  const connRef  = db.ref('.info/connected');
  const presRef  = db.ref(`rooms/${roomId}/presence/${userId}`);

  connRef.on('value', snap => {
    if (snap.val() === true) {
      presRef.onDisconnect().remove();
      presRef.set(true);
    }
  });

  return () => {
    connRef.off();
    presRef.remove();
  };
}

// ---- Connection banner ----
function initConnectionBanner() {
  const banner = document.getElementById('conn-banner');
  if (!banner) return;
  db.ref('.info/connected').on('value', snap => {
    if (snap.val() === false) {
      banner.textContent = '⚠️ Connection lost — reconnecting...';
      banner.className = 'disconnected show';
    } else {
      banner.textContent = '✅ Reconnected!';
      banner.className = 'reconnected show';
      setTimeout(() => banner.classList.remove('show'), 2500);
    }
  });
}

// ---- DOM ready helper ----
function onReady(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}
