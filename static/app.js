async function loadInsights(forceRefresh = false) {
    const insightGrid = document.getElementById('insight-grid');
    const refreshBtn = document.getElementById('refresh-insights-btn');
    if (!insightGrid || !refreshBtn) return;

    refreshBtn.textContent = 'Loading...';
    insightGrid.innerHTML = '<div class="insights-center" style="grid-column: span 3;">🧠 AI is analyzing your spending...</div>';

    try {
        const url = forceRefresh ? '/ai/insights?refresh=true' : '/ai/insights';
        const res = await authFetch(url);
        const data = await res.json();

        if (res.ok) {
            insightGrid.innerHTML = data.insights.split('\n').map(insight => {
                if (!insight) return;
                // Basic markdown to HTML
                insight = insight.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
                insight = insight.replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics
                return `<div class="insight-item">${insight}</div>`;
            }).join('');
        } else {
            insightGrid.innerHTML = `<div class="empty-state error-state">Error: ${data.error}</div>`;
        }
    } catch (err) {
        insightGrid.innerHTML = `<div class="empty-state error-state">An error occurred while fetching insights.</div>`;
        console.error('Error loading insights:', err);
    } finally {
        refreshBtn.textContent = 'Refresh';
    }
}

document.getElementById('refresh-insights-btn')?.addEventListener('click', () => loadInsights(true));
document.getElementById('gen-insights-btn')?.addEventListener('click', () => loadInsights(false));

// ==================== AUTH STATE ====================
let currentUser = null;
let clerk = null;

// On page load: show app or auth screen
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const dateInput = document.getElementById('date-input');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        if (window.Clerk) {
            clerk = window.Clerk;
            await clerk.load({
                publishableKey: window.__CLERK_PUBLISHABLE_KEY__
            });

            clerk.addListener(({ user }) => {
                if (user) {
                    currentUser = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : user.fullName;
                    showApp();
                } else {
                    // Redirect unauthenticated users to our custom sign-in page
                    window.location.href = '/login';
                }
            });

            if (clerk.user) {
                currentUser = clerk.user.primaryEmailAddress ? clerk.user.primaryEmailAddress.emailAddress : clerk.user.fullName;
                showApp();
            }
        } else {
            console.error('Clerk library failed to load.');
            document.body.style.visibility = 'visible';
            document.body.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--rose);">Authentication service failed to load. Please check your connection or disable ad-blockers.</div>';
        }

    } catch (globalErr) {
        console.error('App Script Error:', globalErr);
    }
});


function showApp() {
    document.body.style.visibility = 'visible';
    const userBlockName = document.querySelector('.profile-card strong');
    const userBlockEmail = document.querySelector('.profile-card span');
    const avatar = document.querySelectorAll('.avatar, .profile-avatar');

    if (clerk.user) {
        if (userBlockName) userBlockName.textContent = clerk.user.fullName || "User";
        if (userBlockEmail) userBlockEmail.textContent = clerk.user.primaryEmailAddress.emailAddress || "";
        if (avatar) {
            const initials = (clerk.user.firstName ? clerk.user.firstName[0] : '') + (clerk.user.lastName ? clerk.user.lastName[0] : '');
            avatar.forEach(a => a.textContent = initials || 'SR');
        }
        const greetTitle = document.querySelector('.greet-title em');
        if (greetTitle) greetTitle.textContent = clerk.user.firstName || "User";
    }

    loadDashboard();
    handleSharedTarget();
}

async function signOut() {
    document.body.style.visibility = 'hidden';
    await clerk?.signOut();
}
document.getElementById('sign-out-btn')?.addEventListener('click', signOut);

async function authFetch(url, options = {}) {
    if (!clerk || !clerk.session) {
        return new Response(JSON.stringify({
            error: "Not logged in"
        }), {
            status: 401,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
    const token = await clerk.session.getToken();
    options.headers = {
        ...(options.headers || {}),
        'Authorization': `Bearer ${token}`
    };
    const res = await fetch(url, options);
    if (res.status === 401) {
        console.error("Session expired. Please log in again.");
    }
    return res;
}


async function loadDashboard() {
    loadSummary();
    loadTransactions();
    loadSubscriptions();
    loadBudgets();
}

async function loadSummary() {
    try {
        const res = await authFetch('/summary');
        if (!res.ok) {
            console.log("Could not load summary, user might not be logged in.");
            return;
        }
        const sum = await res.json();

        document.getElementById('stat-income').textContent = '₹' + (sum.income || 0).toLocaleString('en-IN');
        document.getElementById('stat-expense').textContent = '₹' + (sum.expense || 0).toLocaleString('en-IN');
        document.getElementById('stat-savings').textContent = '₹' + (sum.savings || 0).toLocaleString('en-IN');
        document.getElementById('stat-count').textContent = sum.transaction_count || 0;

        renderSpendingChart(sum.by_category, sum.expense);

    } catch (err) {
        console.error('Error loading summary:', err);
    }
}

let spendingChart = null;
function renderSpendingChart(categoryData, totalExpense) {
    const ctx = document.getElementById('spending-breakdown-chart');
    if (!ctx) return;

    if (spendingChart) {
        spendingChart.destroy();
    }

    const legendEl = document.getElementById('donut-legend');
    if (!categoryData || categoryData.length === 0) {
        legendEl.innerHTML = '<div class="empty-state" style="padding: 0;">No spending data yet.</div>';
        if (spendingChart) spendingChart.clear();
        return;
    }

    const labels = categoryData.map(d => d.category);
    const backgroundColors = ['var(--violet)', 'var(--pink)', 'var(--amber)', 'var(--green)', 'var(--cyan)', 'var(--gold)', 'var(--red)', '#84CC16', '#0EA5E9'];
    const data = categoryData.map(d => d.total);

    spendingChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        }
    });

    legendEl.innerHTML = categoryData.map((d, i) => {
        const percentage = totalExpense > 0 ? ((d.total / totalExpense) * 100).toFixed(0) : 0;
        return `
            <div class="legend-item" style="${i === categoryData.length - 1 ? 'border-bottom:none;' : ''}">
                <div class="legend-left">
                    <span class="legend-line" style="background:${backgroundColors[i % backgroundColors.length]}"></span>
                    <span>${d.category}</span>
                </div>
                <div>₹${d.total.toLocaleString('en-IN')} <span class="legend-sub">${percentage}%</span></div>
            </div>
        `;
    }).join('');
}

let monthlyOverviewChart = null;
function renderMonthlyOverviewChart(transactions) {
    const ctx = document.getElementById('monthly-overview-chart');
    if (!ctx) return;

    if (monthlyOverviewChart) {
        monthlyOverviewChart.destroy();
    }

    const monthlyData = {};
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthKey = d.toISOString().slice(0, 7);
        monthlyData[monthKey] = { income: 0, expense: 0 };
    }

    transactions.forEach(t => {
        const monthKey = t.date.slice(0, 7);
        if (monthlyData[monthKey]) {
            if (t.type === 'Income') {
                monthlyData[monthKey].income += t.amount;
            } else {
                monthlyData[monthKey].expense += t.amount;
            }
        }
    });

    const labels = Object.keys(monthlyData).map(m => new Date(m + '-02').toLocaleString('default', { month: 'short' }));
    const incomeData = Object.values(monthlyData).map(m => m.income);
    const expenseData = Object.values(monthlyData).map(m => m.expense);

    monthlyOverviewChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Income',
                    data: incomeData,
                    backgroundColor: 'rgba(126, 231, 181, 0.2)',
                    borderColor: '#7ee7b5',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Expense',
                    data: expenseData,
                    backgroundColor: 'rgba(242, 155, 151, 0.2)',
                    borderColor: '#f29b97',
                    borderWidth: 1,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { display: false },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#8a8898'
                    }
                }
            }
        }
    });
}


async function loadTransactions() {
    try {
        const res = await authFetch('/transactions');
        if (!res.ok) {
            console.log("Could not load transactions, user might not be logged in.");
            document.getElementById('txn-list').innerHTML = '<div class="empty-state">Please log in to see your transactions.</div>';
            return;
        }
        const transactions = await res.json();
        renderTransactions(transactions);
        renderMonthlyOverviewChart(transactions);
    } catch (err) {
        console.error('Error loading transactions:', err);
    }
}

function renderTransactions(transactions) {
    const listEl = document.getElementById('txn-list');
    if (!transactions || transactions.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No transactions yet.</div>';
        return;
    }

    listEl.innerHTML = transactions.slice(0, 5).map(t => { // Show latest 5
        const amountSign = t.type === 'Income' ? '+' : '−';
        const amountClass = t.type === 'Income' ? 'plus' : 'minus';

        return `
            <div class="tx-item">
                <div class="tx-icon">${t.merchant.charAt(0).toUpperCase()}</div>
                <div class="tx-meta">
                  <strong>${t.merchant}</strong>
                  <span>${t.date} · ${t.category}</span>
                </div>
                <div class="amount ${amountClass}">${amountSign}₹${t.amount.toLocaleString('en-IN')}</div>
            </div>
        `;
    }).join('');
}


/* ── Type toggle ── */
let currentTxnType = 'Expense';

function setType(t) {
    const exp = document.getElementById('expOpt');
    const inc = document.getElementById('incOpt');
    if (t === 'Income') {
        currentTxnType = 'Income';
        exp.className = 'toggle-item';
        inc.className = 'toggle-item active';
    } else {
        currentTxnType = 'Expense';
        exp.className = 'toggle-item active';
        inc.className = 'toggle-item';
    }
}

/* ── Sidebar nav ── */
document.querySelectorAll('.sb-item').forEach(item => {
    item.addEventListener('click', function () {
        document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Top nav ── */
document.querySelectorAll('.tn').forEach(item => {
    item.addEventListener('click', function () {
        document.querySelectorAll('.tn').forEach(i => i.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Transaction filters ── */
document.querySelectorAll('.tf').forEach(btn => {
    btn.addEventListener('click', function () {
        this.closest('.txn-filters').querySelectorAll('.tf').forEach(b => b.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Quick category ── */
document.querySelectorAll('.qcat').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.qcat').forEach(b => b.style.borderColor = '');
        this.style.borderColor = 'var(--sand)';
        const cat = this.dataset.category;
        const sel = document.getElementById('category-select');
        if (sel) {
            sel.value = cat;
        }
        document.getElementById('merchant-input').focus();
    });
});

/* ── Save button feedback ── */
document.getElementById('save-txn-btn')?.addEventListener('click', async function () {
    const btn = this;
    const merchant = document.getElementById('merchant-input').value.trim();
    const amount = document.getElementById('amount-input').value;
    const category = document.getElementById('category-select').value;
    const date = document.getElementById('date-input').value;
    const note = document.getElementById('note-input').value.trim();

    if (!merchant || !amount) {
        alert('Please fill in at least merchant and amount.');
        return;
    }

    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        const res = await authFetch('/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant,
                amount,
                category,
                type: currentTxnType,
                date,
                note
            })
        });

        if (res.ok) {
            btn.textContent = '✓ Saved!';
            btn.style.background = 'var(--green)';

            // Clear form
            document.getElementById('merchant-input').value = '';
            document.getElementById('amount-input').value = '';
            document.getElementById('note-input').value = '';
            document.getElementById('category-select').value = '';
            document.getElementById('date-input').value = new Date().toISOString().split('T')[0];

            // Reload data
            loadDashboard();

        } else {
            const errData = await res.json();
            btn.textContent = 'Error!';
            btn.style.background = 'var(--red)';
            alert('Error saving transaction: ' + (errData.error || 'Unknown error'));
        }
    } catch (err) {
        btn.textContent = 'Error!';
        btn.style.background = 'var(--red)';
        alert('An error occurred: ' + err.message);
    } finally {
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.background = '';
        }, 2000);
    }
});

/* ── Auto Parse (Natural Language) ── */
const nlParseBtn = document.getElementById('nl-parse-btn');
const nlInput = document.getElementById('nl-input');

nlParseBtn?.addEventListener('click', async () => {
    const text = nlInput.value.trim();
    if (!text) {
        alert('Please enter a transaction description.');
        return;
    }

    const originalText = nlParseBtn.textContent;
    nlParseBtn.textContent = 'PARSING...';
    nlParseBtn.disabled = true;

    try {
        const res = await authFetch('/ai/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            // Populate the form fields
            if (data.merchant) document.getElementById('merchant-input').value = data.merchant;
            if (data.amount) document.getElementById('amount-input').value = data.amount;
            if (data.category) document.getElementById('category-select').value = data.category;
            if (data.date) document.getElementById('date-input').value = data.date;
            if (data.note) document.getElementById('note-input').value = data.note;

            // Set type (Income/Expense)
            if (data.type) setType(data.type);

            nlInput.value = ''; // Clear the input after successful parse
        } else {
            alert('Could not parse transaction: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Parse error:', err);
        alert('An error occurred while parsing the text.');
    } finally {
        nlParseBtn.textContent = originalText;
        nlParseBtn.disabled = false;
    }
});

/* ── PDF Export ── */
document.getElementById('export-pdf-btn')?.addEventListener('click', async function () {
    const btn = this;
    const originalText = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await authFetch('/export/pdf');

        if (res.ok) {
            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition');
            let filename = 'expense-report.pdf'; // Default filename

            if (disposition && disposition.includes('attachment')) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();

        } else {
            alert('Failed to generate PDF. Please try again.');
        }
    } catch (err) {
        alert('An error occurred while exporting the PDF.');
        console.error('PDF Export Error:', err);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

/* ── Update greeting by time ── */
(function () {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const el = document.querySelector('.greet-title');
    if (el) {
        const name = el.querySelector('em').textContent;
        el.innerHTML = `${greet}, <em>${name}</em>`;
    }
    const monthEl = document.getElementById('current-month-text');
    if (monthEl) monthEl.textContent = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
})();

/* ── AI Chat Functionality ── */
const aiChatModal = document.getElementById('ai-chat-modal');
const askAiBtn = document.getElementById('ask-ai-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

askAiBtn?.addEventListener('click', () => {
    aiChatModal.style.display = 'flex';
    addChatMessage('bot', 'Hello! How can I help you with your finances today?');
});

closeChatBtn?.addEventListener('click', () => {
    aiChatModal.style.display = 'none';
});

chatSendBtn?.addEventListener('click', handleChatSubmit);
chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleChatSubmit();
    }
});

async function handleChatSubmit() {
    const message = chatInput.value.trim();
    if (!message) return;

    addChatMessage('user', message);
    chatInput.value = '';
    chatInput.disabled = true;
    chatSendBtn.disabled = true;

    // Add a temporary loading message
    const loadingMessage = addChatMessage('bot', '...');
    loadingMessage.classList.add('loading'); // For potential CSS animation

    try {
        const res = await authFetch('/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        loadingMessage.remove(); // Remove the loading indicator

        const data = await res.json();
        if (res.ok) {
            addChatMessage('bot', data.reply);
        } else {
            addChatMessage('bot', `Error: ${data.error}`);
        }
    } catch (err) {
        loadingMessage.remove(); // Also remove on error
        addChatMessage('bot', 'An error occurred. Please try again.');
    } finally {
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
        chatInput.focus();
    }
}

function addChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender);
    const contentElement = document.createElement('div');
    contentElement.classList.add('content');
    contentElement.textContent = message;
    messageElement.appendChild(contentElement);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageElement; // Return the element for manipulation
}

/* ── Subscription Functionality ── */
const subscriptionModal = document.getElementById('subscription-modal');
const addSubscriptionBtn = document.getElementById('add-subscription-btn');
const closeSubscriptionModalBtn = document.getElementById('close-subscription-modal-btn');
const saveSubscriptionBtn = document.getElementById('save-subscription-btn');
const subscriptionList = document.getElementById('subscription-list');

addSubscriptionBtn?.addEventListener('click', () => {
    subscriptionModal.style.display = 'flex';
});

closeSubscriptionModalBtn?.addEventListener('click', () => {
    subscriptionModal.style.display = 'none';
});

saveSubscriptionBtn?.addEventListener('click', async () => {
    const name = document.getElementById('sub-name-input').value.trim();
    const amount = document.getElementById('sub-amount-input').value;
    const category = document.getElementById('sub-category-select').value;
    const startDate = document.getElementById('sub-date-input').value;

    if (!name || !amount || !startDate) {
        alert('Please fill in all fields.');
        return;
    }

    try {
        const res = await authFetch('/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, amount, category, start_date: startDate })
        });

        if (res.ok) {
            subscriptionModal.style.display = 'none';
            loadSubscriptions();
        } else {
            const errData = await res.json();
            alert(`Error: ${errData.error}`);
        }
    } catch (err) {
        alert('An error occurred.');
    }
});

async function loadSubscriptions() {
    try {
        const res = await authFetch('/subscriptions');
        const subscriptions = await res.json();
        renderSubscriptions(subscriptions);
    } catch (err) {
        console.error('Error loading subscriptions:', err);
    }
}

function renderSubscriptions(subscriptions) {
    if (!subscriptions || subscriptions.length === 0) {
        subscriptionList.innerHTML = '<div class="empty-state">No active subscriptions.<br>Add recurring bills to track them.</div>';
        return;
    }

    subscriptionList.innerHTML = subscriptions.map(sub => `
        <div class="sub-item">
            <div>
                <strong style="font-size:1.05rem;">${sub.name}</strong>
                <small>${sub.category} · Next due: ${sub.next_due_date}</small>
            </div>
            <div style="display:flex;align-items:center;gap:14px;">
                <strong style="font-size:1.4rem;font-family:'Cormorant Garamond',serif;">₹${sub.amount.toLocaleString('en-IN')}</strong>
                <button class="ghost-btn delete-sub-btn" data-id="${sub.id}" style="padding:4px 8px;color:var(--red)">&times;</button>
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.delete-sub-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            if (confirm('Are you sure you want to delete this subscription?')) {
                await authFetch(`/subscriptions/${id}`, { method: 'DELETE' });
                loadSubscriptions();
            }
        });
    });
}

/* ── Budget Functionality ── */
const budgetModal = document.getElementById('budget-modal');
const manageBudgetBtn = document.getElementById('manage-budget-btn');
const closeBudgetModalBtn = document.getElementById('close-budget-modal-btn');
const saveBudgetBtn = document.getElementById('save-budget-btn');
const budgetList = document.getElementById('budget-list');

manageBudgetBtn?.addEventListener('click', () => {
    budgetModal.style.display = 'flex';
});

closeBudgetModalBtn?.addEventListener('click', () => {
    budgetModal.style.display = 'none';
});

saveBudgetBtn?.addEventListener('click', async () => {
    const category = document.getElementById('budget-category-select').value;
    const amount = document.getElementById('budget-amount-input').value;

    if (!category || !amount) {
        alert('Please fill in all fields.');
        return;
    }

    try {
        const res = await authFetch('/budgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, amount })
        });

        if (res.ok) {
            budgetModal.style.display = 'none';
            loadBudgets();
        } else {
            const errData = await res.json();
            alert(`Error: ${errData.error}`);
        }
    } catch (err) {
        alert('An error occurred while saving the budget.');
    }
});

async function loadBudgets() {
    try {
        const res = await authFetch('/budgets');
        const budgets = await res.json();
        renderBudgets(budgets);
    } catch (err) {
        console.error('Error loading budgets:', err);
    }
}

function renderBudgets(budgets) {
    if (!budgets || budgets.length === 0) {
        budgetList.innerHTML = '<div class="empty-state">No budgets set.<br>Click Manage to add one.</div>';
        return;
    }

    budgetList.innerHTML = budgets.map(b => {
        const pct = Math.min((b.spent / b.limit) * 100, 100).toFixed(0);
        return `
            <div class="budget-item" style="margin-bottom: 12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;color:#a8abc6;">
                    <span><span style="color:${b.color || 'var(--gold)'}">•</span> ${b.category}</span>
                    <span style="color:#686b88">₹${b.spent.toLocaleString('en-IN')} / ₹${b.limit.toLocaleString('en-IN')}</span>
                </div>
                <div class="mini-progress"><span style="width:${pct}%; background:${b.color || 'var(--gold)'}"></span></div>
            </div>
        `;
    }).join('');
}

/* ── Mobile Sidebar Toggle ── */
const hamburgerBtn = document.getElementById('hamburger-btn');
const sidebar = document.querySelector('.sidebar');

hamburgerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar?.classList.contains('open')) {
        if (!sidebar.contains(e.target) && e.target !== hamburgerBtn) {
            sidebar.classList.remove('open');
        }
    }
});

/* ── Web Share Target Handler ── */
function handleSharedTarget() {
    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get('text') || params.get('title'); // Android sometimes puts text in title

    if (sharedText) {
        const nlInput = document.getElementById('nl-input');
        const nlParseBtn = document.getElementById('nl-parse-btn');
        if (nlInput && nlParseBtn) {
            nlInput.value = sharedText;
            setTimeout(() => nlParseBtn.click(), 500); // Trigger parse
        }
        // Clean up URL to avoid re-parsing on page refresh
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

/* ── PWA Installation ── */
let deferredPrompt;
const installAppBtn = document.getElementById('install-app-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if (installAppBtn) {
        installAppBtn.style.display = 'inline-block';
    }
});

installAppBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    // We've used the prompt, and can't use it again, throw it away
    deferredPrompt = null;
    // Hide the button
    installAppBtn.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
    // Clear the deferredPrompt so it can be garbage collected
    deferredPrompt = null;
    if (installAppBtn) {
        installAppBtn.style.display = 'none';
    }
    console.log('PWA was installed');
});
