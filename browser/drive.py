#!/usr/bin/env python3
"""Load a page in a real browser and return what it reported.

WebDriver over plain HTTP: geckodriver ships with Firefox and speaks the
protocol directly, so this needs no selenium and no pip install.

Why not `firefox --screenshot`: it captures immediately, without waiting for
animation frames, so a game's first painted frame never appears and the
verdict has to be read out of an image. Here the page can run a REAL
requestAnimationFrame loop and this waits for it to finish, which tests the
loop games actually use rather than a hand-pumped substitute.

Exits 0 when the page reports PASS, 1 otherwise. The page's own log is
printed either way, since that is the diagnostic.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

PORT = 4444
BASE = f"http://127.0.0.1:{PORT}"


def rpc(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        # geckodriver puts the real reason in the body; the status alone
        # ("500 Internal Server Error") says nothing useful.
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code}: {detail}") from None


def wait_for_driver(proc, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            urllib.request.urlopen(BASE + "/status", timeout=2).read()
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    if len(sys.argv) < 2:
        print("usage: drive.py <url> [timeout_seconds]", file=sys.stderr)
        return 2
    url = sys.argv[1]
    budget = float(sys.argv[2]) if len(sys.argv) > 2 else 45.0

    driver = subprocess.Popen(
        ["geckodriver", "--port", str(PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_for_driver(driver):
            print("geckodriver did not start", file=sys.stderr)
            return 2

        session = rpc("POST", "/session", {
            "capabilities": {"alwaysMatch": {
                "moz:firefoxOptions": {"args": ["-headless"]},
                # A real window size: some games read innerWidth.
                "pageLoadStrategy": "normal",
            }}
        })["value"]["sessionId"]
        sid = f"/session/{session}"

        try:
            rpc("POST", sid + "/window/rect",
                {"width": 1100, "height": 900, "x": 0, "y": 0})
            rpc("POST", sid + "/url", {"url": url})

            # Poll for the verdict the page writes into #log. Polling rather
            # than a fixed sleep means a fast game finishes fast and a slow
            # one still gets its full budget.
            deadline = time.time() + budget
            text = ""
            while time.time() < deadline:
                res = rpc("POST", sid + "/execute/sync", {
                    "script": "return (document.getElementById('log')||{}).textContent || '';",
                    "args": [],
                })
                text = res.get("value") or ""
                if "VERDICT:" in text:
                    break
                time.sleep(0.25)

            if text.strip():
                for line in text.strip().splitlines():
                    print("      " + line)
            else:
                print("      (page reported nothing)")

            return 0 if "VERDICT: PASS" in text else 1
        finally:
            try:
                rpc("DELETE", sid)
            except Exception:
                pass
    finally:
        driver.terminate()
        try:
            driver.wait(timeout=10)
        except Exception:
            driver.kill()


if __name__ == "__main__":
    sys.exit(main())
