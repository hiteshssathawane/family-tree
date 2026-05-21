#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PORT=8000
PROJECT_NAME="The Family Tree"

echo -e "${BLUE}🌳 Starting ${PROJECT_NAME} Development Server${NC}"
echo "================================"

# Change to script directory
cd "$(dirname "$0")"

# Function to kill existing processes on the port
kill_existing_processes() {
    echo -e "${YELLOW}🔍 Checking for existing processes on port ${PORT}...${NC}"

    # Find processes using the port (cross-platform approach)
    if command -v lsof >/dev/null 2>&1; then
        # macOS/Linux with lsof
        EXISTING_PID=$(lsof -ti tcp:${PORT} 2>/dev/null)
    elif command -v netstat >/dev/null 2>&1; then
        # Fallback to netstat
        EXISTING_PID=$(netstat -tlnp 2>/dev/null | grep ":${PORT} " | awk '{print $7}' | cut -d'/' -f1)
    fi

    if [ ! -z "$EXISTING_PID" ]; then
        echo -e "${RED}💀 Killing existing process(es): ${EXISTING_PID}${NC}"
        kill -9 $EXISTING_PID 2>/dev/null
        sleep 1
        echo -e "${GREEN}✅ Previous server stopped${NC}"
    else
        echo -e "${GREEN}✅ No existing processes found${NC}"
    fi
}

# Function to clear browser cache instructions
show_cache_instructions() {
    echo ""
    echo -e "${YELLOW}🧹 To clear browser cache:${NC}"
    echo "  • Chrome/Edge: Ctrl+Shift+R (Cmd+Shift+R on Mac)"
    echo "  • Firefox: Ctrl+F5 (Cmd+Shift+R on Mac)"
    echo "  • Safari: Cmd+Option+R"
    echo "  • Or open Developer Tools → Network → Disable cache"
    echo ""
}

# Function to start server with cache-busting headers
start_server() {
    echo -e "${BLUE}🚀 Starting development server...${NC}"
    echo -e "${GREEN}📱 Server will be available at: http://localhost:${PORT}${NC}"
    echo -e "${YELLOW}📱 Press Ctrl+C to stop the server${NC}"
    echo ""

    # Start Python server with cache-busting (if Python 3.8+ available)
    if python3 -c "import sys; exit(0 if sys.version_info >= (3, 8) else 1)" 2>/dev/null; then
        # Use custom HTTP server with no-cache headers for development
        python3 -c "
import http.server
import socketserver
from urllib.parse import urlparse
import os

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_cache_headers()
        super().end_headers()

    def send_cache_headers(self):
        # Disable caching for development
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')

    def log_message(self, format, *args):
        # Custom log format with colors
        print(f'\033[0;36m[{self.address_string()}]\033[0m {format % args}')

PORT = ${PORT}
Handler = NoCacheHTTPRequestHandler

try:
    with socketserver.TCPServer(('', PORT), Handler) as httpd:
        print(f'\033[0;32m✅ Server running at http://localhost:{PORT}/\033[0m')
        print(f'\033[0;33m📁 Serving: {os.getcwd()}\033[0m')
        print(f'\033[0;36m🔄 Auto-refresh: Cache disabled for development\033[0m')
        print('')
        httpd.serve_forever()
except KeyboardInterrupt:
    print(f'\n\033[0;31m🛑 Server stopped by user\033[0m')
except OSError as e:
    print(f'\n\033[0;31m❌ Error: Port {PORT} may already be in use\033[0m')
    print(f'\033[0;31m   {e}\033[0m')
"
    else
        # Fallback to standard Python server
        echo -e "${YELLOW}⚠️  Using standard HTTP server (cache headers not available)${NC}"
        python3 -m http.server ${PORT}
    fi
}

# Function to open browser (optional)
open_browser() {
    sleep 2  # Wait for server to start
    URL="http://localhost:${PORT}"

    echo -e "${BLUE}🌐 Opening browser...${NC}"

    # Cross-platform browser opening
    if command -v open >/dev/null 2>&1; then
        # macOS
        open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then
        # Linux
        xdg-open "$URL"
    elif command -v start >/dev/null 2>&1; then
        # Windows
        start "$URL"
    else
        echo -e "${YELLOW}📱 Manually open: ${URL}${NC}"
    fi
}

# Function to handle cleanup on exit
cleanup() {
    echo ""
    echo -e "${RED}🛑 Shutting down development server...${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
main() {
    kill_existing_processes
    show_cache_instructions

    # Ask if user wants to auto-open browser
    echo -e "${BLUE}🌐 Auto-open browser? (y/n, default: y):${NC}"
    read -t 5 -n 1 auto_open
    echo ""

    if [[ ! "$auto_open" =~ ^[Nn]$ ]]; then
        # Open browser in background
        open_browser &
    fi

    # Start the server (this blocks until Ctrl+C)
    start_server
}

# Run main function
main
