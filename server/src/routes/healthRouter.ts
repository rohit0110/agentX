import { FastifyPluginAsync } from "fastify";

const healthRouter: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_req, reply) => {
    return reply.send({ ok: true, uptime: process.uptime() });
  });
};

export default healthRouter;
