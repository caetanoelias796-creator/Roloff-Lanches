// Configurações do aplicativo web do Firebase para a Roloff Lanches
const firebaseConfig = {
    apiKey: "AIzaSyD8qpX7stwwP7cBqMQJrE3MBmrHxQ8U5xc",
    authDomain: "roloff-lanches.firebaseapp.com",
    databaseURL: "https://roloff-lanches-default-rtdb.firebaseio.com",
    projectId: "roloff-lanches",
    storageBucket: "roloff-lanches.firebasestorage.app",
    messagingSenderId: "24827239942",
    appId: "1:24827239942:web:e18bce407052c76c7ced87"
};

// Inicialização segura e centralizada do Firebase
if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}

