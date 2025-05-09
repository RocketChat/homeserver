import { Inject, Injectable } from '@nestjs/common';
import { Db, MongoClient, MongoClientOptions } from 'mongodb';
import { ConfigService } from '../services/config.service';

@Injectable()
export class DatabaseConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connectionPromise: Promise<void> | null = null;
  
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.connect();
  }
  
  async getDb(): Promise<Db> {
    if (!this.db) {
      await this.connect();
    }
    return this.db!;
  }
  
  private async connect(): Promise<void> {
    // Return existing connection promise if one is in progress
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    // Return if already connected
    if (this.client && this.db) {
      return;
    }
    
    // Create a new connection promise
    this.connectionPromise = new Promise<void>(async (resolve, reject) => {
      try {
        const dbConfig = this.configService.getDatabaseConfig();
        
        const options: MongoClientOptions = {
          maxPoolSize: dbConfig.poolSize,
        };
        
        this.client = new MongoClient(dbConfig.uri, options);
        await this.client.connect();
        
        this.db = this.client.db(dbConfig.name);
        console.log(`Connected to MongoDB database: ${dbConfig.name}`);
        
        resolve();
      } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        this.connectionPromise = null;
        reject(new Error('Database connection failed'));
      }
    });
    
    return this.connectionPromise;
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connectionPromise = null;
      console.log('Disconnected from MongoDB');
    }
  }
} 
