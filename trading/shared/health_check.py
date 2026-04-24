#!/usr/bin/env python3
"""Wrapper — redirects to health/health_check.py"""
import sys, os
os.execv(sys.executable, [sys.executable,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "health/health_check.py")
] + sys.argv[1:])
