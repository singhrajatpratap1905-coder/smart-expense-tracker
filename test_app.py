
import requests

try:
    response = requests.get("http://127.0.0.1:5000/")
    print(response.status_code)
    print(response.text)
except requests.exceptions.ConnectionError as e:
    print(f"Connection error: {e}")
