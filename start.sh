#!/bin/bash
# =================================================================
# start.sh  -  starts the WHOLE project with ONE command:   ./start.sh
#
#   1. installs what is missing (only the first time)
#   2. builds the website (only when you changed it)
#   3. starts the Python server, which shows the website + runs the AI
#
# Then open:  http://localhost:8000      Stop: press Ctrl + C
# =================================================================

cd "$(dirname "$0")"                      # always work from the project folder
PORT="${PORT:-8000}"

# --- 1. First-time setup ---
if [ ! -x .venv/bin/python ]; then
  echo "Setting up Python (first time only, takes a few minutes)..."
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt || exit 1
fi
if [ ! -d frontend/node_modules ]; then
  echo "Installing website packages (first time only)..."
  (cd frontend && npm install) || exit 1
fi

# --- 2. Build the website if it is missing or a file in frontend/app changed ---
if [ ! -f frontend/out/index.html ] || [ -n "$(find frontend/app -newer frontend/out/index.html)" ]; then
  echo "Building the website..."
  (cd frontend && npm run build > /dev/null) || { echo "Website build failed. Run: cd frontend && npm run build"; exit 1; }
fi

# --- 3. Free the port if an old copy is still running ---
old=$(lsof -ti tcp:$PORT -sTCP:LISTEN)
[ -n "$old" ] && { echo "Port $PORT is busy, stopping the old copy..."; kill $old; sleep 1; }

echo ""
echo "  Pothole Detection System  ->  http://localhost:$PORT"
echo "  (press Ctrl + C to stop)"
echo ""
[ -z "$NO_BROWSER" ] && (sleep 3 && open "http://localhost:$PORT") &   # open the browser by itself
cd backend && exec ../.venv/bin/python -m uvicorn server:app --port "$PORT" --log-level warning
