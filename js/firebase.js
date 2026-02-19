// ⚠️  Reemplazar con la config del proyecto "cotizaciones-manila" en Firebase Console
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyAbpbH5h94_Wkq0ADR9YvrrHOhtTCoZO3A",
  authDomain: "cotizaciones-manila.firebaseapp.com",
  projectId: "cotizaciones-manila",
  storageBucket: "cotizaciones-manila.firebasestorage.app",
  messagingSenderId: "27640433214",
  appId: "1:27640433214:web:4f336ad93d9173858d5f6f"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
