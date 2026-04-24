#!/usr/bin/env python3
"""Wrapper — redirects to health/daily_summary.py"""
import sys, os
os.execv(sys.executable, [sys.executable,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "health/daily_summary.py")
] + sys.argv[1:])
