#!/usr/bin/env bash
set -euo pipefail

VERSION="153.0.8010.52"
URL="https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-linux64.zip"
ROOT="${RUNNER_TEMP:-/tmp}/opencontainer-chrome-${VERSION}"
ZIP="${ROOT}.zip"
REAL="${ROOT}/chrome-linux64/chrome"
WRAPPER_DIR="${RUNNER_TEMP:-/tmp}/opencontainer-frozen-browser-bin"
WRAPPER="${WRAPPER_DIR}/google-chrome-stable"

command -v curl >/dev/null
command -v unzip >/dev/null
rm -rf "${ROOT}" "${ZIP}" "${WRAPPER_DIR}"
mkdir -p "${ROOT}" "${WRAPPER_DIR}"

curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --retry-delay 2 \
  --output "${ZIP}" "${URL}"
unzip -q "${ZIP}" -d "${ROOT}"

test -x "${REAL}"
RAW_VERSION="$("${REAL}" --version)"
case "${RAW_VERSION}" in
  *"${VERSION}"*) ;;
  *)
    echo "Frozen Chrome version mismatch: ${RAW_VERSION}" >&2
    exit 1
    ;;
esac

cat >"${WRAPPER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--version" ]]; then
  echo "Google Chrome 153.0.8010.52"
  exit 0
fi
exec "${REAL}" "$@"
EOF
chmod +x "${WRAPPER}"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${WRAPPER_DIR}" >> "${GITHUB_PATH}"
else
  echo "GITHUB_PATH is required for the frozen CI browser installer" >&2
  exit 1
fi

echo "Pinned Chrome ${VERSION} from ${URL}"
