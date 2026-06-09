import urllib.request
import json

base_url = "http://localhost:8000/api"

def get_latest_booking():
    # Login first
    url = f"{base_url}/admin/login"
    data = json.dumps({"username": "admin", "password": "password123"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as res:
            admin_data = json.loads(res.read().decode("utf-8"))
            token = admin_data["token"]
    except Exception as e:
        print("Login failed:", e)
        return

    # Export data
    url = f"{base_url}/admin/export"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET"
    )
    try:
        with urllib.request.urlopen(req) as res:
            export_data = json.loads(res.read().decode("utf-8"))
            bookings = export_data.get("bookings", [])
            if bookings:
                lp = bookings[0].get("license_plate")
                print("Code points:", [hex(ord(c)) for c in lp])
            else:
                print("No bookings found.")
    except Exception as e:
        print("Export failed:", e)

if __name__ == "__main__":
    get_latest_booking()
