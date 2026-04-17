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

INV_FILE="${OUT}/failing-invariants.txt"

case "$TOOL" in
  echidna)
    # Echidna writes shrunk reproducers under <corpus>/reproducers/
    if [ -d "${CORPUS}/reproducers" ]; then
      cp -R "${CORPUS}/reproducers" "${OUT}/reproducers"
    fi
    # Older / configured runs may also drop failure-*.txt at the corpus root.
    find "$CORPUS" -maxdepth 2 -type f \( -name 'failure-*.txt' -o -name 'shrunk-*.txt' \) \
      -exec cp {} "$OUT/" \; 2>/dev/null || true

    # Echidna names each reproducer file after the failing property
    # (e.g. reproducers/echidna_escrow_conservation.txt). Extract the
    # property name from the filename so reviewers see it inline in the
    # PR comment without downloading the artifact.
    {
      if [ -d "${OUT}/reproducers" ]; then
        find "${OUT}/reproducers" -maxdepth 1 -type f -name '*.txt' \
          -exec basename {} .txt \; 2>/dev/null
      fi
      find "$OUT" -maxdepth 1 -type f \( -name 'failure-*.txt' -o -name 'shrunk-*.txt' \) \
        -exec basename {} \; 2>/dev/null \
        | sed -e 's/^failure-//' -e 's/^shrunk-//' -e 's/\.txt$//'
    } | awk 'NF' | sort -u > "$INV_FILE" || true
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

    # Medusa records each failing property as a JSON file under
    # test_results/. The test name is embedded in the JSON (under various
    # keys depending on the medusa version) and is also typically the
    # filename. Extract via jq with a filename fallback so we always
    # surface a property name when one is available.
    {
      if [ -d "${OUT}/test_results" ]; then
        while IFS= read -r -d '' f; do
          name=""
          if command -v jq >/dev/null 2>&1; then
            # Prefer the property-specific keys at any depth before
            # falling back to a generic `.name`, which in some medusa
            # output variants may belong to an unrelated nested object
            # (e.g. a contract or call entry) rather than the failing
            # property itself.
            name=$(jq -r '
              ([.. | objects |
                  (.test_name? // .testName? // .property? // .propertyName?)
                  | strings] | first)
              // ([.. | objects | .name? | strings] | first)
              // empty
            ' "$f" 2>/dev/null)
          fi
          if [ -z "$name" ] || [ "$name" = "null" ]; then
            name=$(basename "$f" .json)
          fi
          [ -n "$name" ] && echo "$name"
        done < <(find "${OUT}/test_results" -maxdepth 3 -type f -name '*.json' -print0)
      fi
    } | awk 'NF' | sort -u > "$INV_FILE" || true
    ;;
  *)
    echo "::warning::unknown tool '${TOOL}' — skipping collection"
    exit 0
    ;;
esac

# Drop the invariants file if it ended up empty so downstream steps can
# treat its absence as "no inline invariant info available".
if [ -f "$INV_FILE" ] && [ ! -s "$INV_FILE" ]; then
  rm -f "$INV_FILE"
fi

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
  if [ -s "$INV_FILE" ]; then
    echo "**Failing invariants:**"
    echo ""
    while IFS= read -r inv; do
      echo "- \`${inv}\`"
    done < "$INV_FILE"
    echo ""
  fi
  echo "<details><summary>Files included</summary>"
  echo ""
  echo '```'
  ( cd "$OUT" && find . -type f | sort ) || true
  echo '```'
  echo ""
  echo "</details>"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

exit 0
