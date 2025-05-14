import fs from 'fs';
import { generateKeyPairsFromString } from '../../homeserver/src/keys';
import { FederationClient } from '../src';

async function main() {
  const serverName = process.env.SERVER_NAME || 'your-server.example.com';
  
  const keyString = process.env.SIGNING_KEY || 
    fs.readFileSync('./signing-key.txt', 'utf-8').trim();
  
  try {
    const signingKey = await generateKeyPairsFromString(keyString);
    
    const federation = new FederationClient({
      serverName,
      signingKey,
      debug: true
    });
    
    const targetServer = process.env.TARGET_SERVER || 'matrix.org';
    console.log(`Querying server: ${targetServer}`);
    
    try {
      console.log('Getting server version...');
      const version = await federation.getVersion(targetServer);
      console.log(`Server version: ${version.server.name} ${version.server.version}`);
    } catch (error) {
      console.error('Error getting server version:', error);
    }
    
    const userId = process.env.USER_ID || '@alice:matrix.org';
    try {
      console.log(`Querying profile for ${userId}...`);
      const profile = await federation.queryProfile(targetServer, userId);
      console.log('Profile data:', profile);
    } catch (error) {
      console.error('Error querying profile:', error);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 