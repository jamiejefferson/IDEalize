IDEalize PC build pack
======================

What this is
------------
IDEalize is a Mac and Windows app. The Windows installer can only be built on
a Windows PC, and JJ does not have one. This folder holds the app's source code
and a script that builds the installer. Running it needs no knowledge of the
project. The script does the work and puts the results in a folder called
OUTPUT for you to send back.

What you need
-------------
- A Windows 10 or 11 PC with an Intel or AMD processor (not an ARM laptop).
- About 5 GB of free disk space.
- An internet connection. The build downloads its tools and components.
- Time. On the automated build machine the build takes about 13 minutes; a
  laptop takes longer, and most of that is downloading. You can keep using
  the PC while it runs.

Steps
-----
1. Unzip this pack somewhere short, for example C:\idealize-build. Long
   folder paths can make the build fail, so avoid deep folders like
   Documents\Work\Projects\....

2. Double-click Build-IDEalize.cmd inside the unzipped folder.

   If a blue "Windows protected your PC" box appears, click "More info" and
   then "Run anyway". The script is not signed by a publisher, which is what
   the box is warning about.

3. If the window says Node.js is needed, install it using the command or the
   link it shows, then double-click Build-IDEalize.cmd again. Node.js is the
   only thing you install by hand, and only if the PC does not have it.

4. Wait for the window to say "Build finished". An Explorer window opens on
   the OUTPUT folder.

5. Send everything in the OUTPUT folder to JJ. It contains the installer
   (IDEalize-V1-Setup.exe and a copy with the version in its name), a
   portable zip, a checksums file, and the build log.

Trying the installer yourself
-----------------------------
If you want to check it works, run IDEalize-V1-Setup.exe from OUTPUT.
Windows shows the same "Windows protected your PC" box because the installer
is unsigned; choose "More info", then "Run anyway". The app installs like any
other and can be removed from Settings > Apps. You are the first person to
run IDEalize on a Windows PC, so anything odd you notice is worth telling JJ,
however small.

If it stops
-----------
Send OUTPUT\build-log.txt to JJ. That file has everything needed to work out
what went wrong. There is nothing else to do on your side.
