/**
 * @file HTTPS proxy server management
 */
import * as https from 'https';
import * as http from 'http';
import { loadCertificates } from '../certificates';

let httpsProxyServer: https.Server | null = null;

/**
 * Create and start HTTPS proxy server.
 * @param httpsPort The HTTPS port to listen on
 * @param httpPort The HTTP port to forward to
 * @param hostname The hostname to listen on
 * @returns Promise&lt;boolean> - True if started successfully, false if failed
 */
export async function createHttpsProxy(
  httpsPort: number,
  httpPort: number,
  hostname: string = 'localhost'
): Promise<boolean> {
  try {
    console.log(`Creating HTTPS proxy for ${hostname} on port ${httpsPort} -> ${httpPort}`);
    const { cert, key } = await loadCertificates([hostname]);

    httpsProxyServer = https.createServer({ cert, key }, (req, res) => {
      console.log(`HTTPS proxy request: ${req.method} ${req.url} from ${req.headers.host}`);

      const proxyReq = http.request(
        {
          hostname: 'localhost',
          port: httpPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          console.log(`Proxy response: ${proxyRes.statusCode} for ${req.url}`);
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );

      proxyReq.on('error', (err) => {
        console.error(`HTTPS proxy request error for ${hostname}:${httpsPort} -> localhost:${httpPort}:`, err);
        console.error('Error details:', {
          code: (err as Error & { code?: string }).code,
          message: err.message,
          hostname: 'localhost',
          port: httpPort,
          path: req.url,
        });
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Proxy error: Unable to connect to localhost:${httpPort}\nError: ${err.message}`);
      });

      req.pipe(proxyReq);
    });

    // Listen on all interfaces (0.0.0.0) to accept connections to any hostname
    return new Promise((resolve) => {
      httpsProxyServer!.listen(httpsPort, '0.0.0.0', () => {
        console.log(`✅ HTTPS proxy server running at https://${hostname}:${httpsPort}/`);
        console.log(`   Forwarding to HTTP server at http://localhost:${httpPort}/`);
        resolve(true);
      });

      httpsProxyServer!.on('error', (err) => {
        console.error('❌ HTTPS proxy server error:', err);
        resolve(false);
      });
    });
  } catch (error) {
    console.error('❌ Failed to start HTTPS proxy:', error);
    console.log('Continuing with HTTP-only mode');
    return false; // HTTPS proxy failed, use HTTP only
  }
}

/**
 * Stop the HTTPS proxy server.
 */
export function stopHttpsProxy(): void {
  if (httpsProxyServer) {
    console.log('Stopping HTTPS proxy server');
    httpsProxyServer.close();
    httpsProxyServer = null;
  }
}

/**
 * Restart HTTPS proxy for new hostname.
 */
export async function restartHttpsProxy(httpsPort: number, httpPort: number, hostname: string): Promise<boolean> {
  console.log(`Restarting HTTPS proxy server for new website…`);
  stopHttpsProxy();
  return createHttpsProxy(httpsPort, httpPort, hostname);
}
