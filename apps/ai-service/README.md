# SecureVote AI Service (Flask)

Face encoding (`/encode-face`), matching (`/match-face`), and blink detection (`/detect-blink`) using `face_recognition` and OpenCV.

## Setup (Windows)

```powershell
# Recommended: use Python 3.11 for better compatibility with dlib/face_recognition builds.
# Check your Python versions with:
#   py -0p
#
# If Python 3.11 is installed:
py -3.11 -m venv .venv311
.\.venv311\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**Important:** `face_recognition` depends on `dlib`. On Windows, `dlib` often requires the **C++ build toolchain** (MSVC), not just Python.

If you see errors like:
- `You must use Visual Studio to build a python extension on windows`

Then install **Visual Studio Build Tools** (C++ build tools) using the “Desktop development with C++” workload, or otherwise ensure `cl.exe` + MSVC toolchain are available.

After installing build tools, rerun:
```powershell
pip install -r requirements.txt
```

## Run

```powershell
python app.py
```

Default URL: `http://127.0.0.1:5001`. Set `AI_SERVICE_URL` in the API `.env` to match.
