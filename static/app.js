function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}
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

            clerk.addListener(({
                user
            }) => {
                if (user) {
                    currentUser = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : user.fullName;
                    showApp();
                } else {
                    loadDashboard();
                }
            });

            if (clerk.user) {
                currentUser = clerk.user.primaryEmailAddress ? clerk.user.primaryEmailAddress.emailAddress : clerk.user.fullName;
                showApp();
            } else {
                loadDashboard();
            }
        } else {
            console.error('Clerk library failed to load.');
        }

    } catch (globalErr) {
        console.error('App Script Error:', globalErr);
    }
});


function showApp() {
    const userBlockName = document.querySelector('.userblock-info p:first-child');
    const userBlockEmail = document.querySelector('.userblock-info p:last-child');
    const avatar = document.querySelectorAll('.avatar');

    if (clerk.user) {
        if (userBlockName) userBlockName.textContent = clerk.user.fullName || "User";
        if (userBlockEmail) userBlockEmail.textContent = clerk.user.primaryEmailAddress.emailAddress || "";
        if (avatar) {
            const initials = (clerk.user.firstName ? clerk.user.firstName[0] : '') + (clerk.user.lastName ? clerk.user.lastName[0] : '');
            avatar.forEach(a => a.textContent = initials || 'SR');
        }
        const greetTitle = document.querySelector('.greet-title em');
        if(greetTitle) greetTitle.textContent = clerk.user.firstName || "User";
    }

    loadDashboard();
}

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
    const data = categoryData.map(d => d.total);
    
    const backgroundColors = categoryData.map(() => getRandomColor());

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
            <div class="dl-item">
                <div class="dl-bar" style="background:${backgroundColors[i]};"></div>
                <div class="dl-name">${d.category}</div>
                <div class="dl-val">₹${d.total.toLocaleString('en-IN')}</div>
                <div class="dl-pct">${percentage}%</div>
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
                    backgroundColor: getRandomColor(),
                    borderColor: getRandomColor(),
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Expense',
                    data: expenseData,
                    backgroundColor: getRandomColor(),
                    borderColor: getRandomColor(),
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
                        color: 'var(--t3)'
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
        const style = {
            color: getRandomColor(),
            dim: getRandomColor()
        };
        const amountSign = t.type === 'Income' ? '+' : '−';
        const amountColor = t.type === 'Income' ? 'var(--sage2)' : 'var(--rose2)';

        return `
            <div class="txn">
                <div class="txn-stripe" style="background:${style.color};"></div>
                <div class="txn-logo" style="background:${style.dim};color:${style.color};">${t.merchant.charAt(0).toUpperCase()}</div>
                <div class="txn-body">
                  <div class="txn-name">${t.merchant}</div>
                  <div class="txn-sub">${t.date} · ${t.category}</div>
                </div>
                <div class="txn-amt" style="color:${amountColor};">${amountSign}₹${t.amount.toLocaleString('en-IN')}</div>
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
        exp.className = 'ts-opt';
        inc.className = 'ts-opt on-inc';
    } else {
        currentTxnType = 'Expense';
        exp.className = 'ts-opt on-exp';
        inc.className = 'ts-opt';
    }
}

/* ── Sidebar nav ── */
document.querySelectorAll('.sb-item').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Top nav ── */
document.querySelectorAll('.tn').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.tn').forEach(i => i.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Transaction filters ── */
document.querySelectorAll('.tf').forEach(btn => {
    btn.addEventListener('click', function() {
        this.closest('.txn-filters').querySelectorAll('.tf').forEach(b => b.classList.remove('on'));
        this.classList.add('on');
    });
});

/* ── Quick category ── */
document.querySelectorAll('.qcat').forEach(btn => {
    btn.addEventListener('click', function() {
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
document.getElementById('save-txn-btn').addEventListener('click', async function() {
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
            btn.style.background = 'var(--sage)';
            
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
            btn.style.background = 'var(--rose)';
            alert('Error saving transaction: ' + (errData.error || 'Unknown error'));
        }
    } catch (err) {
        btn.textContent = 'Error!';
        btn.style.background = 'var(--rose)';
        alert('An error occurred: ' + err.message);
    } finally {
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.background = '';
        }, 2000);
    }
});

/* ── Update greeting by time ── */
(function() {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const el = document.querySelector('.greet-title');
    if (el) {
       const name = el.querySelector('em').textContent;
       el.innerHTML = `${greet}, <em>${name}</em>`;
    }
})();