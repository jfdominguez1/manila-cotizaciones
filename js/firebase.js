// ⚠️  Reemplazar con la config del proyecto "cotizaciones-manila" en Firebase Console
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "PLACEHOLDER",
  authDomain: "cotizaciones-manila.firebaseapp.com",
  projectId: "cotizaciones-manila",
  storageBucket: "cotizaciones-manila.appspot.com",
  messagingSenderId: "PLACEHOLDER",
  appId: "PLACEHOLDER"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
