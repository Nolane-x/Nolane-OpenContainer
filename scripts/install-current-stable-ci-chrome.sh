#!/usr/bin/env bash
set -euo pipefail

MANIFEST_URL="https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
ARTIFACT_DIR=".artifacts/p14-browser-regression"
ROOT="${RUNNER_TEMP:-/tmp}/opencontainer-current-stable-chrome"
MANIFEST="${ROOT}-manifest.json"
ZIP="${ROOT}.zip"
WRAPPER_DIR="${RUNNER_TEMP:-/tmp}/opencontainer-current-stable-browser-bin"
WRAPPER="${WRAPPER_DIR}/google-chrome-stable"

command -v curl >/dev/null
command -v unzip >/dev/null
command -v node >/dev/null
command -v sha256sum >/dev/null

rm -rf "${ROOT}" "${ZIP}" "${WRAPPER_DIR}"
mkdir -p "${ROOT}" "${WRAPPER_DIR}" "${ARTIFACT_DIR}"

curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --retry-delay 2   --output "${MANIFEST}" "${MANIFEST_URL}"

VERSION="$(node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const v=x?.channels?.Stable?.version;if(!v)process.exit(2);process.stdout.write(v)" "${MANIFEST}")"
URL="$(node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const rows=x?.channels?.Stable?.downloads?.chrome??[];const u=rows.find(r=>r.platform==='linux64')?.url;if(!u)process.exit(2);process.stdout.write(u)" "${MANIFEST}")"

case "${URL}" in
  https://storage.googleapis.com/chrome-for-testing-public/*/linux64/chrome-linux64.zip) ;;
  *)
    echo "Unexpected Chrome Stable download URL: ${URL}" >&2
    exit 1
    ;;
esac

curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --retry-delay 2   --output "${ZIP}" "${URL}"
unzip -q "${ZIP}" -d "${ROOT}"

REAL="${ROOT}/chrome-linux64/chrome"
test -x "${REAL}"
RAW_VERSION="$("${REAL}" --version)"
case "${RAW_VERSION}" in
  *"${VERSION}"*) ;;
  *)
    echo "Current Stable Chrome version mismatch: manifest=${VERSION} binary=${RAW_VERSION}" >&2
    exit 1
    ;;
esac

cat >"${WRAPPER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "Google Chrome ${VERSION}"
  exit 0
fi
exec "${REAL}" "\$@"
EOF
chmod +x "${WRAPPER}"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${WRAPPER_DIR}" >> "${GITHUB_PATH}"
else
  echo "GITHUB_PATH is required for the current Stable CI browser installer" >&2
  exit 1
fi

MANIFEST_SHA256="$(sha256sum "${MANIFEST}" | awk '{print $1}')"
ARCHIVE_SHA256="$(sha256sum "${ZIP}" | awk '{print $1}')"
export VERSION URL RAW_VERSION MANIFEST_URL MANIFEST_SHA256 ARCHIVE_SHA256
node <<'NODE'
const fs=require('fs');
const receipt={
  schema:'opencontainer.p14-current-stable-install.v1.0',
  channel:'Stable',
  version:process.env.VERSION,
  observedVersion:process.env.RAW_VERSION,
  manifestUrl:process.env.MANIFEST_URL,
  downloadUrl:process.env.URL,
  manifestSha256:process.env.MANIFEST_SHA256,
  archiveSha256:process.env.ARCHIVE_SHA256,
  platform:'linux64'
};
fs.mkdirSync('.artifacts/p14-browser-regression',{recursive:true});
fs.writeFileSync('.artifacts/p14-browser-regression/newest-stable-install.json',JSON.stringify(receipt,null,2)+'\n');
NODE

echo "Installed current Chrome Stable ${VERSION} from Chrome for Testing"
