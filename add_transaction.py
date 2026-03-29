
import requests
import jwt
import time

# Create a dummy JWT token
secret = "secret" # dummy secret
payload = {
    "sub": "user123",
    "exp": time.time() + 3600
}
token = jwt.encode(payload, secret, algorithm="HS256")

headers = {
    "Authorization": f"Bearer {token}"
}

# Add a dummy transaction
transaction = {
    "merchant": "Test Merchant",
    "amount": 100,
    "category": "Test Category"
}

try:
    response = requests.post("http://127.0.0.1:5000/add", headers=headers, json=transaction)
    print(response.status_code)
    print(response.json())
except requests.exceptions.ConnectionError as e:
    print(f"Connection error: {e}")
