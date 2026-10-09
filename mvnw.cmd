@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mvn.ps1" %*
