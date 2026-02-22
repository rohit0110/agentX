import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import healthRouter from "./routes/healthRouter";
import agentRouter from "./routes/agentRouter";
import wsRouter from "./routes/wsRouter";

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocketPlugin);

  await fastify.register(healthRouter);
  await fastify.register(agentRouter);
  await fastify.register(wsRouter);

  return fastify;
}
