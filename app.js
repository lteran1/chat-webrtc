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
    initContacts();
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

// ── Contactos autorizados por el administrador ────────
let onlineUsersCache = [];
let authorizedContacts = [];

function renderSavedContacts() {
  const list = document.getElementById('savedContactsList');
  if (!list) return;
  list.innerHTML = '';
  if (authorizedContacts.length === 0) {
    list.innerHTML = '<li style="color:#6a7175;font-size:0.9rem;padding:6px 0;">Sin contactos autorizados.<br><small>El administrador debe autorizar contactos.</small></li>';
    return;
  }
  authorizedContacts.forEach(username => {
    // Buscar si está online ahora mismo
    const onlineUser = onlineUsersCache.find(u => u.username === username);
    const isOnline = onlineUser && onlineUser.isOnline;
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f7f7f7;border-radius:8px;gap:6px;margin-bottom:6px;';
    const statusDot = isOnline ? '🟢' : '⚪';
    li.innerHTML = `<span>${statusDot} <strong style="color:#222;">${username}</strong></span>`;
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;';
    if (isOnline) {
      const callC = document.createElement('button');
      callC.textContent = 'Llamar';
      callC.style.cssText = 'background:#25d366;color:#fff;border:none;border-radius:14px;padding:3px 10px;font-weight:bold;cursor:pointer;font-size:0.85rem;';
      callC.onclick = () => {
        targetIdInput.value = onlineUser.socketId;
        log('Llamando a ' + username + '...');
        document.getElementById('callBtn').click();
      };
      actions.appendChild(callC);
    } else {
      const offSpan = document.createElement('span');
      offSpan.textContent = 'Offline';
      offSpan.style.cssText = 'color:#b0bec5;font-size:0.82rem;';
      actions.appendChild(offSpan);
    }
    li.appendChild(actions);
    list.appendChild(li);
  });
}
// Solicitar lista de usuarios al conectar si es admin
function requestUserList() {
  if (isAdmin) {
    socket.emit('admin-list-users');
  }
}

function checkAdmin() {
  adminPanel.style.display = isAdmin ? '' : 'none';
}

// Inicializar lista de contactos al cargar la app
function initContacts() {
  // Solicitar contactos autorizados al servidor
  socket.emit('get-authorized-contacts');
}

// Recibir contactos autorizados del servidor
socket.on('authorized-contacts', (contacts) => {
  authorizedContacts = contacts;
  renderSavedContacts();
});

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

function addMessage(from, text, fileUrl, fileName){
  const el = document.createElement('div');
  const isOwn = from === 'Tú' || from === myId;
  el.className = 'msg ' + (isOwn ? 'out' : 'in');
  let content = `<div class="from">${isOwn ? 'Tú' : from}</div><div class="text">${text || ''}`;
  if (fileUrl && fileName) {
    content += `<br><a href="${fileUrl}" download="${fileName}" target="_blank">📎 ${fileName}</a>`;
  }
  content += '</div>';
  el.innerHTML = content;
  msgList.appendChild(el);
  msgList.scrollTop = msgList.scrollHeight;
}
// Envío de archivos entre contactos autorizados usando WebRTC data channel
const fileInput = document.getElementById('fileInput');
if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!peer || !dataChannelOpen) {
      log('Debes iniciar una llamada para enviar archivos.');
      return;
    }
    // Leer archivo como ArrayBuffer y enviar por data channel
    const reader = new FileReader();
    reader.onload = function(evt) {
      const buffer = evt.target.result;
      // Enviar metadatos primero
      peer.send(JSON.stringify({ fileName: file.name, fileSize: file.size, fileType: file.type, isFile: true }));
      // Enviar archivo en partes si es grande
      const chunkSize = 16 * 1024;
      for (let i = 0; i < buffer.byteLength; i += chunkSize) {
        peer.send(buffer.slice(i, i + chunkSize));
      }
      peer.send('FILE_END');
      log('Archivo enviado: ' + file.name);
    };
    reader.readAsArrayBuffer(file);
  });
}

// Recepción de archivos por data channel
let incomingFile = null;
let incomingFileBuffer = [];
if (typeof window !== 'undefined') {
  window.handleDataChannelMessage = function(data) {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data);
        if (meta.isFile) {
          incomingFile = { name: meta.fileName, size: meta.fileSize, type: meta.fileType };
          incomingFileBuffer = [];
          return;
        }
      } catch {}
      if (data === 'FILE_END' && incomingFile) {
        // Unir partes y crear enlace de descarga
        const blob = new Blob(incomingFileBuffer, { type: incomingFile.type });
        const url = URL.createObjectURL(blob);
        addMessage('Contacto', '', url, incomingFile.name);
        incomingFile = null;
        incomingFileBuffer = [];
        return;
      }
    }
    // Si es parte de archivo
    if (incomingFile) {
      incomingFileBuffer.push(data);
    }
  };
}

// Socket events
socket.on('connect', () => {
  myId = socket.id;
  myIdEl.textContent = `ID: ${myId}`;
  log('Conectado al servidor de señalización');
  checkAdmin();
  requestUserList();
  // Parchear data channel para archivos
  if (peer && peer._channel) {
    peer._channel.onmessage = (e) => {
      const data = e.data;
      if (typeof window.handleDataChannelMessage === 'function') {
        window.handleDataChannelMessage(data);
      }
    };
  }
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
  onlineUsersCache = allUsers;
  renderSavedContacts();

  if (!globalUserList) return;
  globalUserList.innerHTML = '';

  allUsers.forEach(u => {
    if (u.username === currentUser) return;

    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f7f7f7;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.05);color:#333;';

    const statusDot = u.isOnline ? '🟢' : '⚪';
    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = `${statusDot} <strong style="margin-left:5px;">${u.username}</strong>${u.isAdmin ? ' <small style="color:#075e54;font-weight:bold;">(admin)</small>' : ''}`;
    infoSpan.title = u.isOnline ? 'En línea' : 'Desconectado';
    li.appendChild(infoSpan);

    // Si es admin, mostrar controles para autorizar contactos
    if (isAdmin) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;align-items:center;';
      // Autorizar contacto para cualquier usuario (menos admin)
      allUsers.forEach(target => {
        if (!target.isAdmin && target.username !== u.username) {
          const authBtn = document.createElement('button');
          authBtn.textContent = `Autorizar ${target.username}↔${u.username}`;
          authBtn.style.cssText = 'background:#075e54;color:#fff;border:none;border-radius:14px;padding:2px 8px;font-size:0.75rem;cursor:pointer;';
          authBtn.onclick = () => {
            socket.emit('admin-authorize-contact', { user: target.username, contact: u.username });
            log(`Autorizando a ${target.username} para contactar con ${u.username}`);
          };
          actions.appendChild(authBtn);
        }
      });
      li.appendChild(actions);
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
  // Apagar cámara y micrófono al terminar la llamada
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  dataChannelOpen = false;
  hangBtn.disabled = true;
  remoteVideo.srcObject = null;
}

// antes de cerrar la pestaña
window.addEventListener('beforeunload', () => {
  try { socket.close(); } catch(e){}
  if (peer) peer.destroy();
});
