const http = require('node:http');

function createHttpServerService({ router }) {
  let server = null;
  const sockets = new Set();

  function start({ host, port }) {
    if (server) throw new Error('HTTP_SERVER_ALREADY_STARTED');
    server = http.createServer((request, response) => {
      Promise.resolve(router(request, response)).catch(() => {
        if (response.headersSent) {
          response.end();
          return;
        }
        response.writeHead(500, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: '管理端处理请求失败' },
        }));
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    return new Promise((resolve, reject) => {
      const handleError = (error) => {
        server = null;
        reject(error);
      };
      server.once('error', handleError);
      server.listen(port, host, () => {
        server.off('error', handleError);
        const address = server.address();
        resolve(typeof address === 'object' && address
          ? { host: address.address, port: address.port }
          : { host, port });
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    const activeServer = server;
    server = null;
    return new Promise((resolve, reject) => {
      activeServer.close((error) => error ? reject(error) : resolve());
      if (typeof activeServer.closeAllConnections === 'function') {
        activeServer.closeAllConnections();
      } else {
        for (const socket of sockets) socket.destroy();
      }
    });
  }

  return { start, stop };
}

module.exports = { createHttpServerService };
