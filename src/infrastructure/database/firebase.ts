
import * as admin from "firebase-admin";
import { config } from "../../config/index";
import { logger } from "../../shared/utils/logger";

// track initialization
let firebaseInitialized = false;
let firestoreInstance: admin.firestore.Firestore;

// initialize firebase SDK
export function initializeFirebase(): admin.firestore.Firestore {
  if (firebaseInitialized && firestoreInstance) {
    return firestoreInstance;
  }

}





