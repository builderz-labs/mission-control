# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for ICT-Agent.exe
#
# Build (from trading/agent/ directory):
#   pip install pyinstaller httpx websockets keyring
#   pyinstaller ict_agent.spec
#
# Output: dist/ICT-Agent.exe  (single file, ~15 MB)

import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ['signal_agent.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        # keyring backends — include all so Windows Credential Manager works
        'keyring.backends.Windows',
        'keyring.backends.SecretService',
        'keyring.backends.kwallet',
        'keyring.backends.fail',
        'keyring.backends.null',
        # websockets internals
        'websockets.legacy',
        'websockets.legacy.client',
        'websockets.legacy.server',
        'websockets.asyncio',
        # httpx / httpcore internals
        'httpx._transports.default',
        'httpcore._sync.http11',
        'httpcore._async.http11',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Cut binary size — nothing in signal_agent needs these
        'tkinter', 'matplotlib', 'numpy', 'scipy', 'PIL',
        'IPython', 'pandas', 'PyQt5', 'PyQt6', 'wx',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ICT-Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,          # console mode for beta — users see log output
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon='assets/ict_agent.ico',  # uncomment when icon is added
)
