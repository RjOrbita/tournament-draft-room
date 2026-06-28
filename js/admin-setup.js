// ============================================================
//  ADMIN SETUP PAGE — 3-Step Room Creation Wizard
// ============================================================

let currentStep = 1;
let playerPool  = []; // { name, position, info }

onReady(async () => {
  const session = loadSession();
  if (!session || !session.adminId) {
    window.location.href = 'index.html';
    return;
  }
  initConnectionBanner();
  document.getElementById('nav-admin-name').textContent = `👤 ${session.adminName || 'Admin'}`;

  // ---- Step navigation ----
  document.getElementById('btn-step1-next').addEventListener('click', () => tryGoStep(2));
  document.getElementById('btn-step2-back').addEventListener('click', () => goStep(1));
  document.getElementById('btn-step2-next').addEventListener('click', () => tryGoStep(3));
  document.getElementById('btn-step3-back').addEventListener('click', () => goStep(2));
  document.getElementById('btn-launch-room').addEventListener('click', launchRoom);

  // ---- Tabs ----
  document.querySelectorAll('#pool-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pool-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ---- Add player (manual) ----
  document.getElementById('btn-add-player').addEventListener('click', handleAddPlayer);
  ['inp-pname','inp-ppos','inp-pinfo'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', e => {
      if (e.key === 'Enter') handleAddPlayer();
    });
  });

  // ---- Clear all players ----
  document.getElementById('btn-clear-players').addEventListener('click', () => {
    if (playerPool.length === 0) return;
    if (!confirm('Clear all players from the pool?')) return;
    playerPool = [];
    renderPlayerList();
  });

  // ---- CSV drop zone ----
  const dropZone  = document.getElementById('csv-drop-zone');
  const fileInput = document.getElementById('csv-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processCSV(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processCSV(fileInput.files[0]);
  });

  // Update recommended pool size when captains/team size changes
  ['inp-captains','inp-team-size'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateRecommended);
  });
  updateRecommended();
});

// ---- Step logic ----
function goStep(n) {
  document.getElementById(`step-${currentStep}`).classList.remove('active');
  document.getElementById(`step-${n}`).classList.add('active');

  document.querySelectorAll('.step-item').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active','done');
    if (s < n)     el.classList.add('done');
    else if (s === n) el.classList.add('active');
  });
  ['conn-1-2','conn-2-3'].forEach((id, i) => {
    document.getElementById(id).classList.toggle('done', n > i + 2);
  });

  if (n === 3) populateReview();
  currentStep = n;
}

function tryGoStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  goStep(n);
}

// ---- Validation ----
function validateStep1() {
  const name = document.getElementById('inp-room-name').value.trim();
  const team  = parseInt(document.getElementById('inp-team-size').value);
  const pts   = parseInt(document.getElementById('inp-starting-pts').value);

  if (!name) { showToast('Enter a room name.', 'error'); document.getElementById('inp-room-name').focus(); return false; }
  if (!team || team < 1) { showToast('Team size must be at least 1.', 'error'); return false; }
  if (!pts || pts < 10) { showToast('Starting points must be at least 10.', 'error'); return false; }
  return true;
}

function validateStep2() {
  if (playerPool.length === 0) {
    showToast('Add at least one player to the pool.', 'error');
    return false;
  }
  return true;
}

// ---- Manual add player ----
function handleAddPlayer() {
  const name = document.getElementById('inp-pname').value.trim();
  const pos  = document.getElementById('inp-ppos').value.trim();
  const info = document.getElementById('inp-pinfo').value.trim();

  if (!name) { showToast('Player name is required.', 'error'); document.getElementById('inp-pname').focus(); return; }

  playerPool.push({ name, position: pos, info });
  renderPlayerList();

  document.getElementById('inp-pname').value = '';
  document.getElementById('inp-ppos').value  = '';
  document.getElementById('inp-pinfo').value = '';
  document.getElementById('inp-pname').focus();
  showToast(`${name} added to pool.`, 'success');
}

// ---- CSV processing ----
function processCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const rows = parseCSV(e.target.result);
    if (!rows.length) { showToast('No valid rows found in CSV. Check format.', 'error'); return; }
    playerPool = [...playerPool, ...rows];
    renderPlayerList();
    showToast(`${rows.length} players imported from CSV.`, 'success');
    document.getElementById('csv-file-input').value = '';
  };
  reader.onerror = () => showToast('Failed to read file.', 'error');
  reader.readAsText(file);
}

// ---- Render player list ----
function renderPlayerList() {
  const list     = document.getElementById('player-list');
  const emptyMsg = document.getElementById('empty-pool-msg');
  const badge    = document.getElementById('player-count-badge');

  badge.textContent = `${playerPool.length} player${playerPool.length !== 1 ? 's' : ''}`;

  if (!playerPool.length) {
    list.innerHTML = '';
    list.appendChild(emptyMsg);
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  list.innerHTML = playerPool.map((p, i) => `
    <div class="player-list-item">
      <div class="pl-num">${i + 1}</div>
      <div class="pl-info">
        <div class="pl-name">${escHtml(p.name)}
          ${p.position ? `<span class="badge badge-primary" style="margin-left:8px;font-size:.65rem;">${escHtml(p.position)}</span>` : ''}
        </div>
        ${p.info ? `<div class="pl-meta">${escHtml(p.info)}</div>` : ''}
      </div>
      <button class="pl-del" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.pl-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const removed = playerPool.splice(idx, 1);
      renderPlayerList();
      showToast(`${removed[0].name} removed.`, 'info');
    });
  });
}

// ---- Recommended pool size ----
function updateRecommended() {
  const captains  = parseInt(document.getElementById('inp-captains').value) || 4;
  const teamSize  = parseInt(document.getElementById('inp-team-size').value) || 5;
  const rec = captains * teamSize;
  document.getElementById('recommended-pool').textContent = `${rec}+`;
}

// ---- Populate review ----
function populateReview() {
  const name     = document.getElementById('inp-room-name').value.trim();
  const captains = document.getElementById('inp-captains').value;
  const teamSize = document.getElementById('inp-team-size').value;
  const pts      = document.getElementById('inp-starting-pts').value;
  const timer    = document.getElementById('inp-bid-timer').value;
  const spots    = parseInt(captains) * parseInt(teamSize);

  document.getElementById('rv-room-name').textContent    = name;
  document.getElementById('rv-captains').textContent     = captains;
  document.getElementById('rv-team-size').textContent    = `${teamSize} players`;
  document.getElementById('rv-starting-pts').textContent = `${pts} pts`;
  document.getElementById('rv-bid-timer').textContent    = `${timer}s`;
  document.getElementById('rv-pool-size').textContent    = playerPool.length;
  document.getElementById('rv-spots-needed').textContent = spots;

  const warn = document.getElementById('rv-pool-warning');
  warn.classList.toggle('hidden', playerPool.length >= spots);
}

// ---- Launch Room ----
async function launchRoom() {
  const session = loadSession();
  if (!session || !session.adminId) { window.location.href = 'index.html'; return; }

  const btn = document.getElementById('btn-launch-room');
  btn.disabled = true;
  btn.textContent = '⏳ Creating room...';

  try {
    const user = await ensureAuth();

    // Build room data
    const roomName     = document.getElementById('inp-room-name').value.trim();
    const numCaptains  = parseInt(document.getElementById('inp-captains').value);
    const maxTeamSize  = parseInt(document.getElementById('inp-team-size').value);
    const startingPts  = parseInt(document.getElementById('inp-starting-pts').value);
    const bidTimer     = parseInt(document.getElementById('inp-bid-timer').value);
    const inviteCode   = generateInviteCode();
    const roomId       = generateId();

    // Build player pool object
    const poolObj = {};
    playerPool.forEach((p, i) => {
      const key = `player_${i}_${generateId().slice(0,6)}`;
      poolObj[key] = {
        name:     p.name,
        position: p.position || '',
        info:     p.info     || '',
        status:   'available',
        draftedBy:  null,
        draftedFor: null,
        order:    i
      };
    });

    // Admin as first participant
    const participants = {};
    participants[user.uid] = {
      name:         session.adminName || 'Admin',
      role:         'admin',
      captainIndex: -1,
      points:       startingPts,
      team:         [],
      joinedAt:     firebase.database.ServerValue.TIMESTAMP
    };

    const roomData = {
      meta: {
        roomName,
        adminId:       user.uid,
        status:        'lobby',
        numCaptains,
        maxTeamSize,
        startingPoints: startingPts,
        bidTimerSeconds: bidTimer,
        inviteCode,
        createdAt:     firebase.database.ServerValue.TIMESTAMP
      },
      participants,
      playerPool: poolObj,
      draft:       null,
      log:         null,
      presence:    null
    };

    await db.ref(`rooms/${roomId}`).set(roomData);

    // Update session
    saveSession({
      roomId,
      userId:   user.uid,
      userName: session.adminName || 'Admin',
      role:     'admin',
      adminId:  user.uid,
      adminName: session.adminName
    });

    showToast('Room created! Taking you to the lobby…', 'success');
    setTimeout(() => { window.location.href = `lobby.html?room=${roomId}`; }, 800);

  } catch(err) {
    console.error('Launch room error:', err);
    showToast('Failed to create room. Check your Firebase config.', 'error');
    btn.disabled = false;
    btn.textContent = '🚀 Launch Room';
  }
}
