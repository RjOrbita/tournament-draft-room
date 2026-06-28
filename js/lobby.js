// ============================================================
//  LOBBY PAGE
// ============================================================

let roomId, myId, myRole, myName;
let roomMeta, participants = {}, captainSlots = [], turnOrder = [];
let assigningSlotIndex = -1;
let participantsListener, presenceListener, metaListener;

onReady(async () => {
  const session = loadSession();
  if (!session || !session.roomId) { window.location.href = 'index.html'; return; }

  roomId = session.roomId;
  myName = session.userName || session.adminName;
  myRole = session.role;

  initConnectionBanner();

  try {
    const user = await ensureAuth();
    myId = user.uid;

    // Register presence
    setupPresence(roomId, myId);

    // Load initial meta
    const metaSnap = await db.ref(`rooms/${roomId}/meta`).once('value');
    if (!metaSnap.exists()) { window.location.href = 'index.html'; return; }
    roomMeta = metaSnap.val();

    // Redirect if already started
    if (roomMeta.status === 'drafting') { window.location.href = `draft.html?room=${roomId}`; return; }
    if (roomMeta.status === 'completed') { window.location.href = `results.html?room=${roomId}`; return; }

    renderRoomInfo();
    initUI();
    listenToParticipants();
    listenToMeta();

  } catch(err) {
    console.error(err);
    showToast('Failed to connect. Check your Firebase config.', 'error');
  }
});

function renderRoomInfo() {
  document.getElementById('nav-room-name').textContent = roomMeta.roomName;
  document.getElementById('nav-invite-code').textContent = roomMeta.inviteCode;
  document.getElementById('lobby-room-title').textContent = roomMeta.roomName;
  document.getElementById('info-captains').textContent    = roomMeta.numCaptains;
  document.getElementById('info-team-size').textContent   = `${roomMeta.maxTeamSize} players`;
  document.getElementById('info-starting-pts').textContent= `${roomMeta.startingPoints} pts`;
  document.getElementById('info-bid-timer').textContent   = `${roomMeta.bidTimerSeconds}s`;

  // Pool size
  db.ref(`rooms/${roomId}/playerPool`).once('value').then(snap => {
    document.getElementById('info-pool-size').textContent = snap.numChildren() + ' players';
  });

  // My badge
  document.getElementById('nav-my-badge').textContent =
    myRole === 'admin' ? '👑 Admin' : myRole === 'captain' ? '⚔️ Captain' : '👁 Spectator';
  document.getElementById('nav-my-badge').className =
    myRole === 'admin' ? 'badge badge-primary' : myRole === 'captain' ? 'badge badge-captain' : 'badge badge-neutral';

  // Build captain slots array
  captainSlots = Array.from({ length: roomMeta.numCaptains }, (_, i) => ({ index: i, captainId: null, name: null }));
  turnOrder = [];
  renderCaptainSlots();
}

function initUI() {
  const isAdmin = myRole === 'admin';

  // Copy invite code
  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    await copyToClipboard(roomMeta.inviteCode);
    showToast(`Copied invite code: ${roomMeta.inviteCode}`, 'success');
  });

  // Exit room
  document.getElementById('btn-exit-room')?.addEventListener('click', exitRoom);

  // Admin-only UI
  if (isAdmin) {
    document.getElementById('btn-start-draft').classList.remove('hidden');
    document.getElementById('btn-start-draft').addEventListener('click', startDraft);
  } else {
    document.getElementById('captain-panel-hint').textContent = 'Waiting for admin to assign captains…';
  }

  // Assign captain modal
  document.getElementById('close-assign').addEventListener('click', () => closeModal('modal-assign-captain'));
  document.getElementById('cancel-assign').addEventListener('click', () => closeModal('modal-assign-captain'));

  // Randomize turn order
  document.getElementById('btn-randomize-order').addEventListener('click', () => {
    shuffleArray(turnOrder);
    renderTurnOrderList();
  });
}

// ---- Listeners ----
function listenToParticipants() {
  db.ref(`rooms/${roomId}/participants`).on('value', snap => {
    participants = snap.val() || {};

    // Sync captain slots from DB
    captainSlots = captainSlots.map(slot => {
      const captainId = Object.keys(participants).find(uid =>
        participants[uid].role === 'captain' && participants[uid].captainIndex === slot.index
      );
      return {
        ...slot,
        captainId: captainId || null,
        name: captainId ? participants[captainId].name : null
      };
    });

    // Sync turn order from DB participants
    const existingOrder = captainSlots
      .filter(s => s.captainId)
      .sort((a, b) => {
        const ao = participants[a.captainId]?.turnOrder ?? a.index;
        const bo = participants[b.captainId]?.turnOrder ?? b.index;
        return ao - bo;
      })
      .map(s => s.captainId);

    if (existingOrder.length) {
      turnOrder = existingOrder;
    } else {
      turnOrder = captainSlots.filter(s => s.captainId).map(s => s.captainId);
    }

    renderCaptainSlots();
    renderParticipantsList();
    renderTurnOrderIfReady();
    updateStartButton();
  });
}

function listenToMeta() {
  db.ref(`rooms/${roomId}/meta/status`).on('value', snap => {
    if (snap.val() === 'drafting') {
      window.location.href = `draft.html?room=${roomId}`;
    }
  });
}

// ---- Render: Captain Slots ----
function renderCaptainSlots() {
  const list      = document.getElementById('captain-slots-list');
  const countBadge= document.getElementById('captain-assigned-count');
  const isAdmin   = myRole === 'admin';
  const assigned  = captainSlots.filter(s => s.captainId).length;

  countBadge.textContent = `${assigned} / ${roomMeta.numCaptains} assigned`;
  countBadge.className   = assigned === roomMeta.numCaptains ? 'badge badge-gold' : 'badge badge-neutral';

  list.innerHTML = captainSlots.map(slot => `
    <div class="captain-slot ${slot.captainId ? 'assigned' : ''}" id="cslot-${slot.index}">
      <div class="slot-num">#${slot.index + 1}</div>
      <div class="slot-info">
        ${slot.captainId
          ? `<div class="slot-name">${escHtml(slot.name)}</div><div class="slot-label"><span class="badge badge-captain">Captain ${slot.index + 1}</span></div>`
          : `<div class="slot-name text-dim">Empty Slot</div><div class="slot-label text-dim font-size:.7rem">Awaiting assignment</div>`
        }
      </div>
      ${isAdmin
        ? `<button class="btn btn-sm ${slot.captainId ? 'btn-ghost' : 'btn-primary'}" data-slot="${slot.index}">
             ${slot.captainId ? 'Change' : 'Assign'}
           </button>`
        : ''}
    </div>
  `).join('');

  if (isAdmin) {
    list.querySelectorAll('[data-slot]').forEach(btn => {
      btn.addEventListener('click', () => openAssignModal(parseInt(btn.dataset.slot)));
    });
  }
}

// ---- Assign Captain Modal ----
function openAssignModal(slotIndex) {
  assigningSlotIndex = slotIndex;
  document.getElementById('assign-slot-label').textContent = slotIndex + 1;

  const alreadyAssigned = captainSlots.map(s => s.captainId).filter(Boolean);
  const eligible = Object.entries(participants).filter(([uid, p]) =>
    p.role !== 'admin' && !alreadyAssigned.includes(uid)
  );

  const list = document.getElementById('assign-options-list');

  if (!eligible.length) {
    list.innerHTML = `<p class="text-muted text-sm">No eligible participants. Wait for more people to join.</p>`;
  } else {
    list.innerHTML = eligible.map(([uid, p]) => `
      <button class="btn btn-ghost w-full" style="justify-content:flex-start;gap:var(--s3);" data-uid="${uid}">
        <div class="avatar avatar-md avatar-primary">${initials(p.name)}</div>
        <span>${escHtml(p.name)}</span>
        <span class="badge badge-neutral ml-auto">${p.role}</span>
      </button>
    `).join('');

    list.querySelectorAll('[data-uid]').forEach(btn => {
      btn.addEventListener('click', () => assignCaptain(btn.dataset.uid, assigningSlotIndex));
    });
  }

  openModal('modal-assign-captain');
}

async function assignCaptain(uid, slotIndex) {
  closeModal('modal-assign-captain');
  try {
    // Unassign any existing captain in this slot
    const prevCaptain = captainSlots[slotIndex].captainId;
    if (prevCaptain) {
      await db.ref(`rooms/${roomId}/participants/${prevCaptain}`).update({
        role: 'spectator', captainIndex: -1
      });
    }
    // Assign new captain
    await db.ref(`rooms/${roomId}/participants/${uid}`).update({
      role: 'captain',
      captainIndex: slotIndex,
      points: roomMeta.startingPoints,
      team: [],
      turnOrder: slotIndex
    });

    // Update session if that's me
    if (uid === myId) {
      const session = loadSession();
      saveSession({ ...session, role: 'captain' });
      myRole = 'captain';
      document.getElementById('nav-my-badge').textContent = '⚔️ Captain';
      document.getElementById('nav-my-badge').className   = 'badge badge-captain';
    }

    showToast(`Captain ${slotIndex + 1} assigned!`, 'success');
  } catch(err) {
    console.error(err);
    showToast('Failed to assign captain.', 'error');
  }
}

// ---- Turn Order ----
function renderTurnOrderIfReady() {
  const allAssigned = captainSlots.every(s => s.captainId);
  const panel = document.getElementById('turn-order-panel');
  if (allAssigned && myRole === 'admin') {
    panel.classList.remove('hidden');
    if (!turnOrder.length) turnOrder = captainSlots.map(s => s.captainId);
    renderTurnOrderList();
  } else {
    panel.classList.add('hidden');
  }
}

function renderTurnOrderList() {
  const list = document.getElementById('turn-order-list');
  list.innerHTML = turnOrder.map((uid, i) => {
    const p = participants[uid];
    if (!p) return '';
    return `
      <div class="turn-item" draggable="true" data-uid="${uid}" data-idx="${i}">
        <span class="turn-drag-icon">⠿</span>
        <span style="font-family:'Rajdhani',sans-serif;font-size:1.1rem;font-weight:700;color:var(--text-4);width:20px;">${i+1}</span>
        <div class="avatar avatar-md avatar-gold">${initials(p.name)}</div>
        <span class="font-semibold">${escHtml(p.name)}</span>
        <span class="badge badge-captain ml-auto">Captain ${captainSlots.find(s=>s.captainId===uid)?.index+1??''}</span>
      </div>
    `;
  }).join('');

  initDragSort(list, turnOrder, renderTurnOrderList);
}

// ---- Simple drag-and-drop sort ----
function initDragSort(list, arr, onUpdate) {
  let dragged = null;
  list.querySelectorAll('[draggable]').forEach(item => {
    item.addEventListener('dragstart', () => { dragged = item; item.style.opacity = '.5'; });
    item.addEventListener('dragend', () => { item.style.opacity = ''; dragged = null; });
    item.addEventListener('dragover', e => { e.preventDefault(); });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const from = parseInt(dragged.dataset.idx);
      const to   = parseInt(item.dataset.idx);
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      onUpdate();
    });
  });
}

// ---- Participants List ----
function renderParticipantsList() {
  const list  = document.getElementById('participants-list');
  const badge = document.getElementById('participant-count-badge');
  const parts = Object.entries(participants);
  badge.textContent = `${parts.length} connected`;

  if (!parts.length) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--s6)"><p class="text-dim text-sm">No one connected yet.</p></div>`;
    return;
  }
  list.innerHTML = parts.map(([uid, p]) => `
    <div class="participant-item">
      <div class="status-dot online"></div>
      <div class="avatar avatar-md avatar-primary">${initials(p.name)}</div>
      <div class="participant-info">
        <div class="participant-name">${escHtml(p.name)} ${uid === myId ? '<span class="badge badge-primary" style="font-size:.65rem;">You</span>' : ''}</div>
        <div class="participant-role">${roleLabel(p.role, p.captainIndex)}</div>
      </div>
    </div>
  `).join('');
}

function roleLabel(role, idx) {
  if (role === 'admin') return '👑 Admin';
  if (role === 'captain') return `⚔️ Captain ${(idx ?? 0) + 1}`;
  return '👁 Spectator';
}

// ---- Participants List ----
function updateStartButton() {
  const btn = document.getElementById('btn-start-draft');
  const allAssigned = captainSlots.every(s => s.captainId);
  btn.disabled = !allAssigned;
  btn.title = allAssigned ? '' : 'Assign all captain slots before starting.';
}

// ---- Start Draft ----
async function startDraft() {
  if (!captainSlots.every(s => s.captainId)) {
    showToast('Assign all captain slots before starting.', 'error');
    return;
  }
  const btn = document.getElementById('btn-start-draft');
  btn.disabled = true;
  btn.textContent = '⏳ Starting...';

  try {
    // Save turn order to DB
    const updates = {};
    turnOrder.forEach((uid, i) => {
      updates[`rooms/${roomId}/participants/${uid}/turnOrder`] = i;
    });

    // Create initial draft state
    updates[`rooms/${roomId}/draft`] = {
      phase: 'pick',
      currentCaptainIndex: 0,
      turnOrder,
      round: 1,
      timerEndsAt: firebase.database.ServerValue.TIMESTAMP + 30000,
      timerPaused: false,
      timeRemainingMs: null,
      pausedBecause: null,
      activeBid: null
    };
    updates[`rooms/${roomId}/meta/status`] = 'drafting';

    // Add start log
    const logKey = db.ref(`rooms/${roomId}/log`).push().key;
    updates[`rooms/${roomId}/log/${logKey}`] = {
      type: 'system',
      message: '🚀 Draft has started! Good luck to all captains.',
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    await db.ref().update(updates);
    // Redirect handled by listenToMeta
  } catch(err) {
    console.error(err);
    showToast('Failed to start draft.', 'error');
    btn.disabled = false;
    btn.textContent = '⚡ Start Draft';
  }
}

// ---- Helper ----
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---- Actions ----
async function exitRoom() {
  if (!confirm('Are you sure you want to leave this room?')) return;
  try {
    if (myId) await db.ref(`rooms/${roomId}/participants/${myId}`).remove();
    clearSession();
    window.location.href = 'index.html';
  } catch(e) {
    console.error(e);
    showToast('Failed to exit room.', 'error');
  }
}
