#!/usr/bin/env bash
# snapshot-prebackfill-db.sh
#
# Atomically snapshots the production SQLite database on Fly.io BEFORE any
# backfill, mass UPDATE, or schema migration. The snapshot artifact path must
# be cited in the backfill commit message (Supplementary Gate B).
#
# Plan: Plans/nba-learned-model.md addendum v11 §"Pre-flight tooling" #3 (pm.7).
#
# Usage:
#   bash scripts/snapshot-prebackfill-db.sh
#   bash scripts/snapshot-prebackfill-db.sh --app <fly-app-name>
#   bash scripts/snapshot-prebackfill-db.sh --label <label>   # added to filename
#   bash scripts/snapshot-prebackfill-db.sh --local           # snapshot local DB only
#
# Output:
#   data/snapshots/sportsdata-prebackfill-<TIMESTAMP>[.<LABEL>].db
#
# After a successful snapshot, paste the output path into the backfill commit
# message as: Snapshot: data/snapshots/<filename>
#
# Requires: fly CLI at ~/.fly/bin/fly or on PATH. Install: curl -L
# https://fly.io/install.sh | sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOTS_DIR="${REPO_ROOT}/data/snapshots"
REMOTE_DB_PATH="/app/data/sqlite/sportsdata.db"
FLY_APP="sportsdata-api"
LABEL=""
LOCAL_ONLY=false
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# --- Arg parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)    FLY_APP="$2"; shift 2 ;;
    --label)  LABEL=".$2"; shift 2 ;;
    --local)  LOCAL_ONLY=true; shift ;;
    *)        echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "${SNAPSHOTS_DIR}"

SNAPSHOT_FILENAME="sportsdata-prebackfill-${TIMESTAMP}${LABEL}.db"
SNAPSHOT_PATH="${SNAPSHOTS_DIR}/${SNAPSHOT_FILENAME}"

# --- Locate fly binary ---
FLY_BIN=""
if command -v fly &>/dev/null; then
  FLY_BIN="fly"
elif [[ -x "${HOME}/.fly/bin/fly" ]]; then
  FLY_BIN="${HOME}/.fly/bin/fly"
elif [[ -x "${HOME}/.fly/bin/flyctl" ]]; then
  FLY_BIN="${HOME}/.fly/bin/flyctl"
fi

if [[ "${LOCAL_ONLY}" == "true" ]]; then
  LOCAL_DB="${REPO_ROOT}/data/sqlite/sportsdata.db"
  if [[ ! -f "${LOCAL_DB}" ]]; then
    echo "ERROR: local DB not found at ${LOCAL_DB}" >&2
    exit 1
  fi
  sqlite3 "${LOCAL_DB}" ".backup ${SNAPSHOT_PATH}"
  echo "Snapshot (local): ${SNAPSHOT_PATH}"
  echo ""
  echo "Snapshot created. Cite in commit message:"
  echo "  Snapshot: data/snapshots/${SNAPSHOT_FILENAME}"
  exit 0
fi

if [[ -z "${FLY_BIN}" ]]; then
  echo "ERROR: fly CLI not found. Install with: curl -L https://fly.io/install.sh | sh" >&2
  echo "Or run with --local to snapshot the local DB." >&2
  exit 1
fi

echo "fly binary: ${FLY_BIN}"
echo "App: ${FLY_APP}"
echo "Timestamp: ${TIMESTAMP}"
echo ""

# --- Step 1: create atomic backup on remote ---
REMOTE_SNAPSHOT="/tmp/sportsdata-prebackfill-${TIMESTAMP}.db"
echo "Creating sqlite3 backup on remote at ${REMOTE_SNAPSHOT}..."
"${FLY_BIN}" ssh console --app "${FLY_APP}" \
  -C "sqlite3 ${REMOTE_DB_PATH} '.backup ${REMOTE_SNAPSHOT}'"

# --- Step 2: verify remote snapshot exists and get size ---
echo "Verifying remote snapshot..."
REMOTE_SIZE=$("${FLY_BIN}" ssh console --app "${FLY_APP}" \
  -C "ls -la ${REMOTE_SNAPSHOT}" 2>/dev/null | awk '{print $5}' || echo "0")
echo "Remote snapshot size: ${REMOTE_SIZE} bytes"

if [[ "${REMOTE_SIZE}" == "0" ]] || [[ -z "${REMOTE_SIZE}" ]]; then
  echo "ERROR: remote snapshot appears empty or failed. Check Fly SSH access." >&2
  exit 1
fi

# --- Step 3: pull snapshot to local ---
echo "Downloading snapshot to ${SNAPSHOT_PATH}..."
"${FLY_BIN}" ssh console --app "${FLY_APP}" \
  -C "cat ${REMOTE_SNAPSHOT}" > "${SNAPSHOT_PATH}"

# --- Step 4: verify local snapshot ---
LOCAL_SIZE=$(wc -c < "${SNAPSHOT_PATH}" | tr -d ' ')
echo "Local snapshot size: ${LOCAL_SIZE} bytes"

if [[ "${LOCAL_SIZE}" -lt 4096 ]]; then
  echo "ERROR: local snapshot too small (${LOCAL_SIZE} bytes). Download may have failed." >&2
  rm -f "${SNAPSHOT_PATH}"
  exit 1
fi

# Verify it's a valid SQLite file (first 16 bytes = "SQLite format 3\000")
MAGIC=$(head -c 16 "${SNAPSHOT_PATH}" 2>/dev/null | od -A n -t x1 | tr -d ' \n' | head -c 32)
if [[ "${MAGIC}" != "53514c69746520666f726d6174203300" ]]; then
  echo "WARN: snapshot magic bytes don't match SQLite3 header — verify file integrity manually." >&2
fi

# --- Step 5: clean up remote temp file ---
"${FLY_BIN}" ssh console --app "${FLY_APP}" \
  -C "rm -f ${REMOTE_SNAPSHOT}" || true

echo ""
echo "Snapshot complete: ${SNAPSHOT_PATH}"
echo ""
echo "Cite in backfill commit message:"
echo "  Snapshot: data/snapshots/${SNAPSHOT_FILENAME}"
echo ""
echo "To inspect: sqlite3 ${SNAPSHOT_PATH} '.tables'"
