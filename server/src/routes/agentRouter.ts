import { FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";
import { PromptRequestSchema } from "../protocol/schemas";
import { agentRunner } from "../agent/AgentRunner";
import { sql } from "../db/database";

const API_KEY = process.env.API_KEY ?? "change_me";

function validateApiKey(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return req.headers["x-api-key"] === API_KEY;
}

const agentRouter: FastifyPluginAsync = async (fastify) => {
  // Auth pre-handler for this plugin
  fastify.addHook("preHandler", async (req, reply) => {
    if (!validateApiKey(req)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  fastify.post("/agent/prompt", async (req, reply) => {
    let body: { prompt: string; session_id?: string };
    try {
      body = PromptRequestSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: "Invalid request", details: err.issues });
      }
      throw err;
    }

    const sessionId = agentRunner.enqueue(body.prompt, body.session_id);
    return reply.status(202).send({ session_id: sessionId });
  });

  fastify.get("/agent/history", async (_req, reply) => {
    const messages = await sql`
      SELECT id, session_id, role, content, created_at
      FROM messages
      ORDER BY id ASC
    `;
    return reply.send({ messages });
  });
};

export default agentRouter;
