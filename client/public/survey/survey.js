/* ─── PFG PROJECT SATISFACTION SURVEY ─────────────────────────────── */

// SURVEY_DATA is populated at runtime:
// - If ?token=xxx is present, fetched from /api/survey/token-data?token=xxx
// - Otherwise falls back to demo data below
let SURVEY_DATA = null;

const DEMO_SURVEY_DATA = {
  respondentName: 'Nashater Gill',
  respondentInitials: 'NG',
  respondentRole: 'Site Manager',
  respondentCompany: 'GE Vernova',
  projectName: 'GENT — GE Vernova · ST LP Rotor Upgrade',
  projectCode: 'GNT',
  projectStartDate: null,
  projectEndDate: null,
  oem: 'GE Vernova',
  projectManager: 'Wesley Martin',
  team: [
    { id: 'wm', name: 'Wesley Martin',          initials: 'WM', role: 'Project Manager',    shift: 'day',   isPM: true },
    { id: 'jc', name: 'Juan Carlos Beltran',    initials: 'JCB', role: 'Site Supervisor',   shift: 'day',   isPM: false },
    { id: 'bg', name: 'Bruno da Silva Neves',   initials: 'BN', role: 'Lead Technician',    shift: 'day',   isPM: false },
    { id: 'pg', name: 'Pedro Beltran Simarro',  initials: 'PBS', role: 'Senior Technician', shift: 'day',   isPM: false },
    { id: 'cg', name: 'Cesar Gallut Garcia',    initials: 'CGG', role: 'Technician',        shift: 'day',   isPM: false },
    { id: 'jj', name: 'Juan Jose Armario',      initials: 'JJA', role: 'Technician',        shift: 'night', isPM: false },
    { id: 'ar', name: 'Alberto Rodriguez',      initials: 'AR', role: 'Night Supervisor',   shift: 'night', isPM: false },
    { id: 'ms', name: 'Miguel Sanchez Lopez',   initials: 'MSL', role: 'Senior Technician', shift: 'night', isPM: false },
  ]
};

// Current survey token (from URL param)
let SURVEY_TOKEN = null;

// ─── LOAD DATA & INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Check for token in URL
  const params = new URLSearchParams(window.location.search);
  SURVEY_TOKEN = params.get('token');

  if (SURVEY_TOKEN) {
    // Fetch real data from API
    try {
      const res = await fetch(`/api/survey/token-data?token=${encodeURIComponent(SURVEY_TOKEN)}`);
      if (res.status === 404) {
        showError('Invalid or expired link', 'This survey link is not valid or has expired. Please request a new link.');
        return;
      }
      if (res.status === 410) {
        showError('Already submitted', 'This survey has already been completed. Thank you for your feedback!');
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      SURVEY_DATA = await res.json();
    } catch (err) {
      console.error('Failed to load survey data:', err);
      // Fall back to demo data so the form is at least usable
      SURVEY_DATA = DEMO_SURVEY_DATA;
    }
  } else {
    // No token — use demo data for testing
    SURVEY_DATA = DEMO_SURVEY_DATA;
  }

  // Apply OEM theme AFTER data is loaded
  applyOEMTheme();

  // Now initialise the rest of the survey
  populateMeta();
  buildTeamRoster();
  initThemeToggle();
  initIndividualFeedback();
  initRatingHighlight();
  initFormSubmit();
});

// ─── ERROR STATE ───────────────────────────────────────────────
function showError(title, message) {
  const wrap = document.querySelector('.survey-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="survey-intro" style="text-align:center;padding:60px 20px;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.5" style="margin:0 auto 16px;display:block">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <h2 class="survey-title" style="font-size:1.5rem;">${title}</h2>
      <p class="survey-subtitle">${message}</p>
    </div>
  `;
}

// ─── META ─────────────────────────────────────────────────────
function populateMeta() {
  const d = SURVEY_DATA;
  setEl('respondentName', d.respondentName);
  setEl('respondentRole', `${d.respondentRole} · ${d.respondentCompany}`);
  setEl('respondentAvatar', d.respondentInitials);
  setEl('projectChip', d.projectName);
  setEl('successProjectName', d.projectName);
}
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─── THEME TOGGLE ─────────────────────────────────────────────
function initThemeToggle() {
  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let theme = prefersDark ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);
  updateToggleIcon(toggle, theme);

  toggle && toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    updateToggleIcon(toggle, theme);
  });
}
function updateToggleIcon(btn, theme) {
  if (!btn) return;
  btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  btn.innerHTML = theme === 'dark'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// ─── RATING ANSWERED STATE ─────────────────────────────────────
function initRatingHighlight() {
  document.querySelectorAll('.rating-scale, .nps-scale').forEach(scale => {
    scale.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const block = radio.closest('.question-block');
        if (block) {
          block.classList.add('answered');
          block.classList.remove('error');
        }
      });
    });
  });
}

// ─── INDIVIDUAL FEEDBACK ───────────────────────────────────────
function initIndividualFeedback() {
  const yesBtn   = document.getElementById('indivYes');
  const noBtn    = document.getElementById('indivNo');
  const roster   = document.getElementById('teamRoster');

  yesBtn && yesBtn.addEventListener('click', () => {
    yesBtn.setAttribute('aria-pressed', 'true');
    noBtn.setAttribute('aria-pressed', 'false');
    roster.hidden = false;
    roster.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  noBtn && noBtn.addEventListener('click', () => {
    noBtn.setAttribute('aria-pressed', 'true');
    yesBtn.setAttribute('aria-pressed', 'false');
    roster.hidden = true;
  });
}

// ─── BUILD TEAM ROSTER ─────────────────────────────────────────
function buildTeamRoster() {
  const grid = document.getElementById('teamGrid');
  if (!grid) return;

  SURVEY_DATA.team.forEach(person => {
    const card = document.createElement('div');
    card.className = 'person-card';
    card.dataset.personId = person.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-pressed', 'false');

    card.innerHTML = `
      <div class="card-top">
        <div class="card-avatar ${person.isPM ? 'pm' : ''}">${person.initials}</div>
        <div>
          <div class="card-name">${person.name}</div>
          <div class="card-role">${person.role}</div>
        </div>
        <svg class="card-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="card-shift">
        <span class="shift-dot ${person.shift}"></span>
        ${person.shift === 'day' ? 'Day Shift' : 'Night Shift'}
        ${person.isPM ? '· Project Manager' : ''}
      </div>
      <div class="card-comment">
        <textarea placeholder="Your comments about ${person.name.split(' ')[0]}..." rows="3" name="comment_${person.id}"></textarea>
      </div>
    `;

    // Toggle selection on click or Enter/Space
    const toggleCard = (e) => {
      // Don't toggle if clicking inside the textarea
      if (e.target.tagName === 'TEXTAREA') return;
      const selected = card.classList.toggle('selected');
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (selected) {
        const ta = card.querySelector('textarea');
        if (ta) setTimeout(() => ta.focus(), 150);
      }
    };

    card.addEventListener('click', toggleCard);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCard(e);
      }
    });

    grid.appendChild(card);
  });
}

// ─── FORM SUBMIT ───────────────────────────────────────────────
function initFormSubmit() {
  const form   = document.getElementById('surveyForm');
  const success = document.getElementById('successState');
  const submitBtn = document.getElementById('submitBtn');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valid = validateForm(form);
    if (!valid) return;

    // Disable button to prevent double-submit
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Submitting...</span>';
    }

    // Collect data
    const data = collectFormData(form);

    try {
      if (SURVEY_TOKEN) {
        // POST to API in production
        const res = await fetch('/api/survey/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: SURVEY_TOKEN,
            q1: data.scores.q1_planning,
            q2: data.scores.q2_quality,
            q3: data.scores.q3_hse,
            q4: data.scores.q4_supervision,
            q5: data.scores.q5_pm,
            q6: data.scores.q6_overall,
            nps: data.nps,
            openFeedback: data.openFeedback,
            individualFeedback: data.individualFeedback.map(f => ({
              workerId: f.personId,
              comment: f.comment
            }))
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
      } else {
        // Demo mode — just log
        console.log('Survey submitted (demo):', JSON.stringify(data, null, 2));
      }

      // Show success
      form.style.opacity = '0';
      form.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        form.hidden = true;
        success.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 300);
    } catch (err) {
      console.error('Submit error:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Submit Feedback</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      }
      alert('There was a problem submitting your feedback. Please try again.');
    }
  });
}

function validateForm(form) {
  let valid = true;
  const required = ['q1','q2','q3','q4','q5','q6','q7'];

  required.forEach(name => {
    const radios = form.querySelectorAll(`input[name="${name}"]`);
    const checked = [...radios].some(r => r.checked);
    const block = radios[0]?.closest('.question-block');

    if (!checked) {
      valid = false;
      if (block) {
        block.classList.add('error');
        // Add error message if not already there
        if (!block.querySelector('.error-msg')) {
          const msg = document.createElement('p');
          msg.className = 'error-msg';
          msg.textContent = 'Please select a rating to continue.';
          block.appendChild(msg);
        }
        block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (block) {
      block.classList.remove('error');
    }
  });

  return valid;
}

function collectFormData(form) {
  const fd = new FormData(form);
  const data = {
    project: SURVEY_DATA.projectCode,
    respondent: {
      name: SURVEY_DATA.respondentName,
      company: SURVEY_DATA.respondentCompany,
      role: SURVEY_DATA.respondentRole
    },
    scores: {
      q1_planning:    Number(fd.get('q1')),
      q2_quality:     Number(fd.get('q2')),
      q3_hse:         Number(fd.get('q3')),
      q4_supervision: Number(fd.get('q4')),
      q5_pm:          Number(fd.get('q5')),
      q6_overall:     Number(fd.get('q6')),
    },
    nps: Number(fd.get('q7')),
    openFeedback: fd.get('q8') || '',
    individualFeedback: [],
    submittedAt: new Date().toISOString()
  };

  // Calculate average score
  const scores = Object.values(data.scores);
  data.averageScore = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

  // Individual feedback
  document.querySelectorAll('.person-card.selected').forEach(card => {
    const personId = card.dataset.personId;
    const comment = card.querySelector('textarea')?.value || '';
    const person = SURVEY_DATA.team.find(p => String(p.id) === String(personId));
    if (person) {
      data.individualFeedback.push({
        personId,
        name: person.name,
        comment
      });
    }
  });

  return data;
}

// ─── OEM THEME PALETTE ─────────────────────────────────────────
// Applied at runtime based on SURVEY_DATA.oem
// In production: injected server-side from the project record

const OEM_THEMES = {
  'GE Vernova': {
    primary:      '#005E60',
    primaryHover: '#004547',
    primaryHl:    '#e0f0f0',
    primaryLight: '#f0fafa',
    chip:         '#e0f0f0',
    chipText:     '#005E60',
  },
  'Siemens Energy': {
    primary:      '#009999',
    primaryHover: '#007777',
    primaryHl:    '#e0f5f5',
    primaryLight: '#f0fafa',
    chip:         '#e0f5f5',
    chipText:     '#007777',
  },
  'Mitsubishi Power': {
    primary:      '#c0001a',
    primaryHover: '#990015',
    primaryHl:    '#fde8ea',
    primaryLight: '#fff5f6',
    chip:         '#fde8ea',
    chipText:     '#c0001a',
  },
  'Arabelle Solutions': {
    primary:      '#FE5716',
    primaryHover: '#d94210',
    primaryHl:    '#fff0eb',
    primaryLight: '#fff8f5',
    chip:         '#fff0eb',
    chipText:     '#c43d0d',
  },
  'Ansaldo Energia': {
    primary:      '#055160',
    primaryHover: '#033d4a',
    primaryHl:    '#e0eff2',
    primaryLight: '#f0f8fa',
    chip:         '#e0eff2',
    chipText:     '#055160',
  },
  'Doosan Skoda': {
    primary:      '#0017A8',
    primaryHover: '#00118a',
    primaryHl:    '#e5e8ff',
    primaryLight: '#f2f4ff',
    chip:         '#e5e8ff',
    chipText:     '#0017A8',
  },
};

function applyOEMTheme() {
  if (!SURVEY_DATA) return;
  const theme = OEM_THEMES[SURVEY_DATA.oem];
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty('--color-primary',       theme.primary);
  root.style.setProperty('--color-primary-hover',  theme.primaryHover);
  root.style.setProperty('--color-primary-highlight', theme.primaryHl);
  root.style.setProperty('--color-primary-light',  theme.primaryLight);
  // Also update dark mode primary to a lighter variant
  // (simple approach: use the highlight as chip bg)
  document.querySelectorAll('.project-chip').forEach(el => {
    el.style.background = theme.chip;
    el.style.color = theme.chipText;
  });
}
