import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import firebaseConfig from './firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const typedFirebaseConfig = firebaseConfig as typeof firebaseConfig & { firestoreDatabaseId?: string };
const db = getFirestore(
  app,
  typedFirebaseConfig.firestoreDatabaseId &&
    typedFirebaseConfig.firestoreDatabaseId.trim() &&
    typedFirebaseConfig.firestoreDatabaseId !== '(default)'
    ? typedFirebaseConfig.firestoreDatabaseId
    : undefined
);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const microsoftProvider = new OAuthProvider('microsoft.com');

export { app, db, auth, googleProvider, microsoftProvider };
export * from 'firebase/firestore';
export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  linkWithCredential
} from 'firebase/auth';
export type { User as FirebaseUser, Unsubscribe, ConfirmationResult } from 'firebase/auth';


