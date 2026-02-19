import { auth } from './firebase.js';
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

export function requireAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      if (user) {
        resolve(user);
      } else {
        window.location.href = 'login.html';
        reject('not authenticated');
      }
    });
  });
}

export async function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  await firebaseSignOut(auth);
  window.location.href = 'login.html';
}

export function getCurrentUser() {
  return auth.currentUser;
}
