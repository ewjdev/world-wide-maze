#!/usr/bin/env bash
# Rebuilds the share-card fonts (Phase 18). Not run by the build: the outputs are committed (OFL 1.1, see NOTICE.md).
#
# Inputs: the Google Fonts variable TTFs (OFL 1.1)
#   https://raw.githubusercontent.com/google/fonts/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf
#   https://raw.githubusercontent.com/google/fonts/main/ofl/figtree/Figtree%5Bwght%5D.ttf
# Needs fonttools + brotli (`python3 -m venv v && v/bin/pip install fonttools brotli`).
#
# Usage: FONTTOOLS=/path/to/venv/bin build-fonts.sh <dir with Unbounded-VF.ttf and Figtree-VF.ttf>
#
# Each instance is static (resvg renders a variable font's default instance only) and subset to Latin,
# Latin-1, Latin Extended-A and the punctuation the cards use. Titles with other characters fall back to the host.
set -euo pipefail
SRC="${1:?source dir}"
BIN="${FONTTOOLS:?venv bin dir with fonttools and pyftsubset}"
OUT="$(cd "$(dirname "$0")" && pwd)"
UNICODES="U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+2190-2193,U+00D7"

instance() {
  local src="$1" weight="$2" name="$3"
  "$BIN/fonttools" varLib.instancer "$SRC/$src" "wght=$weight" --static --update-name-table -q -o "/tmp/$name-full.ttf"
  "$BIN/pyftsubset" "/tmp/$name-full.ttf" --unicodes="$UNICODES" --layout-features='kern,liga' \
    --no-hinting --desubroutinize --name-IDs='0,1,2,3,4,5,6,13,14' --output-file="$OUT/$name.ttf"
}

instance Unbounded-VF.ttf 900 unbounded-900
instance Unbounded-VF.ttf 700 unbounded-700
instance Figtree-VF.ttf 600 figtree-600
instance Figtree-VF.ttf 800 figtree-800
ls -la "$OUT"/*.ttf
