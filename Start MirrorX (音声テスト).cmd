@echo off
chcp 65001 >nul
rem Audio experiment M1: asks the iPhone for AAC-LC-only audio (M1b) and logs what arrives (data\mirrorx.log, data\audio-m1.bin).
rem Normal use: "Start MirrorX.cmd". This one is only for the audio test.
set MIRRORX_AUDIO_TEST=lc
call "%~dp0Start MirrorX.cmd"
