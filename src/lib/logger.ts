import pino from "pino";
import { env } from "../env";

const opts: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
};
if (env.NODE_ENV !== "production") {
  opts.transport = { target: "pino/file", options: { destination: 1 } };
}
export const logger = pino(opts);
