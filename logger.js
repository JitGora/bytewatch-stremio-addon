const { createLogger, transports, format } = require("winston");

module.exports = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
      format.timestamp(),
      format.colorize(),
      format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [ new transports.Console()  ],
});
