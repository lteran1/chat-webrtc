// app.js - cliente simple para mensajería y llamadas (usa simple-peer y socket.io-client CDN)
// Cambia la URL si tu servidor está en otra dirección

const SERVER_URL = window.location.origin;
let currentUser = null;
let isAdmin = false;

// Inicializar socket con autoConnect en false para evitar errores al asociar eventos al inicio
const socket = io(SERVER_URL, {
  transports: ['websocket'],
  autoConnect: false
});

// Login modal
const loginModal = document.getElementById('loginModal');
const loginForm = document.getElementById('loginForm');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const loginMsg = document.getElementById('loginMsg');
const mainApp = document.getElementById('mainApp');

function showLogin(msg = '') {
  loginModal.style.display = 'flex';
  mainApp.style.display = 'none';
  loginMsg.textContent = msg;
}
function showApp() {
  loginModal.style.display = 'none';
  mainApp.style.display = '';
}

loginForm.addEventListener('submit', function(e) {
  e.preventDefault();
  const username = loginUser.value.trim();
  const password = loginPass.value.trim();
  if (!username || !password) {
    loginMsg.textContent = 'Completa todos los campos.';
    return;
  }
  // Establecer credenciales y conectar
  socket.auth = { username, password };
  socket.connect();

  // Esperar validación
  socket.once('login-result', ({ ok, isAdmin: admin, msg }) => {
    if (!ok) {
      socket.disconnect();
      showLogin(msg || 'Credenciales incorrectas.');
      loginForm.reset();
      return;
    }
    currentUser = username;
    isAdmin = !!admin;
    showApp();
    checkAdmin();
    requestUserList();
    loginForm.reset();
  });
});

// Mostrar login al cargar
showLogin();

const myIdEl = document.getElementById('myId');
const callBtn = document.getElementById('callBtn');
const hangBtn = document.getElementById('hangBtn');
const targetIdInput = document.getElementById('targetId');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const msgList = document.getElementById('msgList');
const msgInput = document.getElementById('msgInput');
const sendMsgBtn = document.getElementById('sendMsg');

const logArea = document.getElementById('logArea');

// Panel de administración
const adminPanel = document.getElementById('adminPanel');
const createUserForm = document.getElementById('createUserForm');

const userList = document.getElementById('userList');
const globalUserList = document.getElementById('globalUserList');
// Solicitar lista de usuarios al conectar si es admin
function requestUserList() {
  if (isAdmin) {
    socket.emit('admin-list-users');
  }
}

function checkAdmin() {
  adminPanel.style.display = isAdmin ? '' : 'none';
}

// Llama a checkAdmin cuando se conecte el socket

let localStream = null;
let peer = null;
let myId = null;
let dataChannelOpen = false;

// util
function log(text){
  const p = document.createElement('div');
  p.textContent = text;
  logArea.appendChild(p);
  logArea.scrollTop = logArea.scrollHeight;
}

function addMessage(from, text){
  const el = document.createElement('div');
  // Si el mensaje es propio, usa clase 'out', si es remoto, 'in'
  const isOwn = from === 'Tú' || from === myId;
  el.className = 'msg ' + (isOwn ? 'out' : 'in');
  el.innerHTML = `<div class="from">${isOwn ? 'Tú' : from}</div><div class="text">${text}</div>`;
  msgList.appendChild(el);
  msgList.scrollTop = msgList.scrollHeight;
}

// Socket events
socket.on('connect', () => {
  myId = socket.id;
  myIdEl.textContent = `ID: ${myId}`;
  log('Conectado al servidor de señalización');
  checkAdmin();
  requestUserList();
});
// Recibe y muestra la lista de usuarios
socket.on('admin-user-list', (users) => {
  if (!userList) return;
  userList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.justifyContent = 'space-between';
    li.style.padding = '4px 0';
    li.innerHTML = `<span>${u.username}${u.isAdmin ? ' <b>(admin)</b>' : ''}</span>`;
    if (!u.isAdmin) {
      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.style.background = '#e53935';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '12px';
      btn.style.padding = '2px 10px';
      btn.style.marginLeft = '12px';
      btn.style.cursor = 'pointer';
      btn.onclick = () => {
        if (confirm('¿Eliminar usuario ' + u.username + '?')) {
          socket.emit('admin-delete-user', u.username);
        }
      };
      li.appendChild(btn);
    }
    userList.appendChild(li);
  });
});

// Recibe y muestra la lista global de usuarios y sus estados (para todos)
socket.on('user-list-update', (allUsers) => {
  if (!globalUserList) return;
  globalUserList.innerHTML = '';

  allUsers.forEach(u => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.justifyContent = 'space-between';
    li.style.padding = '8px 12px';
    li.style.background = '#f7f7f7';
    li.style.borderRadius = '8px';
    li.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
    li.style.color = '#333';

    // Indicador de estado (online/offline)
    const statusDot = u.isOnline ? '🟢' : '⚪';
    const statusText = u.isOnline ? 'En línea' : 'Desconectado';
    
    // Nombre de usuario e info
    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = `${statusDot} <strong style="margin-left: 6px;">${u.username}</strong> ${u.isAdmin ? ' <small style="color:#075e54; font-weight:bold;">(admin)</small>' : ''}`;
    infoSpan.title = statusText;
    li.appendChild(infoSpan);

    // Botón de acción (Llamar) si está conectado y no es el propio usuario
    if (u.isOnline && u.username !== currentUser) {
      const callBtn = document.createElement('button');
      callBtn.textContent = 'Llamar';
      callBtn.style.background = '#25d366';
      callBtn.style.color = '#fff';
      callBtn.style.border = 'none';
      callBtn.style.borderRadius = '16px';
      callBtn.style.padding = '4px 12px';
      callBtn.style.cursor = 'pointer';
      callBtn.style.fontWeight = 'bold';
      
      callBtn.onclick = () => {
        targetIdInput.value = u.socketId;
        log(`Iniciando llamada directa a ${u.username}...`);
        document.getElementById('callBtn').click();
      };
      li.appendChild(callBtn);
    } else if (u.username === currentUser) {
      const selfSpan = document.createElement('span');
      selfSpan.textContent = 'Tú';
      selfSpan.style.color = '#6a7175';
      selfSpan.style.fontSize = '0.85rem';
      selfSpan.style.fontWeight = 'bold';
      li.appendChild(selfSpan);
    } else {
      const offlineSpan = document.createElement('span');
      offlineSpan.textContent = 'Offline';
      offlineSpan.style.color = '#b0bec5';
      offlineSpan.style.fontSize = '0.85rem';
      li.appendChild(offlineSpan);
    }

    globalUserList.appendChild(li);
  });
});

// Recibe confirmación de borrado y actualiza lista
socket.on('admin-delete-user-result', ({ ok, msg }) => {
  adminMsg.textContent = msg || (ok ? 'Usuario eliminado.' : 'Error al eliminar usuario.');
  requestUserList();
});

// Actualiza lista tras crear usuario
socket.on('admin-create-user-result', ({ ok, msg }) => {
  adminMsg.textContent = msg || (ok ? 'Usuario creado correctamente.' : 'Error al crear usuario.');
  if (ok) requestUserList();
});
// Manejo del formulario de creación de usuarios (solo admin)
if (createUserForm) {
  createUserForm.addEventListener('submit', function(e) {
    e.preventDefault();
    if (!isAdmin) {
      adminMsg.textContent = 'No tienes permisos para crear usuarios.';
      return;
    }
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    if (!username || !password) {
      adminMsg.textContent = 'Completa todos los campos.';
      return;
    }
    // Aquí deberías enviar la petición al servidor para crear el usuario
    // Por ahora, solo simula
    socket.emit('admin-create-user', { username, password });
    adminMsg.textContent = 'Enviando solicitud...';
  });
}

socket.on('signal', async ({ from, data }) => {
  log(`Señal recibida de ${from}`);
  if (!peer) {
    try {
      await ensureLocalStream();
    } catch (err) {
      log('Respondiendo llamada en modo solo texto (sin cámara/micrófono)');
    }
    createPeer(false, from);
  }
  peer.signal(data);
});

socket.on('disconnect', () => {
  log('Desconectado del servidor');
});

// get media
async function ensureLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    return localStream;
  } catch (err) {
    log('Error accediendo a cámara/mic: ' + err.message);
    throw err;
  }
}

// create peer
function createPeer(initiator, remoteId){
  hangBtn.disabled = false; // Habilitar botón de colgar inmediatamente
  peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream || undefined,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ]
    }
  });

  peer.on('signal', data => {
    // enviar señal al peer objetivo
    const to = remoteId || targetIdInput.value;
    if (!to) {
      log('No hay ID objetivo para enviar señal');
      return;
    }
    socket.emit('signal', { to, data });
    log('Señal enviada a ' + to);
  });

  peer.on('stream', stream => {
    remoteVideo.srcObject = stream;
    log('Stream remoto recibido');
  });

  peer.on('connect', () => {
    dataChannelOpen = true;
    log('Canal de datos abierto');
    hangBtn.disabled = false;
  });

  peer.on('data', data => {
    const text = new TextDecoder().decode(data);
    addMessage('Contacto', text);
  });

  peer.on('close', () => {
    log('Peer cerrado');
    cleanupPeer();
  });

  peer.on('error', err => {
    log('Peer error: ' + err);
    cleanupPeer();
  });

  return peer;
}

// UI actions
callBtn.addEventListener('click', async () => {
  const target = targetIdInput.value.trim();
  if (!target) { log('Introduce un ID para llamar'); return; }
  try {
    await ensureLocalStream();
  } catch (err) {
    log('Iniciando llamada en modo solo texto (sin cámara/micrófono)');
  }
  createPeer(true, target);
});

hangBtn.addEventListener('click', () => {
  if (peer) peer.destroy();
  cleanupPeer();
  log('Llamada finalizada');
});

sendMsgBtn.addEventListener('click', () => {
  const text = msgInput.value.trim();
  if (!text) return;
  if (peer && dataChannelOpen) {
    peer.send(text);
    addMessage('Tú', text);
    msgInput.value = '';
  } else {
    log('No hay canal de datos abierto. Mensaje no enviado.');
  }
});

// cleanup
function cleanupPeer(){
  if (peer) {
    try { peer.destroy(); } catch(e){}
    peer = null;
  }
  dataChannelOpen = false;
  hangBtn.disabled = true;
  remoteVideo.srcObject = null;
}

// antes de cerrar la pestaña
window.addEventListener('beforeunload', () => {
  try { socket.close(); } catch(e){}
  if (peer) peer.destroy();
});
