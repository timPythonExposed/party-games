/* ===== Hints app – client-side JS ===== */

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  LS.set('hints.theme', theme);
}

(function initTheme() {
  const saved = LS.get('hints.theme', 'dark');
  applyTheme(saved);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = LS.get('hints.theme', 'dark');
      const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
      applyTheme(next);
    });
  }
})();

// Text scale
(function initTextScale() {
  const saved = LS.get('hints.textScale', 'normal');
  document.documentElement.setAttribute('data-text-scale', saved);
})();

// ---------------------------------------------------------------------------
// Timer class
// ---------------------------------------------------------------------------
class Timer {
  constructor(durationSec, onTick, onDone) {
    this.duration = durationSec;
    this.remaining = durationSec;
    this.onTick = onTick;
    this.onDone = onDone;
    this._raf = null;
    this._start = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._start = performance.now() - (this.duration - this.remaining) * 1000;
    this._tick();
  }

  _tick() {
    if (!this._running) return;
    const elapsed = (performance.now() - this._start) / 1000;
    this.remaining = Math.max(0, this.duration - elapsed);
    this.onTick(this.remaining, this.duration);
    if (this.remaining <= 0) {
      this._running = false;
      this.onDone();
      return;
    }
    this._raf = requestAnimationFrame(() => this._tick());
  }

  pause() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  reset(newDuration) {
    this.pause();
    if (newDuration !== undefined) this.duration = newDuration;
    this.remaining = this.duration;
    this.onTick(this.remaining, this.duration);
  }
}

// ---------------------------------------------------------------------------
// Time-up sound – loud "sad trombone" wah-wah-wah-wahhh
// ---------------------------------------------------------------------------
function playTimeUpSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Compressor to maximize perceived loudness without clipping
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.1;
    compressor.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(compressor);

    // Sad trombone: Bb4 -> A4 -> Ab4 -> G4 (long slide down)
    const notes = [
      { freq: 466, start: 0,    dur: 0.35 },
      { freq: 440, start: 0.4,  dur: 0.35 },
      { freq: 415, start: 0.8,  dur: 0.35 },
      { freq: 392, start: 1.2,  dur: 0.8  },
    ];

    notes.forEach(({ freq, start, dur }) => {
      // Main tone (sawtooth for brassy timbre)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      // Slide the last note down for comedic droop
      if (dur > 0.5) {
        osc.frequency.linearRampToValueAtTime(freq * 0.85, ctx.currentTime + start + dur);
      }

      // Second oscillator, slightly detuned, for fatness
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(freq * 1.005, ctx.currentTime + start);
      if (dur > 0.5) {
        osc2.frequency.linearRampToValueAtTime(freq * 0.85 * 1.005, ctx.currentTime + start + dur);
      }

      // Vibrato (wobble) for trombone "wah" feel
      const vibrato = ctx.createOscillator();
      const vibratoGain = ctx.createGain();
      vibrato.frequency.value = 6;
      vibratoGain.gain.value = freq * 0.025;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);
      vibratoGain.connect(osc2.frequency);
      vibrato.start(ctx.currentTime + start);
      vibrato.stop(ctx.currentTime + start + dur + 0.1);

      // Envelope
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, ctx.currentTime + start);
      g.gain.setValueAtTime(1.0, ctx.currentTime + start + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);

      osc.connect(g);
      osc2.connect(g);
      g.connect(master);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
      osc2.start(ctx.currentTime + start);
      osc2.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Play page initialisation
// ---------------------------------------------------------------------------
function initPlay() {
  const timerBar     = document.getElementById('timerBar');
  const timerDisplay = document.getElementById('timerDisplay');
  const wordEl       = document.getElementById('word');
  const nextBtn      = document.getElementById('nextBtn');
  const resetTimerBtn= document.getElementById('resetTimerBtn');
  const timeUpOverlay= document.getElementById('timeUpOverlay');
  const emptyOverlay = document.getElementById('emptyOverlay');
  const overlayNextBtn  = document.getElementById('overlayNextBtn');
  const overlayCloseBtn = document.getElementById('overlayCloseBtn');
  const emptyResetBtn   = document.getElementById('emptyResetBtn');
  const toast        = document.getElementById('toast');
  const categoryBadge = document.getElementById('categoryBadge');

  const timerSec = LS.get('hints.timerSeconds', 60);
  const noTimer = timerSec === 0;

  // Hide timer UI when timer is disabled
  if (noTimer) {
    timerBar.parentElement.hidden = true;
    timerDisplay.hidden = true;
    resetTimerBtn.hidden = true;
  }

  function onTick(remaining, total) {
    if (noTimer) return;
    const secs = Math.ceil(remaining);
    timerDisplay.textContent = secs;
    const pct = remaining / total;
    timerBar.style.width = (pct * 100) + '%';
    timerBar.classList.toggle('warning', pct <= 0.3 && pct > 0.1);
    timerBar.classList.toggle('danger', pct <= 0.1);
  }

  function onDone() {
    if (noTimer) return;
    playTimeUpSound();
    try { navigator.vibrate([300, 100, 300, 100, 500]); } catch {}
    timeUpOverlay.hidden = false;
  }

  const timer = noTimer ? null : new Timer(timerSec, onTick, onDone);
  if (!noTimer) onTick(timerSec, timerSec);   // initial render

  // -- Fetch next word --
  async function fetchNext() {
    try {
      const res = await fetch('/next', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) {
        emptyOverlay.hidden = false;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij ophalen woord');
        return;
      }
      const data = await res.json();
      wordEl.textContent = data.word;
      wordEl.classList.remove('fade-in');
      // trigger reflow for re-animation
      void wordEl.offsetWidth;
      wordEl.classList.add('fade-in');

      // Show category badge for Pictionary
      if (data.category && categoryBadge) {
        categoryBadge.textContent = data.category;
        categoryBadge.style.backgroundColor = data.category_color || '#4F46E5';
        categoryBadge.hidden = false;
      } else if (categoryBadge) {
        categoryBadge.hidden = true;
      }

      if (timer) {
        timer.reset(LS.get('hints.timerSeconds', 60));
        timer.start();
      }
      timeUpOverlay.hidden = true;
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  // -- Reset words --
  async function resetWords() {
    try {
      await fetch('/reset_used', { method: 'POST', credentials: 'same-origin' });
      emptyOverlay.hidden = true;
      showToast('Woorden gereset');
    } catch {}
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  // -- Event listeners --
  nextBtn.addEventListener('click', fetchNext);
  resetTimerBtn.addEventListener('click', () => {
    if (timer) {
      timer.reset(LS.get('hints.timerSeconds', 60));
      onTick(timer.remaining, timer.duration);
    }
    timeUpOverlay.hidden = true;
  });
  overlayNextBtn.addEventListener('click', fetchNext);
  overlayCloseBtn.addEventListener('click', () => { timeUpOverlay.hidden = true; });
  emptyResetBtn.addEventListener('click', async () => {
    await resetWords();
    fetchNext();
  });

  // -- Shake to next (mobile) --
  let lastShake = 0;
  window.addEventListener('devicemotion', (e) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const force = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
    if (force > 35 && Date.now() - lastShake > 1000) {
      lastShake = Date.now();
      fetchNext();
    }
  });

  // -- Fullscreen toggle (double-tap on word) --
  let lastTap = 0;
  wordEl.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    lastTap = now;
  });
}

// ---------------------------------------------------------------------------
// Settings page initialisation
// ---------------------------------------------------------------------------
function initSettings() {
  const timerRadios    = document.querySelectorAll('input[name="timer"]');
  const textRadios     = document.querySelectorAll('input[name="textScale"]');
  const themeRadios    = document.querySelectorAll('input[name="theme"]');
  const saveBtn        = document.getElementById('saveSettingsBtn');

  // Restore saved values
  const savedTimer = LS.get('hints.timerSeconds', 60);
  const savedScale = LS.get('hints.textScale', 'normal');
  const savedTheme = LS.get('hints.theme', 'dark');

  timerRadios.forEach(r => { if (parseInt(r.value) === savedTimer) r.checked = true; });
  textRadios.forEach(r => { if (r.value === savedScale) r.checked = true; });
  themeRadios.forEach(r => { if (r.value === savedTheme) r.checked = true; });

  saveBtn.addEventListener('click', () => {
    const timer = parseInt(document.querySelector('input[name="timer"]:checked').value);
    const scale = document.querySelector('input[name="textScale"]:checked').value;
    const theme = document.querySelector('input[name="theme"]:checked').value;

    LS.set('hints.timerSeconds', timer);
    LS.set('hints.textScale', scale);
    LS.set('hints.theme', theme);

    applyTheme(theme);
    document.documentElement.setAttribute('data-text-scale', scale);

    window.location.href = '/play';
  });
}

// ---------------------------------------------------------------------------
// GTY Setup page
// ---------------------------------------------------------------------------
function initGtySetup() {
  const container = document.getElementById('teamNamesContainer');
  const radios = document.querySelectorAll('input[name="num_teams"]');

  function renderTeamInputs(count) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const div = document.createElement('div');
      div.className = 'gty-team-input';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `team_${i}`;
      input.placeholder = `Team ${i + 1}`;
      input.className = 'text-input';
      div.appendChild(input);
      container.appendChild(div);
    }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      renderTeamInputs(parseInt(r.value));
    });
  });

  // Rounds to win: custom field <-> radio interaction
  const roundsRadios = document.querySelectorAll('input[name="rounds_to_win"]');
  const roundsCustom = document.getElementById('roundsCustom');

  if (roundsCustom) {
    roundsCustom.addEventListener('input', () => {
      if (roundsCustom.value) {
        roundsRadios.forEach(r => { r.checked = false; });
      }
    });
    roundsRadios.forEach(r => {
      r.addEventListener('change', () => {
        roundsCustom.value = '';
      });
    });
  }
}

// ---------------------------------------------------------------------------
// GTY Play page
// ---------------------------------------------------------------------------
function initGtyPlay() {
  const scoreboard     = document.getElementById('scoreboard');
  const yearTimelines  = document.getElementById('yearTimelines');
  const jetonButtons   = document.getElementById('jetonButtons');
  const roundDisplay   = document.getElementById('roundDisplay');
  const songSection    = document.getElementById('songSection');
  const qrContainer    = document.getElementById('qrContainer');
  const qrPlaceholder  = document.getElementById('qrPlaceholder');
  const qrImage        = document.getElementById('qrImage');
  const songLinks      = document.getElementById('songLinks');
  const youtubeLink    = document.getElementById('youtubeLink');
  const revealSection  = document.getElementById('revealSection');
  const revealYear     = document.getElementById('revealYear');
  const revealInfo     = document.getElementById('revealInfo');
  const nextSongBtn    = document.getElementById('nextSongBtn');
  const revealBtn      = document.getElementById('revealBtn');
  const undoBtn        = document.getElementById('undoBtn');
  const awardButtons   = document.getElementById('awardButtons');
  const winnerOverlay  = document.getElementById('winnerOverlay');
  const winnerText     = document.getElementById('winnerText');
  const emptyOverlay   = document.getElementById('emptyOverlay');
  const toast          = document.getElementById('toast');

  // Cache rounds_to_win so we don't need extra state fetches
  let cachedRoundsToWin = 5;

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function updateScoreboard(teamNames, scores, roundsToWin, jetons) {
    if (roundsToWin !== undefined) cachedRoundsToWin = roundsToWin;
    scoreboard.innerHTML = '';
    teamNames.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'gty-team-card';
      const jetonCount = (jetons && jetons[i]) || 0;
      const jetonHtml = jetonCount > 0
        ? `<div class="gty-jeton-count">${jetonCount} jeton${jetonCount !== 1 ? 's' : ''}</div>`
        : '';
      card.innerHTML = `<div class="gty-team-name">${name}</div><div class="gty-team-score">${scores[i]} / ${cachedRoundsToWin}</div>${jetonHtml}`;
      scoreboard.appendChild(card);
    });
  }

  function updateTimelines(teamNames, teamYears) {
    yearTimelines.innerHTML = '';
    if (!teamYears) return;
    teamNames.forEach((name, i) => {
      const years = teamYears[i] || [];
      if (years.length === 0) return;
      const row = document.createElement('div');
      row.className = 'gty-timeline';
      const label = document.createElement('span');
      label.className = 'gty-timeline-label';
      label.textContent = name;
      row.appendChild(label);
      const badges = document.createElement('span');
      badges.className = 'gty-timeline-badges';
      years.forEach(y => {
        const badge = document.createElement('span');
        badge.className = 'gty-year-badge';
        badge.textContent = y;
        badges.appendChild(badge);
      });
      row.appendChild(badges);
      yearTimelines.appendChild(row);
    });
  }

  function updateJetonButtons(teamNames, jetons) {
    jetonButtons.innerHTML = '';
    teamNames.forEach((name, i) => {
      const group = document.createElement('div');
      group.className = 'gty-jeton-group';

      const label = document.createElement('span');
      label.className = 'gty-jeton-label';
      label.textContent = name;
      group.appendChild(label);

      const addBtn = document.createElement('button');
      addBtn.className = 'btn gty-jeton-btn gty-jeton-btn--add';
      addBtn.textContent = '+Jeton';
      addBtn.addEventListener('click', () => changeJeton(i, 'add'));
      group.appendChild(addBtn);

      const useBtn = document.createElement('button');
      useBtn.className = 'btn gty-jeton-btn gty-jeton-btn--use';
      useBtn.textContent = '\u2212Jeton';
      useBtn.disabled = !jetons || jetons[i] <= 0;
      useBtn.addEventListener('click', () => changeJeton(i, 'use'));
      group.appendChild(useBtn);

      jetonButtons.appendChild(group);
    });
  }

  function updateAwardButtons(teamNames, enabled) {
    awardButtons.innerHTML = '';
    teamNames.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn gty-btn-award';
      btn.textContent = `Punt voor ${name}`;
      btn.disabled = !enabled;
      btn.addEventListener('click', () => awardPoint(i));
      awardButtons.appendChild(btn);
    });
  }

  // Shared helper to apply full state from response data
  function applyFullState(data) {
    updateScoreboard(data.team_names, data.scores, data.rounds_to_win, data.jetons);
    updateTimelines(data.team_names, data.team_years);
    updateJetonButtons(data.team_names, data.jetons);
  }

  // Fetch initial state on page load
  async function fetchState() {
    try {
      const res = await fetch('/gty/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      applyFullState(data);
      updateAwardButtons(data.team_names, data.revealed);
      if (data.round_number > 0) {
        roundDisplay.textContent = `Ronde ${data.round_number}`;
      }
      if (data.qr_url || data.youtube_link) {
        songSection.hidden = false;
        if (data.qr_url) {
          qrImage.src = data.qr_url;
          qrImage.hidden = false;
          qrPlaceholder.hidden = true;
        }
        if (data.youtube_link) {
          youtubeLink.href = data.youtube_link;
          songLinks.hidden = false;
        }
      }
      if (data.revealed && data.artist) {
        revealSection.hidden = false;
        revealYear.textContent = data.year;
        revealInfo.textContent = `${data.artist} – ${data.title}`;
        revealBtn.disabled = true;
      }
      if (data.winner) {
        winnerText.textContent = `${data.winner} wint!`;
        winnerOverlay.hidden = false;
      }
      undoBtn.disabled = !data.revealed;
    } catch {}
  }

  async function fetchNextSong() {
    try {
      const res = await fetch('/gty/next', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) {
        emptyOverlay.hidden = false;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij ophalen nummer');
        return;
      }
      const data = await res.json();

      // Show song section
      songSection.hidden = false;
      revealSection.hidden = true;
      revealBtn.disabled = false;
      undoBtn.disabled = true;

      // Update round
      roundDisplay.textContent = `Ronde ${data.round}`;

      // QR code
      if (data.qr_url) {
        qrImage.src = data.qr_url;
        qrImage.hidden = false;
        qrPlaceholder.hidden = true;
      } else {
        qrImage.hidden = true;
        qrPlaceholder.hidden = false;
        qrPlaceholder.textContent = 'Geen QR code beschikbaar';
      }

      // YouTube link
      if (data.youtube_link) {
        youtubeLink.href = data.youtube_link;
        songLinks.hidden = false;
      } else {
        songLinks.hidden = true;
      }

      // Disable award buttons until reveal
      const state = await fetch('/gty/state', { credentials: 'same-origin' }).then(r => r.json());
      updateAwardButtons(state.team_names, false);
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  async function revealAnswer() {
    try {
      const res = await fetch('/gty/reveal', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij onthullen');
        return;
      }
      const data = await res.json();
      revealYear.textContent = data.year;
      revealInfo.textContent = `${data.artist} – ${data.title}`;
      revealSection.hidden = false;
      revealSection.classList.remove('fade-in');
      void revealSection.offsetWidth;
      revealSection.classList.add('fade-in');
      revealBtn.disabled = true;
      undoBtn.disabled = false;

      // Enable award buttons
      const state = await fetch('/gty/state', { credentials: 'same-origin' }).then(r => r.json());
      updateAwardButtons(state.team_names, true);
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  async function awardPoint(teamIdx) {
    try {
      const res = await fetch('/gty/award', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `team=${teamIdx}`,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij toekennen punt');
        return;
      }
      const data = await res.json();
      updateScoreboard(data.team_names, data.scores, undefined, data.jetons);
      updateTimelines(data.team_names, data.team_years);
      updateJetonButtons(data.team_names, data.jetons);

      if (data.winner) {
        winnerText.textContent = `${data.winner} wint!`;
        winnerOverlay.hidden = false;
      }
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  async function undoAward() {
    try {
      const res = await fetch('/gty/undo', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij ongedaan maken');
        return;
      }
      const data = await res.json();
      updateScoreboard(data.team_names, data.scores, undefined, data.jetons);
      updateTimelines(data.team_names, data.team_years);
      updateJetonButtons(data.team_names, data.jetons);
      winnerOverlay.hidden = true;
      showToast('Punt ongedaan gemaakt');
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  async function changeJeton(teamIdx, action) {
    try {
      const res = await fetch('/gty/jeton', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `team=${teamIdx}&action=${action}`,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij jeton');
        return;
      }
      const data = await res.json();
      // Re-fetch full state to update scoreboard jeton counts
      const state = await fetch('/gty/state', { credentials: 'same-origin' }).then(r => r.json());
      updateScoreboard(state.team_names, state.scores, state.rounds_to_win, data.jetons);
      updateJetonButtons(data.team_names, data.jetons);
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  // Event listeners
  nextSongBtn.addEventListener('click', fetchNextSong);
  revealBtn.addEventListener('click', revealAnswer);
  undoBtn.addEventListener('click', undoAward);

  // Initial load
  fetchState();
}

// ---------------------------------------------------------------------------
// 30 Seconds Setup page
// ---------------------------------------------------------------------------
function initTsSetup() {
  const container = document.getElementById('teamNamesContainer');
  const radios = document.querySelectorAll('input[name="num_teams"]');

  function renderTeamInputs(count) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const div = document.createElement('div');
      div.className = 'gty-team-input';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `team_${i}`;
      input.placeholder = `Team ${i + 1}`;
      input.className = 'text-input';
      div.appendChild(input);
      container.appendChild(div);
    }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      renderTeamInputs(parseInt(r.value));
    });
  });
}

// ---------------------------------------------------------------------------
// 30 Seconds Play page
// ---------------------------------------------------------------------------
function initTsPlay() {
  const TEAM_COLORS = ['#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const scoreboard     = document.getElementById('scoreboard');
  const boardBars      = document.getElementById('boardBars');
  const finishLabel    = document.getElementById('finishLabel');
  const currentTeamEl  = document.getElementById('currentTeam');
  const phaseRoll      = document.getElementById('phaseRoll');
  const rollBtn        = document.getElementById('rollBtn');
  const diceResult     = document.getElementById('diceResult');
  const diceValue      = document.getElementById('diceValue');
  const phaseDraw      = document.getElementById('phaseDraw');
  const drawBtn        = document.getElementById('drawBtn');
  const phasePlay      = document.getElementById('phasePlay');
  const timerBar       = document.getElementById('timerBar');
  const timerDisplay   = document.getElementById('timerDisplay');
  const wordsContainer = document.getElementById('wordsContainer');

  const phaseScore     = document.getElementById('phaseScore');
  const wordsCheck     = document.getElementById('wordsCheck');
  const scoreSummary   = document.getElementById('scoreSummary');
  const submitScoreBtn = document.getElementById('submitScoreBtn');
  const undoBtn        = document.getElementById('undoBtn');
  const winnerOverlay  = document.getElementById('winnerOverlay');
  const winnerText     = document.getElementById('winnerText');
  const toast          = document.getElementById('toast');

  let gameState = null;
  let currentWords = [];
  let currentHandicap = 0;
  let timer = null;
  let timerRunning = false;

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function updateScoreboard(teamNames, positions, finishScore, activeIdx) {
    scoreboard.innerHTML = '';
    teamNames.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'ts-team-card' + (i === activeIdx ? ' ts-active' : '');
      card.style.borderColor = (i === activeIdx) ? TEAM_COLORS[i] : '';
      if (i === activeIdx) card.style.boxShadow = `0 0 0 2px ${TEAM_COLORS[i]}`;
      card.innerHTML = `
        <div class="ts-team-name" style="color:${TEAM_COLORS[i]}">${name}</div>
        <div class="ts-team-position">${positions[i]} / ${finishScore}</div>
      `;
      scoreboard.appendChild(card);
    });
  }

  function updateBoard(teamNames, positions, finishScore) {
    boardBars.innerHTML = '';
    finishLabel.textContent = `FINISH (${finishScore})`;
    teamNames.forEach((name, i) => {
      const pct = Math.min(100, (positions[i] / finishScore) * 100);
      const bar = document.createElement('div');
      bar.className = 'ts-board-bar';
      bar.style.width = pct + '%';
      bar.style.backgroundColor = TEAM_COLORS[i];
      bar.style.height = `${Math.floor(20 / teamNames.length)}px`;
      bar.style.top = `${i * Math.floor(20 / teamNames.length)}px`;
      bar.title = `${name}: ${positions[i]}`;
      boardBars.appendChild(bar);
    });
  }

  function updateCurrentTeam(teamNames, idx) {
    currentTeamEl.textContent = `Aan de beurt: ${teamNames[idx]}`;
    currentTeamEl.style.color = TEAM_COLORS[idx];
    currentTeamEl.style.background = `color-mix(in srgb, ${TEAM_COLORS[idx]} 8%, var(--bg-card))`;
  }

  function showPhase(phase) {
    phaseRoll.hidden = phase !== 'roll';
    phaseDraw.hidden = phase !== 'draw';
    phasePlay.hidden = phase !== 'play';
    phaseScore.hidden = phase !== 'score';
  }

  // -- Timer --
  function createTimer(durationSec) {
    return new Timer(durationSec, (remaining, total) => {
      const secs = Math.ceil(remaining);
      timerDisplay.textContent = secs;
      const pct = remaining / total;
      timerBar.style.width = (pct * 100) + '%';
      timerBar.classList.toggle('warning', pct <= 0.3 && pct > 0.1);
      timerBar.classList.toggle('danger', pct <= 0.1);
    }, () => {
      // Time's up
      timerRunning = false;
      playTimeUpSound();
      try { navigator.vibrate([300, 100, 300, 100, 500]); } catch {}
      goToScorePhase();
    });
  }

  function goToScorePhase() {
    showPhase('score');
    // Build check list from current words
    wordsCheck.innerHTML = '';
    currentWords.forEach((word, i) => {
      const item = document.createElement('div');
      item.className = 'ts-word-check-item';
      item.dataset.index = i;
      item.innerHTML = `
        <div class="ts-check-icon">✓</div>
        <div class="ts-word-text">${word}</div>
      `;
      item.addEventListener('click', () => {
        item.classList.toggle('ts-checked');
        updateScoreSummary();
      });
      wordsCheck.appendChild(item);
    });
    updateScoreSummary();
  }

  function getCheckedCount() {
    return wordsCheck.querySelectorAll('.ts-checked').length;
  }

  function updateScoreSummary() {
    const correct = getCheckedCount();
    const steps = Math.max(0, correct - currentHandicap);
    scoreSummary.innerHTML = `
      <div class="ts-score-calc">${correct} juist − ${currentHandicap} handicap</div>
      <div class="ts-score-steps">= ${steps} vakje${steps !== 1 ? 's' : ''} vooruit</div>
    `;
  }

  // -- API calls --
  async function fetchState() {
    try {
      const res = await fetch('/ts/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      gameState = await res.json();

      updateScoreboard(gameState.team_names, gameState.positions, gameState.finish_score, gameState.current_team_idx);
      updateBoard(gameState.team_names, gameState.positions, gameState.finish_score);
      updateCurrentTeam(gameState.team_names, gameState.current_team_idx);

      if (gameState.winner) {
        winnerText.textContent = `${gameState.winner} wint! 🎉`;
        winnerOverlay.hidden = false;
      }

      // Determine current phase
      if (gameState.handicap !== null && gameState.current_words && gameState.current_words.length > 0) {
        // We have words drawn, show play phase
        currentWords = gameState.current_words;
        currentHandicap = gameState.handicap;
        showWordsOnCard(currentWords);
        showPhase('play');
        diceResult.hidden = false;
        diceValue.textContent = currentHandicap;
      } else if (gameState.handicap !== null) {
        currentHandicap = gameState.handicap;
        diceResult.hidden = false;
        diceValue.textContent = currentHandicap;
        showPhase('draw');
      } else {
        showPhase('roll');
        diceResult.hidden = true;
      }

      undoBtn.disabled = !gameState.round_number;
    } catch {}
  }

  async function rollDice() {
    try {
      rollBtn.disabled = true;
      // Animate
      diceResult.hidden = false;
      diceResult.classList.add('ts-dice-rolling');
      diceValue.textContent = '?';

      const res = await fetch('/ts/roll', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij dobbelen');
        rollBtn.disabled = false;
        return;
      }
      const data = await res.json();
      currentHandicap = data.handicap;

      // Short delay for animation
      await new Promise(r => setTimeout(r, 500));
      diceResult.classList.remove('ts-dice-rolling');
      diceValue.textContent = data.handicap;

      showPhase('draw');
      rollBtn.disabled = false;
    } catch (err) {
      showToast('Netwerkfout');
      rollBtn.disabled = false;
    }
  }

  function showWordsOnCard(words) {
    wordsContainer.innerHTML = '';
    words.forEach((word, i) => {
      const card = document.createElement('div');
      card.className = 'ts-word-card';
      card.innerHTML = `
        <div class="ts-word-number">${i + 1}</div>
        <div class="ts-word-text">${word}</div>
      `;
      wordsContainer.appendChild(card);
    });
  }

  async function drawCard() {
    try {
      drawBtn.disabled = true;
      const res = await fetch('/ts/draw', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij trekken kaart');
        drawBtn.disabled = false;
        return;
      }
      const data = await res.json();
      currentWords = data.words;

      showWordsOnCard(currentWords);
      showPhase('play');

      // Start timer immediately
      timer = createTimer(30);
      timerDisplay.textContent = '30';
      timerBar.style.width = '100%';
      timerBar.classList.remove('warning', 'danger');
      timer.start();
      timerRunning = true;

      drawBtn.disabled = false;
    } catch (err) {
      showToast('Netwerkfout');
      drawBtn.disabled = false;
    }
  }

  async function submitScore() {
    const correct = getCheckedCount();
    try {
      submitScoreBtn.disabled = true;
      const res = await fetch('/ts/score', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `correct=${correct}`,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij opslaan score');
        submitScoreBtn.disabled = false;
        return;
      }
      const data = await res.json();

      // Show result toast
      showToast(`${data.steps} vakje${data.steps !== 1 ? 's' : ''} vooruit!`);

      // Update UI
      updateScoreboard(data.team_names, data.positions, data.finish_score, data.current_team_idx);
      updateBoard(data.team_names, data.positions, data.finish_score);
      updateCurrentTeam(data.team_names, data.current_team_idx);

      if (data.winner) {
        winnerText.textContent = `${data.winner} wint! 🎉`;
        winnerOverlay.hidden = false;
      }

      // Reset for next turn
      showPhase('roll');
      diceResult.hidden = true;
      currentWords = [];
      currentHandicap = 0;
      undoBtn.disabled = false;
      submitScoreBtn.disabled = false;
    } catch (err) {
      showToast('Netwerkfout');
      submitScoreBtn.disabled = false;
    }
  }

  async function undoLast() {
    try {
      const res = await fetch('/ts/undo', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout bij ongedaan maken');
        return;
      }
      const data = await res.json();

      updateScoreboard(data.team_names, data.positions, data.finish_score, data.current_team_idx);
      updateBoard(data.team_names, data.positions, data.finish_score);
      updateCurrentTeam(data.team_names, data.current_team_idx);
      winnerOverlay.hidden = true;
      showToast('Laatste beurt ongedaan gemaakt');

      // Reset to roll phase for the restored team
      showPhase('roll');
      diceResult.hidden = true;
    } catch (err) {
      showToast('Netwerkfout');
    }
  }

  // -- Event listeners --
  rollBtn.addEventListener('click', rollDice);
  drawBtn.addEventListener('click', drawCard);
  submitScoreBtn.addEventListener('click', submitScore);
  undoBtn.addEventListener('click', undoLast);

  // Initial load
  fetchState();
}

// ---------------------------------------------------------------------------
// Generic Setup page (team name inputs, used by Taboe, Bluf, etc.)
// ---------------------------------------------------------------------------
function initGenericSetup() {
  const container = document.getElementById('teamNamesContainer');
  const radios = document.querySelectorAll('input[name="num_teams"]');
  if (!container || !radios.length) return;

  function renderTeamInputs(count) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const div = document.createElement('div');
      div.className = 'gty-team-input';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `team_${i}`;
      input.placeholder = `Team ${i + 1}`;
      input.className = 'text-input';
      div.appendChild(input);
      container.appendChild(div);
    }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      renderTeamInputs(parseInt(r.value));
    });
  });
}

// ---------------------------------------------------------------------------
// Taboe Play page
// ---------------------------------------------------------------------------
function initTaboePlay() {
  const TEAM_COLORS = ['#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const scoreboard    = document.getElementById('scoreboard');
  const boardBars     = document.getElementById('boardBars');
  const finishLabel   = document.getElementById('finishLabel');
  const currentTeamEl = document.getElementById('currentTeam');
  const phaseStart    = document.getElementById('phaseStart');
  const phasePlay     = document.getElementById('phasePlay');
  const phaseEnd      = document.getElementById('phaseEnd');
  const startTurnBtn  = document.getElementById('startTurnBtn');
  const timerBar      = document.getElementById('timerBar');
  const timerDisplay  = document.getElementById('timerDisplay');
  const taboeWord     = document.getElementById('taboeWord');
  const taboeForbidden = document.getElementById('taboeForbidden');
  const turnScore     = document.getElementById('turnScore');
  const correctBtn    = document.getElementById('correctBtn');
  const skipBtn       = document.getElementById('skipBtn');
  const taboeBtn      = document.getElementById('taboeBtn');
  const endSummary    = document.getElementById('endSummary');
  const confirmEndBtn = document.getElementById('confirmEndBtn');
  const undoBtn       = document.getElementById('undoBtn');
  const winnerOverlay = document.getElementById('winnerOverlay');
  const winnerText    = document.getElementById('winnerText');
  const toast         = document.getElementById('toast');

  let gameState = null;
  let timer = null;
  let turnCorrect = 0;
  let turnTaboe = 0;

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function updateScoreboard(st) {
    scoreboard.innerHTML = '';
    st.team_names.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'ts-team-card' + (i === st.current_team_idx ? ' ts-active' : '');
      card.style.borderColor = (i === st.current_team_idx) ? TEAM_COLORS[i] : '';
      if (i === st.current_team_idx) card.style.boxShadow = `0 0 0 2px ${TEAM_COLORS[i]}`;
      card.innerHTML = `
        <div class="ts-team-name" style="color:${TEAM_COLORS[i]}">${name}</div>
        <div class="ts-team-position">${st.scores[i]} / ${st.finish_score}</div>
      `;
      scoreboard.appendChild(card);
    });
    finishLabel.textContent = `FINISH (${st.finish_score})`;
    boardBars.innerHTML = '';
    st.team_names.forEach((name, i) => {
      const pct = Math.min(100, (st.scores[i] / st.finish_score) * 100);
      const bar = document.createElement('div');
      bar.className = 'ts-board-bar';
      bar.style.width = pct + '%';
      bar.style.backgroundColor = TEAM_COLORS[i];
      bar.style.height = `${Math.floor(20 / st.team_names.length)}px`;
      bar.style.top = `${i * Math.floor(20 / st.team_names.length)}px`;
      bar.title = `${name}: ${st.scores[i]}`;
      boardBars.appendChild(bar);
    });
    currentTeamEl.textContent = `Aan de beurt: ${st.team_names[st.current_team_idx]}`;
    currentTeamEl.style.color = TEAM_COLORS[st.current_team_idx];
    currentTeamEl.style.background = `color-mix(in srgb, ${TEAM_COLORS[st.current_team_idx]} 8%, var(--bg-card))`;
  }

  function showPhase(phase) {
    phaseStart.hidden = phase !== 'start';
    phasePlay.hidden = phase !== 'play';
    phaseEnd.hidden = phase !== 'end';
  }

  function showCard(card) {
    taboeWord.textContent = card.word;
    taboeForbidden.innerHTML = card.taboo.map(w =>
      `<span class="taboe-forbidden-word">🚫 ${w}</span>`
    ).join('');
  }

  function updateTurnScore() {
    turnScore.innerHTML = `✓ ${turnCorrect} &nbsp; ⚠ ${turnTaboe}`;
  }

  // Timer
  function createTimer() {
    return new Timer(60, (remaining, total) => {
      const secs = Math.ceil(remaining);
      timerDisplay.textContent = secs;
      const pct = remaining / total;
      timerBar.style.width = (pct * 100) + '%';
      timerBar.classList.toggle('warning', pct <= 0.3 && pct > 0.1);
      timerBar.classList.toggle('danger', pct <= 0.1);
    }, () => {
      playTimeUpSound();
      try { navigator.vibrate([300, 100, 300, 100, 500]); } catch {}
      endTurn();
    });
  }

  async function drawCard() {
    try {
      const res = await fetch('/taboe/draw', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) {
        showToast('Geen kaarten meer!');
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function startTurn() {
    turnCorrect = 0;
    turnTaboe = 0;
    updateTurnScore();
    const card = await drawCard();
    if (!card) return;
    showCard(card);
    showPhase('play');
    timer = createTimer();
    timerDisplay.textContent = '60';
    timerBar.style.width = '100%';
    timerBar.classList.remove('warning', 'danger');
    timer.start();
  }

  async function markCorrect() {
    const res = await fetch('/taboe/correct', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return;
    turnCorrect++;
    updateTurnScore();
    const card = await drawCard();
    if (!card) { endTurn(); return; }
    showCard(card);
  }

  async function markTaboe() {
    const res = await fetch('/taboe/taboe_fout', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return;
    turnTaboe++;
    updateTurnScore();
    const card = await drawCard();
    if (!card) { endTurn(); return; }
    showCard(card);
  }

  async function skipCard() {
    const card = await drawCard();
    if (!card) { endTurn(); return; }
    showCard(card);
  }

  async function endTurn() {
    if (timer) timer.pause();
    showPhase('end');
    const netScore = Math.max(0, turnCorrect - turnTaboe);
    endSummary.innerHTML = `
      <div class="ts-score-summary">
        <div class="ts-score-calc">✓ ${turnCorrect} correct − ⚠ ${turnTaboe} taboe</div>
        <div class="ts-score-steps">= ${netScore} punt${netScore !== 1 ? 'en' : ''}</div>
      </div>
    `;
  }

  async function confirmEnd() {
    try {
      const res = await fetch('/taboe/end_turn', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      gameState = data;
      updateScoreboard(data);
      if (data.winner) {
        winnerText.textContent = `${data.winner} wint! 🏆`;
        winnerOverlay.hidden = false;
      }
      showPhase('start');
      undoBtn.disabled = false;
    } catch { showToast('Netwerkfout'); }
  }

  async function undoLast() {
    try {
      const res = await fetch('/taboe/undo', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { showToast('Kan niet ongedaan maken'); return; }
      const data = await res.json();
      gameState = data;
      updateScoreboard(data);
      winnerOverlay.hidden = true;
      showPhase('start');
      showToast('Laatste beurt ongedaan gemaakt');
    } catch { showToast('Netwerkfout'); }
  }

  async function fetchState() {
    try {
      const res = await fetch('/taboe/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      gameState = await res.json();
      updateScoreboard(gameState);
      if (gameState.winner) {
        winnerText.textContent = `${gameState.winner} wint! 🏆`;
        winnerOverlay.hidden = false;
      }
      showPhase('start');
      undoBtn.disabled = !gameState.round_number;
    } catch {}
  }

  startTurnBtn.addEventListener('click', startTurn);
  correctBtn.addEventListener('click', markCorrect);
  taboeBtn.addEventListener('click', markTaboe);
  skipBtn.addEventListener('click', skipCard);
  confirmEndBtn.addEventListener('click', confirmEnd);
  undoBtn.addEventListener('click', undoLast);

  fetchState();
}

// ---------------------------------------------------------------------------
// Wie Ben Ik Play page
// ---------------------------------------------------------------------------
function initWbiPlay() {
  const personEl    = document.getElementById('wbiPerson');
  const counterEl   = document.getElementById('wbiCounter');
  const nextBtn     = document.getElementById('wbiNextBtn');
  const emptyOverlay = document.getElementById('emptyOverlay');
  const toast       = document.getElementById('toast');

  let shown = 0;

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  async function fetchNext() {
    try {
      nextBtn.disabled = true;
      const res = await fetch('/wbi/next', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) {
        emptyOverlay.hidden = false;
        nextBtn.disabled = false;
        return;
      }
      if (!res.ok) { showToast('Fout bij laden'); nextBtn.disabled = false; return; }
      const data = await res.json();
      shown++;
      personEl.textContent = data.person;
      personEl.style.animation = 'none';
      personEl.offsetHeight; // reflow
      personEl.style.animation = '';
      counterEl.textContent = `Persoon ${shown}`;
      nextBtn.disabled = false;
    } catch { showToast('Netwerkfout'); nextBtn.disabled = false; }
  }

  nextBtn.addEventListener('click', fetchNext);
}

// ---------------------------------------------------------------------------
// Muziekbingo Setup page
// ---------------------------------------------------------------------------
function initMbingoSetup() {
  const container = document.getElementById('teamNamesContainer');
  const radios = document.querySelectorAll('input[name="num_players"]');
  if (!container || !radios.length) return;

  function renderPlayerInputs(count) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const div = document.createElement('div');
      div.className = 'gty-team-input';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `player_${i}`;
      input.placeholder = `Speler ${i + 1}`;
      input.className = 'text-input';
      div.appendChild(input);
      container.appendChild(div);
    }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => renderPlayerInputs(parseInt(r.value)));
  });
}

// ---------------------------------------------------------------------------
// Muziekbingo Play page (single shared card with QR)
// ---------------------------------------------------------------------------
function initMbingoPlay() {
  const PLAYER_COLORS = ['#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const playerScores    = document.getElementById('playerScores');
  const qrPlaceholder   = document.getElementById('qrPlaceholder');
  const qrImage         = document.getElementById('qrImage');
  const songLinks       = document.getElementById('songLinks');
  const statusLabel     = document.getElementById('statusLabel');
  const revealedSong    = document.getElementById('revealedSong');
  const revealArtist    = document.getElementById('revealArtist');
  const revealTitle     = document.getElementById('revealTitle');
  const songProgress    = document.getElementById('songProgress');
  const nowPlaying      = document.getElementById('nowPlaying');
  const bingoGrid       = document.getElementById('bingoGrid');
  const nextSongBtn     = document.getElementById('nextSongBtn');
  const revealBtn       = document.getElementById('revealBtn');
  const claimPopup      = document.getElementById('claimPopup');
  const popupButtons    = document.getElementById('popupButtons');
  const popupClose      = document.getElementById('popupClose');
  const finishOverlay   = document.getElementById('finishOverlay');
  const finalScores     = document.getElementById('finalScores');
  const toast           = document.getElementById('toast');

  let state = null;
  let pendingCellIdx = null;   // which cell did the user tap?
  let claiming = false;        // prevent double-claims

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  // -- Scores --
  function calcScores(st) {
    const s = new Array(st.num_players).fill(0);
    st.card.forEach(c => { if (c.claimed_by != null) s[c.claimed_by]++; });
    return s;
  }

  function renderScoreboard(st) {
    playerScores.innerHTML = '';
    const scores = calcScores(st);
    st.player_names.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'mbingo-player-card';
      card.style.borderColor = PLAYER_COLORS[i];
      card.innerHTML = `
        <div class="mbingo-player-name" style="color:${PLAYER_COLORS[i]}">${name}</div>
        <div class="mbingo-player-score">${scores[i]}</div>
      `;
      playerScores.appendChild(card);
    });
  }

  // -- Grid --
  function renderGrid(st) {
    bingoGrid.innerHTML = '';
    bingoGrid.dataset.size = st.card_size;
    st.card.forEach((cell, idx) => {
      const el = document.createElement('div');
      el.className = 'mbingo-cell';
      el.dataset.idx = idx;
      el.innerHTML = `<span class="mbingo-cell-artist">${cell.artist}</span><span class="mbingo-cell-title">${cell.title}</span>`;
      if (cell.claimed_by != null) {
        el.classList.add('mbingo-cell--claimed');
        el.style.background = PLAYER_COLORS[cell.claimed_by];
        el.style.borderColor = PLAYER_COLORS[cell.claimed_by];
      }
      el.addEventListener('click', () => onCellTap(idx, el));
      bingoGrid.appendChild(el);
    });
  }

  // -- Cell tap → show player popup --
  function onCellTap(idx, cellEl) {
    if (!state || state.revealed) return;
    if (state.play_idx < 0) { showToast('Start eerst een nummer!'); return; }
    if (state.card[idx].claimed_by != null) { showToast('Al geclaimd!'); return; }

    pendingCellIdx = idx;
    showPopup(cellEl);
  }

  function showPopup(anchorEl) {
    popupButtons.innerHTML = '';
    state.player_names.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'mbingo-popup-btn';
      btn.style.background = PLAYER_COLORS[i];
      btn.style.color = '#fff';
      btn.textContent = name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doClaim(i);
      });
      popupButtons.appendChild(btn);
    });

    // Position popup near the tapped cell
    const gridRect = bingoGrid.getBoundingClientRect();
    const cellRect = anchorEl.getBoundingClientRect();
    const popupEl = claimPopup;
    popupEl.hidden = false;

    requestAnimationFrame(() => {
      const pw = popupEl.offsetWidth;
      const ph = popupEl.offsetHeight;
      // center horizontally relative to cell, clamp to screen
      let left = cellRect.left + cellRect.width / 2 - pw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      // prefer above the cell, fall below if no room
      let top = cellRect.top - ph - 8;
      if (top < 8) top = cellRect.bottom + 8;
      popupEl.style.left = left + 'px';
      popupEl.style.top = top + 'px';
    });
  }

  function hidePopup() {
    claimPopup.hidden = true;
    pendingCellIdx = null;
  }

  popupClose.addEventListener('click', (e) => { e.stopPropagation(); hidePopup(); });
  document.addEventListener('click', (e) => {
    if (!claimPopup.hidden && !claimPopup.contains(e.target) && !bingoGrid.contains(e.target)) {
      hidePopup();
    }
  });

  // -- Claim logic --
  async function doClaim(playerIdx) {
    if (claiming || pendingCellIdx === null) return;
    claiming = true;
    const cellIdx = pendingCellIdx;
    hidePopup();

    try {
      const res = await fetch('/mbingo/claim', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `player=${playerIdx}&cell=${cellIdx}`,
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || 'Fout'); claiming = false; return; }
      const data = await res.json();

      if (!data.correct) {
        // Wrong cell – shake it
        const cellEl = bingoGrid.children[cellIdx];
        if (cellEl) {
          cellEl.classList.add('mbingo-cell--wrong');
          setTimeout(() => cellEl.classList.remove('mbingo-cell--wrong'), 600);
        }
        showToast(data.message || 'Fout vakje!');
        claiming = false;
        return;
      }

      // Correct!
      state.card[cellIdx].claimed_by = data.player_idx;
      state.revealed = true;
      renderGrid(state);
      renderScoreboard(state);

      // Highlight claimed cell
      const cellEl = bingoGrid.children[cellIdx];
      if (cellEl) cellEl.classList.add('mbingo-cell--highlight');

      // Show revealed song
      showRevealed(data.artist, data.title);
      setPhase('revealed');
      claiming = false;
    } catch { showToast('Netwerkfout'); claiming = false; }
  }

  // -- Song links --
  function showSongLinks(data) {
    songLinks.innerHTML = '';
    if (data.youtube_link) {
      const a = document.createElement('a');
      a.href = data.youtube_link; a.target = '_blank'; a.textContent = '▶ YouTube';
      songLinks.appendChild(a);
    }
    if (data.spotify_link) {
      const a = document.createElement('a');
      a.href = data.spotify_link; a.target = '_blank'; a.textContent = '🎵 Spotify';
      songLinks.appendChild(a);
    }
    songLinks.hidden = !songLinks.children.length;
  }

  // -- Phases --
  function setPhase(phase) {
    // phase: 'idle' | 'listening' | 'revealed'
    nowPlaying.classList.remove('mbingo-listening', 'mbingo-revealed-state');
    if (phase === 'idle') {
      statusLabel.textContent = 'Druk op ▶ om te starten';
      statusLabel.hidden = false;
      revealedSong.hidden = true;
      nextSongBtn.hidden = false;
      revealBtn.hidden = true;
    } else if (phase === 'listening') {
      statusLabel.textContent = '🎧 Luister… wie herkent het?';
      statusLabel.hidden = false;
      revealedSong.hidden = true;
      nowPlaying.classList.add('mbingo-listening');
      nextSongBtn.hidden = true;
      revealBtn.hidden = false;
    } else if (phase === 'revealed') {
      statusLabel.hidden = true;
      revealedSong.hidden = false;
      nowPlaying.classList.add('mbingo-revealed-state');
      nextSongBtn.hidden = false;
      revealBtn.hidden = true;
    }
  }

  function showRevealed(artist, title) {
    revealArtist.textContent = artist;
    revealTitle.textContent = title;
  }

  // -- Next song --
  async function nextSong() {
    try {
      nextSongBtn.disabled = true;
      const res = await fetch('/mbingo/next_song', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) { showFinish(); return; }
      if (!res.ok) { showToast('Fout'); nextSongBtn.disabled = false; return; }
      const data = await res.json();

      state.play_idx = data.song_number - 1;
      state.revealed = false;
      songProgress.textContent = `${data.song_number} / ${data.total_songs}`;

      if (data.qr_url) {
        qrImage.src = data.qr_url; qrImage.hidden = false; qrPlaceholder.hidden = true;
      } else {
        qrImage.hidden = true; qrPlaceholder.hidden = false; qrPlaceholder.textContent = '♫';
      }
      showSongLinks(data);
      setPhase('listening');
      // Remove highlight from previous round
      bingoGrid.querySelectorAll('.mbingo-cell--highlight').forEach(c => c.classList.remove('mbingo-cell--highlight'));
      nextSongBtn.disabled = false;
    } catch { showToast('Netwerkfout'); nextSongBtn.disabled = false; }
  }

  // -- Reveal (skip) --
  async function revealSong() {
    try {
      revealBtn.disabled = true;
      const res = await fetch('/mbingo/reveal', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { showToast('Fout'); revealBtn.disabled = false; return; }
      const data = await res.json();
      state.revealed = true;
      showRevealed(data.artist, data.title);
      setPhase('revealed');

      // Highlight the unclaimed cell
      const cellEl = bingoGrid.children[data.card_idx];
      if (cellEl) cellEl.classList.add('mbingo-cell--highlight');
      revealBtn.disabled = false;
    } catch { showToast('Netwerkfout'); revealBtn.disabled = false; }
  }

  // -- Finish --
  function showFinish() {
    const scores = calcScores(state);
    finalScores.innerHTML = '';
    const sorted = state.player_names
      .map((n, i) => ({ name: n, score: scores[i], color: PLAYER_COLORS[i] }))
      .sort((a, b) => b.score - a.score);
    sorted.forEach((p, rank) => {
      const div = document.createElement('div');
      div.style.cssText = `padding:.5rem;font-weight:700;font-size:1.1rem;color:${p.color}`;
      div.textContent = `${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : ''} ${p.name}: ${p.score} vakjes`;
      finalScores.appendChild(div);
    });
    finishOverlay.hidden = false;
  }

  // -- Initial state --
  async function fetchState() {
    try {
      const res = await fetch('/mbingo/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      state = await res.json();
      renderScoreboard(state);
      renderGrid(state);
      songProgress.textContent = state.play_idx >= 0
        ? `${state.play_idx + 1} / ${state.total_songs}` : '';

      if (state.revealed && state.current_artist) {
        showRevealed(state.current_artist, state.current_title);
        if (state.qr_url) { qrImage.src = state.qr_url; qrImage.hidden = false; qrPlaceholder.hidden = true; }
        showSongLinks(state);
        setPhase('revealed');
      } else if (state.play_idx >= 0 && !state.revealed) {
        if (state.qr_url) { qrImage.src = state.qr_url; qrImage.hidden = false; qrPlaceholder.hidden = true; }
        showSongLinks(state);
        setPhase('listening');
      } else {
        setPhase('idle');
      }
    } catch {}
  }

  nextSongBtn.addEventListener('click', nextSong);
  revealBtn.addEventListener('click', revealSong);
  fetchState();
}

// ---------------------------------------------------------------------------
// Schattingen Play page
// ---------------------------------------------------------------------------
function initSchatPlay() {
  const TEAM_COLORS = ['#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const scoreboard        = document.getElementById('scoreboard');
  const roundInfo         = document.getElementById('roundInfo');
  const phaseNext         = document.getElementById('phaseNext');
  const phaseGuess        = document.getElementById('phaseGuess');
  const phaseReveal       = document.getElementById('phaseReveal');
  const nextQuestionBtn   = document.getElementById('nextQuestionBtn');
  const questionText      = document.getElementById('questionText');
  const guessSection      = document.getElementById('guessSection');
  const revealBtn         = document.getElementById('revealBtn');
  const revealQuestionText = document.getElementById('revealQuestionText');
  const answerValue       = document.getElementById('answerValue');
  const guessResults      = document.getElementById('guessResults');
  const nextAfterRevealBtn = document.getElementById('nextAfterRevealBtn');
  const winnerOverlay     = document.getElementById('winnerOverlay');
  const winnerText        = document.getElementById('winnerText');
  const toast             = document.getElementById('toast');

  let gameState = null;
  let submittedGuesses = {};

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function showPhase(phase) {
    phaseNext.hidden = phase !== 'next';
    phaseGuess.hidden = phase !== 'guess';
    phaseReveal.hidden = phase !== 'reveal';
  }

  function updateScoreboard(st) {
    scoreboard.innerHTML = '';
    st.team_names.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'ts-team-card';
      card.innerHTML = `
        <div class="ts-team-name" style="color:${TEAM_COLORS[i]}">${name}</div>
        <div class="ts-team-position">${st.scores[i]} / ${st.points_to_win}</div>
      `;
      scoreboard.appendChild(card);
    });
  }

  function renderGuessInputs(st) {
    guessSection.innerHTML = '';
    submittedGuesses = {};
    st.team_names.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'schat-team-guess';
      row.innerHTML = `
        <span class="schat-team-label" style="color:${TEAM_COLORS[i]}">${name}</span>
        <input type="number" class="schat-guess-input" id="guessInput${i}" placeholder="Schatting..." step="any">
        <button class="schat-submit-btn" id="guessBtn${i}" data-team="${i}">✓</button>
      `;
      guessSection.appendChild(row);

      const btn = row.querySelector(`#guessBtn${i}`);
      const input = row.querySelector(`#guessInput${i}`);
      btn.addEventListener('click', () => submitGuess(i, input, btn));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitGuess(i, input, btn);
      });
    });
  }

  async function submitGuess(teamIdx, input, btn) {
    const val = input.value.trim();
    if (!val) return;
    try {
      const res = await fetch('/schat/guess', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `team=${teamIdx}&guess=${val}`,
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || 'Fout'); return; }
      const data = await res.json();
      submittedGuesses[teamIdx] = true;
      btn.textContent = '✓';
      btn.disabled = true;
      btn.classList.add('schat-submitted');
      input.disabled = true;
      input.style.borderColor = TEAM_COLORS[teamIdx];

      // Enable reveal if all teams submitted
      const allDone = gameState.team_names.every((_, i) => submittedGuesses[i]);
      if (allDone) revealBtn.disabled = false;
    } catch { showToast('Netwerkfout'); }
  }

  async function fetchNext() {
    try {
      nextQuestionBtn.disabled = true;
      const res = await fetch('/schat/next', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { const d = await res.json(); showToast(d.error || 'Fout'); nextQuestionBtn.disabled = false; return; }
      const data = await res.json();
      questionText.textContent = data.question;
      roundInfo.textContent = `Vraag ${data.round_number}`;
      renderGuessInputs(gameState);
      revealBtn.disabled = true;
      showPhase('guess');
      nextQuestionBtn.disabled = false;
    } catch { showToast('Netwerkfout'); nextQuestionBtn.disabled = false; }
  }

  async function reveal() {
    try {
      revealBtn.disabled = true;
      const res = await fetch('/schat/reveal', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { const d = await res.json(); showToast(d.error || 'Fout'); revealBtn.disabled = false; return; }
      const data = await res.json();

      revealQuestionText.textContent = questionText.textContent;
      answerValue.textContent = data.answer.toLocaleString('nl-BE');

      // Show guess results
      guessResults.innerHTML = '';
      const answer = data.answer;
      const distances = {};
      gameState.team_names.forEach((_, i) => {
        const g = data.guesses[String(i)];
        if (g !== undefined) distances[i] = Math.abs(g - answer);
      });
      const minDist = Math.min(...Object.values(distances));

      gameState.team_names.forEach((name, i) => {
        const guess = data.guesses[String(i)];
        if (guess === undefined) return;
        const dist = Math.abs(guess - answer);
        const isWinner = dist === minDist;
        const item = document.createElement('div');
        item.className = `schat-result-item ${isWinner ? 'schat-result-winner' : ''}`;
        item.innerHTML = `
          <span class="schat-result-icon">${isWinner ? '✓' : '✗'}</span>
          <span style="flex:1;color:${TEAM_COLORS[i]};font-weight:700">${name}</span>
          <span>${guess.toLocaleString('nl-BE')}</span>
          <span style="color:var(--text-muted);font-size:.8rem">(afstand: ${dist.toLocaleString('nl-BE')})</span>
          <span>${isWinner ? '+1' : '+0'}</span>
        `;
        guessResults.appendChild(item);
      });

      gameState.scores = data.scores;
      updateScoreboard(gameState);

      if (data.winner) {
        winnerText.textContent = `${data.winner} wint! 🏆`;
        setTimeout(() => { winnerOverlay.hidden = false; }, 1000);
      }

      showPhase('reveal');
    } catch { showToast('Netwerkfout'); revealBtn.disabled = false; }
  }

  async function fetchState() {
    try {
      const res = await fetch('/schat/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      gameState = await res.json();
      updateScoreboard(gameState);
      roundInfo.textContent = gameState.round_number ? `Vraag ${gameState.round_number}` : '';
      if (gameState.winner) {
        winnerText.textContent = `${gameState.winner} wint! 🏆`;
        winnerOverlay.hidden = false;
      }
      showPhase('next');
    } catch {}
  }

  nextQuestionBtn.addEventListener('click', fetchNext);
  nextAfterRevealBtn.addEventListener('click', fetchNext);
  revealBtn.addEventListener('click', reveal);

  fetchState();
}

// ---------------------------------------------------------------------------
// Dit of Dat Play page
// ---------------------------------------------------------------------------
function initDodPlay() {
  const dodCard    = document.getElementById('dodCard');
  const dodStart   = document.getElementById('dodStart');
  const optionAText = document.getElementById('optionAText');
  const optionBText = document.getElementById('optionBText');
  const counter    = document.getElementById('dodCounter');
  const nextBtn    = document.getElementById('dodNextBtn');
  const resetBtn   = document.getElementById('dodResetBtn');
  const resetBtn2  = document.getElementById('dodResetBtn2');
  const emptyOverlay = document.getElementById('emptyOverlay');
  const toast      = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  async function fetchNext() {
    try {
      nextBtn.disabled = true;
      const res = await fetch('/dod/next', { method: 'POST', credentials: 'same-origin' });
      if (res.status === 204) {
        emptyOverlay.hidden = false;
        nextBtn.disabled = false;
        return;
      }
      if (!res.ok) { showToast('Fout'); nextBtn.disabled = false; return; }
      const data = await res.json();
      dodStart.hidden = true;
      dodCard.hidden = false;
      dodCard.style.animation = 'none';
      dodCard.offsetHeight;
      dodCard.style.animation = '';
      optionAText.textContent = data.option_a;
      optionBText.textContent = data.option_b;
      counter.textContent = `Vraag ${data.number} / ${data.total}`;
      nextBtn.disabled = false;
    } catch { showToast('Netwerkfout'); nextBtn.disabled = false; }
  }

  async function reset() {
    try {
      await fetch('/dod/reset', { method: 'POST', credentials: 'same-origin' });
      dodCard.hidden = true;
      dodStart.hidden = false;
      emptyOverlay.hidden = true;
      counter.textContent = '';
    } catch { showToast('Netwerkfout'); }
  }

  nextBtn.addEventListener('click', fetchNext);
  resetBtn.addEventListener('click', reset);
  if (resetBtn2) resetBtn2.addEventListener('click', reset);
}

// ---------------------------------------------------------------------------
// Bluf Play page
// ---------------------------------------------------------------------------
function initBlufPlay() {
  const TEAM_COLORS = ['#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const scoreboard      = document.getElementById('scoreboard');
  const roundInfo       = document.getElementById('roundInfo');
  const phaseNext       = document.getElementById('phaseNext');
  const phaseVote       = document.getElementById('phaseVote');
  const phaseReveal     = document.getElementById('phaseReveal');
  const nextStatementBtn = document.getElementById('nextStatementBtn');
  const statementText   = document.getElementById('statementText');
  const voteSection     = document.getElementById('voteSection');
  const revealBtn       = document.getElementById('revealBtn');
  const revealStatementText = document.getElementById('revealStatementText');
  const answerCard      = document.getElementById('answerCard');
  const answerBadge     = document.getElementById('answerBadge');
  const explanationText = document.getElementById('explanationText');
  const voteResults     = document.getElementById('voteResults');
  const nextAfterRevealBtn = document.getElementById('nextAfterRevealBtn');
  const winnerOverlay   = document.getElementById('winnerOverlay');
  const winnerText      = document.getElementById('winnerText');
  const toast           = document.getElementById('toast');

  let gameState = null;
  let votes = {};

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function updateScoreboard(st) {
    scoreboard.innerHTML = '';
    st.team_names.forEach((name, i) => {
      const card = document.createElement('div');
      card.className = 'ts-team-card';
      card.innerHTML = `
        <div class="ts-team-name" style="color:${TEAM_COLORS[i]}">${name}</div>
        <div class="ts-team-position">${st.scores[i]} / ${st.points_to_win}</div>
      `;
      scoreboard.appendChild(card);
    });
  }

  function showPhase(phase) {
    phaseNext.hidden = phase !== 'next';
    phaseVote.hidden = phase !== 'vote';
    phaseReveal.hidden = phase !== 'reveal';
  }

  function renderVoteButtons(st) {
    voteSection.innerHTML = '';
    votes = {};
    st.team_names.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'bluf-team-vote';
      row.innerHTML = `
        <span class="bluf-team-label" style="color:${TEAM_COLORS[i]}">${name}</span>
        <button class="bluf-vote-btn" data-team="${i}" data-vote="true">Waar</button>
        <button class="bluf-vote-btn" data-team="${i}" data-vote="false">Niet waar</button>
        <span class="bluf-vote-check" id="voteCheck${i}"></span>
      `;
      voteSection.appendChild(row);
    });

    voteSection.querySelectorAll('.bluf-vote-btn').forEach(btn => {
      btn.addEventListener('click', () => castVote(btn.dataset.team, btn.dataset.vote));
    });
  }

  async function castVote(teamIdx, vote) {
    try {
      const res = await fetch('/bluf/vote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `team=${teamIdx}&vote=${vote}`,
      });
      if (!res.ok) return;
      const data = await res.json();
      votes = data.votes;

      // Update vote button styles
      Object.entries(data.votes).forEach(([ti, v]) => {
        const btns = voteSection.querySelectorAll(`[data-team="${ti}"]`);
        btns.forEach(b => {
          b.classList.remove('bluf-voted-true', 'bluf-voted-false');
          if (b.dataset.vote === 'true' && v === true) b.classList.add('bluf-voted-true');
          if (b.dataset.vote === 'false' && v === false) b.classList.add('bluf-voted-false');
        });
        const check = document.getElementById(`voteCheck${ti}`);
        if (check) check.textContent = '✓';
      });

      // Enable reveal if all teams voted
      if (Object.keys(data.votes).length >= gameState.num_teams) {
        revealBtn.disabled = false;
      }
    } catch { showToast('Netwerkfout'); }
  }

  async function fetchNext() {
    try {
      nextStatementBtn.disabled = true;
      const res = await fetch('/bluf/next', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Fout');
        nextStatementBtn.disabled = false;
        return;
      }
      const data = await res.json();
      statementText.textContent = data.statement;
      roundInfo.textContent = `Ronde ${data.round_number}`;
      renderVoteButtons(gameState);
      revealBtn.disabled = true;
      showPhase('vote');
      nextStatementBtn.disabled = false;
    } catch { showToast('Netwerkfout'); nextStatementBtn.disabled = false; }
  }

  async function reveal() {
    try {
      revealBtn.disabled = true;
      const res = await fetch('/bluf/reveal', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { revealBtn.disabled = false; return; }
      const data = await res.json();

      revealStatementText.textContent = statementText.textContent;
      answerCard.className = 'bluf-answer-card ' + (data.answer ? 'bluf-true' : 'bluf-false');
      answerBadge.textContent = data.answer ? '✓ WAAR' : '✗ NIET WAAR';
      explanationText.textContent = data.explanation || '';

      // Show vote results
      voteResults.innerHTML = '';
      data.team_names.forEach((name, i) => {
        const teamVote = votes[String(i)];
        const correct = teamVote === data.answer;
        const item = document.createElement('div');
        item.className = `bluf-result-item ${correct ? 'bluf-result-correct' : 'bluf-result-wrong'}`;
        item.innerHTML = `
          <span class="bluf-result-icon">${correct ? '✓' : '✗'}</span>
          <span style="flex:1;color:${TEAM_COLORS[i]}">${name}</span>
          <span>${teamVote === true ? 'Waar' : teamVote === false ? 'Niet waar' : '–'}</span>
          <span>${correct ? '+1' : '+0'}</span>
        `;
        voteResults.appendChild(item);
      });

      gameState.scores = data.scores;
      updateScoreboard(gameState);

      if (data.winner) {
        winnerText.textContent = `${data.winner} wint! 🏆`;
        setTimeout(() => { winnerOverlay.hidden = false; }, 1000);
      }

      showPhase('reveal');
    } catch { showToast('Netwerkfout'); revealBtn.disabled = false; }
  }

  async function fetchState() {
    try {
      const res = await fetch('/bluf/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      gameState = await res.json();
      updateScoreboard(gameState);
      roundInfo.textContent = gameState.round_number ? `Ronde ${gameState.round_number}` : '';
      if (gameState.winner) {
        winnerText.textContent = `${gameState.winner} wint! 🏆`;
        winnerOverlay.hidden = false;
      }
      showPhase('next');
    } catch {}
  }

  nextStatementBtn.addEventListener('click', fetchNext);
  nextAfterRevealBtn.addEventListener('click', fetchNext);
  revealBtn.addEventListener('click', reveal);

  fetchState();
}
