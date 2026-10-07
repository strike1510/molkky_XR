// Serveur statique minimal (aucune dépendance) : node server.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const port = Number(process.argv[2]) || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const fichier = path.join(__dirname, url === '/' ? 'index.html' : url);
  if (!fichier.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(fichier, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(fichier)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`Mölkky VR : http://localhost:${port}`));
