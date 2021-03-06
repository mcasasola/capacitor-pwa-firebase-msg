import { promisify } from 'util';
import { writeFile, existsSync } from 'fs';
import { join, parse, resolve, dirname } from 'path';
import { copy } from 'fs-extra';

// @ts-ignore
import config from '../../../../capacitor.config.json';

const chalk = require('chalk');

interface CliConfigFirebase {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}
const FIREBASECONFIGKEYS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'vapidKey'];

const writeFileAsync = promisify(writeFile);

const SERVICEWORKER_FILENAME = 'capacitor-pwa-firebase-msg-sw.js';
const FIREBASE_CONFIG_FILENAME = 'firebase.config.json';
const FIREBASE_APP_FILENAME = 'firebase-app.js';
const FIREBASE_MESSAGING_FILENAME = 'firebase-messaging.js';
const SERVICEWORKER_TEMPLATE = `
(function() {
  importScripts('./${FIREBASE_APP_FILENAME}');
  importScripts('./${FIREBASE_MESSAGING_FILENAME}');

  firebase.initializeApp({
    messagingSenderId: '[SENDER_ID]'
  });

  const messaging = firebase.messaging();

  self.addEventListener('push', (event) => {
    event.stopImmediatePropagation();
  });
  
  self.addEventListener('pushsubscriptionchange', e => {
    event.stopImmediatePropagation();
  });

  messaging.setBackgroundMessageHandler(msgPayload => {
    return messaging.sendMessageToWindowClients_(msgPayload);
  });
})();
`;

function logError(...args: any[]) {
  console.error(chalk.red('[error]'), ...args);
}

function logFatal(...args: any[]): never {
  logError(...args);
  logError(`When the errors are fixed, reinstall this package: npm i capacitor-pwa-firebase-msg`);
  return process.exit(1);
}

function resolveNode(...pathSegments: any[]): string | null {
  const id = pathSegments[0];
  const path = pathSegments.slice(1);

  let modulePath;
  const starts = [process.cwd()];
  for (let start of starts) {
    modulePath = resolveNodeFrom(start, id);
    if (modulePath) {
      break;
    }
  }
  if (!modulePath) {
    return null;
  }

  return join(modulePath, ...path);
}

function resolveNodeFrom(start: string, id: string): string | null {
  const rootPath = parse(start).root;
  let basePath = resolve(start);
  let modulePath;
  while (true) {
    modulePath = join(basePath, 'node_modules', id);
    if (existsSync(modulePath)) {
      return modulePath;
    }
    if (basePath === rootPath) {
      return null;
    }
    basePath = dirname(basePath);
  }
}

async function generateServiceWorker(capacitorConfig: any, firebaseConfig: CliConfigFirebase) {
  const missingFirebaseValues = FIREBASECONFIGKEYS.filter(k => !(firebaseConfig as any)[k]);

  if (missingFirebaseValues.length > 0 && missingFirebaseValues.length < FIREBASECONFIGKEYS.length) {
    logFatal(`Firebase configuration missing: ${missingFirebaseValues.join(', ')}. `,
      'Check your capacitor.config.json');
  }
  else {
    const serviceWorker = SERVICEWORKER_TEMPLATE.replace('[SENDER_ID]', firebaseConfig.messagingSenderId);
    const firebasePath = resolveNode('firebase', FIREBASE_APP_FILENAME);
    const firebaseMessagingPath = resolveNode('firebase', FIREBASE_MESSAGING_FILENAME);

    if (!firebasePath || !firebaseMessagingPath) {
      logFatal(`Unable to find required files in node_modules/firebase. Are you sure the firebase dependency is installed?`);
    }
    else {
      const webDirAbs = resolve(process.cwd(), '..', '..', capacitorConfig.webDir);

      await writeFileAsync(join(webDirAbs, SERVICEWORKER_FILENAME), serviceWorker);
      await writeFileAsync(join(webDirAbs, FIREBASE_CONFIG_FILENAME), JSON.stringify(firebaseConfig, null, 2));
      await copy(firebasePath, join(webDirAbs, FIREBASE_APP_FILENAME));
      await copy(firebaseMessagingPath, join(webDirAbs, FIREBASE_MESSAGING_FILENAME));
    }
  }
}

if (!config || !config.plugins || !config.plugins.PWAFirebaseMsg) {
  logFatal('Firebase configuration missing under plugins.PWAFirebaseMsg inside of capacitor.config.json', JSON.stringify(config, null, 2));
}

generateServiceWorker(config, config.plugins.PWAFirebaseMsg).then(
  () => {
    console.log(
      chalk.green('[success]'), 
      `${SERVICEWORKER_FILENAME}, ${FIREBASE_CONFIG_FILENAME}, ${FIREBASE_APP_FILENAME} and ${FIREBASE_MESSAGING_FILENAME} saved to ${resolve(process.cwd(), '..', '..', config.webDir)}`
    );
  },
  (e) => {
    logFatal('Unable to write files to Capacitor web app directory', e);
  }
);