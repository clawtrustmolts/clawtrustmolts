#!/usr/bin/env bash
#
# Collect reproducer / shrunk failure files written by Echidna or Medusa
# into a flat `fuzz-failures/<contract>/` directory so reviewers can
# download just the failing call sequence without digging through the
# full corpus.
#
# Usage:
#   collect-fuzz-failures.sh <tool> <contract> <corpus_dir>
#
# Where:
#   <tool>        echidna | medusa
#   <contract>    Property-contract name (e.g. EchidnaEscrow). Used as
#                 the artifact subdir name.
#   <corpus_dir>  Path to the per-contract corpus directory the fuzzer
#                 wrote to (relative to $PWD or absolute).
#
# Behaviour:
#   * Always exits 0 — this script runs in `if: failure()` post-steps
#     and must never mask the real test failure.
#   * Copies (only) the reproducer artifacts into ./fuzz-failures/<contract>/.
#   * Echidna: copies <corpus>/reproducers/ and any shrunk failure-*.txt.
#   * Medusa:  copies <corpus>/test_results/ and <corpus>/call_sequences/
#              entries flagged as failing.
#   * Writes a one-line summary + file listing to $GITHUB_STEP_SUMMARY
#     pointing reviewers at the artifact name to download.

set -u

TOOL="${1:-}"
CONTRACT="${2:-}"
CORPUS="${3:-}"

if [ -z "$TOOL" ] || [ -z "$CONTRACT" ] || [ -z "$CORPUS" ]; then
  echo "usage: $0 <echidna|medusa> <contract> <corpus_dir>" >&2
  exit 0
fi

OUT="fuzz-failures/${CONTRACT}"
mkdir -p "$OUT"

if [ ! -d "$CORPUS" ]; then
  echo "::warning::no corpus directory at ${CORPUS} — nothing to collect for ${CONTRACT}"
  exit 0
fi

case "$TOOL" in
  echidna)
    # Echidna writes shrunk reproducers under <corpus>/reproducers/
    if [ -d "${CORPUS}/reproducers" ]; then
      cp -R "${CORPUS}/reproducers" "${OUT}/reproducers"
    fi
    # Older / configured runs may also drop failure-*.txt at the corpus root.
    find "$CORPUS" -maxdepth 2 -type f \( -name 'failure-*.txt' -o -name 'shrunk-*.txt' \) \
      -exec cp {} "$OUT/" \; 2>/dev/null || true
    ;;
  medusa)
    # Medusa writes failing call sequences under <corpus>/test_results/
    # (newer versions) and shrunken sequences under <corpus>/call_sequences/.
    if [ -d "${CORPUS}/test_results" ]; then
      cp -R "${CORPUS}/test_results" "${OUT}/test_results"
    fi
    if [ -d "${CORPUS}/call_sequences" ]; then
      # Only copy call-sequence files (small JSONs); skip coverage data.
      mkdir -p "${OUT}/call_sequences"
      find "${CORPUS}/call_sequences" -maxdepth 2 -type f -name '*.json' \
        -exec cp {} "${OUT}/call_sequences/" \; 2>/dev/null || true
    fi
    ;;
  *)
    echo "::warning::unknown tool '${TOOL}' — skipping collection"
    exit 0
    ;;
esac

# If the collector found nothing, leave a small marker so reviewers know
# the post-step ran but the fuzzer didn't emit a structured reproducer.
if [ -z "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "Fuzzer (${TOOL}) failed for ${CONTRACT} but no reproducer files were written under ${CORPUS}." \
    > "${OUT}/NO_REPRODUCER_FOUND.txt"
  echo "Check the ${TOOL}-corpus artifact for the full corpus." \
    >> "${OUT}/NO_REPRODUCER_FOUND.txt"
fi

# Job-summary entry: link reviewers to the artifact for this contract.
ARTIFACT_NAME="fuzz-failures-${CONTRACT}"
if [ "$TOOL" = "medusa" ]; then
  ARTIFACT_NAME="fuzz-failures-medusa-${CONTRACT}"
fi
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
{
  echo ""
  echo "### ❌ ${TOOL} failed for \`${CONTRACT}\`"
  echo ""
  echo "Reproducer collected. Download the **[\`${ARTIFACT_NAME}\`](${RUN_URL}#artifacts)** artifact from this run."
  echo ""
  echo "<details><summary>Files included</summary>"
  echo ""
  echo '```'
  ( cd "$OUT" && find . -type f | sort ) || true
  echo '```'
  echo ""
  echo "</details>"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

exit 0
