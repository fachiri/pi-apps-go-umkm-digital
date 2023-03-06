import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import logger from 'morgan';
import MongoStore from 'connect-mongo';
import { MongoClient } from 'mongodb';
import env from './environments';
import mountPaymentsEndpoints from './handlers/payments';
import mountUserEndpoints from './handlers/users';
const { WebSocketServer, WebSocket } = require('ws');
import http from 'http';
const uuidv4 = require('uuid').v4;
const colors = {
  FgGreen: '\x1b[32m',
  FgRed: '\x1b[31m'
}

// We must import typedefs for ts-node-dev to pick them up when they change (even though tsc would supposedly
// have no problem here)
// https://stackoverflow.com/questions/65108033/property-user-does-not-exist-on-type-session-partialsessiondata#comment125163548_65381085
import "./types/session";

const dbName = env.mongo_db_name;
const mongoUri = `mongodb://${env.mongo_host}/${dbName}`;
const mongoClientOptions = {
  authSource: "admin",
  auth: {
    username: env.mongo_user,
    password: env.mongo_password,
  },
}


//
// I. Initialize and set up the express app and various middlewares and packages:
//

const app: express.Application = express();

// Log requests to the console in a compact format:
app.use(logger('dev'));

// Full log of all requests to /log/access.log:
app.use(logger('common', {
  stream: fs.createWriteStream(path.join(__dirname, '..', 'log', 'access.log'), { flags: 'a' }),
}));

// Enable response bodies to be sent as JSON:
app.use(express.json())

// Handle CORS:
app.use(cors({
  origin: env.frontend_url,
  credentials: true
}));

// Handle cookies 🍪
app.use(cookieParser());

// Use sessions:
app.use(session({
  secret: env.session_secret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: mongoUri,
    mongoOptions: mongoClientOptions,
    dbName: dbName,
    collectionName: 'user_sessions'
  }),
}));


//
// II. Mount app endpoints:
//



// Payments endpoint under /payments:
const paymentsRouter = express.Router();
mountPaymentsEndpoints(paymentsRouter);
app.use('/pi/payments', paymentsRouter);

// User endpoints (e.g signin, signout) under /user:
const userRouter = express.Router();
mountUserEndpoints(userRouter);
app.use('/pi/user', userRouter);

// Hello World page to check everything works:
app.get('/pi', async (_, res) => {
  res.status(200).send({ message: "Hello, World!" });
});



// setup websocket
const server = http.createServer();
const wsServer = new WebSocketServer({ server });

// I'm maintaining all active connections in this object
const clients: any = {};
// I'm maintaining all active users in this object
const users: any = {};
// The current editor content is maintained here.
let editorContent: any = null;
// User activity history.
let userActivity: any = [];

// Event types
const typesDef: any = {
  USER_EVENT: 'userevent',
  CONTENT_CHANGE: 'contentchange'
}

function broadcastMessage(json: any) {
  // We are sending the current data to all connected clients
  const data = JSON.stringify(json);
  for(let userId in clients) {
    let client = clients[userId];
    if(client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  };
}

function handleMessage(message: any, userId: any) {
  const dataFromClient = JSON.parse(message.toString());
  const json: any = { type: dataFromClient.type };
  if (dataFromClient.type === typesDef.USER_EVENT) {
    users[userId] = dataFromClient;
    userActivity.push(`${dataFromClient.username} joined to edit the document`);
    json.data = { users, userActivity };
  } else if (dataFromClient.type === typesDef.CONTENT_CHANGE) {
    editorContent = dataFromClient.content;
    json.data = { editorContent, userActivity };
  }
  broadcastMessage(json);
}

function handleDisconnect(userId: any) {
    console.log(`${userId} disconnected.`);
    const json: any = { type: typesDef.USER_EVENT };
    const username = users[userId]?.username || userId;
    userActivity.push(`${username} left the document`);
    json.data = { users, userActivity };
    delete clients[userId];
    delete users[userId];
    broadcastMessage(json);
}

// A new client connection request received
wsServer.on('connection', (connection: any) => {
  // Generate a unique code for every user
  const userId = uuidv4();
  console.log(`Recieved a new connection.`);

  // Store the new connection and handle messages
  clients[userId] = connection;
  console.log(`${userId} connected.`);
  connection.on('message', (message: any) => handleMessage(message, userId));
  // User disconnected
  connection.on('close', () => handleDisconnect(userId));
});

// III. Boot up the app:
server.listen(8800, () => {
  console.log(`${colors.FgGreen}`, `✓ WebSocket server is running on port 8800!`);
});

app.listen(8000, async () => {
  try {
    const client = await MongoClient.connect(mongoUri, mongoClientOptions)
    const db = client.db(dbName);
    app.locals.orderCollection = db.collection('orders');
    app.locals.userCollection = db.collection('users');
    console.log(`${colors.FgGreen}`, '✓ Connected to MongoDB on: ', mongoUri)
  } catch (err) {
    console.error(`${colors.FgRed}`, 'Connection to MongoDB failed: ', err)
  }
  console.log(`${colors.FgGreen}`, '✓ App platform demo app - Backend listening on port 8000!');
  console.log(`${colors.FgGreen}`, `✓ CORS config: configured to respond to a frontend hosted on ${env.frontend_url}`);
});



