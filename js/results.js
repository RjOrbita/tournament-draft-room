// ============================================================
//  RESULTS PAGE
// ============================================================

onReady(async () => {
  const params  = new URLSearchParams(window.location.search);
  const session = loadSession();
  const roomId  = params.get('room') || session?.roomId;

  if (!roomId) { window.location.href = 'index.html'; return; }

  try {
    await ensureAuth();

    const [metaSnap, partsSnap, poolSnap] = await Promise.all([
      db.ref(`rooms/${roomId}/meta`).once('value'),
      db.ref(`rooms/${roomId}/participants`).once('value'),
      db.ref(`rooms/${roomId}/playerPool`).once('value')
    ]);

    if (!metaSnap.exists()) { window.location.href = 'index.html'; return; }

    const meta         = metaSnap.val();
    const participants = partsSnap.val() || {};
    const playerPool   = poolSnap.val()  || {};

    document.getElementById('nav-room-name').textContent = meta.roomName;
    document.getElementById('results-subtitle').textContent =
      `${meta.roomName} · ${new Date().toLocaleDateString()} · ${meta.numCaptains} captains`;

    // Build captain data
    const captains = (meta.turnOrderSnapshot || Object.keys(participants))
      .map(uid => ({ uid, ...participants[uid] }))
      .filter(c => c.role === 'captain')
      .sort((a, b) => (a.captainIndex ?? 0) - (b.captainIndex ?? 0));

    // Compute stats per captain
    const captainStats = captains.map(c => {
      const team = Array.isArray(c.team) ? c.team : [];
      const totalSpent = team.reduce((sum, pid) => sum + (playerPool[pid]?.draftedFor ?? 0), 0);
      return { ...c, team, totalSpent, ptsRemaining: c.points ?? 0 };
    });

    // Podium (sort by team size first, then points spent desc)
    const podiumCaptains = [...captainStats]
      .sort((a, b) => b.team.length - a.team.length || b.totalSpent - a.totalSpent)
      .slice(0, 3);

    renderPodium(podiumCaptains);
    renderRosters(captainStats, playerPool);

    // Export
    document.getElementById('btn-export').addEventListener('click', () => exportResults(meta, captainStats, playerPool));

  } catch(err) {
    console.error(err);
    showToast('Failed to load results.', 'error');
  }
});

// ---- Podium ----
function renderPodium(captains) {
  if (!captains.length) return;
  const section = document.getElementById('podium-section');

  const medals = ['🥇', '🥈', '🥉'];
  const order  = [1, 0, 2]; // center = 1st place

  const reordered = [captains[1], captains[0], captains[2]].filter(Boolean);

  section.innerHTML = `
    <h2 style="font-size:1.4rem;margin-bottom:var(--s8);text-align:center;">🏅 Top Captains</h2>
    <div class="podium">
      ${reordered.map((c, i) => {
        const rank = i === 1 ? 0 : i === 0 ? 1 : 2; // original rank
        const placeClass = rank === 0 ? 'p1' : rank === 1 ? 'p2' : 'p3';
        const style = avatarStyle(c.captainIndex ?? rank);
        return `
          <div class="podium-place ${placeClass}">
            <div class="podium-block">${medals[rank]}</div>
            <div class="avatar avatar-lg" style="${style}">${initials(c.name)}</div>
            <div class="font-semibold text-sm text-center" style="max-width:100px;">${escHtml(c.name)}</div>
            <div class="points-chip" style="font-size:.8rem;">${c.totalSpent} pts spent</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ---- Roster Cards ----
function renderRosters(captains, playerPool) {
  const grid = document.getElementById('results-grid');

  grid.innerHTML = captains.map((c, i) => {
    const style = avatarStyle(c.captainIndex ?? i);
    const team  = c.team || [];

    const teamRows = team.map((pid, ti) => {
      const p = playerPool[pid] || {};
      return `
        <div class="player-result-item">
          <div class="pri-num">${ti + 1}</div>
          <div style="flex:1;">
            <div class="pri-name">${escHtml(p.name || 'Unknown')}</div>
            ${p.position ? `<div class="pri-pos">${escHtml(p.position)}</div>` : ''}
          </div>
          <div class="pri-pts">${p.draftedFor ?? '?'} pts</div>
        </div>
      `;
    }).join('');

    const ptsRemaining = c.points ?? 0;
    const pctUsed = c.totalSpent > 0
      ? Math.round((c.totalSpent / (c.totalSpent + ptsRemaining)) * 100)
      : 0;

    return `
      <div class="result-captain-card" style="animation-delay:${i * 0.1}s">
        <div class="result-captain-header">
          <div class="avatar avatar-md" style="${style}">${initials(c.name)}</div>
          <div style="flex:1;">
            <div class="font-semibold">${escHtml(c.name)}</div>
            <div class="text-xs text-muted">Captain ${(c.captainIndex ?? i) + 1}</div>
          </div>
          <div class="points-chip" style="font-size:.8rem;">${c.totalSpent} pts spent</div>
        </div>
        <div class="result-captain-body">
          <!-- Stats row -->
          <div class="flex gap-3 mb-3">
            <div class="stat-box" style="flex:1;">
              <div class="stat-val text-gold">${c.totalSpent}</div>
              <div class="stat-lbl">Points Spent</div>
            </div>
            <div class="stat-box" style="flex:1;">
              <div class="stat-val text-success">${ptsRemaining}</div>
              <div class="stat-lbl">Points Left</div>
            </div>
            <div class="stat-box" style="flex:1;">
              <div class="stat-val">${team.length}</div>
              <div class="stat-lbl">Players</div>
            </div>
          </div>
          <!-- Points bar -->
          <div class="pts-bar mb-3">
            <div class="pts-fill" style="width:${pctUsed}%"></div>
          </div>
          <!-- Team list -->
          <div class="flex flex-col gap-2">
            ${teamRows || '<div class="text-dim text-sm text-center p-4">No players drafted.</div>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---- Export ----
function exportResults(meta, captains, playerPool) {
  let csv = `Tournament Draft Results: ${meta.roomName}\n\n`;

  captains.forEach(c => {
    csv += `Captain: ${c.name}\n`;
    csv += `Points Spent: ${c.totalSpent} | Points Remaining: ${c.points ?? 0}\n`;
    csv += `#,Player,Position,Points Paid\n`;
    (c.team || []).forEach((pid, i) => {
      const p = playerPool[pid] || {};
      csv += `${i+1},"${p.name || ''}","${p.position || ''}",${p.draftedFor ?? 0}\n`;
    });
    csv += '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `draft-results-${meta.roomName.replace(/\s+/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Results exported!', 'success');
}
