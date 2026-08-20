const admin = require('firebase-admin');

// serviceAccountKey.json ফাইলটা Firebase Console > Project Settings >
// Service Accounts > Generate New Private Key থেকে ডাউনলোড করে
// backend রুটে রাখুন (এবং .gitignore এ যোগ করুন — এটা secret)
let initialized = false;

function initFirebase() {
  if (initialized) return;

  try {
    const serviceAccount = require('../../serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
  } catch (err) {
    console.warn('Firebase not initialized — serviceAccountKey.json পাওয়া যায়নি। Push notification কাজ করবে না।');
  }
}

module.exports = { admin, initFirebase };
