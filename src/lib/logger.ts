import pino from "pino";
import { getConfig } from "../config";

const opts: pino.LoggerOptions = {
  level: getConfig().LOG_LEVEL,
};
if (process.env.NODE_ENV !== "production") {
  opts.transport = { target: "pino/file", options: { destination: 1 } };
}
export const logger = pino(opts);
