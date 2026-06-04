'use strict';
const pino = require('pino');

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: false,
      translateTime: 'SYS:yyyy-mm-dd HH:MM',
      ignore: 'pid,hostname',
      singleLine: true,
    },
  },
});

module.exports = logger;
