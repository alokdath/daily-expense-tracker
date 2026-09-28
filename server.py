#!/usr/bin/env python3
"""
Personal Expense Tracker - lightweight local server.
Uses only the Python standard library. Persists data to data.json.

Run:  python3 server.py
Then open http://localhost:8900 in your browser.
"""
import json
import os
import http.server
import socketserver
import threading
from datetime import datetime
from urllib.parse import urlparse

PORT = 8900
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")

_lock = threading.Lock()

ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
    "/manifest.json": "manifest.json",
    "/service-worker.js": "service-worker.js",
    "/icons/icon-192.png": "icons/icon-192.png",
    "/icons/icon-512.png": "icons/icon-512.png",
    "/vendor/chart.umd.js": "vendor/chart.umd.js",
}


def load_data():
    with _lock:
        if not os.path.exists(DATA_FILE):
            return {"categories": [], "recurring": [], "transactions": []}
        with open(DATA_FILE, "r") as f:
            return json.load(f)


def save_data(data):
    with _lock:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, DATA_FILE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    # Block DNS-rebinding and cross-site requests: only the app's own origin may talk to the server.
    def _request_allowed(self, needs_json=False):
        if self.headers.get("Host", "") not in ALLOWED_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return False
        if needs_json:
            ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if ctype != "application/json":
                return False
        return True

    def _forbidden(self):
        return self._send_json({"error": "forbidden"}, 403)

    def list_directory(self, path):
        self.send_error(404)
        return None

    # ---- API routes ----
    def do_HEAD(self):
        if not self._request_allowed():
            return self._forbidden()
        return self._serve_static(head=True)

    def do_GET(self):
        if not self._request_allowed():
            return self._forbidden()
        if self.path == "/api/data":
            return self._send_json(load_data())
        return self._serve_static()

    def _serve_static(self, head=False):
        rel = STATIC_FILES.get(urlparse(self.path).path)
        if rel is None:
            return self.send_error(404)
        self.path = "/" + rel
        return super().do_HEAD() if head else super().do_GET()

    def do_POST(self):
        if not self._request_allowed(needs_json=True):
            return self._forbidden()
        if self.path == "/api/data":
            data = self._read_json_body()
            save_data(data)
            return self._send_json({"ok": True})
        if self.path == "/api/transaction":
            body = self._read_json_body()
            data = load_data()
            body["id"] = body.get("id") or datetime.now().strftime("%Y%m%d%H%M%S%f")
            data["transactions"].append(body)
            save_data(data)
            return self._send_json({"ok": True, "id": body["id"]})
        return self._send_json({"error": "not found"}, 404)

    def do_PUT(self):
        if not self._request_allowed(needs_json=True):
            return self._forbidden()
        if self.path.startswith("/api/transaction/"):
            tx_id = self.path.rsplit("/", 1)[-1]
            body = self._read_json_body()
            data = load_data()
            for i, t in enumerate(data["transactions"]):
                if t.get("id") == tx_id:
                    body["id"] = tx_id
                    data["transactions"][i] = body
                    save_data(data)
                    return self._send_json({"ok": True})
            return self._send_json({"error": "not found"}, 404)
        return self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        if not self._request_allowed():
            return self._forbidden()
        if self.path.startswith("/api/transaction/"):
            tx_id = self.path.rsplit("/", 1)[-1]
            data = load_data()
            before = len(data["transactions"])
            data["transactions"] = [t for t in data["transactions"] if t.get("id") != tx_id]
            save_data(data)
            return self._send_json({"ok": True, "deleted": before - len(data["transactions"])})
        if self.path.startswith("/api/recurring/"):
            rid = self.path.rsplit("/", 1)[-1]
            data = load_data()
            data["recurring"] = [r for r in data["recurring"] if r.get("id") != rid]
            save_data(data)
            return self._send_json({"ok": True})
        return self._send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        pass  # keep console quiet


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    with ThreadingServer(("localhost", PORT), Handler) as httpd:
        print(f"Expense Tracker running at http://localhost:{PORT}")
        httpd.serve_forever()
