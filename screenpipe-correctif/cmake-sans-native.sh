#!/bin/sh
# Enveloppe de cmake pour compiler screenpipe : coupe la détection CPU de ggml (whisper-rs-sys),
# dont l'option -mcpu=native+dotprod+i8mm+nosve+sme est refusée par le clang d'Apple sur certaines puces.
# Usage : export CMAKE=/chemin/absolu/vers/cmake-sans-native.sh (le crate cmake lit cette variable).
# Seules les configurations reçoivent l'option ; --build, --install, -E et -P passent tels quels.
REEL="${CMAKE_REEL:-cmake}"
case "$1" in
  --build|--install|-E|-P|--version|--help) exec "$REEL" "$@" ;;
esac
exec "$REEL" -DGGML_NATIVE=OFF "$@"
