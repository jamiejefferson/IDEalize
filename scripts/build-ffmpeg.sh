#!/usr/bin/env bash
# Build the ffmpeg program IDEalize ships for Studio: joining a soundtrack to a
# video and reading a video's length and frames. It is built from ffmpeg's own
# source with only the parts Studio uses, and without --enable-gpl,
# --enable-nonfree or --enable-version3, so the result is LGPL 2.1 or later.
# No outside library is linked in.
#
#   scripts/build-ffmpeg.sh            # writes vendor/ffmpeg/mac-arm64/ffmpeg
#
# Needs the Xcode command line tools. Re-run it to move to a newer ffmpeg:
# change VERSION and SHA256 below, run it, and commit vendor/ffmpeg.
set -euo pipefail

VERSION="9.1"
SHA256="${FFMPEG_SHA256:-1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/vendor/ffmpeg/mac-arm64"
WORK="${WORK:-$(mktemp -d)}"
URL="https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"

FLAGS=(
  --arch=arm64 --target-os=darwin --cc=clang
  --extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0
  --enable-static --disable-shared --disable-debug --disable-doc
  --disable-ffplay --disable-ffprobe --disable-network --disable-autodetect
  --disable-everything
  --enable-protocol=file,pipe
  --enable-demuxer=mov,matroska,wav,mp3,aac,flac,ogg,image2
  --enable-muxer=mp4,mov,image2,null,wav
  --enable-decoder=h264,hevc,vp8,vp9,mpeg4,aac,mp3,flac,vorbis,opus,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_u8,mjpeg,png
  --enable-encoder=aac,mjpeg,pcm_s16le
  --enable-parser=h264,hevc,vp8,vp9,aac,mpegaudio,flac,vorbis,opus,mjpeg
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata
  --enable-filter=fps,scale,tile,apad,aresample,format,aformat,null,anull,setpts,asetpts
)

mkdir -p "$WORK" "$OUT"
cd "$WORK"
curl -fsSL -o ffmpeg.tar.xz "$URL"
GOT="$(shasum -a 256 ffmpeg.tar.xz | cut -d' ' -f1)"
if [ -n "$SHA256" ] && [ "$GOT" != "$SHA256" ]; then
  echo "ffmpeg-$VERSION.tar.xz has checksum $GOT, expected $SHA256" >&2
  exit 1
fi
tar -xf ffmpeg.tar.xz
cd "ffmpeg-$VERSION"
./configure "${FLAGS[@]}"
make -j"$(sysctl -n hw.ncpu)" ffmpeg
strip -x ffmpeg
cp ffmpeg "$OUT/ffmpeg"
cp COPYING.LGPLv2.1 "$HERE/vendor/ffmpeg/COPYING.LGPLv2.1"
{
  echo "version: $VERSION"
  echo "source: $URL"
  echo "source-sha256: $GOT"
  echo "configure: ${FLAGS[*]}"
  echo "binary-sha256: $(shasum -a 256 "$OUT/ffmpeg" | cut -d' ' -f1)"
} > "$HERE/vendor/ffmpeg/BUILD.txt"
"$OUT/ffmpeg" -hide_banner -version | head -3
