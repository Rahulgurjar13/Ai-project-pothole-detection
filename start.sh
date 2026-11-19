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
# (The first line "#!/bin/bash" tells the computer to run this file with the bash shell.)

cd "$(dirname "$0")"                      # always work from the project folder ($0 = this script's path, dirname = its folder)
PORT="${PORT:-8000}"                      # use the PORT setting if the user gave one, otherwise use 8000

# --- 1. First-time setup ---
if [ ! -x .venv/bin/python ]; then        # if the Python inside the .venv folder does NOT exist yet (-x = file can be run)...
  echo "Setting up Python (first time only, takes a few minutes)..."   # print a message on the screen
  # make a private Python folder (.venv), THEN (&&) install the libraries; if either fails (||) stop the script
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt || exit 1
fi                                        # end of the "if"
if [ ! -d frontend/node_modules ]; then   # if the website packages folder does NOT exist yet (-d = is a folder)...
  echo "Installing website packages (first time only)..."   # print a message
  (cd frontend && npm install) || exit 1  # in a sub-shell ( ), go into frontend and install packages; stop if it fails
fi                                        # end of the "if"

# --- 2. Build the website if it is missing or a file in frontend/app changed ---
# -f = file exists; find ... -newer = list files in frontend/app changed after the last build; -n = that list is not empty
if [ ! -f frontend/out/index.html ] || [ -n "$(find frontend/app -newer frontend/out/index.html)" ]; then
  echo "Building the website..."          # print a message
  # build the website (> /dev/null hides its normal output); if it fails, show a hint and stop the script
  (cd frontend && npm run build > /dev/null) || { echo "Website build failed. Run: cd frontend && npm run build"; exit 1; }
fi                                        # end of the "if"

# --- 3. Free the port if an old copy is still running ---
old=$(lsof -ti tcp:$PORT -sTCP:LISTEN)    # lsof -ti = give only the process ID (number) of the program listening on this port
# if a process ID was found (-n = not empty): print a message, kill (stop) that program, wait 1 second
[ -n "$old" ] && { echo "Port $PORT is busy, stopping the old copy..."; kill $old; sleep 1; }

echo ""                                   # print an empty line
echo "  Pothole Detection System  ->  http://localhost:$PORT"   # print the website address
echo "  (press Ctrl + C to stop)"         # print how to stop the server
echo ""                                   # print an empty line
# if NO_BROWSER is not set (-z = empty): wait 3 s for the server, then open the address; the final & runs it in the background
[ -z "$NO_BROWSER" ] && (sleep 3 && open "http://localhost:$PORT") &   # open the browser by itself
# go into backend, then start the API server with uvicorn (server:app = the "app" inside server.py);
# exec = the server replaces this script, so Ctrl + C stops it directly; --log-level warning = print only warnings/errors
cd backend && exec ../.venv/bin/python -m uvicorn server:app --port "$PORT" --log-level warning
