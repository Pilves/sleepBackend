import winston from 'winston';
import path from 'path';
import {config} from "../../config";

const logDir = path.join(__dirname, '../../logs');


const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
);

const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
);

const sensitivePatterns = [

    // email addresses
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },

    // api keys
    { pattern: /api[_-]?key[=:]["']?\w{20,}["']?/gi, replacement: 'api_key="[API_KEY]"' },

    // passwords
    { pattern: /"password":\s*"[^"]*"/g, replacement: '"password":"[REDACTED]"' },
]

const filterSensitiveData = winston.format((info) => {
    if (typeof info.message === 'string') {
        sensitivePatterns.forEach(({ pattern, replacement }) => {
            info.message = info.message.replace(pattern, replacement);
        });
    }
    return info;
});

export const logger = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(
        filterSensitiveData(),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
        winston.format.json(),
    ),
    defaultMeta: { service: 'sleep-game-api' },
    transports: [

        // console
        new winston.transports.Console({
            format: consoleFormat,
        }),

        // error file
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: '10485760', // 10mb
        }),

        // combined file
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            format: fileFormat,
            maxsize: '10485760', // 10mb
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log')
        })
    ]
});

export const addRequestContext = (requestId: string) => {
    return {
        debug: (message: string, meta = {}) => logger.debug(message, { requestId, ...meta }),
        info: (message: string, meta = {}) => logger.info(message, { requestId, ...meta }),
        warn: (message: string, meta = {}) => logger.warn(message, { requestId, ...meta }),
        error: (message: string, meta = {}) => logger.error(message, { requestId, ...meta })
    };
};

export default logger;
