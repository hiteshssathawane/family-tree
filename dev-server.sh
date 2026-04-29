#!/bin/bash
echo "🌳 Opening The Family Tree at http://localhost:8000"
echo "📱 Press Ctrl+C to stop"
cd "$(dirname "$0")"
python3 -m http.server 8000
