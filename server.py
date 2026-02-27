import http.server
import socketserver
import urllib.request
from urllib.error import URLError, HTTPError
import os

import urllib.parse

PORT = 8080

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/proxy/'):
            raw_target_url = self.path[len('/proxy/'):]
            target_url = urllib.parse.unquote(raw_target_url)
            
            if not target_url.startswith('http'):
                self.send_error(400, "Invalid target URL")
                return
            
            print(f"Proxying: {target_url}")
            req = urllib.request.Request(
                target_url, 
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            )
            try:
                with urllib.request.urlopen(req) as response:
                    body = response.read()
                    self.send_response(response.status)
                    for header, value in response.getheaders():
                        # Don't forward chunked encoding or CORS headers from origin
                        if header.lower() not in ['transfer-encoding', 'connection', 'access-control-allow-origin']:
                            self.send_header(header, value)
                    self.end_headers()
                    self.wfile.write(body)
            except HTTPError as e:
                self.send_error(e.code, str(e))
            except URLError as e:
                self.send_error(500, str(e.reason))
        else:
            # Serve static files normally
            if self.path == '/':
                self.path = '/index.html'
            super().do_GET()

with socketserver.TCPServer(("", PORT), ProxyHTTPRequestHandler) as httpd:
    print(f"Serving at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
