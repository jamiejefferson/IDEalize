#!/bin/sh
# Encodes recorded frames into the site's film files, with soundtrack.wav as
# the audio, and posters: the blank
# set (frame 0) shown before the film plays, and the finished ident (frame 160)
# for visitors who prefer reduced motion.
#   sh encode.sh <frames-dir>   (writes into ../assets/v2/)
set -e
F="${1:-frames}"; OUT="$(dirname "$0")/../assets/v2"; A="$(dirname "$0")/soundtrack.wav"
ffmpeg -v error -y -framerate 25 -i "$F/%04d.png" -i "$A" -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 23 -preset slow -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT/film.mp4"
ffmpeg -v error -y -framerate 25 -i "$F/%04d.png" -i "$A" -c:v libvpx-vp9 -pix_fmt yuv420p -crf 36 -b:v 0 -row-mt 1 -c:a libopus -b:a 160k -shortest "$OUT/film.webm"
python3 -c "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');im.thumbnail((1600,1600));im.save(sys.argv[2],'WEBP',quality=82,method=6)" "$F/0000.png" "$OUT/film-poster.webp"
python3 -c "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');im.thumbnail((1600,1600));im.save(sys.argv[2],'WEBP',quality=82,method=6)" "$F/0160.png" "$OUT/film-poster-still.webp"
ls -la "$OUT"/film*
