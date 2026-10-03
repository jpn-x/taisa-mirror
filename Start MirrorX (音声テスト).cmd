@echo off
chcp 65001 >nul
rem Audio experiment M1: asks the iPhone for ALAC-only audio and logs what arrives (data\mirrorx.log, data\audio-m1.bin).
rem Normal use: "Start MirrorX.cmd". This one is only for the audio test.
set MIRRORX_AUDIO_TEST=1
call "%~dp0Start MirrorX.cmd"
