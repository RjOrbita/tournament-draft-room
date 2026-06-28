// ============================================================
//  DRAFT ENGINE — Blind Bid Draft Room
// ============================================================

// ---- State ----
let roomId, myId, myRole, myName;
let roomMeta = null;
let participants = {};
let playerPool = {};
let draftState = null;
let logEntries = [];

let timerInterval = null;
let selectedPlayerId = null;
let pendingBidPlayerId = null;
let isResolving = false;

// ---- Init ----
onReady(async () => {
  const params  = new URLSearchParams(window.location.search);
  const session = loadSession();
  roomId = params.get('room') || session?.roomId;

  if (!roomId) { window.location.href = 'index.html'; return; }

  initConnectionBanner();

  try {
    const user = await ensureAuth();
    myId = user.uid;

    // Load session data
    myName = session?.userName || session?.adminName || 'Unknown';
    myRole = session?.role || 'spectator';

    // Ensure participant is registered
    const partRef = db.ref(`rooms/${roomId}/participants/${myId}`);
    const partSnap = await partRef.once('value');
    if (!partSnap.exists() && myRole !== 'admin') {
      window.location.href = 'index.html';
      return;
    }
    if (partSnap.exists()) {
      myRole = partSnap.val().role;
      myName = partSnap.val().name;
    }

    // Load meta
    const metaSnap = await db.ref(`rooms/${roomId}/meta`).once('value');
    if (!metaSnap.exists()) { window.location.href = 'index.html'; return; }
    roomMeta = metaSnap.val();

    if (roomMeta.status === 'completed') { window.location.href = `results.html?room=${roomId}`; return; }

    // Setup presence
    setupPresence(roomId, myId);

    // Update navbar
    document.getElementById('nav-room-name').textContent = roomMeta.roomName;
    const myBadge = document.getElementById('nav-my-badge');
    myBadge.textContent = myRole === 'admin' ? '👑 Admin' : myRole === 'captain' ? '⚔️ You' : '👁 Watch';
    myBadge.className   = myRole === 'captain' ? 'badge badge-captain' : myRole === 'admin' ? 'badge badge-primary' : 'badge badge-neutral';

    // Top Nav buttons
    document.getElementById('btn-exit-room')?.addEventListener('click', exitRoom);
    if (myRole === 'admin') {
      const resetBtn = document.getElementById('btn-reset-draft');
      if (resetBtn) {
        resetBtn.style.display = 'inline-flex';
        resetBtn.addEventListener('click', resetDraft);
      }
    }

    // Show my points chip (captain only)
    if (myRole === 'captain') {
      document.getElementById('my-points-chip').style.display = 'inline-flex';
    }

    // Start listeners
    listenToRoomMeta();
    listenToParticipants();
    listenToPlayerPool();
    listenToDraftState();
    listenToPresence();
    listenToLog();

    // Search filter
    document.getElementById('pool-search').addEventListener('input', renderPoolGrid);

    // Bid confirm modal listeners
    document.getElementById('close-bid-confirm').addEventListener('click', () => closeModal('modal-bid-confirm'));
    document.getElementById('cancel-bid-confirm').addEventListener('click', () => closeModal('modal-bid-confirm'));
    document.getElementById('submit-bid-confirm').addEventListener('click', handleBidSubmit);
    document.getElementById('bid-amount-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') handleBidSubmit();
    });

  } catch(err) {
    console.error('Draft init error:', err);
    showToast('Failed to connect to draft. Check your internet connection.', 'error');
  }
});

// ============================================================
//  FIREBASE LISTENERS
// ============================================================
function listenToRoomMeta() {
  db.ref(`rooms/${roomId}/meta/status`).on('value', snap => {
    const status = snap.val();
    if (status === 'completed') {
      setTimeout(() => { window.location.href = `results.html?room=${roomId}`; }, 2000);
    } else if (status === 'lobby') {
      window.location.href = `lobby.html?room=${roomId}`;
    }
  });
}

function listenToParticipants() {
  db.ref(`rooms/${roomId}/participants`).on('value', snap => {
    participants = snap.val() || {};
    // Update my points
    if (myRole === 'captain' && participants[myId]) {
      const pts = participants[myId].points ?? roomMeta.startingPoints;
      document.getElementById('my-points-val').textContent = pts;
    }
    renderCaptainsSidebar();
  });
}

function listenToPlayerPool() {
  db.ref(`rooms/${roomId}/playerPool`).on('value', snap => {
    playerPool = snap.val() || {};
    renderPoolGrid();
    updatePoolCount();
  });
}

function listenToDraftState() {
  db.ref(`rooms/${roomId}/draft`).on('value', snap => {
    const prev = draftState;
    draftState = snap.val();

    if (!draftState) return;

    // Round badge
    document.getElementById('round-badge').textContent = `Round ${draftState.round || 1}`;

    // Handle phase changes
    renderBidStage();
    updatePhaseBanner();
    renderCaptainsSidebar();
    renderPoolGrid();

    // Timer management
    if (draftState.phase === 'bidding' || draftState.phase === 'pick') {
      if (!draftState.timerPaused) {
        startLocalTimer();
      } else {
        stopLocalTimer();
        showPausedState();
      }
    } else {
      stopLocalTimer();
    }

    // Auto-reveal when phase changes to reveal
    if (draftState.phase === 'reveal' && prev?.phase !== 'reveal') {
      showRevealOverlay();
    }
  });
}

function listenToPresence() {
  db.ref(`rooms/${roomId}/presence`).on('value', snap => {
    const online = snap.val() || {};
    if (!draftState || isResolving) return;
    if (draftState.phase !== 'bidding' && draftState.phase !== 'pick') return;

    const turnOrder = draftState.turnOrder || [];
    let needsAction = [];
    
    if (draftState.phase === 'bidding') {
      const bids = draftState.activeBid?.bids || {};
      needsAction = turnOrder.filter(uid => {
        const bid = bids[uid];
        return uid !== draftState.activeBid?.nominatedBy &&
               (!bid || (!bid.submitted && !bid.passed));
      });
    } else if (draftState.phase === 'pick') {
      needsAction = [turnOrder[draftState.currentCaptainIndex]];
    }

    const offlineNeedsAction = needsAction.filter(uid => !online[uid]);

    // Only admin (or first connected user) manages pause state
    if (myRole === 'admin' || myId === turnOrder[0]) {
      if (offlineNeedsAction.length > 0 && !draftState.timerPaused) {
        pauseTimer(offlineNeedsAction[0]);
      } else if (offlineNeedsAction.length === 0 && draftState.timerPaused) {
        resumeTimer();
      }
    }
  });
}

function listenToLog() {
  db.ref(`rooms/${roomId}/log`).limitToLast(50).on('value', snap => {
    const entries = [];
    snap.forEach(child => entries.push(child.val()));
    logEntries = entries;
    renderLog();
  });
}

// ============================================================
//  TIMER
// ============================================================
function startLocalTimer() {
  stopLocalTimer();
  timerInterval = setInterval(tickTimer, 250);
}
function stopLocalTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function tickTimer() {
  if (!draftState || draftState.timerPaused) return;
  const remaining = Math.max(0, draftState.timerEndsAt - Date.now());
  const secs = Math.ceil(remaining / 1000);

  // Update timer display
  const totalSecs = draftState.phase === 'pick' ? 30 : Math.ceil(roomMeta.bidTimerSeconds);
  updateTimerDisplay(secs, totalSecs);

  if (remaining <= 0) {
    stopLocalTimer();
    handleTimerExpiry();
  }
}

async function handleTimerExpiry() {
  if (isResolving) return;
  // Use transaction to safely advance phases when timer runs out
  try {
    await db.ref(`rooms/${roomId}/draft`).transaction(draft => {
      if (!draft) return;
      if (draft.phase === 'bidding') {
        draft.phase = 'reveal';
        return draft;
      }
      if (draft.phase === 'pick') {
        // Auto-skip turn if they don't pick
        const nextIdx = (draft.currentCaptainIndex + 1) % draft.turnOrder.length;
        draft.currentCaptainIndex = nextIdx;
        draft.timerEndsAt = Date.now() + 30000;
        if (nextIdx === 0) draft.round = (draft.round || 1) + 1;
        return draft;
      }
    });
  } catch(e) { /* another client handled it */ }
}

async function pauseTimer(offlineUid) {
  if (!draftState || !draftState.timerEndsAt) return;
  const remaining = Math.max(0, draftState.timerEndsAt - Date.now());
  try {
    await db.ref(`rooms/${roomId}/draft`).update({
      timerPaused: true,
      timeRemainingMs: remaining,
      pausedBecause: offlineUid
    });
  } catch(e) { console.warn('pauseTimer:', e); }
}

async function resumeTimer() {
  if (!draftState?.timeRemainingMs) return;
  const newEnd = Date.now() + draftState.timeRemainingMs;
  try {
    await db.ref(`rooms/${roomId}/draft`).update({
      timerPaused: false,
      timerEndsAt: newEnd,
      timeRemainingMs: null,
      pausedBecause: null
    });
  } catch(e) { console.warn('resumeTimer:', e); }
}

// ============================================================
//  RENDER: BID STAGE
// ============================================================
function renderBidStage() {
  const stage = document.getElementById('bid-stage');
  if (!draftState) return;

  const { phase, turnOrder, currentCaptainIndex, activeBid } = draftState;
  const activeCaptainId = turnOrder?.[currentCaptainIndex];
  const activeCaptain   = participants[activeCaptainId] || {};
  const amIActiveCaptain= activeCaptainId === myId;
  const amICaptain      = myRole === 'captain';

  stage.className = `bid-stage phase-${phase}`;

  // ---- PICK phase ----
  if (phase === 'pick') {
    const timerHtml = buildTimerHtml();
    if (amIActiveCaptain) {
      stage.innerHTML = `
        <div class="your-turn-banner" style="width:100%;max-width:380px;margin-bottom:var(--s4);">
          <div style="font-size:1.5rem;margin-bottom:var(--s2);">🎯 Your Turn!</div>
          <div class="text-sm text-muted">Select a player from the pool to nominate them for bidding.</div>
        </div>
        ${timerHtml}
        <div class="text-muted text-sm mt-4">Click any <span class="badge badge-primary">available</span> player in the pool to pick them.</div>
      `;
    } else {
      stage.innerHTML = `
        <div style="font-size:2.5rem;margin-bottom:var(--s4);">⏳</div>
        <div style="font-size:1.1rem;font-weight:600;">${escHtml(activeCaptain.name || 'Captain')}</div>
        <div class="text-muted text-sm mt-2 mb-4">is picking a player…</div>
        ${timerHtml}
        <div class="phase-banner pick mt-4">🎯 Pick Phase</div>
      `;
    }
    return;
  }

  // ---- BIDDING phase ----
  if (phase === 'bidding' && activeBid) {
    const player = playerPool[activeBid.playerId] || {};
    const bids   = activeBid.bids || {};
    const amINominator = activeBid.nominatedBy === myId;
    const myBidData    = bids[myId] || {};

    // Build bid status chips for all captains
    const bidChips = (turnOrder || []).map(uid => {
      const p   = participants[uid] || {};
      const bid = bids[uid] || {};
      let cls = 'pending', label = '…';
      if (bid.passed)                       { cls = 'passed'; label = 'Passed'; }
      else if (bid.submitted)               { cls = 'placed'; label = '✓ Bid Placed'; }
      const isMe = uid === myId;
      return `<div class="bid-status-chip ${cls} ${isMe ? 'is-me' : ''}">${escHtml(p.name || '?')} <span>${label}</span></div>`;
    }).join('');

    const timerHtml = buildTimerHtml();

    if (amINominator) {
      // My bid is already placed — show locked state
      stage.innerHTML = `
        <div class="nominated-player-card">
          <div class="np-name">${escHtml(player.name || 'Unknown')}</div>
          ${player.position ? `<div class="np-pos">${escHtml(player.position)}</div>` : ''}
          ${player.info     ? `<div class="np-info">${escHtml(player.info)}</div>`     : ''}
        </div>
        <div class="badge badge-gold" style="font-size:.85rem;padding:8px 16px;">
          🔒 Your bid: <strong style="font-size:1.1rem;margin-left:4px;">${myBidData.amount ?? '?'} pts</strong>
        </div>
        ${timerHtml}
        <div class="text-muted text-sm">Waiting for other captains to place their blind bids…</div>
        <div class="bid-statuses">${bidChips}</div>
      `;
    } else if (myBidData.submitted || myBidData.passed) {
      // Already bid — show waiting state
      stage.innerHTML = `
        <div class="nominated-player-card">
          <div class="np-name">${escHtml(player.name || 'Unknown')}</div>
          ${player.position ? `<div class="np-pos">${escHtml(player.position)}</div>` : ''}
          ${player.info     ? `<div class="np-info">${escHtml(player.info)}</div>`     : ''}
        </div>
        <div class="badge badge-success" style="font-size:.85rem;padding:8px 16px;">✓ Your bid is locked in</div>
        ${timerHtml}
        <div class="text-muted text-sm">Waiting for bids to be revealed…</div>
        <div class="bid-statuses">${bidChips}</div>
      `;
    } else if (amICaptain) {
      // Show bid input for non-nominator captains
      const myPoints = participants[myId]?.points ?? 0;
      stage.innerHTML = `
        <div class="nominated-player-card">
          <div class="np-name">${escHtml(player.name || 'Unknown')}</div>
          ${player.position ? `<div class="np-pos">${escHtml(player.position)}</div>` : ''}
          ${player.info     ? `<div class="np-info">${escHtml(player.info)}</div>`     : ''}
        </div>
        ${timerHtml}
        <div style="width:100%;max-width:320px;">
          <div class="form-label mb-3">Your blind bid (you have <strong class="text-gold">${myPoints}</strong> pts left)</div>
          <div class="bid-input-group mb-3">
            <div class="bid-input-prefix">⭐</div>
            <input class="bid-input-field" type="number" id="inline-bid-input"
              min="1" max="${myPoints}" placeholder="Min 1 pt"
              ${myPoints <= 0 ? 'disabled' : ''} />
          </div>
          <div class="flex gap-3">
            <button class="btn btn-gold w-full" id="inline-bid-submit" ${myPoints <= 0 ? 'disabled' : ''}>
              🔒 Lock In Bid
            </button>
            <button class="btn btn-ghost" id="inline-bid-pass" style="flex-shrink:0;">Pass</button>
          </div>
          ${myPoints <= 0 ? `<p class="text-danger text-xs text-center mt-2">You have no points left — you must pass.</p>` : ''}
        </div>
        <div class="bid-statuses">${bidChips}</div>
      `;
      setupInlineBidListeners(activeBid.playerId, myPoints);
    } else {
      // Spectator / admin view
      stage.innerHTML = `
        <div class="nominated-player-card">
          <div class="np-name">${escHtml(player.name || 'Unknown')}</div>
          ${player.position ? `<div class="np-pos">${escHtml(player.position)}</div>` : ''}
          ${player.info     ? `<div class="np-info">${escHtml(player.info)}</div>`     : ''}
        </div>
        ${timerHtml}
        <div class="text-muted text-sm">Captains are placing their blind bids…</div>
        <div class="bid-statuses">${bidChips}</div>
      `;
    }
    return;
  }

  // ---- REVEAL phase (shown briefly before overlay) ----
  if (phase === 'reveal') {
    stage.innerHTML = `
      <div style="font-size:2.5rem">🎲</div>
      <div style="font-size:1.1rem;font-weight:600;">Revealing bids…</div>
    `;
    return;
  }

  // ---- RESOLVING / COMPLETED ----
  if (phase === 'resolving' || phase === 'completed') {
    stage.innerHTML = `
      <div style="font-size:2.5rem">✅</div>
      <div style="font-size:1rem;color:var(--text-3);">Processing results…</div>
    `;
    return;
  }
}

function buildTimerHtml() {
  if (!draftState?.timerEndsAt && !draftState?.timerPaused) return '';
  const total   = (draftState.phase === 'pick' ? 30 : (roomMeta?.bidTimerSeconds || 60)) * 1000;
  let remaining = draftState.timerPaused
    ? (draftState.timeRemainingMs || 0)
    : Math.max(0, draftState.timerEndsAt - Date.now());

  const secs    = Math.ceil(remaining / 1000);
  const frac    = Math.min(1, remaining / total);
  const r = 52, circ = 2 * Math.PI * r;
  const offset = circ * (1 - frac);
  const cls     = secs <= 10 ? 'danger' : secs <= 20 ? 'warn' : '';
  const pausedClass = draftState.timerPaused ? 'paused' : '';

  return `
    <div class="timer-ring ${cls} ${pausedClass}" style="width:120px;height:120px;" id="timer-ring">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle class="timer-ring-bg"   cx="60" cy="60" r="${r}"/>
        <circle class="timer-ring-prog" cx="60" cy="60" r="${r}"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          id="timer-ring-prog"/>
      </svg>
      <div style="display:flex;flex-direction:column;align-items:center;z-index:1;">
        <div class="timer-ring-val" id="timer-ring-val">${secs}</div>
        <div class="timer-sub">${draftState.timerPaused ? '⏸ PAUSED' : 'SECONDS'}</div>
      </div>
    </div>
    ${draftState.timerPaused && draftState.pausedBecause
      ? `<div class="paused-msg">⚠️ Paused — waiting for ${escHtml(participants[draftState.pausedBecause]?.name || 'captain')} to reconnect</div>`
      : ''}
  `;
}

function updateTimerDisplay(secs, totalSecs) {
  const ring = document.getElementById('timer-ring');
  const val  = document.getElementById('timer-ring-val');
  const prog = document.getElementById('timer-ring-prog');
  if (!ring || !val || !prog) return;

  val.textContent = secs;
  const r = 52, circ = 2 * Math.PI * r;
  const frac = Math.min(1, secs / totalSecs);
  prog.style.strokeDashoffset = circ * (1 - frac);

  ring.classList.remove('danger','warn');
  if (secs <= 10) ring.classList.add('danger');
  else if (secs <= 20) ring.classList.add('warn');
}

function showPausedState() {
  const sub = document.querySelector('.timer-sub');
  const ring = document.getElementById('timer-ring');
  if (sub)  sub.textContent = '⏸ PAUSED';
  if (ring) ring.classList.add('paused');
}

// ---- Inline bid listeners (for bidding phase) ----
function setupInlineBidListeners(playerId, maxPoints) {
  const submitBtn = document.getElementById('inline-bid-submit');
  const passBtn   = document.getElementById('inline-bid-pass');
  const input     = document.getElementById('inline-bid-input');

  if (submitBtn) submitBtn.addEventListener('click', () => doSubmitBid(playerId, maxPoints));
  if (passBtn)   passBtn.addEventListener('click', () => doPassBid());
  if (input)     input.addEventListener('keypress', e => {
    if (e.key === 'Enter') doSubmitBid(playerId, maxPoints);
  });
}

// ============================================================
//  RENDER: POOL GRID
// ============================================================
function renderPoolGrid() {
  const grid   = document.getElementById('pool-grid');
  const query  = (document.getElementById('pool-search')?.value || '').toLowerCase();
  const phase  = draftState?.phase;
  const activeCaptainId = draftState?.turnOrder?.[draftState?.currentCaptainIndex];
  const amIActiveCaptain = activeCaptainId === myId;
  const isPickPhase = phase === 'pick';

  const entries = Object.entries(playerPool)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));

  const filtered = entries.filter(([, p]) => {
    if (!query) return true;
    return (p.name || '').toLowerCase().includes(query) ||
           (p.position || '').toLowerCase().includes(query);
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:var(--s8)">
      <div class="empty-state-icon">🔍</div>
      <p class="empty-state-text">No players match your search.</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(([pid, p]) => {
    const isDrafted = p.status === 'drafted';
    const isBidding = p.status === 'bidding';
    const clickable  = isPickPhase && amIActiveCaptain && !isDrafted && !isBidding;
    return `
      <div class="player-card ${isDrafted ? 'drafted' : ''} ${isBidding ? 'bidding' : ''} ${clickable ? 'fade-in' : ''}"
           id="pc-${pid}" data-pid="${pid}" ${clickable ? 'tabindex="0" role="button"' : ''}>
        <div class="pcard-name">${escHtml(p.name)}</div>
        ${p.position ? `<div class="pcard-pos">${escHtml(p.position)}</div>` : ''}
        ${p.info     ? `<div class="pcard-info">${escHtml(p.info)}</div>`     : ''}
        ${isDrafted  ? '' : ''}
      </div>
    `;
  }).join('');

  if (isPickPhase && amIActiveCaptain) {
    grid.querySelectorAll('[data-pid]').forEach(card => {
      const pid = card.dataset.pid;
      const p   = playerPool[pid];
      if (p?.status === 'available') {
        card.addEventListener('click', () => openBidModal(pid));
        card.addEventListener('keypress', e => { if (e.key === 'Enter') openBidModal(pid); });
      }
    });
  }
}

function updatePoolCount() {
  const available = Object.values(playerPool).filter(p => p.status === 'available').length;
  document.getElementById('pool-count-badge').textContent = `${available} left`;
}

// ============================================================
//  RENDER: CAPTAINS SIDEBAR
// ============================================================
function renderCaptainsSidebar() {
  const sidebar = document.getElementById('captains-sidebar');
  const turnOrder = draftState?.turnOrder || [];
  const activeCaptainId = draftState?.turnOrder?.[draftState?.currentCaptainIndex];

  const captains = turnOrder.map(uid => ({ uid, ...participants[uid] })).filter(c => c.role === 'captain');

  if (!captains.length) {
    sidebar.innerHTML = `<div class="text-dim text-sm text-center p-4">No captains yet.</div>`;
    return;
  }

  sidebar.innerHTML = captains.map((c, i) => {
    const isActive = c.uid === activeCaptainId;
    const isMe     = c.uid === myId;
    const pts      = c.points ?? roomMeta?.startingPoints ?? 100;
    const maxPts   = roomMeta?.startingPoints ?? 100;
    const pct      = Math.round((pts / maxPts) * 100);
    const team     = Array.isArray(c.team) ? c.team : [];
    const maxTeam  = roomMeta?.maxTeamSize ?? 5;
    const captainIdx = c.captainIndex ?? i;
    const style    = avatarStyle(captainIdx);

    // Team list
    const teamHtml = Array.from({ length: maxTeam }, (_, ti) => {
      const playerId = team[ti];
      const player   = playerId ? playerPool[playerId] : null;
      if (player) {
        return `<div class="sidebar-team-slot filled">
          <span class="truncate" style="max-width:120px;">${escHtml(player.name)}</span>
          <span class="st-pts">${player.draftedFor ?? '?'}pts</span>
        </div>`;
      }
      return `<div class="sidebar-team-slot" style="color:var(--text-4)">Slot ${ti+1}</div>`;
    }).join('');

    return `
      <div class="captain-card ${isActive ? 'active-turn' : ''} ${isMe ? 'is-me' : ''}">
        <div class="flex items-center gap-3 mb-3">
          <div class="avatar avatar-md" style="${style}">${initials(c.name || '?')}</div>
          <div style="flex:1;min-width:0;">
            <div class="truncate font-semibold text-sm">${escHtml(c.name || 'Captain')}
              ${isMe ? '<span class="badge badge-gold" style="font-size:.6rem;margin-left:4px;">You</span>' : ''}
            </div>
            ${isActive ? `<div class="badge badge-primary" style="font-size:.62rem;margin-top:2px;">🎯 Active</div>` : ''}
          </div>
          <div class="points-chip" style="font-size:.85rem;padding:4px 10px;">
            <span>⭐</span><span>${pts}</span>
          </div>
        </div>
        <div class="pts-bar">
          <div class="pts-fill ${pct < 20 ? 'low' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between text-xs text-muted mt-1 mb-3">
          <span>${pts} pts left</span>
          <span>${team.length}/${maxTeam} players</span>
        </div>
        <div class="team-list">${teamHtml}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
//  RENDER: DRAFT LOG
// ============================================================
function renderLog() {
  const logEl = document.getElementById('draft-log');
  if (!logEntries.length) {
    logEl.innerHTML = `<div class="empty-state" style="padding:var(--s6)"><p class="text-dim text-sm">Draft events will appear here.</p></div>`;
    return;
  }
  logEl.innerHTML = [...logEntries].reverse().map(entry => `
    <div class="log-entry ${entry.type}">
      <span class="text-dim" style="font-size:.7rem;">${formatTs(entry.timestamp)}</span>
      ${entry.message}
    </div>
  `).join('');
}

// ============================================================
//  PHASE BANNER
// ============================================================
function updatePhaseBanner() {
  const banner = document.getElementById('phase-banner');
  if (!draftState) return;

  const { phase, turnOrder, currentCaptainIndex } = draftState;
  const activeCaptainId = turnOrder?.[currentCaptainIndex];
  const captainName = participants[activeCaptainId]?.name || 'Captain';

  const labels = {
    pick:      `🎯 Pick Phase — ${escHtml(captainName)}'s Turn`,
    bidding:   `⭐ Blind Bidding`,
    reveal:    `🎲 Reveal!`,
    resolving: `✅ Resolving…`,
    completed: `🏁 Draft Complete`
  };
  banner.textContent = labels[phase] || phase;
  banner.className   = `phase-banner ${phase === 'bidding' ? 'bidding' : phase === 'reveal' ? 'reveal' : phase === 'completed' ? 'done' : 'pick'}`;
}

// ============================================================
//  BID MODAL (for nominating captain picking from pool)
// ============================================================
function openBidModal(playerId) {
  const player   = playerPool[playerId];
  if (!player) return;
  const myPoints = participants[myId]?.points ?? 0;

  pendingBidPlayerId = playerId;

  document.getElementById('bid-confirm-player-name').textContent = player.name;
  document.getElementById('bid-confirm-player-pos').textContent  = player.position || '';
  document.getElementById('bid-amount-input').value   = '';
  document.getElementById('bid-amount-input').max     = myPoints;
  document.getElementById('bid-max-display').textContent     = myPoints;
  document.getElementById('bid-balance-display').textContent  = myPoints;
  document.getElementById('bid-confirm-warning').classList.add('hidden');

  document.getElementById('bid-amount-input').removeEventListener('input', bidInputHandler);
  document.getElementById('bid-amount-input').addEventListener('input', bidInputHandler);

  openModal('modal-bid-confirm');
  setTimeout(() => document.getElementById('bid-amount-input').focus(), 200);
}

function bidInputHandler() {
  const input    = document.getElementById('bid-amount-input');
  const myPoints = participants[myId]?.points ?? 0;
  const val      = parseInt(input.value);
  const warn     = document.getElementById('bid-confirm-warning');
  if (val > myPoints) {
    warn.textContent = `⚠️ You only have ${myPoints} points.`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

async function handleBidSubmit() {
  const playerId = pendingBidPlayerId;
  if (!playerId) return;
  const amount   = parseInt(document.getElementById('bid-amount-input').value);
  const myPoints = participants[myId]?.points ?? 0;

  if (!amount || amount < 1) { showToast('Bid must be at least 1 point.', 'error'); return; }
  if (amount > myPoints)     { showToast(`You only have ${myPoints} points.`, 'error'); return; }

  const btn = document.getElementById('submit-bid-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Submitting…';

  try {
    closeModal('modal-bid-confirm');
    await nominateAndBid(playerId, amount);
  } catch(err) {
    console.error(err);
    showToast('Failed to place bid. Try again.', 'error');
    btn.disabled = false;
    btn.textContent = '🔒 Lock In Bid';
  }
}

// ============================================================
//  GAME ACTIONS
// ============================================================

// Called by the ACTIVE CAPTAIN who picked a player from the pool
async function nominateAndBid(playerId, bidAmount) {
  if (!draftState || draftState.phase !== 'pick') return;

  const turnOrder = draftState.turnOrder || [];

  // Initialize all bids — nominator is pre-submitted, others pending
  const bids = {};
  turnOrder.forEach(uid => {
    bids[uid] = uid === myId
      ? { amount: bidAmount, submitted: true, passed: false }
      : { amount: 0,         submitted: false, passed: false };
  });

  const timerEndsAt = Date.now() + (roomMeta.bidTimerSeconds * 1000);
  const logKey = db.ref(`rooms/${roomId}/log`).push().key;
  const player = playerPool[playerId];

  const updates = {};
  updates[`rooms/${roomId}/playerPool/${playerId}/status`] = 'bidding';
  updates[`rooms/${roomId}/draft/phase`]             = 'bidding';
  updates[`rooms/${roomId}/draft/timerEndsAt`]       = timerEndsAt;
  updates[`rooms/${roomId}/draft/timerPaused`]       = false;
  updates[`rooms/${roomId}/draft/activeBid`]         = { playerId, nominatedBy: myId, bids };
  updates[`rooms/${roomId}/log/${logKey}`] = {
    type: 'nomination',
    captainName: myName,
    playerName: player?.name || 'Unknown',
    message: `🎯 <strong>${escHtml(myName)}</strong> nominated <strong>${escHtml(player?.name || 'Unknown')}</strong>`,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };

  await db.ref().update(updates);
  showToast(`Your bid is locked in! Waiting for others…`, 'gold');
}

// Called by OTHER captains during bidding phase
async function doSubmitBid(playerId, maxPoints) {
  const input = document.getElementById('inline-bid-input');
  if (!input) return;
  const amount = parseInt(input.value);

  if (!amount || amount < 1)    { showToast('Bid must be at least 1 point.', 'error'); return; }
  if (amount > maxPoints)       { showToast(`You only have ${maxPoints} points.`, 'error'); return; }

  const btn = document.getElementById('inline-bid-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Locking…'; }

  try {
    await db.ref(`rooms/${roomId}/draft/activeBid/bids/${myId}`).update({
      amount, submitted: true, passed: false
    });
    showToast('Your blind bid is locked in!', 'gold');
    await checkAllBidsIn();
  } catch(err) {
    console.error(err);
    showToast('Failed to submit bid. Try again.', 'error');
  }
}

async function doPassBid() {
  try {
    await db.ref(`rooms/${roomId}/draft/activeBid/bids/${myId}`).update({
      amount: 0, submitted: false, passed: true
    });
    showToast('You passed on this player.', 'info');
    await checkAllBidsIn();
  } catch(err) {
    console.error(err);
    showToast('Failed to pass. Try again.', 'error');
  }
}

// Check if all captains have bid or passed; if so, advance to reveal
async function checkAllBidsIn() {
  const snap = await db.ref(`rooms/${roomId}/draft/activeBid/bids`).once('value');
  const bids = snap.val() || {};
  const allDone = Object.values(bids).every(b => b.submitted || b.passed);
  if (allDone) {
    try {
      await db.ref(`rooms/${roomId}/draft`).transaction(draft => {
        if (!draft || draft.phase !== 'bidding') return;
        draft.phase = 'reveal';
        return draft;
      });
    } catch(e) { /* another client handled it */ }
  }
}

// ============================================================
//  REVEAL OVERLAY
// ============================================================
function showRevealOverlay() {
  if (!draftState?.activeBid) return;
  const { playerId, nominatedBy, bids } = draftState.activeBid;
  const player = playerPool[playerId] || {};

  // Determine winner
  const { winnerId, winAmount } = computeWinner(bids, nominatedBy);

  // Build card data
  const turnOrder = draftState.turnOrder || [];
  const cardData  = turnOrder.map(uid => ({
    uid,
    name:    participants[uid]?.name || 'Captain',
    amount:  bids[uid]?.amount ?? 0,
    passed:  bids[uid]?.passed ?? false,
    winner:  uid === winnerId
  }));

  // Render overlay
  document.getElementById('reveal-player-name').textContent = `🃏 Player: ${player.name || 'Unknown'}`;
  document.getElementById('reveal-cards-wrap').innerHTML = cardData.map((c, i) => `
    <div class="rev-card" id="rcard-${i}">
      <div class="rev-card-inner">
        <div class="rev-card-front">
          <div style="font-size:2rem;">🔒</div>
          <div class="rev-captain-name">${escHtml(c.name)}</div>
        </div>
        <div class="rev-card-back ${c.winner ? 'winner' : ''} ${c.passed ? 'passed' : ''}">
          <div class="rev-captain-name">${escHtml(c.name)}</div>
          ${c.passed
            ? `<div class="rev-passed-label">PASS</div>`
            : `<div class="rev-bid-amount ${c.winner ? 'winner-amt' : ''}">${c.amount}</div>
               <div style="font-size:.7rem;color:var(--text-3)">pts</div>`
          }
          ${c.winner ? `<div class="rev-winner-label">👑 WINNER</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  document.getElementById('reveal-winner-banner').classList.add('hidden');
  document.getElementById('bid-reveal-overlay').classList.add('active');

  // Flip cards one by one
  cardData.forEach((_, i) => {
    setTimeout(() => {
      document.getElementById(`rcard-${i}`)?.classList.add('flipped');
    }, 600 + i * 400);
  });

  // Show winner banner after all cards flipped
  const flipTime = 600 + cardData.length * 400 + 400;
  setTimeout(() => {
    const winnerName = participants[winnerId]?.name || 'Unknown';
    const winnerEl   = document.getElementById('reveal-winner-banner');
    document.getElementById('reveal-winner-name').textContent = `🏆 ${winnerName} wins!`;
    document.getElementById('reveal-winner-detail').innerHTML =
      `<span class="winner-player">${escHtml(player.name || 'Unknown')}</span> for <span class="winner-pts">${winAmount} pts</span>`;
    winnerEl.classList.remove('hidden');
    // Trigger resolution (first client to run transaction wins)
    resolveRound(winnerId, winAmount, playerId);
  }, flipTime);

  // Auto-close overlay after some time
  setTimeout(() => {
    document.getElementById('bid-reveal-overlay').classList.remove('active');
  }, flipTime + 3500);
}

function computeWinner(bids, nominatedBy) {
  let winnerId  = nominatedBy;
  let winAmount = bids[nominatedBy]?.amount ?? 0;

  Object.entries(bids).forEach(([uid, bid]) => {
    if (!bid.passed && bid.submitted) {
      if (bid.amount > winAmount) {
        winAmount = bid.amount;
        winnerId  = uid;
      }
      // tie goes to nominator — keep current winner
    }
  });
  return { winnerId, winAmount };
}

// ============================================================
//  RESOLVE ROUND (atomic, first-client-wins via transaction)
// ============================================================
async function resolveRound(winnerId, winAmount, playerId) {
  if (isResolving) return;

  // Acquire resolution lock
  let capturedDraft = null;
  const txResult = await db.ref(`rooms/${roomId}/draft`).transaction(draft => {
    if (!draft || draft.phase !== 'reveal') return; // already resolved
    capturedDraft = JSON.parse(JSON.stringify(draft));
    draft.phase = 'resolving';
    return draft;
  });

  if (!txResult.committed) return; // Another client handled it
  isResolving = true;

  try {
    const winner  = participants[winnerId];
    const player  = playerPool[playerId];
    const oldTeam = Array.isArray(winner?.team) ? winner.team : [];
    const newTeam = [...oldTeam, playerId];
    const newPts  = (winner?.points ?? 0) - winAmount;

    // Check if draft ends
    const draft    = capturedDraft;
    const turnOrder = draft.turnOrder || [];
    const nextIdx  = (draft.currentCaptainIndex + 1) % turnOrder.length;

    // Build updated captains to check completion
    const updatedParts = { ...participants, [winnerId]: { ...winner, team: newTeam, points: newPts } };
    const allCaptains  = turnOrder.map(uid => updatedParts[uid]).filter(p => p?.role === 'captain');
    const draftComplete= allCaptains.every(c => (c?.team || []).length >= (roomMeta?.maxTeamSize ?? 5));

    const logKey = db.ref(`rooms/${roomId}/log`).push().key;
    const updates = {};

    updates[`rooms/${roomId}/playerPool/${playerId}/status`]    = 'drafted';
    updates[`rooms/${roomId}/playerPool/${playerId}/draftedBy`] = winnerId;
    updates[`rooms/${roomId}/playerPool/${playerId}/draftedFor`]= winAmount;
    updates[`rooms/${roomId}/participants/${winnerId}/points`]   = newPts;
    updates[`rooms/${roomId}/participants/${winnerId}/team`]     = newTeam;
    updates[`rooms/${roomId}/log/${logKey}`] = {
      type: 'win',
      winnerId,
      winnerName: winner?.name || 'Unknown',
      playerName: player?.name || 'Unknown',
      amount: winAmount,
      message: `🏆 <strong>${escHtml(winner?.name || '?')}</strong> wins <strong>${escHtml(player?.name || '?')}</strong> for <strong>${winAmount} pts</strong>!`,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    if (draftComplete) {
      const endLogKey = db.ref(`rooms/${roomId}/log`).push().key;
      updates[`rooms/${roomId}/meta/status`] = 'completed';
      updates[`rooms/${roomId}/draft/phase`] = 'completed';
      updates[`rooms/${roomId}/log/${endLogKey}`] = {
        type: 'system',
        message: '🏁 Draft complete! All rosters are full.',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      };
    } else {
      updates[`rooms/${roomId}/draft/phase`]               = 'pick';
      updates[`rooms/${roomId}/draft/currentCaptainIndex`] = nextIdx;
      updates[`rooms/${roomId}/draft/activeBid`]           = null;
      updates[`rooms/${roomId}/draft/timerEndsAt`]         = Date.now() + 30000;
      updates[`rooms/${roomId}/draft/timerPaused`]         = false;
      updates[`rooms/${roomId}/draft/timeRemainingMs`]     = null;
      updates[`rooms/${roomId}/draft/pausedBecause`]       = null;
      if (nextIdx === 0) {
        updates[`rooms/${roomId}/draft/round`] = (draft.round || 1) + 1;
      }
    }

    await db.ref().update(updates);
  } catch(err) {
    console.error('resolveRound error:', err);
  } finally {
    isResolving = false;
  }
}
// ============================================================
//  ACTIONS
// ============================================================
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

async function resetDraft() {
  if (myRole !== 'admin') return;
  if (!confirm('Are you sure you want to reset the draft? All progress will be lost and you will return to the lobby.')) return;
  
  try {
    const updates = {};
    
    // 1. Reset room status
    updates[`rooms/${roomId}/meta/status`] = 'lobby';
    
    // 2. Clear draft node
    updates[`rooms/${roomId}/draft`] = null;
    
    // 3. Reset player pool status to available
    Object.keys(playerPool).forEach(pid => {
      updates[`rooms/${roomId}/playerPool/${pid}/status`] = 'available';
    });
    
    // 4. Reset participants
    Object.keys(participants).forEach(uid => {
      updates[`rooms/${roomId}/participants/${uid}/team`] = null;
      updates[`rooms/${roomId}/participants/${uid}/points`] = roomMeta.startingPoints || 100;
    });
    
    await db.ref().update(updates);
    // Listeners will redirect everyone automatically
  } catch(e) {
    console.error(e);
    showToast('Failed to reset draft.', 'error');
  }
}
