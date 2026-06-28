// ============================================================
//  INDEX PAGE — Landing (Create / Join Room)
// ============================================================
onReady(async () => {
  // Check for existing active session and redirect
  const session = loadSession();
  if (session && session.roomId) {
    // Verify room still exists
    try {
      const snap = await db.ref(`rooms/${session.roomId}/meta`).once('value');
      if (snap.exists()) {
        const status = snap.val().status;
        if (status === 'drafting') {
          window.location.href = `draft.html?room=${session.roomId}`;
          return;
        } else if (status === 'completed') {
          window.location.href = `results.html?room=${session.roomId}`;
          return;
        } else {
          window.location.href = `lobby.html?room=${session.roomId}`;
          return;
        }
      }
    } catch(e) { /* no valid session */ }
  }

  initConnectionBanner();

  // ---- Open / close modals ----
  const openCreate = () => openModal('modal-create');
  const openJoin   = () => openModal('modal-join');

  document.getElementById('btn-admin-card').addEventListener('click', openCreate);
  document.getElementById('btn-admin-card').addEventListener('keypress', e => e.key === 'Enter' && openCreate());
  document.getElementById('btn-join-card').addEventListener('click', openJoin);
  document.getElementById('btn-join-card').addEventListener('keypress', e => e.key === 'Enter' && openJoin());

  document.getElementById('close-create').addEventListener('click', () => closeModal('modal-create'));
  document.getElementById('cancel-create').addEventListener('click', () => closeModal('modal-create'));
  document.getElementById('close-join').addEventListener('click', () => closeModal('modal-join'));
  document.getElementById('cancel-join').addEventListener('click', () => closeModal('modal-join'));

  // Close on backdrop click
  ['modal-create', 'modal-join'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
      if (e.target === this) closeModal(id);
    });
  });

  // Uppercase invite code as typed
  const codeInput = document.getElementById('input-invite-code');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  // ---- Create Room ----
  document.getElementById('submit-create').addEventListener('click', handleCreateRoom);
  document.getElementById('input-admin-name').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleCreateRoom();
  });

  async function handleCreateRoom() {
    const nameInput = document.getElementById('input-admin-name');
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); showToast('Please enter your name.', 'error'); return; }

    const btn = document.getElementById('submit-create');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
      const user = await ensureAuth();
      saveSession({ adminId: user.uid, adminName: name });
      window.location.href = 'admin-setup.html';
    } catch(err) {
      console.error(err);
      showToast('Authentication failed. Check your internet connection.', 'error');
      btn.disabled = false;
      btn.textContent = 'Continue Setup →';
    }
  }

  // ---- Join Room ----
  document.getElementById('submit-join').addEventListener('click', handleJoinRoom);
  document.getElementById('input-join-name').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleJoinRoom();
  });
  codeInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('input-join-name').focus();
  });

  async function handleJoinRoom() {
    const code = codeInput.value.trim().toUpperCase();
    const name = document.getElementById('input-join-name').value.trim();

    if (!code || code.length !== 6) { codeInput.focus(); showToast('Enter a 6-character invite code.', 'error'); return; }
    if (!name) { document.getElementById('input-join-name').focus(); showToast('Please enter your name.', 'error'); return; }

    const btn = document.getElementById('submit-join');
    btn.disabled = true;
    btn.textContent = 'Joining...';

    try {
      const user = await ensureAuth();

      // Find room by invite code
      const snap = await db.ref('rooms').orderByChild('meta/inviteCode').equalTo(code).limitToFirst(1).once('value');
      if (!snap.exists()) {
        showToast('Room not found. Check the invite code.', 'error');
        btn.disabled = false;
        btn.textContent = 'Join Room →';
        return;
      }

      let roomId, roomMeta;
      snap.forEach(child => { roomId = child.key; roomMeta = child.val().meta; });

      if (roomMeta.status === 'completed') {
        showToast('This draft has already ended.', 'error');
        btn.disabled = false;
        btn.textContent = 'Join Room →';
        return;
      }

      // Register participant
      const participantRef = db.ref(`rooms/${roomId}/participants/${user.uid}`);
      const existing = await participantRef.once('value');
      if (!existing.exists()) {
        await participantRef.set({
          name,
          role: 'spectator',
          captainIndex: -1,
          points: roomMeta.startingPoints || 100,
          team: [],
          joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
      } else {
        // Update name in case they changed it
        await participantRef.update({ name });
      }

      saveSession({
        roomId,
        userId: user.uid,
        userName: name,
        role: existing.exists() ? existing.val().role : 'spectator'
      });

      // Redirect based on room status
      if (roomMeta.status === 'drafting') {
        window.location.href = `draft.html?room=${roomId}`;
      } else {
        window.location.href = `lobby.html?room=${roomId}`;
      }

    } catch(err) {
      console.error(err);
      showToast('Error joining room. Please try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Join Room →';
    }
  }
});
