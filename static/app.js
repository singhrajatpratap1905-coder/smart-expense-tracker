// ==================== AUTH STATE ====================
let currentUser  = null;
let clerk = null;

// On page load: show app or auth screen
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const dateInput = document.getElementById('date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    
    const navDate = document.getElementById('navDate');
    if (navDate) navDate.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Load saved theme
    if (localStorage.getItem('theme') === 'dark') {
      document.body.setAttribute('data-theme', 'dark');
      const themeBtn = document.querySelector('.theme-btn');
      if (themeBtn) themeBtn.textContent = '☀️';
    }

    if (window.Clerk) {
      clerk = window.Clerk;
      try {
        await clerk.load({
          publishableKey: window.__CLERK_PUBLISHABLE_KEY__
        });
      } catch(err) {
        document.getElementById('clerk-sign-in').textContent = '⚠️ Clerk Initialization Error: ' + err.message;
        return;
      }

      clerk.addListener(({ user }) => {
        if (user) {
          currentUser = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : user.fullName;
          showApp();
        } else {
          showAuthScreen();
        }
      });

      if (!clerk.user) {
        showAuthScreen();
      }
    } else {
      document.getElementById('clerk-sign-in').textContent = '⚠️ Clerk library failed to load from network.';
    }

    // Initialize custom cursor wrapper early (React Component translated to Vanilla)
    initTargetCursor();

    // Initialize the Vanilla GSAP Mac Dock
    initVanillaDock();

    // Initialize the interactive physics background immediately (doesn't depend on auth)
    initDotGrid();

  } catch(globalErr) {
    document.getElementById('clerk-sign-in').textContent = '💥 App Script Error: ' + globalErr.message;
  }
});

// ==================== AUTH SCREEN LOGIC ====================
function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display  = 'none';
  if (clerk && !document.querySelector('#clerk-sign-in > div')) {
    clerk.mountSignIn(document.getElementById('clerk-sign-in'));
  }
}

let pillNavInitialized = false;

function initPillNav() {
  if (pillNavInitialized || typeof gsap === 'undefined') return;
  pillNavInitialized = true;

  const circles = document.querySelectorAll('.pill .hover-circle');
  const ease = 'power3.easeOut';
  
  function layout() {
    circles.forEach(circle => {
      const pill = circle.parentElement;
      const rect = pill.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      if (w === 0 || h === 0) return;

      const R = ((w * w) / 4 + h * h) / (2 * h);
      const D = Math.ceil(2 * R) + 2;
      const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
      const originY = D - delta;

      circle.style.width = `${D}px`;
      circle.style.height = `${D}px`;
      circle.style.bottom = `-${delta}px`;

      gsap.set(circle, {
        xPercent: -50,
        scale: 0,
        transformOrigin: `50% ${originY}px`
      });

      const label = pill.querySelector('.pill-label');
      const white = pill.querySelector('.pill-label-hover');

      if (label) gsap.set(label, { y: 0 });
      if (white) gsap.set(white, { y: h + 12, opacity: 0 });

      if (circle._tl) circle._tl.kill();
      const tl = gsap.timeline({ paused: true });
      tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: 'auto' }, 0);
      if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: 'auto' }, 0);
      if (white) {
        gsap.set(white, { y: Math.ceil(h + 100), opacity: 0 });
        tl.to(white, { y: 0, opacity: 1, duration: 2, ease, overwrite: 'auto' }, 0);
      }
      circle._tl = tl;
    });
  }

  // Delay slightly to ensure browser painted the display block
  setTimeout(layout, 50);
  window.addEventListener('resize', layout);

  document.querySelectorAll('.pill').forEach(pill => {
    const circle = pill.querySelector('.hover-circle');
    pill.addEventListener('mouseenter', () => {
      if (circle && circle._tl) {
        if (circle._activeTween) circle._activeTween.kill();
        circle._activeTween = circle._tl.tweenTo(circle._tl.duration(), { duration: 0.3, ease, overwrite: 'auto' });
      }
    });
    pill.addEventListener('mouseleave', () => {
      if (circle && circle._tl) {
        if (circle._activeTween) circle._activeTween.kill();
        circle._activeTween = circle._tl.tweenTo(0, { duration: 0.2, ease, overwrite: 'auto' });
      }
    });
  });

  const logo = document.getElementById('pillLogo');
  if (logo) {
    const img = logo.querySelector('div');
    logo.addEventListener('mouseenter', () => {
      gsap.set(img, { rotate: 0 });
      gsap.to(img, { rotate: 360, duration: 0.4, ease, overwrite: 'auto' });
    });
    gsap.set(logo, { scale: 0 });
    gsap.to(logo, { scale: 1, duration: 0.6, ease, delay: 0.1 });
  }

  const navItems = document.getElementById('pillNavItems');
  if (navItems) {
    gsap.set(navItems, { width: 0, overflow: 'hidden' });
    gsap.to(navItems, { width: 'auto', duration: 0.6, ease, delay: 0.1 });
  }

  const menuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  let isMobileOpen = false;

  if (mobileMenu) {
    gsap.set(mobileMenu, { visibility: 'hidden', opacity: 0, scaleY: 1 });
  }

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      isMobileOpen = !isMobileOpen;
      const lines = menuBtn.querySelectorAll('.hamburger-line');
      if (isMobileOpen) {
        gsap.to(lines[0], { rotation: 45, y: 3, duration: 0.3, ease });
        gsap.to(lines[1], { rotation: -45, y: -3, duration: 0.3, ease });
        gsap.set(mobileMenu, { visibility: 'visible' });
        gsap.fromTo(mobileMenu,
          { opacity: 0, y: 10, scaleY: 1 },
          { opacity: 1, y: 0, scaleY: 1, duration: 0.3, ease, transformOrigin: 'top center' }
        );
      } else {
        closeMobileMenu();
      }
    });
  }

  window.closeMobileMenu = function() {
    isMobileOpen = false;
    if (menuBtn) {
      const lines = menuBtn.querySelectorAll('.hamburger-line');
      gsap.to(lines[0], { rotation: 0, y: 0, duration: 0.3, ease });
      gsap.to(lines[1], { rotation: 0, y: 0, duration: 0.3, ease });
    }
    if (mobileMenu) {
      gsap.to(mobileMenu, {
        opacity: 0, y: 10, scaleY: 1, duration: 0.2, ease, transformOrigin: 'top center',
        onComplete: () => gsap.set(mobileMenu, { visibility: 'hidden' })
      });
    }
  };
}

function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display  = 'block';
  document.getElementById('userBadge').textContent = currentUser;
  document.getElementById('welcomeMsg').textContent = `Welcome back`;
  initPillNav();
  loadDashboard();
}

function setAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) el.textContent = msg;
}

async function handleLogout() {
  if (clerk) {
    await clerk.signOut();
  }
  showAuthScreen();
}

// ==================== AUTHENTICATED FETCH ====================
// All API calls go through this helper so the Bearer token is always attached.
async function authFetch(url, options = {}) {
  if (!clerk || !clerk.session) {
    throw new Error('Not logged in to Clerk.');
  }
  const token = await clerk.session.getToken();
  options.headers = {
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`
  };
  const res = await fetch(url, options);
  if (res.status === 401) {
    // Token expired or invalid — force logout
    handleLogout();
    throw new Error('Session expired. Please log in again.');
  }
  return res;
}

// ==================== MERCHANT DATABASE ====================
const merchants = {
  zomato:'Food', swiggy:'Food', dominos:'Food', kfc:'Food', mcdonalds:'Food',
  pizzahut:'Food', starbucks:'Food', subway:'Food', burgerking:'Food',
  amazon:'Shopping', flipkart:'Shopping', myntra:'Shopping', ajio:'Shopping', meesho:'Shopping',
  uber:'Travel', ola:'Travel', irctc:'Travel', rapido:'Travel', makemytrip:'Travel',
  bigbasket:'Groceries', blinkit:'Groceries', zepto:'Groceries', dmart:'Groceries', jiomart:'Groceries',
  bookmyshow:'Entertainment', netflix:'Entertainment', spotify:'Entertainment',
  hotstar:'Entertainment', prime:'Entertainment', youtube:'Entertainment',
  apollo:'Healthcare', medplus:'Healthcare', practo:'Healthcare', pharmeasy:'Healthcare',
  electricity:'Bills', airtel:'Bills', jio:'Bills', vodafone:'Bills', wifi:'Bills',
  rent:'Bills', water:'Bills', gas:'Bills'
};

// ==================== SMART SUGGESTIONS ====================
function suggest(val) {
  const v   = val.toLowerCase().trim();
  const box = document.getElementById('suggestions');
  if (!v) { box.innerHTML = ''; return; }

  const matches = Object.keys(merchants).filter(m => m.includes(v)).slice(0, 6);
  box.innerHTML = matches.map(m =>
    `<span class="chip" onclick="pickSuggestion('${m}')">${m} <small style="opacity:0.6">(${merchants[m]})</small></span>`
  ).join('');

  const found = Object.keys(merchants).find(m => v.includes(m));
  if (found) document.getElementById('category').value = merchants[found];
}

function pickSuggestion(name) {
  document.getElementById('merchant').value  = name.charAt(0).toUpperCase() + name.slice(1);
  document.getElementById('category').value  = merchants[name];
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('amount').focus();
}

// ==================== VOICE INPUT ====================
document.addEventListener('DOMContentLoaded', () => {
  const voiceBar = document.getElementById('voiceBar');
  if (!voiceBar) return;
  voiceBar.addEventListener('click', () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice input not supported. Please use Google Chrome.');
      return;
    }
    const SR    = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SR();
    recog.lang  = 'en-IN';
    recog.start();

    document.getElementById('voiceDot').classList.add('pulse');
    document.getElementById('voiceText').textContent = '🎤 Listening...';

    recog.onresult = (e) => {
      const text = e.results[0][0].transcript.toLowerCase();
      document.getElementById('voiceText').textContent = `Heard: "${text}"`;
      document.getElementById('voiceDot').classList.remove('pulse');

      const amtMatch = text.match(/\d+/);
      if (amtMatch) document.getElementById('amount').value = amtMatch[0];

      const merchantMatch = text.match(/(?:at|on|from|to)\s+(\w+)/);
      if (merchantMatch) {
        const name = merchantMatch[1];
        document.getElementById('merchant').value = name.charAt(0).toUpperCase() + name.slice(1);
        if (merchants[name]) document.getElementById('category').value = merchants[name];
      }
      showStatus('✅ Voice parsed! Review and save.');
    };

    recog.onerror = () => {
      document.getElementById('voiceText').textContent = '❌ Could not hear. Tap to try again.';
      document.getElementById('voiceDot').classList.remove('pulse');
    };
  });
});

// ==================== RECEIPT SCAN (Gemini AI + Tesseract fallback) ====================
async function scanReceipt(input) {
  const file = input.files[0];
  if (!file) return;

  const scanBox = document.getElementById('scanBox');
  scanBox.innerHTML = `<div style="text-align:center;padding:12px">
    <div class="scan-spinner"></div>
    <small>🤖 AI is analyzing your receipt…</small>
  </div>`;

  const formData = new FormData();
  formData.append('receipt', file);

  try {
    // Try Gemini AI first, fall back to Tesseract
    let res = await authFetch('/ai/scan_receipt', {
      method: 'POST',
      body: formData
    });
    let data = await res.json();

    // If AI is not configured, fall back to Tesseract OCR
    if (!res.ok && data.error && data.error.includes('not configured')) {
      const formData2 = new FormData();
      formData2.append('receipt', file);
      res = await authFetch('/scan_receipt', { method: 'POST', body: formData2 });
      data = await res.json();
      // Map Tesseract response fields
      data.amount = data.extracted_amount;
      data.merchant = data.extracted_merchant;
      data.date = data.extracted_date;
    }

    if (!res.ok) {
      scanBox.innerHTML = `<div style="color:var(--red);padding:8px">❌ ${data.error}</div>`;
      resetScanBox(scanBox);
      return;
    }

    // Auto-fill extracted fields
    if (data.amount) {
      document.getElementById('amount').value = Math.round(parseFloat(data.amount));
    }
    if (data.merchant) {
      document.getElementById('merchant').value = data.merchant;
      suggest(data.merchant);
    }
    if (data.date) {
      const parsed = parseReceiptDate(data.date);
      if (parsed) document.getElementById('date').value = parsed;
    }
    if (data.category) {
      document.getElementById('category').value = data.category;
    }

    // Show result
    const preview = URL.createObjectURL(file);
    const itemsHtml = data.items && data.items.length
      ? `<div style="margin-top:2px">Items: ${data.items.slice(0, 3).join(', ')}${data.items.length > 3 ? '...' : ''}</div>` : '';

    scanBox.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px">
        <img src="${preview}" style="max-height:60px;border-radius:6px"/>
        <div style="flex:1;font-size:12px;line-height:1.4">
          <div style="color:var(--green);font-weight:600">✅ Receipt scanned with AI!</div>
          ${data.amount ? `<div>Amount: <b>₹${data.amount}</b></div>` : '<div style="color:var(--text-secondary)">Amount not detected</div>'}
          ${data.merchant ? `<div>Merchant: <b>${data.merchant}</b></div>` : ''}
          ${data.category ? `<div>Category: <b>${data.category}</b></div>` : ''}
          ${itemsHtml}
        </div>
      </div>`;
    resetScanBox(scanBox);
    showStatus('✅ Receipt scanned with AI! Review fields and save.');
  } catch (err) {
    scanBox.innerHTML = `<div style="color:var(--red);padding:8px">❌ ${err.message}</div>`;
    resetScanBox(scanBox);
  }
}

function resetScanBox(scanBox) {
  // Re-add the file input after 10 seconds so user can scan again
  setTimeout(() => {
    scanBox.innerHTML += `
      <div onclick="document.getElementById('receiptFile2').click()" style="margin-top:6px;cursor:pointer;color:var(--text-secondary);font-size:12px">
        📷 Scan another receipt
        <input type="file" id="receiptFile2" accept="image/*" style="display:none" onchange="scanReceipt(this)"/>
      </div>`;
  }, 500);
}

function parseReceiptDate(dateStr) {
  // Try DD/MM/YYYY or DD-MM-YYYY
  let m = dateStr.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // Try YYYY-MM-DD or YYYY/MM/DD
  m = dateStr.match(/(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // Try DD/MM/YY
  m = dateStr.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})/);
  if (m) {
    const [, d, mo, y] = m;
    return `20${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

// ==================== QUICK ADD ====================
function quickFill(merchant, category) {
  document.getElementById('merchant').value = merchant;
  document.getElementById('category').value = category;
  document.getElementById('amount').focus();
}

// ==================== SAVE TRANSACTION ====================
async function saveTransaction() {
  const merchant = document.getElementById('merchant').value.trim();
  const amount   = document.getElementById('amount').value;
  const category = document.getElementById('category').value;
  const type     = document.getElementById('txntype').value;
  const date     = document.getElementById('date').value;
  const note     = document.getElementById('note').value.trim();

  if (!merchant || !amount) {
    showStatus('⚠️ Please fill in merchant and amount!', true);
    return;
  }

  try {
    const res = await authFetch('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant, amount, category, type, date, note })
    });

    if (res.ok) {
      document.getElementById('merchant').value  = '';
      document.getElementById('amount').value    = '';
      document.getElementById('category').value  = '';
      document.getElementById('note').value      = '';
      document.getElementById('suggestions').innerHTML = '';
      document.getElementById('date').value = new Date().toISOString().split('T')[0];
      showStatus('Transaction saved successfully!');
      loadDashboard();
    } else {
      showStatus('Server error. Try again.', true);
    }
  } catch (err) {
    showStatus(err.message, true);
  }
}

// ==================== DELETE SINGLE TRANSACTION ====================
async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  try {
    const res = await authFetch(`/transactions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showStatus('Transaction deleted.');
      loadDashboard();
    }
  } catch (err) {
    showStatus(err.message, true);
  }
}

// ==================== CLEAR ALL ====================
async function clearAll() {
  if (!confirm('Are you sure you want to delete ALL your transactions?')) return;
  try {
    const res = await authFetch('/clear', { method: 'DELETE' });
    if (res.ok) {
      showStatus('All transactions cleared.');
      loadDashboard();
    }
  } catch (err) {
    showStatus(err.message, true);
  }
}

// ==================== STATUS MESSAGE ====================
function showStatus(msg, isError = false) {
  const el = document.getElementById('statusMsg');
  el.textContent  = msg;
  el.style.color  = isError ? 'var(--red)' : 'var(--green)';
  setTimeout(() => { el.textContent = ''; }, 3000);
}
// ==================== AI STATEMENT UPLOAD ====================
let pendingStatementTxns = [];

async function processStatement() {
  const textarea = document.getElementById('statementText');
  const btn = document.querySelector('.statement-btn');
  const text = textarea.value.trim();

  if (!text) {
    showStatus('Please paste your bank SMS or statement text first.', true);
    return;
  }

  btn.classList.add('loading');

  try {
    const res = await authFetch('/api/upload_statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus(data.error || 'Failed to parse statement.', true);
      btn.classList.remove('loading');
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      showStatus('No transactions found in the text. Try pasting more SMS messages.', true);
      btn.classList.remove('loading');
      return;
    }

    pendingStatementTxns = data;
    renderReviewTable(data);
    document.getElementById('statementReviewModal').style.display = 'flex';
    textarea.value = '';

  } catch (err) {
    showStatus('Error: ' + err.message, true);
  } finally {
    btn.classList.remove('loading');
  }
}

function renderReviewTable(txns) {
  const tbody = document.getElementById('reviewTableBody');
  const categories = ['Food','Groceries','Shopping','Travel','Entertainment','Healthcare','Bills','Others'];
  
  tbody.innerHTML = txns.map((t, i) => {
    const catOptions = categories.map(c =>
      `<option value="${c}" ${t.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    return `<tr data-idx="${i}">
      <td>${t.date || '—'}</td>
      <td>₹${Number(t.amount || 0).toLocaleString('en-IN')}</td>
      <td><input type="text" value="${(t.merchant || '').replace(/"/g, '&quot;')}" data-field="merchant" data-original="${(t.upi_id || t.merchant || '').replace(/"/g, '&quot;')}" /></td>
      <td><span style="font-size:11px;opacity:0.7">${t.upi_id || '—'}</span></td>
      <td><select data-field="category">${catOptions}</select></td>
      <td>${t.type || 'Expense'}</td>
    </tr>`;
  }).join('');
}

async function approveStatementTransactions() {
  const rows = document.querySelectorAll('#reviewTableBody tr');
  const aliasPromises = [];

  rows.forEach((row, i) => {
    const merchantInput = row.querySelector('input[data-field="merchant"]');
    const categorySelect = row.querySelector('select[data-field="category"]');
    const original = merchantInput.dataset.original;
    const newName = merchantInput.value.trim();
    const newCat = categorySelect.value;

    // Update the pending transaction with user edits
    pendingStatementTxns[i].merchant = newName;
    pendingStatementTxns[i].category = newCat;

    // If user changed the name, save it as an alias for future auto-correction
    if (original && newName && newName !== original) {
      aliasPromises.push(
        authFetch('/api/aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            original_name: original,
            alias_name: newName,
            category: newCat
          })
        }).catch(err => console.warn('Alias save failed:', err))
      );
    }
  });

  // Save aliases in parallel
  await Promise.all(aliasPromises);

  // Bulk insert all transactions
  try {
    const res = await authFetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: pendingStatementTxns })
    });

    const data = await res.json();
    if (data.success) {
      showStatus(`✅ ${data.count} transactions imported successfully!`);
      closeReviewModal();
      loadDashboard();
    } else {
      showStatus(data.error || 'Failed to save transactions.', true);
    }
  } catch (err) {
    showStatus('Error saving: ' + err.message, true);
  }
}

function closeReviewModal() {
  document.getElementById('statementReviewModal').style.display = 'none';
  pendingStatementTxns = [];
}

// ==================== DARK MODE ====================
let syncDotGridTheme = null;

function toggleTheme() {
  const body = document.body;
  const btn  = document.querySelector('.theme-btn');
  if (body.getAttribute('data-theme') === 'dark') {
    body.removeAttribute('data-theme');
    if (btn) btn.textContent = '🌙';
    localStorage.setItem('theme', 'light');
  } else {
    body.setAttribute('data-theme', 'dark');
    if (btn) btn.textContent = '☀️';
    localStorage.setItem('theme', 'dark');
  }
  if (syncDotGridTheme) syncDotGridTheme();
}

// ==================== LOAD DASHBOARD ====================
async function loadDashboard() {
  try {
    const [txnRes, sumRes] = await Promise.all([
      authFetch('/transactions'),
      authFetch('/summary')
    ]);
    const txns = await txnRes.json();
    const sum  = await sumRes.json();

    document.getElementById('stat-income').textContent  = '₹' + Number(sum.income).toLocaleString('en-IN');
    document.getElementById('stat-expense').textContent = '₹' + Number(sum.expense).toLocaleString('en-IN');
    document.getElementById('stat-savings').textContent = '₹' + Number(sum.savings).toLocaleString('en-IN');
    document.getElementById('stat-count').textContent   = txns.length;

    const savEl = document.getElementById('stat-savings');
    savEl.className = 'value ' + (sum.savings >= 0 ? 'green' : 'red');

    renderList(txns.slice(0, 10));
    renderPieChart(sum.by_category);
    renderBarChart(txns);
    document.getElementById('chartEmpty').style.display = sum.by_category.length ? 'none' : 'block';
    loadInsights();
    loadTrends();
    loadHeatmap();
    loadBudgets();
    loadSubscriptions();
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ==================== TRANSACTION LIST ====================
const catColors = {
  Food:'#FFF3E0', Travel:'#E3F2FD', Groceries:'#E8F5E9',
  Shopping:'#E3F2FD', Entertainment:'#EDE7F6', Healthcare:'#FCE4EC',
  Bills:'#FFF8E1', Income:'#E0F2F1', Others:'#F5F5F5'
};
const catIcons = {
  Food:'🍔', Travel:'🚗', Groceries:'🛒', Shopping:'📦',
  Entertainment:'🎬', Healthcare:'💊', Bills:'💡', Income:'💰', Others:'📝'
};

function renderList(txns) {
  const list = document.getElementById('txnList');
  if (!txns.length) {
    list.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;text-align:center;padding:2rem">No transactions yet. Add one above! ☝️</p>';
    return;
  }

  list.innerHTML = txns.map(t => {
    const [id, amount, merchant, category, type, date, note] = t;
    const bg     = catColors[category] || '#F5F5F5';
    const icon   = catIcons[category]  || '📝';
    const prefix = type === 'Income' ? '+' : '-';
    const color  = type === 'Income' ? 'var(--green)' : 'var(--red)';
    const noteHtml = note ? `<div class="txn-note">${note}</div>` : '';

    return `
      <div class="txn-row">
        <div class="txn-icon" style="background:${bg}">${icon}</div>
        <div class="txn-info">
          <div class="txn-merchant">${merchant}
            <span class="badge" style="background:${bg};color:var(--text)">${category}</span>
          </div>
          <div class="txn-date">${date || 'No date'}</div>
          ${noteHtml}
        </div>
        <div class="txn-amount" style="color:${color}">${prefix}₹${Number(amount).toLocaleString('en-IN')}</div>
        <button class="delete-txn-btn" onclick="deleteTransaction(${id})" title="Delete">✕</button>
      </div>`;
  }).join('');
}

// ==================== PIE CHART ====================
let pieChart;
function renderPieChart(data) {
  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  if (!data || !data.length) return;

  const colors = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#C9CBCF','#7BC67E'];
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{ data: data.map(d => d[1]), backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: 'var(--card-bg)' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } } },
      cutout: '65%'
    }
  });
}

// ==================== BAR CHART ====================
let barChart;
function renderBarChart(txns) {
  const ctx = document.getElementById('barChart').getContext('2d');
  if (barChart) barChart.destroy();
  if (!txns.length) return;

  const monthly = {};
  txns.forEach(t => {
    const [id, amount, merchant, category, type, date] = t;
    if (!date) return;
    const month = date.substring(0, 7);
    if (!monthly[month]) monthly[month] = { income: 0, expense: 0 };
    if (type === 'Income') monthly[month].income += amount;
    else monthly[month].expense += amount;
  });

  const months = Object.keys(monthly).sort().slice(-6);
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => {
        const [y, mo] = m.split('-');
        return new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
      }),
      datasets: [
        { label: 'Income',  data: months.map(m => monthly[m].income),  backgroundColor: '#4BC0C0', borderRadius: 6 },
        { label: 'Expense', data: months.map(m => monthly[m].expense), backgroundColor: '#FF6384', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ==================== AI INSIGHTS ====================
async function loadInsights() {
  const el = document.getElementById('aiInsights');
  if (!el) return;
  el.innerHTML = '<div class="ai-loading"><div class="scan-spinner"></div> Analyzing spending patterns...</div>';
  try {
    const res = await authFetch('/ai/insights');
    const data = await res.json();
    if (data.error) {
      el.innerHTML = `<div class="ai-no-data">${data.error}</div>`;
    } else {
      el.innerHTML = `<div class="ai-insights-text">${formatAiText(data.insights)}</div>`;
    }
  } catch {
    el.innerHTML = '<div class="ai-no-data">Could not load AI insights.</div>';
  }
}

function formatAiText(text) {
  // Convert markdown-like bullets and bold to HTML
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[\-\*•]\s*/gm, '')
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<div class="ai-insight-item">${l}</div>`)
    .join('');
}

// ==================== AI CHAT ====================
function toggleAiChat() {
  const drawer = document.getElementById('aiChatDrawer');
  const fab = document.getElementById('aiFab');
  const isOpen = drawer.classList.toggle('open');
  fab.style.display = isOpen ? 'none' : 'flex';
}

function askAi(question) {
  document.getElementById('aiChatInput').value = question;
  sendAiChat();
}

async function sendAiChat() {
  const input = document.getElementById('aiChatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const messages = document.getElementById('aiChatMessages');

  // Add user message
  messages.innerHTML += `<div class="ai-msg user">${msg}</div>`;

  // Add typing indicator
  const typingId = 'typing-' + Date.now();
  messages.innerHTML += `<div class="ai-msg bot ai-typing" id="${typingId}"><span class="dot-pulse"></span> Thinking...</div>`;
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await authFetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();

    // Remove typing indicator
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    if (data.error) {
      messages.innerHTML += `<div class="ai-msg bot" style="color:var(--red)">${data.error}</div>`;
    } else {
      messages.innerHTML += `<div class="ai-msg bot">${formatAiText(data.reply)}</div>`;
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    messages.innerHTML += `<div class="ai-msg bot" style="color:var(--red)"> ${err.message}</div>`;
  }
  messages.scrollTop = messages.scrollHeight;
}

// ==================== PDF EXPORT ====================
async function exportPDF() {
  try {
    const res = await fetch('/export/pdf', {
      headers: { 'Authorization': 'Bearer ' + currentToken }
    });
    if (!res.ok) { alert('Export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expense_report_${new Date().toISOString().split('T')[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

// ==================== NATURAL LANGUAGE ADD ====================
async function parseNL() {
  const input = document.getElementById('nlInput');
  const text = input.value.trim();
  if (!text) return;

  input.disabled = true;
  input.placeholder = 'Parsing...';

  try {
    const res = await authFetch('/ai/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();

    if (data.amount) document.getElementById('amount').value = Math.round(data.amount);
    if (data.merchant) document.getElementById('merchant').value = data.merchant;
    if (data.category) document.getElementById('category').value = data.category;
    if (data.type) document.getElementById('txntype').value = data.type;
    if (data.date) document.getElementById('date').value = data.date;
    if (data.note) document.getElementById('note').value = data.note;

    input.value = '';
    showStatus('Parsed! Review and save.');
  } catch (e) {
    showStatus('Parse failed: ' + e.message);
  }
  input.disabled = false;
  input.placeholder = 'Type naturally: "Spent 500 at Zomato yesterday"';
}

// ==================== SPENDING TRENDS ====================
let trendsChartInstance = null;

async function loadTrends() {
  try {
    const res = await authFetch('/trends');
    const data = await res.json();
    if (!data.length) return;

    // Last 30 days
    const today = new Date();
    const labels = [];
    const values = [];
    const dataMap = {};
    data.forEach(([date, amt]) => { dataMap[date] = amt; });

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      values.push(dataMap[key] || 0);
    }

    const ctx = document.getElementById('trendsChart');
    if (!ctx) return;
    if (trendsChartInstance) trendsChartInstance.destroy();

    trendsChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daily Spending (₹)',
          data: values,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 6,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } } }
        }
      }
    });
  } catch (e) { console.error('Trends error:', e); }
}

// ==================== HEATMAP CALENDAR ====================
async function loadHeatmap() {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;

  try {
    const res = await authFetch('/heatmap');
    const data = await res.json();

    const amounts = Object.values(data);
    const max = Math.max(...amounts, 1);
    const today = new Date();
    let html = '<div class="heatmap-grid">';

    // 365 days
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const amt = data[key] || 0;
      const level = amt === 0 ? 0 : amt < max * 0.25 ? 1 : amt < max * 0.5 ? 2 : amt < max * 0.75 ? 3 : 4;
      const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const title = amt > 0 ? `₹${amt.toLocaleString()} on ${dateStr}` : `No spend on ${dateStr}`;
      html += `<div class="hm-day hm-${level}" title="${title}"></div>`;
    }

    html += '</div>';
    container.innerHTML = html;
  } catch (e) { console.error('Heatmap error:', e); }
}

// ==================== 2FA MANAGEMENT ====================
function open2FAModal() {
  document.getElementById('tfaModal').style.display = 'flex';
  load2FAStatus();
}

function close2FAModal() {
  document.getElementById('tfaModal').style.display = 'none';
}

async function load2FAStatus() {
  const el = document.getElementById('tfaContent');
  try {
    const res = await authFetch('/2fa/status');
    const data = await res.json();

    if (data.enabled) {
      el.innerHTML = `
        <div style="text-align:center;padding:16px 0">
          <p style="font-weight:700;margin-bottom:4px">2FA is Active</p>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">Your account is protected with two-factor authentication.</p>
          <div class="field">
            <label>Enter 2FA code to disable</label>
            <input type="text" id="tfaDisableCode" placeholder="6-digit code" maxlength="6"/>
          </div>
          <button class="save-btn" style="background:var(--red)" onclick="disable2FA()">Disable 2FA</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div style="text-align:center;padding:16px 0">
          <p style="font-weight:700;margin-bottom:4px">2FA is Off</p>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">Add an extra layer of security to your account.</p>
          <button class="save-btn" onclick="setup2FA()">Enable 2FA</button>
        </div>`;
    }
  } catch {
    el.innerHTML = '<p style="color:var(--red);padding:16px">Error loading 2FA status.</p>';
  }
}

async function setup2FA() {
  const el = document.getElementById('tfaContent');
  el.innerHTML = '<div class="ai-loading"><div class="scan-spinner"></div> Generating QR code...</div>';

  try {
    const res = await authFetch('/2fa/setup', { method: 'POST' });
    const data = await res.json();

    el.innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <p style="font-size:13px;margin-bottom:12px">Scan this QR code with <b>Google Authenticator</b> or any TOTP app:</p>
        <img src="data:image/png;base64,${data.qr_code}" style="width:200px;height:200px;border-radius:8px;margin-bottom:12px"/>
        <p style="font-size:10px;color:var(--text-secondary);margin-bottom:16px;word-break:break-all">Secret: ${data.secret}</p>
        <div class="field">
          <label>Enter the 6-digit code from your app</label>
          <input type="text" id="tfaVerifyCode" placeholder="123456" maxlength="6"/>
        </div>
        <button class="save-btn" onclick="verify2FA()">Verify & Enable</button>
      </div>`;
  } catch {
    el.innerHTML = '<p style="color:var(--red)">Failed to set up 2FA.</p>';
  }
}

async function verify2FA() {
  const code = document.getElementById('tfaVerifyCode').value.trim();
  if (!code) return;
  try {
    const res = await authFetch('/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.status === 'enabled') {
      load2FAStatus();
    } else {
      alert(data.error || 'Invalid code');
    }
  } catch { alert('Verification failed'); }
}

async function disable2FA() {
  const code = document.getElementById('tfaDisableCode').value.trim();
  if (!code) return;
  try {
    const res = await authFetch('/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.status === 'disabled') {
      load2FAStatus();
    } else {
      alert(data.error || 'Invalid code');
    }
  } catch { alert('Disable failed'); }
}

// ==================== MONTHLY BUDGETS ====================
function openBudgetModal() {
  document.getElementById('budgetModal').style.display = 'flex';
}

function closeBudgetModal() {
  document.getElementById('budgetModal').style.display = 'none';
}

async function loadBudgets() {
  const container = document.getElementById('budgetsList');
  try {
    const res = await authFetch('/budgets');
    const budgets = await res.json();
    
    if (!budgets.length) {
      container.innerHTML = '<div class="ai-no-data">No budgets set yet.</div>';
      return;
    }
    
    let html = '';
    budgets.forEach(b => {
      const pct = Math.min((b.spent / b.limit) * 100, 100);
      let color = 'var(--green)';
      if (pct > 90) color = 'var(--red)';
      else if (pct > 75) color = '#f59e0b'; // yellow

      html += `
        <div style="margin-bottom: 12px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;font-weight:600;">
            <span>${b.category}</span>
            <span>₹${b.spent.toLocaleString()} / ₹${b.limit.toLocaleString()}</span>
          </div>
          <div style="width:100%;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};transition:width 0.5s ease;"></div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="ai-no-data">Failed to load budgets.</div>';
  }
}

async function saveBudget() {
  const category = document.getElementById('budgetCategory').value;
  const amount = document.getElementById('budgetAmount').value;
  
  if (!amount) return;
  
  try {
    const res = await authFetch('/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, amount })
    });
    if (res.ok) {
      closeBudgetModal();
      document.getElementById('budgetAmount').value = '';
      loadBudgets();
    }
  } catch (e) { alert('Failed to save budget'); }
}

// ==================== SUBSCRIPTIONS ====================
function openSubModal() {
  document.getElementById('subModal').style.display = 'flex';
}

function closeSubModal() {
  document.getElementById('subModal').style.display = 'none';
}

async function loadSubscriptions() {
  const container = document.getElementById('subsList');
  try {
    const res = await authFetch('/subscriptions');
    const subs = await res.json();
    
    if (!subs.length) {
      container.innerHTML = '<div class="ai-no-data">No active subscriptions.</div>';
      return;
    }
    
    let html = '';
    subs.forEach(s => {
      const dueStr = new Date(s.next_due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      html += `
        <div class="txn-row" style="padding: 8px;">
          <div class="txn-icon" style="background:var(--accent-light);color:var(--accent);font-size:14px;width:32px;height:32px;">🔁</div>
          <div class="txn-info">
            <div class="txn-merchant" style="font-size:12px;">${s.name} <span class="badge" style="background:var(--border)">${s.category}</span></div>
            <div class="txn-date" style="font-size:10px;">Due: ${dueStr}</div>
          </div>
          <div class="txn-amount">₹${s.amount.toLocaleString()}</div>
          <button class="delete-txn-btn" onclick="deleteSubscription(${s.id})" title="Cancel">✕</button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="ai-no-data">Failed to load subscriptions.</div>';
  }
}

async function saveSubscription() {
  const name = document.getElementById('subName').value.trim();
  const amount = document.getElementById('subAmount').value;
  const category = document.getElementById('subCategory').value;
  const start_date = document.getElementById('subDate').value; // if empty, backend defaults to today
  
  if (!name || !amount) return;
  
  try {
    const res = await authFetch('/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, amount, category, start_date: start_date || undefined })
    });
    if (res.ok) {
      closeSubModal();
      document.getElementById('subName').value = '';
      document.getElementById('subAmount').value = '';
      document.getElementById('subDate').value = '';
      loadSubscriptions();
      loadDashboard(); // reload since it might have auto-paid
    }
  } catch (e) { alert('Failed to add subscription'); }
}

async function deleteSubscription(id) {
  if (!confirm('Cancel this subscription?')) return;
  try {
    const res = await authFetch(`/subscriptions/${id}`, { method: 'DELETE' });
    if (res.ok) loadSubscriptions();
  } catch (e) { alert('Failed to cancel'); }
}

// ==================== BACKGROUND ANIMATION ====================
function initDotGrid() {
  const canvas = document.createElement('canvas');
  canvas.id = 'dotGridCanvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '0';
  canvas.style.pointerEvents = 'none';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });
  
  const dotSize = 5;
  const gap = 15;
  const proximity = 120;
  const shockRadius = 250;
  const shockStrength = 10;
  const returnDuration = 1.5;

  let dots = [];
  let pointer = { x: -1000, y: -1000, lastTime: 0, lastX: 0, lastY: 0, vx: 0, vy: 0 };
  let rafId;

  let dotBaseRgb = { r: 0, g: 0, b: 0 }; 
  let dotActiveRgb = { r: 82, g: 39, b: 255 };

  syncDotGridTheme = function() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    dotBaseRgb = isDark ? { r: 39, g: 30, b: 55 } : { r: 210, g: 215, b: 226 };
    dotActiveRgb = isDark ? { r: 82, g: 39, b: 255 } : { r: 90, g: 103, b: 216 };
  };
  syncDotGridTheme();

  function buildGrid() {
    dots = [];
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const cols = Math.floor((width + gap) / (dotSize + gap));
    const rows = Math.floor((height + gap) / (dotSize + gap));
    const cell = dotSize + gap;

    const gridW = cell * cols - gap;
    const gridH = cell * rows - gap;
    
    const startX = (width - gridW) / 2 + dotSize / 2;
    const startY = (height - gridH) / 2 + dotSize / 2;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({ 
          cx: startX + x * cell, 
          cy: startY + y * cell, 
          xOffset: 0, 
          yOffset: 0, 
          _active: false 
        });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x: px, y: py } = pointer;
    const proxSq = proximity * proximity;
    
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const ox = dot.cx + dot.xOffset;
      const oy = dot.cy + dot.yOffset;
      const dx = dot.cx - px;
      const dy = dot.cy - py;
      const dsq = dx * dx + dy * dy;

      let r = dotBaseRgb.r, g = dotBaseRgb.g, b = dotBaseRgb.b;
      
      if (dsq <= proxSq) {
        const dist = Math.sqrt(dsq);
        const t = 1 - (dist / proximity);
        r = Math.round(dotBaseRgb.r + (dotActiveRgb.r - dotBaseRgb.r) * t);
        g = Math.round(dotBaseRgb.g + (dotActiveRgb.g - dotBaseRgb.g) * t);
        b = Math.round(dotBaseRgb.b + (dotActiveRgb.b - dotBaseRgb.b) * t);
      }

      ctx.beginPath();
      ctx.arc(ox, oy, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
    }
    rafId = requestAnimationFrame(draw);
  }

  buildGrid();
  draw();

  window.addEventListener('resize', buildGrid);

  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    const dt = pointer.lastTime ? now - pointer.lastTime : 16;
    const dx = e.clientX - pointer.lastX;
    const dy = e.clientY - pointer.lastY;
    
    let vx = (dx / dt) * 10;
    let vy = (dy / dt) * 10;
    
    pointer.lastTime = now;
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    const speed = Math.hypot(vx, vy);
    
    for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const dist = Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y);
        
        if (speed > 1 && dist < proximity && !dot._active && typeof gsap !== 'undefined') {
            dot._active = true;
            gsap.killTweensOf(dot);
            
            const pushX = (dot.cx - pointer.x) * 0.15 + (vx * 2);
            const pushY = (dot.cy - pointer.y) * 0.15 + (vy * 2);
            
            gsap.timeline()
                .to(dot, {
                    xOffset: pushX,
                    yOffset: pushY,
                    duration: 0.15,
                    ease: 'power2.out'
                })
                .to(dot, {
                    xOffset: 0,
                    yOffset: 0,
                    duration: returnDuration,
                    ease: 'elastic.out(1, 0.5)',
                    onComplete: () => { dot._active = false; }
                });
        }
    }
  });

  window.addEventListener('click', (e) => {
    if (typeof gsap === 'undefined') return;
    const cx = e.clientX;
    const cy = e.clientY;
    
    for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
        
        if (dist < shockRadius && !dot._active) {
            dot._active = true;
            gsap.killTweensOf(dot);
            
            const falloff = Math.max(0, 1 - (dist / shockRadius));
            const pushX = (dot.cx - cx) * 0.2 * falloff * shockStrength;
            const pushY = (dot.cy - cy) * 0.2 * falloff * shockStrength;
            
            gsap.timeline()
                .to(dot, { xOffset: pushX, yOffset: pushY, duration: 0.15, ease: 'power2.out' })
                .to(dot, { xOffset: 0, yOffset: 0, duration: returnDuration, ease: 'elastic.out(1, 0.3)', onComplete: () => { dot._active = false; } });
        }
    }
  });
}

// ==================== TARGET CURSOR (Vanilla Translation) ====================
function initTargetCursor() {
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 768);
  const cursorRef = document.getElementById('targetCursor');
  if (isMobile) {
    if (cursorRef) cursorRef.style.display = 'none';
    return;
  }
  if (!cursorRef) return;
  cursorRef.style.display = 'block';

  // Only hide default cursor on interactive targets, or globally if desired.
  // We'll hide it globally to match user's default hideDefaultCursor logic,
  // but let standard text inputs recover standard I-beam using CSS if needed.
  document.body.style.cursor = 'none';

  const dotRef = document.getElementById('targetCursorDot');
  const cornersRef = cursorRef.querySelectorAll('.target-cursor-corner');

  const config = {
    targetSelector: '.cursor-target, button, input:not([type="text"]):not([type="number"]), select, .pill, a',
    spinDuration: 2,
    hoverDuration: 0.2,
    parallaxOn: true,
    borderWidth: 3,
    cornerSize: 12
  };

  let activeTarget = null;
  let currentLeaveHandler = null;
  let resumeTimeout = null;
  let targetCornerPositions = null;
  let activeStrength = { current: 0 };
  let spinTl = null;

  gsap.set(cursorRef, { xPercent: -50, yPercent: -50, x: window.innerWidth / 2, y: window.innerHeight / 2 });

  function createSpinTimeline() {
    if (spinTl) spinTl.kill();
    spinTl = gsap.timeline({ repeat: -1 }).to(cursorRef, { rotation: "+=360", duration: config.spinDuration, ease: "none" });
  }
  createSpinTimeline();

  function moveCursor(x, y) {
    gsap.to(cursorRef, { x, y, duration: 0.1, ease: 'power3.out' });
  }

  function tickerFn() {
    if (!targetCornerPositions) return;
    const strength = activeStrength.current;
    if (strength === 0) return;

    const cursorX = gsap.getProperty(cursorRef, 'x');
    const cursorY = gsap.getProperty(cursorRef, 'y');

    cornersRef.forEach((corner, i) => {
      const currentX = gsap.getProperty(corner, 'x');
      const currentY = gsap.getProperty(corner, 'y');

      const targetX = targetCornerPositions[i].x - cursorX;
      const targetY = targetCornerPositions[i].y - cursorY;

      const finalX = currentX + (targetX - currentX) * strength;
      const finalY = currentY + (targetY - currentY) * strength;
      const duration = strength >= 0.99 ? (config.parallaxOn ? 0.2 : 0) : 0.05;

      gsap.to(corner, { x: finalX, y: finalY, duration: duration, ease: duration === 0 ? 'none' : 'power1.out', overwrite: 'auto' });
    });
  }

  window.addEventListener('mousemove', (e) => {
    // Override cursor for pure text inputs so developers can still highlight and see standard selection I-beams easily
    if (e.target && e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'number')) {
        document.body.style.cursor = 'text';
    } else {
        document.body.style.cursor = 'none';
    }
    moveCursor(e.clientX, e.clientY);
  });

  window.addEventListener('scroll', () => {
    if (!activeTarget) return;
    const mouseX = gsap.getProperty(cursorRef, 'x');
    const mouseY = gsap.getProperty(cursorRef, 'y');
    const elUnder = document.elementFromPoint(mouseX, mouseY);
    const isOver = elUnder && (elUnder === activeTarget || elUnder.closest(config.targetSelector) === activeTarget);
    if (!isOver && currentLeaveHandler) currentLeaveHandler();
  }, { passive: true });

  window.addEventListener('mousedown', () => {
    gsap.to(dotRef, { scale: 0.7, duration: 0.3 });
    gsap.to(cursorRef, { scale: 0.9, duration: 0.2 });
  });

  window.addEventListener('mouseup', () => {
    gsap.to(dotRef, { scale: 1, duration: 0.3 });
    gsap.to(cursorRef, { scale: 1, duration: 0.2 });
  });

  function cleanupTarget(target) {
    if (currentLeaveHandler) {
      target.removeEventListener('mouseleave', currentLeaveHandler);
      currentLeaveHandler = null;
    }
  }

  window.addEventListener('mouseover', (e) => {
    const target = e.target.closest(config.targetSelector);
    if (!target || activeTarget === target) return;

    if (activeTarget) cleanupTarget(activeTarget);
    if (resumeTimeout) { clearTimeout(resumeTimeout); resumeTimeout = null; }

    activeTarget = target;
    cornersRef.forEach(c => gsap.killTweensOf(c));
    
    gsap.killTweensOf(cursorRef, 'rotation');
    if (spinTl) spinTl.pause();
    gsap.set(cursorRef, { rotation: 0 });

    const rect = target.getBoundingClientRect();
    const cursorX = gsap.getProperty(cursorRef, 'x');
    const cursorY = gsap.getProperty(cursorRef, 'y');

    targetCornerPositions = [
      { x: rect.left - config.borderWidth, y: rect.top - config.borderWidth },
      { x: rect.right + config.borderWidth - config.cornerSize, y: rect.top - config.borderWidth },
      { x: rect.right + config.borderWidth - config.cornerSize, y: rect.bottom + config.borderWidth - config.cornerSize },
      { x: rect.left - config.borderWidth, y: rect.bottom + config.borderWidth - config.cornerSize }
    ];

    gsap.ticker.add(tickerFn);
    gsap.to(activeStrength, { current: 1, duration: config.hoverDuration, ease: 'power2.out' });

    cornersRef.forEach((corner, i) => {
      gsap.to(corner, { x: targetCornerPositions[i].x - cursorX, y: targetCornerPositions[i].y - cursorY, duration: 0.2, ease: 'power2.out' });
    });

    currentLeaveHandler = () => {
      gsap.ticker.remove(tickerFn);
      targetCornerPositions = null;
      gsap.set(activeStrength, { current: 0, overwrite: true });
      activeTarget = null;
      
      const positions = [
        { x: -config.cornerSize * 1.5, y: -config.cornerSize * 1.5 },
        { x: config.cornerSize * 0.5, y: -config.cornerSize * 1.5 },
        { x: config.cornerSize * 0.5, y: config.cornerSize * 0.5 },
        { x: -config.cornerSize * 1.5, y: config.cornerSize * 0.5 }
      ];
      
      const tl = gsap.timeline();
      cornersRef.forEach((corner, index) => {
        gsap.killTweensOf(corner);
        tl.to(corner, { x: positions[index].x, y: positions[index].y, duration: 0.3, ease: 'power3.out' }, 0);
      });

      resumeTimeout = setTimeout(() => {
        if (!activeTarget && spinTl) {
          const currentRot = gsap.getProperty(cursorRef, 'rotation');
          const normRot = currentRot % 360;
          spinTl.kill();
          spinTl = gsap.timeline({ repeat: -1 }).to(cursorRef, { rotation: "+=360", duration: config.spinDuration, ease: "none" });
          gsap.to(cursorRef, {
            rotation: normRot + 360,
            duration: config.spinDuration * (1 - normRot / 360),
            ease: "none",
            onComplete: () => spinTl.restart()
          });
        }
        resumeTimeout = null;
      }, 50);

      cleanupTarget(target);
    };

    target.addEventListener('mouseleave', currentLeaveHandler);
  }, { passive: true });
}

// ==================== VANILLA MAC DOCK ====================
function initVanillaDock() {
  const panel = document.getElementById('dockPanel');
  if (!panel) return;
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 768);
  if (isMobile) {
    document.getElementById('vanillaDock').style.display = 'none';
    return;
  }

  const items = panel.querySelectorAll('.dock-item');
  if (items.length === 0) return;

  const config = {
    baseItemSize: 50,
    magnification: 70,
    distance: 200,
    panelHeight: 68,
    dockHeight: 256
  };

  const maxHeight = Math.max(config.dockHeight, config.magnification + (config.magnification / 2) + 4);

  gsap.set(panel, { height: config.panelHeight });
  
  items.forEach(item => {
    gsap.set(item, { width: config.baseItemSize, height: config.baseItemSize });
    const label = item.querySelector('.dock-label');
    if (label) {
      gsap.set(label, { opacity: 0, y: 0, display: 'none' });
    }
    
    item.addEventListener('mouseenter', () => {
      if (label) {
        label.style.display = 'block';
        gsap.to(label, { opacity: 1, y: -10, duration: 0.2, overwrite: 'auto' });
      }
    });
    item.addEventListener('mouseleave', () => {
      if (label) {
        gsap.to(label, { opacity: 0, y: 0, duration: 0.2, overwrite: 'auto', onComplete: () => {
          label.style.display = 'none';
        }});
      }
    });
  });

  const handleMouseMove = (e) => {
    gsap.to(panel, { height: maxHeight, duration: 0.2, overwrite: 'auto', ease: 'power2.out' });

    const mouseX = e.clientX;
    items.forEach(item => {
      const rect = item.getBoundingClientRect();
      const mouseDistance = Math.abs(mouseX - (rect.x + config.baseItemSize / 2));

      let targetSize = config.baseItemSize;
      if (mouseDistance < config.distance) {
        const progress = 1 - (mouseDistance / config.distance);
        targetSize = config.baseItemSize + (config.magnification - config.baseItemSize) * progress;
      }

      gsap.to(item, {
        width: targetSize,
        height: targetSize,
        duration: 0.1,
        ease: 'power2.out',
        overwrite: 'auto'
      });
    });
  };

  const handleMouseLeave = () => {
    gsap.to(panel, { height: config.panelHeight, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
    items.forEach(item => {
      gsap.to(item, {
        width: config.baseItemSize,
        height: config.baseItemSize,
        duration: 0.3,
        ease: 'elastic.out(1, 0.4)',
        overwrite: 'auto'
      });
    });
  };

  panel.addEventListener('mousemove', handleMouseMove);
  panel.addEventListener('mouseleave', handleMouseLeave);
}