// server.js - Servidor básico compatible con GitHub
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Usuarios en memoria (para demo, usa una base de datos real en producción)
const users = [
  { username: 'admin', password: 'admin', isAdmin: true }
];


// Autenticación de usuario
function getUser(socket) {
  const { username, password } = socket.handshake.auth || {};
  if (!username || !password) return null;
  const user = users.find(u => u.username === username && u.password === password);
  return user || null;
}

function isAdmin(socket) {
  const user = getUser(socket);
  return user && user.isAdmin;
}

io.on('connection', (socket) => {
  // Validar login al conectar
  const { username, password } = socket.handshake.auth || {};
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    socket.emit('login-result', { ok: false, msg: 'Credenciales incorrectas.' });
    socket.disconnect();
    return;
  }
  socket.emit('login-result', { ok: true, isAdmin: !!user.isAdmin });

  // Señalización WebRTC
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Crear usuario (solo admin)
  socket.on('admin-create-user', ({ username, password }) => {
    if (!isAdmin(socket)) {
      socket.emit('admin-create-user-result', { ok: false, msg: 'No autorizado.' });
      return;
    }
    if (!username || !password) {
      socket.emit('admin-create-user-result', { ok: false, msg: 'Datos incompletos.' });
      return;
    }
    if (users.find(u => u.username === username)) {
      socket.emit('admin-create-user-result', { ok: false, msg: 'El usuario ya existe.' });
      return;
    }
    users.push({ username, password, isAdmin: false });
    socket.emit('admin-create-user-result', { ok: true, msg: 'Usuario creado correctamente.' });
    sendUserList();
  });

  // Listar usuarios (solo admin)
  socket.on('admin-list-users', () => {
    if (!isAdmin(socket)) return;
    sendUserList();
  });

  // Eliminar usuario (solo admin, no puede eliminar admin)
  socket.on('admin-delete-user', (username) => {
    if (!isAdmin(socket)) {
      socket.emit('admin-delete-user-result', { ok: false, msg: 'No autorizado.' });
      return;
    }
    if (username === 'admin') {
      socket.emit('admin-delete-user-result', { ok: false, msg: 'No puedes eliminar el usuario admin.' });
      return;
    }
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) {
      socket.emit('admin-delete-user-result', { ok: false, msg: 'Usuario no encontrado.' });
      return;
    }
    users.splice(idx, 1);
    socket.emit('admin-delete-user-result', { ok: true, msg: 'Usuario eliminado.' });
    sendUserList();
  });

  // Enviar lista de usuarios a todos los admins conectados
  function sendUserList() {
    const safeUsers = users.map(u => ({ username: u.username, isAdmin: !!u.isAdmin }));
    io.sockets.sockets.forEach(s => {
      if (isAdmin(s)) {
        s.emit('admin-user-list', safeUsers);
      }
    });
  }
});

// Servir archivos estáticos si se sube a GitHub Pages o similar
app.use(express.static('.'));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
});
