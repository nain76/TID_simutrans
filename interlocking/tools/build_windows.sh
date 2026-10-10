#!/bin/sh
# Cross-compiles the Windows 64bit (GDI) version on Linux (Ubuntu) with MinGW.
#
#   sh interlocking/tools/build_windows.sh <work dir>
#
# Needs: g++-mingw-w64-x86-64-posix, cmake, curl. Builds static zlib, bzip2, libpng and
# freetype into <work dir>/prefix, then build/win64/sim.exe with config.win64.
set -e
W=$(cd "$1" && pwd)
H=x86_64-w64-mingw32
P=$W/prefix
mkdir -p "$W/src" "$W/build" "$P/lib" "$P/include"
cd "$W/src"
for u in https://zlib.net/fossils/zlib-1.3.1.tar.gz https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz \
         https://download.sourceforge.net/libpng/libpng-1.6.43.tar.gz https://download.savannah.gnu.org/releases/freetype/freetype-2.13.2.tar.gz; do
	[ -f "$(basename $u)" ] || curl -sSL -o "$(basename $u)" "$u"
done
cd "$W/build"
for f in "$W"/src/*.tar.gz; do tar xzf "$f"; done
(cd zlib-1.3.1 && make -f win32/Makefile.gcc PREFIX=$H- libz.a && cp libz.a "$P/lib/" && cp zlib.h zconf.h "$P/include/")
(cd bzip2-1.0.8 && make CC=$H-gcc AR=$H-ar RANLIB=$H-ranlib libbz2.a && cp libbz2.a "$P/lib/" && cp bzlib.h "$P/include/")
(cd libpng-1.6.43 && ./configure --host=$H --prefix="$P" --disable-shared --enable-static CPPFLAGS=-I"$P/include" LDFLAGS=-L"$P/lib" && make -j4 && make install)
(mkdir -p ft && cd ft && cmake -S ../freetype-2.13.2 -B . -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_C_COMPILER=$H-gcc -DCMAKE_RC_COMPILER=$H-windres \
	-DCMAKE_INSTALL_PREFIX="$P" -DBUILD_SHARED_LIBS=OFF -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON -DFT_DISABLE_BZIP2=ON \
	-DFT_DISABLE_PNG=ON -DFT_DISABLE_ZLIB=ON -DCMAKE_BUILD_TYPE=Release && make -j4 && make install)

cat > "$W/ft-config" <<EOT
#!/bin/sh
case "\$*" in *--cflags*) echo "-I$P/include/freetype2" ;; *) echo "-L$P/lib -lfreetype" ;; esac
EOT
chmod +x "$W/ft-config"

cd "$(dirname "$0")/../.."
cat > config.win64 <<EOT
BACKEND = gdi
OSTYPE = mingw
COLOUR_DEPTH = 16
DEBUG = 0
MSG_LEVEL = 3
OPTIMISE = 1
MULTI_THREAD = 1
WIN32_CONSOLE = 1
USE_FREETYPE = 1
STATIC = 1
WITH_REVISION = 0
CC = $H-gcc
CXX = $H-g++
HOSTCXX = $H-g++
WINDRES = $H-windres -DREVISION=0
FREETYPE_CONFIG = $W/ft-config
CFLAGS += -I$P/include
LDFLAGS += -L$P/lib
EOT
# newer windres cannot take the preprocessor command line of common.mk: compile the resource directly
mkdir -p build/win64
$H-windres -DREVISION=0 -O COFF simres.rc build/win64/simres.o
make CFG=win64 -j4
$H-strip -o build/win64/sim-WinGDI-OTRP-TID.exe build/win64/sim.exe
echo "=> build/win64/sim-WinGDI-OTRP-TID.exe"
