from flask import Flask, request, jsonify, render_template, send_file, g
import sqlite3, re, datetime, io, os, jwt, hashlib, secrets, json, base64, time, random
from dotenv import load_dotenv

load_dotenv()
from jwt import PyJWKClient
from fpdf import FPDF
import pyotp, qrcode
from functools import wraps

try:
    from PIL import Image, ImageFilter
    import pytesseract
    if os.name == 'nt':
        tesseract_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
    OCR_ENABLED = True
except ImportError:
    OCR_ENABLED = False

# ============ GEMINI AI SETUP ============
AI_ENABLED = False
AI_ERROR_MESSAGE = "Gemini AI is not configured. Set GEMINI_API_KEY."

gemini_flash_model = None
gemini_pro_model = None
genai = None  # module-level reference

try:
    import google.generativeai as genai          # ← correct package
    from google.api_core.exceptions import ResourceExhausted

    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    print(f"GEMINI_API_KEY loaded: {'Yes' if GEMINI_API_KEY else 'No'}")

    if not GEMINI_API_KEY:
        AI_ERROR_MESSAGE = "GEMINI_API_KEY not found in environment. Ensure it is set in a .env file and the application is restarted."
    elif "YOUR_API_KEY" in GEMINI_API_KEY:
        AI_ERROR_MESSAGE = "A placeholder API key was found. Please replace it with your actual Gemini API key in the .env file."
    else:
        genai.configure(api_key=GEMINI_API_KEY)  # ← configure FIRST, separately
        gemini_flash_model = genai.GenerativeModel('gemini-2.5-flash')
        gemini_pro_model   = genai.GenerativeModel('gemini-2.5-flash')
        AI_ENABLED = True
        AI_ERROR_MESSAGE = ""
        print("✅ Gemini AI initialized successfully.")

except ImportError:
    AI_ERROR_MESSAGE = "The 'google-generativeai' library is not installed. Please run: pip install google-generativeai"
    print(f"❌ ImportError: {AI_ERROR_MESSAGE}")
except Exception as e:
    AI_ERROR_MESSAGE = f"Gemini AI initialization failed: {str(e)}"
    print(f"❌ Gemini init error: {AI_ERROR_MESSAGE}")


def gemini_generate(content, model, retries=3):
    """Call a specific Gemini model with auto-retry on rate limits."""
    for attempt in range(retries):
        try:
            return model.generate_content(content)
        except ResourceExhausted:
            if attempt < retries - 1:
                wait = (2 ** attempt) + random.random()
                time.sleep(wait)
            else:
                raise
        except Exception:
            raise


app = Flask(__name__)
app.config['AI_INSIGHTS_CACHE'] = {}

# ============ CONFIG ============
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
JWT_EXPIRY_HOURS = 24 * 7  # tokens last 7 days

# ============ DATABASE SETUP ============
def init_db():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER,
        merchant TEXT,
        category TEXT,
        type TEXT DEFAULT 'Expense',
        date TEXT,
        note TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        amount INTEGER NOT NULL,
        UNIQUE(user_id, category),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        category TEXT NOT NULL,
        next_due_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS merchant_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        alias_name TEXT NOT NULL,
        category TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, original_name)
    )""")

    try:
        cursor.execute("ALTER TABLE transactions ADD COLUMN upi_id TEXT")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()

init_db()

# ============ DATABASE ============
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect("database.db")
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# ============ CLERK JWKS SETUP ============
CLERK_FRONTEND_API = os.environ.get('CLERK_FRONTEND_API')

jwks_client = None
if CLERK_FRONTEND_API and "YOUR_CLERK" not in CLERK_FRONTEND_API:
    jwks_client = PyJWKClient(f"{CLERK_FRONTEND_API}/.well-known/jwks.json")

def decode_token(token: str) -> dict:
    if not jwks_client:
        return jwt.decode(token, options={"verify_signature": False})
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False}
    )

# ============ AUTH DECORATOR ============
def jwt_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401
        token = auth_header.split(' ', 1)[1]
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired. Please log in again.'}), 401
        except Exception as e:
            return jsonify({'error': f'Invalid token: {str(e)}'}), 401

        clerk_id = payload.get('sub')

        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT id FROM users WHERE username=?", (clerk_id,))
        row = cursor.fetchone()
        if not row:
            try:
                cursor.execute(
                    "INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)",
                    (clerk_id, clerk_id, 'clerk_managed', 'clerk_managed')
                )
                user_id = cursor.lastrowid
                db.commit()
            except sqlite3.IntegrityError:
                db.rollback()
                cursor.execute("SELECT id FROM users WHERE username=?", (clerk_id,))
                user_id = cursor.fetchone()[0]
        else:
            user_id = row[0]

        request.user_id = user_id
        request.username = clerk_id
        return f(*args, **kwargs)
    return decorated

def invalidate_insights_cache(user_id):
    cache = app.config.get('AI_INSIGHTS_CACHE', {})
    if user_id in cache:
        del cache[user_id]

# ============ AUTO CATEGORIZE ============
def auto_categorize(merchant):
    m = merchant.lower()
    if any(x in m for x in ["zomato","swiggy","domino","kfc","mcdonalds","food"]):
        return "Food"
    elif any(x in m for x in ["amazon","flipkart","myntra","ajio"]):
        return "Shopping"
    elif any(x in m for x in ["uber","ola","irctc","rapido"]):
        return "Travel"
    elif any(x in m for x in ["bigbasket","blinkit","zepto","dmart","grofer"]):
        return "Groceries"
    elif any(x in m for x in ["bookmyshow","netflix","spotify","prime"]):
        return "Entertainment"
    elif any(x in m for x in ["apollo","medplus","practo","hospital","pharma"]):
        return "Healthcare"
    elif any(x in m for x in ["electricity","airtel","jio","vodafone","wifi","rent","gas"]):
        return "Bills"
    return "Others"

# ============ TRANSACTION ROUTES ============
@app.route('/')
def index():
    # Add a cache-busting version based on the current time
    # This ensures browsers always fetch the latest JS and CSS files during development
    cache_version = int(time.time())
    return render_template('index.html', clerk_publishable_key=os.environ.get('CLERK_PUBLISHABLE_KEY', ''), cache_version=cache_version)

@app.route('/login')
def login():
    return render_template('login.html', clerk_publishable_key=os.environ.get('CLERK_PUBLISHABLE_KEY', ''))

@app.route('/add', methods=['POST'])
@jwt_required
def add_transaction():
    data = request.json
    merchant  = data.get('merchant', 'Unknown')
    amount    = int(data.get('amount', 0))
    category  = data.get('category') or auto_categorize(merchant)
    txn_type  = data.get('type', 'Expense')
    date      = data.get('date', str(datetime.date.today()))
    note      = data.get('note', '')

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO transactions (user_id, amount, merchant, category, type, date, note) VALUES (?,?,?,?,?,?,?)",
        (request.user_id, amount, merchant, category, txn_type, date, note)
    )
    db.commit()
    invalidate_insights_cache(request.user_id)
    return jsonify({"status": "saved", "category": category})


@app.route('/transactions', methods=['GET'])
@jwt_required
def get_transactions():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT id, amount, merchant, category, type, date, note FROM transactions WHERE user_id=? ORDER BY date DESC",
        (request.user_id,)
    )
    rows = cursor.fetchall()
    return jsonify([dict(row) for row in rows])


@app.route('/transactions/<int:txn_id>', methods=['DELETE'])
@jwt_required
def delete_transaction(txn_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "DELETE FROM transactions WHERE id=? AND user_id=?",
        (txn_id, request.user_id)
    )
    deleted = cursor.rowcount
    db.commit()
    invalidate_insights_cache(request.user_id)
    if deleted == 0:
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify({'status': 'deleted'})


@app.route('/summary', methods=['GET'])
@jwt_required
def summary():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Income'", (request.user_id,))
    income = cursor.fetchone()['total'] or 0
    cursor.execute("SELECT SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense'", (request.user_id,))
    expense = cursor.fetchone()['total'] or 0
    cursor.execute(
        "SELECT category, COUNT(*) as count, SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense' GROUP BY category",
        (request.user_id,)
    )
    by_category = cursor.fetchall()
    cursor.execute("SELECT COUNT(*) as count FROM transactions WHERE user_id=?", (request.user_id,))
    transaction_count = cursor.fetchone()['count'] or 0

    return jsonify({
        "income": income,
        "expense": expense,
        "savings": income - expense,
        "by_category": [dict(row) for row in by_category],
        "transaction_count": transaction_count
    })


@app.route('/clear', methods=['DELETE'])
@jwt_required
def clear_all():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM transactions WHERE user_id=?", (request.user_id,))
    db.commit()
    invalidate_insights_cache(request.user_id)
    return jsonify({"status": "cleared"})


@app.route('/scan_receipt', methods=['POST'])
@jwt_required
def scan_receipt():
    if not OCR_ENABLED:
        return jsonify({"error": "Tesseract OCR is not available. Install pytesseract, Pillow, and the Tesseract engine."}), 400

    file = request.files.get('receipt')
    if not file:
        return jsonify({"error": "No receipt image uploaded"}), 400

    try:
        img = Image.open(io.BytesIO(file.read()))
        img = img.convert('L')
        text = pytesseract.image_to_string(img)
    except Exception as e:
        return jsonify({"error": f"OCR processing failed: {str(e)}"}), 500

    lower = text.lower()

    amount = None
    amt_patterns = [
        r'(?:grand\s*total|total\s*amount|amount\s*due|net\s*amount|total)\s*[:\-]?\s*[₹Rs\.]*\s*([\d,]+(?:\.\d{1,2})?)',
        r'[₹]\s*([\d,]+(?:\.\d{1,2})?)',
        r'rs\.?\s*([\d,]+(?:\.\d{1,2})?)',
    ]
    for pat in amt_patterns:
        match = re.search(pat, lower)
        if match:
            amount = match.group(1).replace(',', '')
            break

    merchant = None
    for line in text.strip().split('\n'):
        line = line.strip()
        if len(line) > 2 and not re.match(r'^[\d\s\-/:.₹]+$', line):
            merchant = line.title()
            break

    date = None
    date_patterns = [
        r'(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})',
        r'(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})',
    ]
    for pat in date_patterns:
        match = re.search(pat, text)
        if match:
            date = match.group(1)
            break

    return jsonify({
        "extracted_amount": amount,
        "extracted_merchant": merchant,
        "extracted_date": date,
        "raw_text": text
    })


# ============ GEMINI AI ROUTES ============
def get_user_transactions_text(user_id, limit=50):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT amount, merchant, category, type, date, note FROM transactions WHERE user_id=? ORDER BY date DESC LIMIT ?",
        (user_id, limit)
    )
    rows = cursor.fetchall()
    if not rows:
        return "No transactions recorded yet."
    lines: list[str] = []
    for r in rows:
        line = f"{r['type']} | ₹{r['amount']} | {r['merchant']} | {r['category']} | {r['date'] or 'N/A'}"
        if r['note']:
            line += f" | Note: {r['note']}"
        lines.append(line)
    return "\n".join(reversed(lines))


@app.route('/ai/scan_receipt', methods=['POST'])
@jwt_required
def ai_scan_receipt():
    if not AI_ENABLED:
        return jsonify({"error": AI_ERROR_MESSAGE}), 400

    file = request.files.get('receipt')
    if not file:
        return jsonify({"error": "No receipt image uploaded"}), 400

    try:
        img_bytes = file.read()
        img_b64 = base64.b64encode(img_bytes).decode('utf-8')
        mime = file.content_type or 'image/jpeg'

        prompt = """Analyze this receipt image and extract the following in JSON format:
{
  "amount": <total amount as a number>,
  "merchant": "<store/merchant name>",
  "date": "<date in YYYY-MM-DD format if visible, else null>",
  "items": ["<item1>", "<item2>", ...],
  "category": "<one of: Food, Groceries, Shopping, Travel, Entertainment, Healthcare, Bills, Others>"
}
Return ONLY the JSON, no extra text."""

        response = gemini_generate([
            prompt,
            {"mime_type": mime, "data": img_b64}
        ], model=gemini_pro_model)

        text = getattr(response, "text", "").strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'```\s*$', '', text)

        data = json.loads(text)
        return jsonify({"success": True, **data})
    except json.JSONDecodeError:
        return jsonify({"success": True, "raw_text": getattr(response, "text", ""), "amount": None, "merchant": None, "date": None, "category": None})
    except Exception as e:
        return jsonify({"error": f"AI processing failed: {str(e)}"}), 500


@app.route('/ai/categorize', methods=['POST'])
@jwt_required
def ai_categorize():
    if not AI_ENABLED:
        merchant = request.json.get('merchant', '')
        return jsonify({"category": auto_categorize(merchant)})

    data = request.json
    merchant = data.get('merchant', '')
    note = data.get('note', '')

    prompt = f"""Categorize this expense into exactly ONE of these categories:
Food, Groceries, Shopping, Travel, Entertainment, Healthcare, Bills, Others

Merchant: {merchant}
Note: {note}

Respond with ONLY the category name, nothing else."""

    try:
        response = gemini_generate(prompt, model=gemini_flash_model)
        category = getattr(response, "text", "").strip()
        valid = ['Food', 'Groceries', 'Shopping', 'Travel', 'Entertainment', 'Healthcare', 'Bills', 'Others']
        if category not in valid:
            category = auto_categorize(merchant)
        return jsonify({"category": category})
    except Exception:
        return jsonify({"category": auto_categorize(merchant)})


@app.route('/ai/insights', methods=['GET'])
@jwt_required
def ai_insights():
    if not AI_ENABLED:
        return jsonify({"error": AI_ERROR_MESSAGE}), 400

    user_id = request.user_id
    cache = app.config['AI_INSIGHTS_CACHE']
    force_refresh = request.args.get('refresh') == 'true'

    if force_refresh and user_id in cache:
        del cache[user_id]

    if user_id in cache:
        return jsonify({"insights": cache[user_id], "cached": True})

    txn_text = get_user_transactions_text(request.user_id, limit=50)
    if txn_text == "No transactions recorded yet.":
        return jsonify({"insights": "Add some transactions first, and I'll analyze your spending patterns! ✨", "cached": False})

    prompt = f"""You are a personal finance advisor. Analyze these recent expenses and give 3-5 short, actionable insights.
Use emoji for visual appeal. Be specific with numbers and percentages.
Keep each insight to 1-2 sentences. Format as a bullet list.

Recent transaction history (Type | Amount | Merchant | Category | Date):
{txn_text}

Provide insights:"""

    try:
        response = gemini_generate(prompt, model=gemini_pro_model)
        insights_text = getattr(response, "text", "").strip()
        cache[user_id] = insights_text
        return jsonify({"insights": insights_text, "cached": False})
    except Exception as e:
        return jsonify({"error": f"AI error: {str(e)}"}), 500


@app.route('/ai/chat', methods=['POST'])
@jwt_required
def ai_chat():
    if not AI_ENABLED:
        return jsonify({"error": AI_ERROR_MESSAGE}), 400

    question = request.json.get('message', '').strip()
    if not question:
        return jsonify({"error": "No message provided"}), 400

    txn_text = get_user_transactions_text(request.user_id, limit=50)

    prompt = f"""You are a helpful finance assistant for an expense tracker app.
Answer the user's question based on their recent transaction data below.
Be concise (2-4 sentences max). Use ₹ for currency. Use emoji sparingly.
If the data doesn't contain the answer, say so honestly and mention you're only looking at recent data.

Recent transaction history (Type | Amount | Merchant | Category | Date):
{txn_text}

User question: {question}

Answer:"""

    try:
        response = gemini_generate(prompt, model=gemini_flash_model)
        return jsonify({"reply": getattr(response, "text", "").strip()})
    except Exception as e:
        return jsonify({"error": f"AI error: {str(e)}"}), 500





# ============ PDF EXPORT ============
@app.route('/export/pdf', methods=['GET'])
@jwt_required
def export_pdf():
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Income'", (request.user_id,))
    income = cursor.fetchone()['total'] or 0
    cursor.execute("SELECT SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense'", (request.user_id,))
    expense = cursor.fetchone()['total'] or 0

    cursor.execute(
        "SELECT category, SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense' GROUP BY category",
        (request.user_id,)
    )
    by_cat = cursor.fetchall()

    cursor.execute(
        "SELECT amount, merchant, category, type, date, note FROM transactions WHERE user_id=? ORDER BY date DESC",
        (request.user_id,)
    )
    txns = cursor.fetchall()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.set_font('Helvetica', 'B', 20)
    pdf.cell(0, 12, 'Expense Report', new_x='LMARGIN', new_y='NEXT', align='C')
    pdf.set_font('Helvetica', '', 10)
    pdf.cell(0, 8, f'Generated: {datetime.date.today().strftime("%d %B %Y")}  |  User: {request.username}', new_x='LMARGIN', new_y='NEXT', align='C')
    pdf.ln(8)

    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(0, 10, 'Summary', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('Helvetica', '', 11)
    pdf.cell(60, 8, f'Total Income: Rs.{income:,}')
    pdf.cell(60, 8, f'Total Expense: Rs.{expense:,}')
    pdf.cell(0, 8, f'Savings: Rs.{income - expense:,}', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(6)

    if by_cat:
        pdf.set_font('Helvetica', 'B', 13)
        pdf.cell(0, 10, 'By Category', new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('Helvetica', 'B', 10)
        pdf.set_fill_color(79, 70, 229)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(95, 8, 'Category', border=1, fill=True)
        pdf.cell(95, 8, 'Amount', border=1, fill=True, new_x='LMARGIN', new_y='NEXT')
        pdf.set_text_color(0, 0, 0)
        pdf.set_font('Helvetica', '', 10)
        for cat in by_cat:
            pdf.cell(95, 7, str(cat['category']), border=1)
            pdf.cell(95, 7, f'Rs.{cat["total"]:,}', border=1, new_x='LMARGIN', new_y='NEXT')
        pdf.ln(6)

    if txns:
        pdf.set_font('Helvetica', 'B', 13)
        pdf.cell(0, 10, f'All Transactions ({len(txns)})', new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_fill_color(79, 70, 229)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(25, 7, 'Date', border=1, fill=True)
        pdf.cell(25, 7, 'Type', border=1, fill=True)
        pdf.cell(50, 7, 'Merchant', border=1, fill=True)
        pdf.cell(35, 7, 'Category', border=1, fill=True)
        pdf.cell(25, 7, 'Amount', border=1, fill=True)
        pdf.cell(30, 7, 'Note', border=1, fill=True, new_x='LMARGIN', new_y='NEXT')
        pdf.set_text_color(0, 0, 0)
        pdf.set_font('Helvetica', '', 9)
        for t in txns:
            date_str: str = str(t['date'] or '')
            merch_str: str = str(t['merchant'] or '')
            note_str: str = str(t['note'] or '')
            pdf.cell(25, 6, f"{date_str:.10}", border=1)
            pdf.cell(25, 6, str(t['type']), border=1)
            pdf.cell(50, 6, f"{merch_str:.20}", border=1)
            pdf.cell(35, 6, str(t['category']), border=1)
            pdf.cell(25, 6, f'Rs.{t["amount"]:,}', border=1)
            pdf.cell(30, 6, f"{note_str:.12}", border=1, new_x='LMARGIN', new_y='NEXT')

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f'expense_report_{datetime.date.today()}.pdf')


# ============ NATURAL LANGUAGE ADD ============
@app.route('/ai/parse', methods=['POST'])
@jwt_required
def ai_parse():
    if not AI_ENABLED:
        return jsonify({'error': AI_ERROR_MESSAGE}), 400

    text = request.json.get('text', '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    today = str(datetime.date.today())
    prompt = f"""Parse this expense description into JSON. Today's date is {today}.
Categories: Food, Groceries, Shopping, Travel, Entertainment, Healthcare, Bills, Others
Types: Expense, Income

Text: "{text}"

Return ONLY JSON:
{{"amount": <number>, "merchant": "<name>", "category": "<category>", "type": "Expense or Income", "date": "YYYY-MM-DD", "note": "<optional note>"}}"""

    try:
        response = gemini_generate(prompt, model=gemini_flash_model)
        result = getattr(response, "text", "").strip()
        if result.startswith('```'):
            result = re.sub(r'^```(?:json)?\s*', '', result)
            result = re.sub(r'```\s*$', '', result)
        data = json.loads(result)
        return jsonify({'success': True, **data})
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Could not parse AI response'}), 400
    except Exception as e:
        return jsonify({'error': f'AI error: {str(e)}'}), 500


# ============ AI STATEMENT UPLOADER & ALIAS ENGINE ============
@app.route('/api/upload_statement', methods=['POST'])
@jwt_required
def upload_statement():
    if not AI_ENABLED:
        return jsonify({'error': AI_ERROR_MESSAGE}), 400

    text = request.json.get('text', '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    prompt = f"""You are an expert financial data extractor specializing in Indian UPI SMS and bank statements.
Given the following raw text, extract every single transaction. 
Critically: For the "merchant" field, extract the exact UPI ID (e.g., name@okhdfcbank), VPA, or raw Business Descriptor. Do not summarize it.

Return ONLY a JSON array of objects.
Format:
[{{
  "date": "YYYY-MM-DD",
  "amount": <number>,
  "merchant": "<Raw extracted UPI ID or Name>",
  "category": "<Guessed Category (Food, Groceries, Shopping, Travel, Entertainment, Healthcare, Bills, Others)>",
  "type": "Expense" or "Income",
  "upi_id": "<UPI ID if found, else empty string>"
}}]

Text to parse:
"{text}"
"""
    try:
        response = gemini_generate(prompt, model=gemini_pro_model)
        result = getattr(response, "text", "").strip()
        if result.startswith('```'):
            result = re.sub(r'^```(?:json)?\s*', '', result)
            result = re.sub(r'```\s*$', '', result)

        parsed_txns = json.loads(result)
        if not isinstance(parsed_txns, list):
            parsed_txns = [parsed_txns]

        db = get_db()
        cursor = db.cursor()

        for txn in parsed_txns:
            ident = txn.get('upi_id') or txn.get('merchant', '')
            cursor.execute(
                "SELECT alias_name, category FROM merchant_aliases WHERE user_id=? AND original_name=?",
                (request.user_id, ident)
            )
            alias = cursor.fetchone()
            if alias:
                txn['original_merchant'] = txn['merchant']
                txn['merchant'] = alias['alias_name']
                txn['category'] = alias['category']
                txn['is_aliased'] = True
            else:
                txn['is_aliased'] = False

        return jsonify(parsed_txns)

    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response into JSON. Check text density.'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/transactions/bulk', methods=['POST'])
@jwt_required
def bulk_transactions():
    txns = request.json.get('transactions', [])
    if not txns:
        return jsonify({'error': 'No transactions provided'}), 400

    db = get_db()
    cursor = db.cursor()

    for t in txns:
        cursor.execute(
            '''INSERT INTO transactions (user_id, amount, merchant, category, type, date, upi_id) 
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (request.user_id, t.get('amount'), t.get('merchant'), t.get('category'),
             t.get('type', 'Expense'), t.get('date'), t.get('upi_id', ''))
        )
    db.commit()
    invalidate_insights_cache(request.user_id)
    return jsonify({'success': True, 'count': len(txns)})


@app.route('/api/aliases', methods=['POST'])
@jwt_required
def save_alias():
    original_name = request.json.get('original_name')
    alias_name = request.json.get('alias_name')
    category = request.json.get('category', 'Others')

    if not original_name or not alias_name:
        return jsonify({'error': 'Missing names'}), 400

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            '''INSERT INTO merchant_aliases (user_id, original_name, alias_name, category) 
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, original_name) DO UPDATE SET alias_name=excluded.alias_name, category=excluded.category''',
            (request.user_id, original_name, alias_name, category)
        )
        db.commit()
        success = True
    except Exception as e:
        success = False
        print("Alias Error:", e)

    return jsonify({'success': success})


# ============ TRENDS & HEATMAP DATA ============
@app.route('/trends', methods=['GET'])
@jwt_required
def trends_data():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT date, SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense' AND date IS NOT NULL GROUP BY date ORDER BY date",
        (request.user_id,)
    )
    rows = cursor.fetchall()
    return jsonify([dict(row) for row in rows])


@app.route('/heatmap', methods=['GET'])
@jwt_required
def heatmap_data():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT date, SUM(amount) AS total FROM transactions WHERE user_id=? AND type='Expense' AND date IS NOT NULL GROUP BY date",
        (request.user_id,)
    )
    rows = cursor.fetchall()
    return jsonify({row['date']: row['total'] for row in rows})


# ============ BUDGETS ============
@app.route('/budgets', methods=['GET', 'POST'])
@jwt_required
def handle_budgets():
    db = get_db()
    cursor = db.cursor()

    if request.method == 'POST':
        data = request.json
        category = data.get('category')
        amount = int(data.get('amount', 0))
        if not category or amount <= 0:
            return jsonify({'error': 'Invalid category or amount'}), 400

        cursor.execute("""
            INSERT INTO budgets (user_id, category, amount) 
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, category) DO UPDATE SET amount=excluded.amount
        """, (request.user_id, category, amount))
        db.commit()
        return jsonify({'success': True})

    current_month = datetime.date.today().strftime('%Y-%m')
    cursor.execute("SELECT category, amount FROM budgets WHERE user_id=?", (request.user_id,))
    budgets = {row['category']: row['amount'] for row in cursor.fetchall()}

    cursor.execute("""
        SELECT category, SUM(amount) as total FROM transactions 
        WHERE user_id=? AND type='Expense' AND strftime('%Y-%m', date) = ?
        GROUP BY category
    """, (request.user_id, current_month))
    spent = {row['category']: row['total'] for row in cursor.fetchall()}

    result = []
    for cat, limit in budgets.items():
        result.append({
            'category': cat,
            'limit': limit,
            'spent': spent.get(cat, 0),
            'color': '#%06x' % random.randint(0, 0xFFFFFF)
        })
    return jsonify(result)


# ============ SUBSCRIPTIONS ============
@app.route('/subscriptions', methods=['GET', 'POST'])
@jwt_required
def handle_subscriptions():
    db = get_db()
    cursor = db.cursor()

    if request.method == 'POST':
        data = request.json
        name = data.get('name')
        amount = int(data.get('amount', 0))
        category = data.get('category')
        start_date = data.get('start_date', str(datetime.date.today()))

        if not name or amount <= 0:
            return jsonify({'error': 'Invalid name or amount'}), 400

        cursor.execute(
            "INSERT INTO subscriptions (user_id, name, amount, category, next_due_date) VALUES (?, ?, ?, ?, ?)",
            (request.user_id, name, amount, category, start_date)
        )
        db.commit()
        return jsonify({'success': True})

    today = str(datetime.date.today())
    cursor.execute("SELECT id, name, amount, category, next_due_date FROM subscriptions WHERE user_id=? AND next_due_date <= ?", (request.user_id, today))
    due_subs = cursor.fetchall()

    for sub in due_subs:
        cursor.execute(
            "INSERT INTO transactions (user_id, amount, merchant, category, type, date, note) VALUES (?, ?, ?, ?, 'Expense', ?, ?)",
            (request.user_id, sub['amount'], sub['name'], sub['category'], sub['next_due_date'], 'Auto-paid subscription')
        )
        due = datetime.datetime.strptime(str(sub['next_due_date']), "%Y-%m-%d")
        next_month = due.replace(day=28) + datetime.timedelta(days=4)
        next_due = next_month.replace(day=min(due.day, 28)).strftime("%Y-%m-%d")
        cursor.execute("UPDATE subscriptions SET next_due_date=? WHERE id=?", (next_due, sub['id']))

    if due_subs:
        db.commit()

    cursor.execute("SELECT id, name, amount, category, next_due_date FROM subscriptions WHERE user_id=? ORDER BY next_due_date", (request.user_id,))
    subs = [dict(row) for row in cursor.fetchall()]
    return jsonify(subs)


@app.route('/subscriptions/<int:sub_id>', methods=['DELETE'])
@jwt_required
def delete_subscription(sub_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM subscriptions WHERE id=? AND user_id=?", (sub_id, request.user_id))
    db.commit()
    return jsonify({'success': True})


if __name__ == '__main__':
    app.run(debug=True)