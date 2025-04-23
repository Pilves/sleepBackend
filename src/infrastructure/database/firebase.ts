
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

  try {
    // set credentials path
    let serviceAccount;

    if (config.nodeEnv == "production" && config.firebaseServiceAccount) {
      serviceAccount = config.firebaseServiceAccount;
      logger.info("Firebase service acocunt from ENV")
    } else {

      //local for dev
      try {
        serviceAccount = require("../../serviceAccountKey.json");
        logger.info("Firebase service account from file");
      } catch (error) {
        logger.error("Failed to load serviceAccountKey.json", { error: (error as Error).message });
        throw new Error("Firebase service account credentials not found. Please add service key");
      }
    }

    // initialize firebase admin
    admin.initializeApp({
      credentials: admin.credential.cert(serviceAccount),
    });

    // initialize with optimized settings
    firestoreInstance = admin.firestore();

    if (config.nodeEnv == "production") {

      // prod optimizations
      firestoreInstance.settings({
        ignoreUndefinedProperties: true;
        cacheSizeBytes: 1073741824 // 1GB
      });
    }

    firebaseInitialized = true;
    logger.info("Firebase admin initialized");

    return firestoreInstance;
  } catch (error) {
    logger.error("Failed to start firebase", { error: (error as Error).message });
    throw error;
  }
}

// return firestoreInstance
export function getFirestore(): admin.firestore.Firestore {
  if (!firebaseInitialized) {
    return initializeFirebase();
  }
  return firestoreInstance;
}

// return firestore auth instance
export function getAuth(): admin.auth.Auth {
  if (!firebaseInitialized) {
    initializeFirebase();
  }
  return admin.auth();
}

// close firebase connection (dev/tests)
export async function closeFirebase(): Promise<void> {
  if (firebaseInitialized) {
    try {
      await admin.app().delete();
      firebaseInitialized = false;
      logger.info("firebase conneciton closed");
    } catch (error) {
      logger.error("Error closing firebase", { error: (error as Error).message});
    }
  }
} 

