#!/usr/bin/env python3
"""Wrapper — redirects to data/sync_to_duckdb.py"""
import sys, os
os.execv(sys.executable, [sys.executable,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data/sync_to_duckdb.py")
] + sys.argv[1:])
