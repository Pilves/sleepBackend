
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

    if (config.app.env == "production" && config.firebase.serviceAccount) {
      serviceAccount = config.firebase.serviceAccount;
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

    firestoreInstance = admin.firestore();




  }


}





