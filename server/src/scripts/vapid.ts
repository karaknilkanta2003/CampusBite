import webpush from 'web-push';

// Prints a VAPID key pair for push notifications. Paste both into .env.
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
