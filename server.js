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

// Contactos autorizados por usuario (persistencia simple en archivo)
const fs = require('fs');
const CONTACTS_FILE = './contacts.json';
let authorizedContacts = {};
function loadContacts() {
  try {
    const data = fs.readFileSync(CONTACTS_FILE, 'utf8');
    authorizedContacts = JSON.parse(data).authorizedContacts || {};
  } catch {
    authorizedContacts = {};
  }
}
function saveContacts() {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ authorizedContacts }, null, 2));
}
loadContacts();


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
  socket.username = username; // Guardar el username en el socket
  socket.emit('login-result', { ok: true, isAdmin: !!user.isAdmin });

  // Notificar lista de usuarios al conectar
  broadcastUserList();

  // Señalización WebRTC

  // Validar autorización antes de señalizar
  socket.on('signal', ({ to, data }) => {
    // Buscar usuario destino por socketId
    const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === to);
    if (!targetSocket) return;
    const fromUser = socket.username;
    const toUser = targetSocket.username;
    // Solo permitir si ambos son contactos autorizados
    if (
      authorizedContacts[fromUser] && authorizedContacts[fromUser].includes(toUser) &&
      authorizedContacts[toUser] && authorizedContacts[toUser].includes(fromUser)
    ) {
      io.to(to).emit('signal', { from: socket.id, data });
    }
  });

  // Permitir al admin autorizar contactos
  socket.on('admin-authorize-contact', ({ user, contact }) => {
    if (!isAdmin(socket)) return;
    if (!users.find(u => u.username === user) || !users.find(u => u.username === contact)) return;
    if (!authorizedContacts[user]) authorizedContacts[user] = [];
    if (!authorizedContacts[user].includes(contact)) {
      authorizedContacts[user].push(contact);
      saveContacts();
    }
    socket.emit('admin-authorize-contact-result', { ok: true, msg: `Contacto autorizado para ${user}` });
  });

  // Permitir al admin quitar autorización
  socket.on('admin-remove-contact', ({ user, contact }) => {
    if (!isAdmin(socket)) return;
    if (authorizedContacts[user]) {
      authorizedContacts[user] = authorizedContacts[user].filter(c => c !== contact);
      saveContacts();
    }
    socket.emit('admin-remove-contact-result', { ok: true, msg: `Contacto removido de ${user}` });
  });

  // Permitir a los usuarios obtener su lista de contactos autorizados
  socket.on('get-authorized-contacts', () => {
    const user = socket.username;
    socket.emit('authorized-contacts', authorizedContacts[user] || []);
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
    broadcastUserList();
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
    broadcastUserList();
  });


  // Manejo de desconexión
  socket.on('disconnect', () => {
    broadcastUserList();
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

  // Enviar lista global de usuarios (online y offline) a todos los conectados
  function broadcastUserList() {
    const onlineUsernames = new Set();
    io.sockets.sockets.forEach(s => {
      if (s.username) onlineUsernames.add(s.username);
    });

    const allUsers = users.map(u => {
      const isOnline = onlineUsernames.has(u.username);
      let socketId = null;
      if (isOnline) {
        const foundSocket = Array.from(io.sockets.sockets.values()).find(s => s.username === u.username);
        if (foundSocket) socketId = foundSocket.id;
      }
      return {
        username: u.username,
        isAdmin: !!u.isAdmin,
        isOnline: isOnline,
        socketId: socketId
      };
    });

    io.emit('user-list-update', allUsers);
  }
});

// Servir archivos estáticos si se sube a GitHub Pages o similar
app.use(express.static('.'));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
});
