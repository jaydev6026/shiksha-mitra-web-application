import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

# .env file se variables load karne ke liye
load_dotenv()

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "public"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=63072000"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)"
    return response


SYSTEM_DIRECTIVE = (
    "You are Shiksha Mitra, an AI mentor for students. "
    "Provide clear, accurate, detailed, and complete answers. "
    "Do not truncate or cut off sentences. "
    "Always end your response with the exact phrase: 'What else can I help you with?'"
)
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-20b"


def format_ai_response(text):
    """Clean up the answer, ensure complete output, and append the follow-up prompt."""
    if not text or not text.strip():
        return "I am unable to generate a response right now.\n\nWhat else can I help you with?"

    cleaned = text.strip()

    # Trailing empty dashes hatao
    cleaned = re.sub(r"\s*-\s*$", "", cleaned)

    # Ensure "What else can I help you with?" is at the bottom
    closing_phrase = "What else can I help you with?"
    if closing_phrase.lower() not in cleaned.lower():
        cleaned = f"{cleaned}\n\n{closing_phrase}"

    return cleaned


def run_command(command, timeout=12):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode != 0:
            message = result.stderr.strip() or "The system command did not complete."
            return None, message
        return result.stdout, None
    except FileNotFoundError:
        return None, f"Required system utility not installed: {command[0]}"
    except subprocess.TimeoutExpired:
        return None, "The hardware scan timed out. Please try again."


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "groqConfigured": bool(os.getenv("GROQ_API_KEY")), "model": MODEL})


@app.post("/api/ask")
def ask():
    payload = request.get_json(silent=True) or {}
    mode = str(payload.get("mode", "assistant")).strip().lower()
    language = str(payload.get("language", "English"))[:24]
    question = str(payload.get("prompt", "")).strip()

    if not question:
        return jsonify({"error": "Add a question or a few details first."}), 400
    if len(question) > 5000:
        return jsonify({"error": "Please keep your question under 5,000 characters."}), 400

    # AI Assistant mode me "hi/hello" greetings ke liye exact reply logic
    greetings = {"hi","hii", "hello","hello hello", "hey", "hlo", "hi there", "hello there", "namaste"}
    clean_question = re.sub(r"[^\w\s]", "", question.lower()).strip()
    
    if mode in ["assistant", "ai assistant", "ai_assistant"] and clean_question in greetings:
        intro_reply = (
            "I am Shiksha Mitra AI Assistant, created by JAYDEV SINGH RANAWAT, "
            "HARSH VARDHAN SINGH, DEVENDRA SINGH RATHORE, RAMAN SHARMA, "
            "VICKY SONI and AVANI MEHTA."
        )
        return jsonify({"answer": format_ai_response(intro_reply), "model": MODEL})

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return jsonify({"error": "Groq is not connected yet. Set GROQ_API_KEY in the environment on the device running app.py."}), 503

    user_prompt = (
        f"Module: {mode}. Reply in {language}. "
        "Provide a clear, fully-formed, detailed, and accurate answer. "
        "For scholarships, give clear categories and advise verifying eligibility on official portals. "
        "For interview practice, provide detailed question and answer pairs.\n\n"
        f"Student request:\n{question}"
    )
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_DIRECTIVE},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.5,
        "max_tokens": 1000,
    }).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    req = urllib.request.Request(GROQ_ENDPOINT, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
        answer = data["choices"][0]["message"]["content"].strip()
        return jsonify({"answer": format_ai_response(answer), "model": MODEL})
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        if error.code == 401:
            message = "Groq rejected the configured API key. Check GROQ_API_KEY on the device."
        elif error.code == 429:
            message = "Groq is temporarily rate-limited. Please wait a moment and try again."
        else:
            message = f"Groq request failed ({error.code}). {detail}"
        return jsonify({"error": message}), 502
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as error:
        return jsonify({"error": f"Could not reach the AI service. Check internet access and try again. ({type(error).__name__})"}), 502


@app.get("/api/wifi/scan")
def scan_wifi():
    if not shutil.which("nmcli"):
        return jsonify({"error": "nmcli was not found. Install or enable NetworkManager on this device."}), 503
    output, error = run_command(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"])
    if error:
        return jsonify({"error": error}), 503
    networks = []
    for row in output.splitlines():
        parts = row.split(":")
        if len(parts) < 4:
            continue
        active, ssid, signal, security = parts[0], ":".join(parts[1:-2]), parts[-2], parts[-1]
        try:
            strength = int(signal)
        except ValueError:
            strength = 0
        if ssid:
            networks.append({"ssid": ssid, "signal": strength, "security": security or "Open", "connected": active == "*"})
    networks.sort(key=lambda network: network["signal"], reverse=True)
    return jsonify({"networks": networks})


@app.get("/api/bluetooth/scan")
def scan_bluetooth():
    if shutil.which("bluetoothctl"):
        run_command(["bluetoothctl", "--timeout", "6", "scan", "on"], timeout=9)
        output, error = run_command(["bluetoothctl", "devices"], timeout=6)
    elif shutil.which("hcitool"):
        output, error = run_command(["hcitool", "scan"], timeout=12)
    else:
        return jsonify({"error": "Bluetooth tools were not found. Install BlueZ (bluetoothctl) on this device."}), 503
    if error and not output:
        return jsonify({"error": error}), 503
    devices = []
    for row in (output or "").splitlines():
        match = re.match(r"^(?:Device\s+)?([0-9A-Fa-f:]{17})\s+(.+)$", row.strip())
        if match:
            devices.append({"address": match.group(1), "name": match.group(2).strip()})
    return jsonify({"devices": devices})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)