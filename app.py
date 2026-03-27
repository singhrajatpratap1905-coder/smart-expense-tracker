from flask import Flask, request, jsonify, render_template
import sqlite3, re, datetime, io, os, jwt, hashlib, secrets
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

try:
    from PIL import Image
    import pytesseract
    OCR_ENABLED = True
except ImportError:
    OCR_ENABLED = False

app = Flask(__name__,
            template_folder=os.path.join('venv', 'Backend', 'templates'),
            static_folder=os.path.join('venv', 'Backend', 'static'))

# ============ CONFIG ============
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
JWT_EXPIRY_HOURS = 24 * 7  # tokens last 7 days

# ============ DATABASE SETUP ============
def init_db():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")

    # Transactions table — now with user_id foreign key
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

    conn.commit()
    conn.close()

init_db()

# ============ PASSWORD HELPERS ============
def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((password + salt).encode()).hexdigest()

def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    return hash_password(password, salt) == stored_hash

# ============ JWT HELPERS ============
def create_token(user_id: int, username: str) -> str:
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=JWT_EXPIRY_HOURS)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def decode_token(token: str) -> dict:
    return jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])

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
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        request.user_id = payload['user_id']
        request.username = payload['username']
        return f(*args, **kwargs)
    return decorated

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

# ============ AUTH ROUTES ============

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'error': 'Username, email and password are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'error': 'Invalid email format'}), 400

    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)

    try:
        conn = sqlite3.connect("database.db")
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)",
            (username, email, password_hash, salt)
        )
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
    except sqlite3.IntegrityError as e:
        conn.close()
        if 'username' in str(e):
            return jsonify({'error': 'Username already taken'}), 409
        return jsonify({'error': 'Email already registered'}), 409

    token = create_token(user_id, username)
    return jsonify({'token': token, 'username': username}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.json
    identifier = data.get('identifier', '').strip()  # username or email
    password   = data.get('password', '')

    if not identifier or not password:
        return jsonify({'error': 'Identifier and password are required'}), 400

    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, password_hash, salt FROM users WHERE username=? OR email=?",
        (identifier, identifier.lower())
    )
    row = cursor.fetchone()
    conn.close()

    if not row or not verify_password(password, row[3], row[2]):
        return jsonify({'error': 'Invalid credentials'}), 401

    token = create_token(row[0], row[1])
    return jsonify({'token': token, 'username': row[1]})


# ============ TRANSACTION ROUTES (all protected) ============

@app.route('/')
def index():
    return render_template('index.html')


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

    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO transactions (user_id, amount, merchant, category, type, date, note) VALUES (?,?,?,?,?,?,?)",
        (request.user_id, amount, merchant, category, txn_type, date, note)
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "saved", "category": category})


@app.route('/transactions', methods=['GET'])
@jwt_required
def get_transactions():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, amount, merchant, category, type, date, note FROM transactions WHERE user_id=? ORDER BY date DESC",
        (request.user_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return jsonify(rows)


@app.route('/transactions/<int:txn_id>', methods=['DELETE'])
@jwt_required
def delete_transaction(txn_id):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    # Only delete if it belongs to the requesting user
    cursor.execute(
        "DELETE FROM transactions WHERE id=? AND user_id=?",
        (txn_id, request.user_id)
    )
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    if deleted == 0:
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify({'status': 'deleted'})


@app.route('/summary', methods=['GET'])
@jwt_required
def summary():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute("SELECT SUM(amount) FROM transactions WHERE user_id=? AND type='Income'", (request.user_id,))
    income = cursor.fetchone()[0] or 0
    cursor.execute("SELECT SUM(amount) FROM transactions WHERE user_id=? AND type='Expense'", (request.user_id,))
    expense = cursor.fetchone()[0] or 0
    cursor.execute(
        "SELECT category, SUM(amount) FROM transactions WHERE user_id=? AND type='Expense' GROUP BY category",
        (request.user_id,)
    )
    by_category = cursor.fetchall()
    conn.close()
    return jsonify({
        "income": income,
        "expense": expense,
        "savings": income - expense,
        "by_category": by_category
    })


@app.route('/clear', methods=['DELETE'])
@jwt_required
def clear_all():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute("DELETE FROM transactions WHERE user_id=?", (request.user_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "cleared"})


@app.route('/scan_receipt', methods=['POST'])
@jwt_required
def scan_receipt():
    if not OCR_ENABLED:
        return jsonify({"error": "Tesseract not installed. Run: pip install pytesseract pillow"}), 400
    file = request.files['receipt']
    img = Image.open(io.BytesIO(file.read()))
    text = pytesseract.image_to_string(img)
    amount_match = re.search(r'(?:total|amount|rs\.?|₹)\s*(\d+)', text.lower())
    amount = amount_match.group(1) if amount_match else None
    return jsonify({"extracted_amount": amount, "raw_text": text})


if __name__ == '__main__':
    app.run(debug=True)
