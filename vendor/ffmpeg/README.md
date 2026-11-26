# ffmpeg, as IDEalize ships it

IDEalize carries its own `ffmpeg` so Studio can join a soundtrack to a video and read a video's length and frames without anyone installing anything.

- `mac-arm64/ffmpeg` is built by `scripts/build-ffmpeg.sh` from FFmpeg's own source, with only the parts Studio uses and no outside library.
- It is built without `--enable-gpl`, `--enable-nonfree` and `--enable-version3`, so it is licensed under the GNU Lesser General Public License, version 2.1 or later. The licence text is `COPYING.LGPLv2.1`.
- `BUILD.txt` records the FFmpeg version, the source archive and its checksum, and the exact configure flags. That archive is the complete corresponding source: download it from the URL in `BUILD.txt`, or from https://ffmpeg.org/download.html, and run the script to rebuild the same program.
- The program runs as a separate process. IDEalize does not link against it.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. See https://ffmpeg.org/legal.html.
