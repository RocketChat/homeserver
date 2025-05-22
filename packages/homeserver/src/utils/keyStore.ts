import { Collection, MongoClient } from 'mongodb';

let client: MongoClient | null = null;
let serversCollection: Collection | null = null;

async function ensureConnection() {
  if (!client) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db('matrix');
    serversCollection = db.collection('servers');
  }
  
  return { client, serversCollection };
}

/**
 * Get a public key from the local database
 * 
 * @param origin The server origin
 * @param key The key ID
 * @returns The public key if found, undefined otherwise
 */
export async function getValidPublicKeyFromLocal(
  origin: string,
  key: string,
): Promise<string | undefined> {
  const { serversCollection } = await ensureConnection();
  
  const server = await serversCollection?.findOne({
    name: origin,
  });
  
  if (!server) {
    return undefined;
  }
  
  const keys = server.keys || {};
  const keyData = keys[key];
  
  if (!keyData || keyData.validUntil < Date.now()) {
    return undefined;
  }
  
  return keyData.key;
}

/**
 * Store a public key in the local database
 * 
 * @param origin The server origin
 * @param key The key ID
 * @param value The public key value
 * @param validUntil Timestamp when the key expires
 */
export async function storePublicKey(
  origin: string,
  key: string,
  value: string,
  validUntil: number,
): Promise<void> {
  const { serversCollection } = await ensureConnection();
  
  await serversCollection?.findOneAndUpdate(
    { name: origin },
    {
      $set: {
        [`keys.${key}`]: {
          key: value,
          validUntil,
        },
      },
    },
    { upsert: true },
  );
} 